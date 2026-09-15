import { DurableObject } from "cloudflare:workers";
import { RoomState, type RoomRecord } from "../lib/room-state";
import {
  hashToken,
  MAX_ROOM_BODY_BYTES,
  RoomError,
  secret,
} from "../lib/room-validation";
import { readRoomBody, roomResponse, roomToken } from "../lib/room-api";

type Attachment = { playerId: string; tokenHash: string };

/** One SQLite-backed, hibernating Durable Object per room code. */
export class RaceRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  private connected(): Set<string> {
    return new Set(
      this.ctx
        .getWebSockets()
        .filter((ws) => ws.readyState === WebSocket.OPEN)
        .map((ws) => (ws.deserializeAttachment() as Attachment).playerId),
    );
  }

  private send(ws: WebSocket, message: unknown) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      ws.close(1011, "Connection lost");
    }
  }

  private broadcast(state: RoomState) {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment;
      if (
        !state.record?.room.players.some((p) => p.id === attachment.playerId)
      ) {
        ws.close(4001, "Room session ended");
      } else
        this.send(ws, { type: "state", ...state.snapshot(this.connected()) });
    }
  }

  /** Roll back rejected operations; commit before broadcasting. No timers keep the object awake. */
  private async run<T>(
    operation: (state: RoomState) => Promise<T> | T,
    afterCommit?: (state: RoomState) => void,
  ): Promise<T> {
    const outcome = await this.ctx.blockConcurrencyWhile(async () => {
      const previous = (await this.ctx.storage.get<RoomRecord>("room")) ?? null;
      const state = new RoomState(structuredClone(previous), Date.now());
      state.maintain(this.connected());
      // Lifecycle maintenance must still be committed when a stale client is rejected.
      await this.commit(previous, state);
      const baseline = structuredClone(state.record);
      try {
        const result = await operation(state);
        await this.commit(baseline, state, afterCommit);
        return { ok: true as const, result };
      } catch (error) {
        // Let an invalid action fail without resetting the object or closing other sockets.
        return { ok: false as const, error };
      }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  }

  private async commit(
    previous: RoomRecord | null,
    state: RoomState,
    afterCommit?: (state: RoomState) => void,
  ) {
    const changed =
      JSON.stringify(previous?.room) !== JSON.stringify(state.record?.room);
    if (changed) {
      if (state.record) {
        state.record.revision = (previous?.revision ?? 0) + 1;
        await this.ctx.storage.put("room", state.record);
      } else await this.ctx.storage.deleteAll();
    }
    const alarm = state.nextAlarm();
    if (alarm === null) await this.ctx.storage.deleteAlarm();
    else if ((await this.ctx.storage.getAlarm()) !== alarm)
      await this.ctx.storage.setAlarm(alarm);
    afterCommit?.(state);
    if (changed) this.broadcast(state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/socket") {
      try {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          throw new RoomError(426, "WebSocket 연결이 필요합니다.");
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin)
          throw new RoomError(403, "이 사이트에서 다시 연결해 주세요.");
        const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
          .split(",")
          .map((p) => p.trim());
        if (!protocols.includes("draw-derby.v1"))
          throw new RoomError(400, "게임을 새로고침해 주세요.");
        const token =
          protocols.find((p) => /^token\.[a-f0-9]{48}$/.test(p))?.slice(6) ??
          "";
        const tokenHash = await hashToken(token);
        let client!: WebSocket;
        await this.run((state) => {
          const playerId = state.connect(tokenHash);
          // A refresh replaces the prior socket without duplicating the participant.
          for (const old of this.ctx.getWebSockets(playerId))
            old.close(4002, "Replaced by another connection");
          const pair = new WebSocketPair();
          client = pair[0];
          const server = pair[1];
          this.ctx.acceptWebSocket(server, [playerId]);
          server.serializeAttachment({
            playerId,
            tokenHash,
          } satisfies Attachment);
        });
        // A reconnect may not change stored state; it must always receive a snapshot.
        await this.run((state) => {
          const playerId = state.authenticate(tokenHash).id;
          for (const ws of this.ctx.getWebSockets(playerId))
            this.send(ws, {
              type: "state",
              ...state.snapshot(this.connected()),
            });
        });
        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: { "Sec-WebSocket-Protocol": "draw-derby.v1" },
        });
      } catch (error) {
        return roomResponse(() => {
          throw error;
        });
      }
    }
    return roomResponse(
      async () => {
        const body =
          request.method === "POST" ? await readRoomBody(request) : null;
        const token = roomToken(
          request,
          url.pathname === "/create" || url.pathname === "/join",
        );
        const generated = token ?? secret();
        const tokenHash = await hashToken(generated);
        let playerId = "";
        let snapshot: Record<string, unknown> | undefined;
        await this.run((state) => {
          if (url.pathname === "/create")
            playerId = state.create(
              url.searchParams.get("code")!,
              body,
              tokenHash,
            );
          else if (url.pathname === "/join")
            playerId = token
              ? state.authenticate(tokenHash).id
              : state.join(body, tokenHash);
          else if (url.pathname === "/snapshot") state.authenticate(tokenHash);
          else if (url.pathname === "/action") {
            state.act(tokenHash, body, this.connected());
            // The last leave still acknowledges successfully before its room disappears.
            if (!state.record) {
              snapshot = { left: true };
              return;
            }
          } else throw new RoomError(404, "알 수 없는 요청입니다.");
        });
        if (!snapshot)
          await this.run((state) => {
            snapshot = { ...state.snapshot(this.connected()) };
          });
        return playerId
          ? { ...snapshot, playerId, token: generated }
          : snapshot;
      },
      url.pathname === "/create" ? 201 : 200,
    );
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let id: string | undefined;
    try {
      if (
        typeof message !== "string" ||
        new TextEncoder().encode(message).length > MAX_ROOM_BODY_BYTES
      )
        throw new RoomError(
          413,
          "그림이 너무 복잡합니다. 선을 조금 줄여 주세요.",
        );
      const input = JSON.parse(message);
      if (!input || typeof input !== "object")
        throw new RoomError(400, "요청 형식을 확인해 주세요.");
      const attachment = ws.deserializeAttachment() as Attachment;
      if (input.type === "sync") {
        // One clock sample on connect/resume. Heartbeats use the hibernation auto-response.
        this.send(ws, {
          type: "sync",
          sentAt: input.sentAt,
          serverNow: Date.now(),
        });
        return;
      }
      if (
        typeof input.id !== "string" ||
        input.id.length > 64 ||
        input.type !== "action"
      )
        throw new RoomError(400, "알 수 없는 요청입니다.");
      id = input.id;
      const leaving = input.action?.action === "leave";
      await this.run(
        (state) => {
          state.act(attachment.tokenHash, input.action, this.connected());
        },
        (state) =>
          this.send(
            ws,
            leaving
              ? { type: "result", id, left: true }
              : { type: "result", id, ...state.snapshot(this.connected()) },
          ),
      );
    } catch (error) {
      const status =
        error instanceof RoomError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503;
      this.send(ws, {
        type: "error",
        id,
        status,
        error:
          error instanceof RoomError
            ? error.message
            : "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
      });
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    ws.close(
      [1005, 1006, 1015].includes(code) ? 1000 : code,
      "Connection closed",
    );
    await this.run(() => {});
  }

  async webSocketError(ws: WebSocket) {
    ws.close(1011, "Connection lost");
    await this.run(() => {});
  }

  async alarm() {
    await this.run(() => {});
  }
}
