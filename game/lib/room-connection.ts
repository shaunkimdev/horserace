import type { RoomAction, RoomResponse } from "./rooms";

type Credentials = { code: string; token: string };
type ActionResult = RoomResponse | { left: true };
type Callbacks = {
  state(data: RoomResponse): void;
  clock(offset: number): void;
  status(connected: boolean): void;
  ended(message: string): void;
};

/** Event-driven transport. Never poll room state or replay an uncertain mutation. */
export class RoomConnection {
  private socket: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastPong = 0;
  private sequence = 0;
  private pending = new Map<
    string,
    {
      resolve: (value: ActionResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private credentials: Credentials,
    private callbacks: Callbacks,
    private base = window.location.origin,
  ) {}

  start() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    const url = new URL(
      `/api/rooms/${this.credentials.code}/socket`,
      this.base,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, [
      "draw-derby.v1",
      `token.${this.credentials.token}`,
    ]);
    this.socket = ws;
    this.connectTimer = setTimeout(() => ws.close(), 10_000);
    ws.onopen = () => {
      if (this.stopped || this.socket !== ws) return ws.close();
      clearTimeout(this.connectTimer);
      this.retry = 0;
      this.lastPong = Date.now();
      this.callbacks.status(true);
      this.sync();
      this.heartbeat = setInterval(() => this.checkConnection(), 30_000);
    };
    ws.onmessage = (event) => {
      if (this.stopped || this.socket !== ws) return;
      if (event.data === "pong") {
        this.lastPong = Date.now();
        return;
      }
      try {
        const message = JSON.parse(String(event.data));
        if (
          message.type === "sync" &&
          Number.isFinite(message.sentAt) &&
          Number.isFinite(message.serverNow)
        ) {
          this.callbacks.clock(
            message.serverNow - (message.sentAt + Date.now()) / 2,
          );
        } else if (message.type === "state") this.callbacks.state(message);
        else if (message.type === "result" || message.type === "error") {
          const pending = this.pending.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.type === "error")
              pending.reject(new Error(message.error));
            else pending.resolve(message);
          }
          if (
            message.type === "error" &&
            [401, 404, 410].includes(message.status)
          )
            this.end(message.error);
        }
      } catch {
        ws.close(1002, "Invalid message");
      }
    };
    ws.onerror = () => {}; // onclose handles handshake failures and retry.
    ws.onclose = (event) => {
      if (this.stopped || this.socket !== ws) return;
      clearTimeout(this.connectTimer);
      clearInterval(this.heartbeat);
      this.rejectPending(
        "연결이 끊겨 요청 결과를 확인할 수 없어요. 재연결 후 상태를 확인해 주세요.",
      );
      if (event.code === 4001)
        return this.end("대기방이 만료되었어요. 새 방을 만들어 주세요.");
      if (event.code === 4002)
        return this.end("다른 탭에서 이 참가자로 연결했어요.");
      this.callbacks.status(false);
      void this.reconnect();
    };
  }

  private async reconnect() {
    // Only after a failed socket: identify expired credentials instead of retrying forever.
    try {
      const response = await fetch(
        new URL(`/api/rooms/${this.credentials.code}`, this.base),
        {
          headers: { Authorization: `Bearer ${this.credentials.token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      if (this.stopped) return;
      if ([401, 403, 404, 410].includes(response.status))
        return this.end("참가 정보가 만료되었어요. 방에 다시 입장해 주세요.");
    } catch {
      /* Offline: retry with backoff. */
    }
    if (!this.stopped)
      this.reconnectTimer = setTimeout(
        () => this.start(),
        Math.min(15_000, 1000 * 2 ** this.retry++) + Math.random() * 300,
      );
  }

  private sync() {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: "sync", sentAt: Date.now() }));
  }

  private checkConnection() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastPong > 75_000) {
      this.socket.close();
      return;
    }
    this.socket.send("ping");
  }

  resume() {
    this.checkConnection();
    this.sync();
  }

  action(action: RoomAction): Promise<ActionResult> {
    const ws = this.socket;
    if (this.stopped || ws?.readyState !== WebSocket.OPEN)
      return Promise.reject(
        new Error("서버에 다시 연결하고 있어요. 잠시 후 시도해 주세요."),
      );
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "응답이 늦어지고 있어요. 현재 방 상태를 확인한 후 다시 시도해 주세요.",
          ),
        );
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: "action", id, action }));
    });
  }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private end(message: string) {
    this.stop();
    this.callbacks.ended(message);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimer);
    clearInterval(this.heartbeat);
    this.rejectPending("방 연결을 종료했습니다.");
    this.socket?.close(1000, "Leaving page");
  }
}
