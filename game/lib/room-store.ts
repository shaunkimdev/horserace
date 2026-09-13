import { analyzeAnimal, DEFAULT_TRACK, generateRace, isTrackId, type Animal, type Participant, type Stroke, type TrackId } from './game';
import { ROOM_COLORS, ROOM_CAPACITY, ROOM_COUNTDOWN_MS, type Room, type RoomAction, type RoomPlayer, type RoomResponse, type RoomSession, type RoomRace } from './rooms';

export const MAX_ROOM_BODY_BYTES = 180_000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const CONNECTED_MS = 15_000;
const HOST_TRANSFER_MS = 20_000;
const STALE_PLAYER_MS = 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type StoredPlayer = Omit<RoomPlayer, 'connected'> & { tokenHash: string; lastSeenAt: number };
type StoredRoom = Omit<Room, 'players'> & { players: StoredPlayer[] };
type RoomRow = { code: string; data: string; version: number; expires_at: number };

/** The narrow D1 interface also allows real concurrency tests without Worker globals. */
export type RoomDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes?: number } }>;
    };
  };
};

export class RoomError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RoomError(400, '요청 형식을 확인해 주세요.');
  return value as Record<string, unknown>;
}

function name(value: unknown, fallback?: string, limit = 20): string {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== 'string') throw new RoomError(400, '이름을 입력해 주세요.');
  const clean = Array.from(value).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').trim();
  if (!clean || clean.length > limit) throw new RoomError(400, `이름을 1~${limit}자로 입력해 주세요.`);
  return clean;
}

export function sanitizeAnimal(value: unknown): Animal {
  const animal = object(value);
  if (!Array.isArray(animal.strokes) || animal.strokes.length < 1 || animal.strokes.length > 80) {
    throw new RoomError(400, '동물을 1~80개의 선으로 그려 주세요.');
  }
  let pointCount = 0;
  const strokes: Stroke[] = animal.strokes.map((value) => {
    const stroke = object(value);
    if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 1500) {
      throw new RoomError(400, '그림의 선이 너무 길거나 짧습니다. 다시 그려 주세요.');
    }
    pointCount += stroke.points.length;
    if (pointCount > 8000) throw new RoomError(413, '그림이 너무 복잡합니다. 선을 조금 줄여 주세요.');
    if (typeof stroke.color !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(stroke.color)) {
      throw new RoomError(400, '올바른 펜 색상을 선택해 주세요.');
    }
    return {
      color: stroke.color,
      points: stroke.points.map((value) => {
        const point = object(value);
        if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 440) {
          throw new RoomError(400, '그림은 캔버스 안에 그려 주세요.');
        }
        return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
      }),
    };
  });
  const result = { name: name(animal.name, '나의 동물', 24), strokes };
  const stats = analyzeAnimal(strokes);
  if (!stats.valid) throw new RoomError(400, stats.reason || '몸통과 다리가 보이도록 동물을 그려 주세요.');
  return result;
}

export function normalizeRoomCode(value: unknown): string {
  if (typeof value !== 'string') throw new RoomError(400, '6자리 방 코드를 입력해 주세요.');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new RoomError(400, '6자리 방 코드를 입력해 주세요.');
  return code;
}

function secret(bytes = 24): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new RoomError(401, '참가 정보가 만료되었습니다. 방에 다시 입장해 주세요.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function publicRoom(room: StoredRoom, now: number): Room {
  return {
    trackId:room.trackId??DEFAULT_TRACK,
    code: room.code, hostId: room.hostId, phase: room.phase, race: room.race, expiresAt: room.expiresAt,
    players: room.players.map(({ id, name, color, animal, ready, lastSeenAt }) => ({
      id, name, color, animal, ready, connected: now - lastSeenAt <= CONNECTED_MS,
    })),
  };
}

function maintainRoom(room: StoredRoom, now: number) {
  if (room.phase === 'racing' && room.race && now >= room.race.startedAt + room.race.durationMs) room.phase = 'finished';
  if (room.phase !== 'racing') room.players = room.players.filter((player) => now - player.lastSeenAt <= STALE_PLAYER_MS);
  const host = room.players.find((player) => player.id === room.hostId);
  if (!host || now - host.lastSeenAt > HOST_TRANSFER_MS) {
    const nextHost = room.players.find((player) => now - player.lastSeenAt <= CONNECTED_MS) || room.players[0];
    if (nextHost) room.hostId = nextHost.id;
  }
  room.expiresAt = now + ROOM_TTL_MS;
}

export class RoomStore {
  constructor(private db: RoomDatabase, private now: () => number = Date.now) {}

  private async read(code: string, now: number): Promise<{ room: StoredRoom; version: number }> {
    const row = await this.db.prepare('SELECT code, data, version, expires_at FROM race_rooms WHERE code = ? AND expires_at > ?')
      .bind(code, now).first<RoomRow>();
    if (!row) throw new RoomError(404, '방을 찾을 수 없거나 만료되었습니다. 방 코드를 확인해 주세요.');
    const room=JSON.parse(row.data) as StoredRoom;
    room.trackId??=DEFAULT_TRACK;
    if(room.race)room.race.trackId??=DEFAULT_TRACK;
    return { room, version: row.version };
  }

  private async change(code: string, update: (room: StoredRoom, now: number) => void): Promise<RoomResponse> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const now = this.now();
      const { room, version } = await this.read(code, now);
      update(room, now);
      const result = room.players.length
        ? await this.db.prepare('UPDATE race_rooms SET data = ?, version = version + 1, expires_at = ? WHERE code = ? AND version = ? AND expires_at > ?')
          .bind(JSON.stringify(room), room.expiresAt, code, version, now).run()
        : await this.db.prepare('DELETE FROM race_rooms WHERE code = ? AND version = ?').bind(code, version).run();
      if (result.meta.changes === 1) return { room: publicRoom(room, now), serverNow: now, revision: version + 1 };
    }
    throw new RoomError(409, '다른 참가자의 변경을 반영 중입니다. 한 번 더 시도해 주세요.');
  }

  async create(value: unknown): Promise<RoomSession> {
    const body = object(value);
    const trackId=body.trackId??DEFAULT_TRACK;
    if(!isTrackId(trackId))throw new RoomError(400,'선택한 트랙을 확인해 주세요.');
    const playerName = name(body.name);
    const animal = body.animal === undefined || body.animal === null ? null : sanitizeAnimal(body.animal);
    const token = secret();
    const tokenHash = await hashToken(token);
    const id = secret(12);
    const now = this.now();
    await this.db.prepare('DELETE FROM race_rooms WHERE expires_at <= ?').bind(now).run();
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
      const room: StoredRoom = {
        trackId,
        code, hostId: id, phase: 'lobby', race: null, expiresAt: now + ROOM_TTL_MS,
        players: [{ id, name: playerName, color: ROOM_COLORS[0], animal, ready: false, tokenHash, lastSeenAt: now }],
      };
      const result = await this.db.prepare('INSERT INTO race_rooms (code, data, version, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(code) DO NOTHING')
        .bind(code, JSON.stringify(room), room.expiresAt).run();
      if (result.meta.changes === 1) return { room: publicRoom(room, now), serverNow: now, revision: 1, playerId: id, token };
    }
    throw new RoomError(503, '방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  async join(value: unknown, existingToken?: string): Promise<RoomSession> {
    const body = object(value);
    const code = normalizeRoomCode(body.code);
    if (existingToken) {
      const tokenHash = await hashToken(existingToken);
      let playerId = '';
      const response = await this.change(code, (room, now) => {
        const player = this.authenticate(room, tokenHash);
        playerId = player.id;
        player.lastSeenAt = now;
        maintainRoom(room, now);
      });
      return { ...response, playerId, token: existingToken };
    }
    const playerName = name(body.name);
    const animal = body.animal === undefined || body.animal === null ? null : sanitizeAnimal(body.animal);
    const token = secret();
    const tokenHash = await hashToken(token);
    const id = secret(12);
    const response = await this.change(code, (room, now) => {
      maintainRoom(room, now);
      if (room.phase !== 'lobby') throw new RoomError(409, '레이스가 진행 중입니다. 다음 레이스를 기다려 주세요.');
      if (room.players.length >= ROOM_CAPACITY) throw new RoomError(409, '이 방은 가득 찼습니다. 최대 4명까지 참가할 수 있어요.');
      const color = ROOM_COLORS.find((color) => !room.players.some((player) => player.color === color))!;
      room.players.push({ id, name: playerName, color, animal, ready: false, tokenHash, lastSeenAt: now });
      if (room.players.length === 1) room.hostId = id;
    });
    return { ...response, playerId: id, token };
  }

  private authenticate(room: StoredRoom, tokenHash: string): StoredPlayer {
    const player = room.players.find((player) => player.tokenHash === tokenHash);
    if (!player) throw new RoomError(401, '참가 정보가 만료되었습니다. 방에 다시 입장해 주세요.');
    return player;
  }

  async get(rawCode: string, token: string): Promise<RoomResponse> {
    const code = normalizeRoomCode(rawCode);
    const tokenHash = await hashToken(token);
    return this.change(code, (room, now) => {
      this.authenticate(room, tokenHash).lastSeenAt = now;
      maintainRoom(room, now);
    });
  }

  async act(rawCode: string, token: string, value: unknown): Promise<RoomResponse> {
    const code = normalizeRoomCode(rawCode);
    const tokenHash = await hashToken(token);
    const input = object(value);
    const action = input.action as RoomAction['action'];
    if (!['animal', 'ready', 'start', 'rematch', 'leave','track'].includes(action)) throw new RoomError(400, '알 수 없는 요청입니다.');
    if(action==='track'&&!isTrackId(input.trackId))throw new RoomError(400,'선택한 트랙을 확인해 주세요.');
    const animal = action === 'animal' ? sanitizeAnimal(input.animal) : null;
    if (action === 'ready' && typeof input.ready !== 'boolean') throw new RoomError(400, '준비 상태를 확인해 주세요.');
    return this.change(code, (room, now) => {
      const player = this.authenticate(room, tokenHash);
      player.lastSeenAt = now;
      maintainRoom(room, now);
      if (action === 'leave') {
        room.players = room.players.filter((member) => member.id !== player.id);
        maintainRoom(room, now);
        return;
      }
      if (action === 'start' || action === 'rematch' || action==='track') {
        if (room.hostId !== player.id) throw new RoomError(403, '방장만 트랙을 변경하거나 레이스를 시작·재개할 수 있습니다.');
      }
      if (action === 'rematch') {
        if (room.phase !== 'finished') throw new RoomError(409, '레이스가 끝나면 다시 달릴 수 있습니다.');
        room.phase = 'lobby';
        room.race = null;
        for (const member of room.players) member.ready = false;
        return;
      }
      if (room.phase !== 'lobby') throw new RoomError(409, '레이스 중에는 동물이나 준비 상태를 바꿀 수 없습니다.');
      if(action==='track') {
        if(room.trackId!==input.trackId){room.trackId=input.trackId as TrackId;for(const member of room.players)member.ready=false;}
      } else if (action === 'animal') {
        player.animal = animal;
        player.name = animal!.name.slice(0, 20);
        player.ready = false;
      } else if (action === 'ready') {
        if (input.ready && (!player.animal || !analyzeAnimal(player.animal.strokes).valid)) throw new RoomError(400, '먼저 몸통과 다리가 있는 동물을 그려 주세요.');
        player.ready = input.ready as boolean;
      } else if (action === 'start') {
        if (room.players.length < 2) throw new RoomError(409, '친구가 입장하면 시작할 수 있어요. 최소 2명이 필요합니다.');
        if (room.players.some((member) => !member.ready || !member.animal)) throw new RoomError(409, '모든 참가자가 준비를 마쳐야 시작할 수 있습니다.');
        if (room.players.some((member) => now - member.lastSeenAt > CONNECTED_MS)) throw new RoomError(409, '연결이 끊긴 참가자를 기다리는 중입니다. 1분 후 자동으로 퇴장합니다.');
        const players = room.players.map(({ id, name, color, animal }) => ({ id, name, color, animal: animal! })) satisfies Participant[];
        const seed = secret(12);
        const simulation = generateRace(players, seed,room.trackId);
        const race: RoomRace = {
          trackId:room.trackId,
          seed, startedAt: now + ROOM_COUNTDOWN_MS, durationMs: Math.ceil(simulation.duration * 1000), players,
          results: simulation.results.map((result) => ({
            playerId: result.id, finishTimeMs: Math.round(result.time * 1000), rank: result.place,
            collisions: result.collisions, jumps: result.jumps,
          })),
        };
        room.race = race;
        room.phase = 'racing';
      }
    });
  }
}
