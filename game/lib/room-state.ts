import { DEFAULT_TRACK, generateRace, isTrackId, type Animal } from "./game";
import {
  ROOM_DEFAULT_CAPACITY,
  ROOM_COLORS,
  ROOM_COUNTDOWN_MS,
  type Room,
  type RoomPlayer,
  type RoomResponse,
} from "./rooms";
import {
  inputObject,
  playerName,
  roomCapacity,
  RoomError,
  sanitizeAnimal,
  secret,
} from "./room-validation";

export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
export const HOST_TRANSFER_MS = 20_000;
export const STALE_PLAYER_MS = 60_000;
type StoredPlayer = Omit<RoomPlayer, "connected"> & {
  tokenHash: string;
  disconnectedAt: number | null;
};
export type StoredRoom = Omit<Room, "players"> & { players: StoredPlayer[] };
export type RoomRecord = { room: StoredRoom; revision: number };

/** Pure rules. The Durable Object serializes and persists each successful change. */
export class RoomState {
  constructor(
    public record: RoomRecord | null,
    private now: number,
  ) {
    // Rooms persisted before adjustable capacity keep their original four seats.
    if (record) record.room.capacity ??= ROOM_DEFAULT_CAPACITY;
  }

  requireRoom(): StoredRoom {
    if (!this.record)
      throw new RoomError(
        404,
        "방을 찾을 수 없거나 만료되었습니다. 방 코드를 확인해 주세요.",
      );
    return this.record.room;
  }

  authenticate(tokenHash: string): StoredPlayer {
    const player = this.requireRoom().players.find(
      (p) => p.tokenHash === tokenHash,
    );
    if (!player)
      throw new RoomError(
        401,
        "참가 정보가 만료되었습니다. 방에 다시 입장해 주세요.",
      );
    return player;
  }

  create(code: string, value: unknown, tokenHash: string): string {
    if (this.record) throw new RoomError(409, "이미 사용 중인 방 코드입니다.");
    const body = inputObject(value);
    const capacity = roomCapacity(body.capacity === undefined ? ROOM_DEFAULT_CAPACITY : body.capacity);
    const trackId = body.trackId ?? DEFAULT_TRACK;
    if (!isTrackId(trackId))
      throw new RoomError(400, "선택한 트랙을 확인해 주세요.");
    this.record = {
      revision: 0,
      room: {
        capacity,
        code,
        trackId,
        hostId: "",
        phase: "lobby",
        race: null,
        players: [],
        expiresAt: this.now + ROOM_TTL_MS,
      },
    };
    const id = this.join(body, tokenHash);
    this.record.room.hostId = id;
    return id;
  }

  join(value: unknown, tokenHash: string): string {
    const room = this.requireRoom();
    if (room.phase !== "lobby")
      throw new RoomError(
        409,
        "레이스가 진행 중입니다. 다음 레이스를 기다려 주세요.",
      );
    if (room.players.length >= room.capacity)
      throw new RoomError(
        409,
        `이 방은 가득 찼습니다. 정원은 ${room.capacity}명이에요.`,
      );
    const body = inputObject(value);
    const name = playerName(body.name);
    const animal = body.animal == null ? null : sanitizeAnimal(body.animal);
    const id = secret(12);
    const color = ROOM_COLORS.find(
      (c) => !room.players.some((p) => p.color === c),
    )!;
    room.players.push({
      id,
      name,
      animal,
      color,
      ready: false,
      tokenHash,
      disconnectedAt: this.now,
    });
    room.expiresAt = this.now + ROOM_TTL_MS;
    return id;
  }

  connect(tokenHash: string): string {
    const player = this.authenticate(tokenHash);
    player.disconnectedAt = null;
    this.requireRoom().expiresAt = this.now + ROOM_TTL_MS;
    return player.id;
  }

  /** Open hibernating sockets are authoritative for presence, never periodic DB writes. */
  maintain(connected: ReadonlySet<string>): void {
    if (!this.record) return;
    const room = this.record.room;
    if (this.now >= room.expiresAt) {
      if (!connected.size) {
        this.record = null;
        return;
      }
      room.expiresAt = this.now + ROOM_TTL_MS;
    }
    for (const player of room.players) {
      if (connected.has(player.id)) player.disconnectedAt = null;
      else if (player.disconnectedAt === null) player.disconnectedAt = this.now;
    }
    if (
      room.phase === "racing" &&
      room.race &&
      this.now >= room.race.startedAt + room.race.durationMs
    )
      room.phase = "finished";
    if (room.phase !== "racing")
      room.players = room.players.filter(
        (p) =>
          p.disconnectedAt === null ||
          this.now < p.disconnectedAt + STALE_PLAYER_MS,
      );
    if (!room.players.length) {
      this.record = null;
      return;
    }
    const host = room.players.find((p) => p.id === room.hostId);
    if (
      !host ||
      (host.disconnectedAt !== null &&
        this.now >= host.disconnectedAt + HOST_TRANSFER_MS)
    ) {
      room.hostId = (
        room.players.find((p) => connected.has(p.id)) || room.players[0]
      ).id;
    }
  }

  act(tokenHash: string, value: unknown, connected: ReadonlySet<string>): void {
    const room = this.requireRoom();
    const player = this.authenticate(tokenHash);
    const input = inputObject(value);
    const action = input.action;
    if (
      !["animal", "ready", "start", "rematch", "leave", "track", "capacity"].includes(
        String(action),
      )
    )
      throw new RoomError(400, "알 수 없는 요청입니다.");
    if (action === "leave") {
      room.players = room.players.filter((p) => p.id !== player.id);
      if (!room.players.length) this.record = null;
      else this.maintain(connected);
      return;
    }
    if (
      ["track", "capacity", "start", "rematch"].includes(String(action)) &&
      room.hostId !== player.id
    )
      throw new RoomError(
        403,
        "방장만 방 설정을 변경하거나 레이스를 시작·재개할 수 있습니다.",
      );
    if (action === "rematch") {
      if (room.phase !== "finished")
        throw new RoomError(409, "레이스가 끝나면 다시 달릴 수 있습니다.");
      room.phase = "lobby";
      room.race = null;
      for (const member of room.players) member.ready = false;
      room.expiresAt = this.now + ROOM_TTL_MS;
      return;
    }
    if (room.phase !== "lobby")
      throw new RoomError(
        409,
        "레이스 중에는 동물이나 준비 상태를 바꿀 수 없습니다.",
      );
    if (action === "capacity") {
      const capacity = roomCapacity(input.capacity);
      if (capacity < room.players.length)
        throw new RoomError(409, "현재 참가한 인원보다 정원을 줄일 수 없어요.");
      room.capacity = capacity;
    } else if (action === "track") {
      if (!isTrackId(input.trackId))
        throw new RoomError(400, "선택한 트랙을 확인해 주세요.");
      if (room.trackId !== input.trackId) {
        room.trackId = input.trackId;
        for (const member of room.players) member.ready = false;
      }
    } else if (action === "animal") {
      player.animal = sanitizeAnimal(input.animal);
      player.name = player.animal.name.slice(0, 20);
      player.ready = false;
    } else if (action === "ready") {
      if (typeof input.ready !== "boolean")
        throw new RoomError(400, "준비 상태를 확인해 주세요.");
      if (input.ready && !player.animal)
        throw new RoomError(400, "먼저 몸통과 다리가 있는 동물을 그려 주세요.");
      player.ready = input.ready;
    } else if (action === "start") {
      if (room.players.length < 2)
        throw new RoomError(409, "최소 2명이 필요합니다.");
      if (room.players.some((p) => !p.ready || !p.animal))
        throw new RoomError(
          409,
          "모든 참가자가 준비를 마쳐야 시작할 수 있습니다.",
        );
      if (room.players.some((p) => !connected.has(p.id)))
        throw new RoomError(
          409,
          "연결이 끊긴 참가자를 기다리는 중입니다. 1분 후 자동으로 퇴장합니다.",
        );
      const players = room.players.map(({ id, name, color, animal }) => ({
        id,
        name,
        color,
        animal: animal as Animal,
      }));
      const seed = secret(12);
      const simulation = generateRace(players, seed, room.trackId);
      room.race = {
        players,
        seed,
        trackId: room.trackId,
        startedAt: this.now + ROOM_COUNTDOWN_MS,
        durationMs: Math.ceil(simulation.duration * 1000),
        results: simulation.results.map((r) => ({
          playerId: r.id,
          finishTimeMs: Math.round(r.time * 1000),
          rank: r.place,
          collisions: r.collisions,
          jumps: r.jumps,
        })),
      };
      room.phase = "racing";
    }
    room.expiresAt = this.now + ROOM_TTL_MS;
  }

  snapshot(connected: ReadonlySet<string>): RoomResponse {
    const room = this.requireRoom();
    return {
      revision: this.record!.revision,
      serverNow: this.now,
      room: {
        ...room,
        players: room.players.map(({ id, name, color, animal, ready }) => ({
          id,
          name,
          color,
          animal,
          ready,
          connected: connected.has(id),
        })),
      },
    };
  }

  nextAlarm(): number | null {
    if (!this.record) return null;
    const room = this.record.room;
    const times = [room.expiresAt];
    if (room.phase === "racing" && room.race)
      times.push(room.race.startedAt + room.race.durationMs);
    for (const player of room.players) {
      if (player.disconnectedAt === null) continue;
      if (
        player.id === room.hostId &&
        player.disconnectedAt + HOST_TRANSFER_MS > this.now
      )
        times.push(player.disconnectedAt + HOST_TRANSFER_MS);
      if (room.phase !== "racing")
        times.push(player.disconnectedAt + STALE_PLAYER_MS);
    }
    return Math.max(this.now + 1, Math.min(...times));
  }
}
