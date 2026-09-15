import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = async (source) =>
  (
    await build({
      stdin: { contents: source, resolveDir: root, loader: "ts" },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["cloudflare:workers"],
    })
  ).outputFiles[0].text;
const domain = await bundle(
  "export * from './lib/game'; export * from './lib/room-state'; export * from './lib/room-validation';",
);
const {
  SAMPLE_ANIMALS,
  generateRace,
  RoomState,
  hashToken,
  sanitizeAnimal,
  RoomError,
} = await import(
  `data:text/javascript;base64,${Buffer.from(domain).toString("base64")}`
);
const profile = (i = 0) => ({
  name: `Player ${i}`,
  animal: structuredClone(SAMPLE_ANIMALS[i % 4]),
});
const connected = (state) =>
  new Set(state.record.room.players.map((p) => p.id));
const status = (code) => (error) =>
  error instanceof RoomError && error.status === code;

test("state rules enforce capacity, credentials, host privileges and all tracks", async () => {
  for (const trackId of ["straight", "oval", "zigzag", "woodland"]) {
    const state = new RoomState(null, 1_900_000_000_000);
    const host = state.create("ABC234", { ...profile(), trackId }, "host");
    const guest = state.join(profile(1), "guest");
    state.join(profile(2), "third");
    state.join(profile(3), "fourth");
    assert.throws(() => state.join(profile(), "fifth"), status(409));
    assert.throws(() => state.authenticate("invented"), status(401));
    assert.throws(
      () => state.act("guest", { action: "start" }, connected(state)),
      status(403),
    );
    assert.throws(
      () => state.act("host", { action: "start" }, connected(state)),
      status(409),
    );
    for (const token of ["host", "guest", "third", "fourth"])
      state.act(token, { action: "ready", ready: true }, connected(state));
    state.act("host", { action: "start" }, connected(state));
    const race = state.record.room.race;
    assert.equal(race.trackId, trackId);
    assert.deepEqual(
      race.results.map((r) => r.playerId),
      generateRace(race.players, race.seed, trackId).results.map((r) => r.id),
    );
    assert.throws(
      () =>
        state.act(
          "host",
          { action: "track", trackId: "oval" },
          connected(state),
        ),
      status(409),
    );
    assert.throws(
      () => state.act("host", { action: "rematch" }, connected(state)),
      status(409),
    );
    state.act("host", { action: "leave" }, connected(state));
    assert.equal(state.record.room.hostId, guest);
    assert.ok(race.players.some((p) => p.id === host));
    const publicData = JSON.stringify(state.snapshot(connected(state)));
    assert.ok(!publicData.includes("tokenHash"));
    assert.ok(!publicData.includes("disconnectedAt"));
  }
  for (const value of [
    null,
    { strokes: [] },
    {
      ...profile().animal,
      strokes: Array(81).fill(profile().animal.strokes[0]),
    },
  ])
    assert.throws(() => sanitizeAnimal(value));
  const bad = profile().animal;
  bad.strokes[0].points[0].x = Infinity;
  assert.throws(() => sanitizeAnimal(bad), status(400));
  assert.throws(
    () =>
      new RoomState(null, Date.now()).create(
        "ABC234",
        { ...profile(), trackId: "unknown" },
        "a",
      ),
    status(400),
  );
  await assert.rejects(hashToken(""), status(401));
});

test("capacity defaults to four, persists across upgrades, and only the host can choose 2-8 seats", () => {
  const state = new RoomState(null, Date.now());
  state.create("ABC234", profile(), "host");
  assert.equal(state.record.room.capacity, 4);
  const legacy = structuredClone(state.record);
  delete legacy.room.capacity;
  assert.equal(new RoomState(legacy, Date.now()).snapshot(new Set()).room.capacity, 4);
  for (const capacity of [null, 1, 9, 3.5, "8", NaN]) {
    assert.throws(() => state.act("host", { action: "capacity", capacity }, connected(state)), status(400));
    assert.throws(() => new RoomState(null, Date.now()).create("ABC234", { ...profile(), capacity }, "host"), status(400));
  }
  for (const capacity of [2, 8]) {
    const room = new RoomState(null, Date.now());
    room.create("ABC234", { ...profile(), capacity }, "host");
    for (let i = 1; i < capacity; i++) room.join(profile(i), `guest-${i}`);
    assert.equal(new Set(room.record.room.players.map(p => p.color)).size, capacity);
    assert.throws(() => room.join(profile(), "overflow"), status(409));
    assert.throws(() => room.act("guest-1", { action: "capacity", capacity: 4 }, connected(room)), status(403));
    if (capacity === 8) assert.throws(() => room.act("host", { action: "capacity", capacity: 7 }, connected(room)), status(409));
    for (const p of room.record.room.players) room.act(p.tokenHash, { action: "ready", ready: true }, connected(room));
    room.act("host", { action: "start" }, connected(room));
    assert.equal(room.record.room.race.results.length, capacity);
    assert.throws(() => room.act("host", { action: "capacity", capacity: 8 }, connected(room)), status(409));
  }
  state.act("host", { action: "capacity", capacity: 8 }, connected(state));
  assert.equal(new RoomState(structuredClone(state.record), Date.now()).snapshot(connected(state)).room.capacity, 8);
  state.act("host", { action: "capacity", capacity: 2 }, connected(state));
  assert.equal(state.record.room.capacity, 2);
});

test("quiet sockets stay present; disconnection transfers host and removes absent players on deadlines", () => {
  const now = 1_900_000_000_000;
  const state = new RoomState(null, now);
  const host = state.create("ABC234", profile(), "host");
  const guest = state.join(profile(1), "guest");
  state.connect("host");
  state.connect("guest");
  const quiet = new RoomState(structuredClone(state.record), now + 90_000);
  quiet.maintain(new Set([host, guest]));
  assert.equal(quiet.record.room.players.length, 2);
  assert.equal(quiet.record.room.hostId, host);
  quiet.maintain(new Set([guest]));
  const transferred = new RoomState(quiet.record, now + 110_000);
  transferred.maintain(new Set([guest]));
  assert.equal(transferred.record.room.hostId, guest);
  const removed = new RoomState(transferred.record, now + 150_000);
  removed.maintain(new Set([guest]));
  assert.equal(removed.record.room.players.length, 1);
  assert.throws(() => removed.authenticate("host"), status(401));
  const expired = new RoomState(removed.record, now + 8_000_000);
  expired.maintain(new Set());
  assert.equal(expired.record, null);
});

test("track edits revoke readiness; server time finishes races; rematch preserves drawings", () => {
  const now = 1_900_000_000_000;
  const state = new RoomState(null, now);
  state.create("ABC234", profile(), "host");
  state.join(profile(1), "guest");
  for (const token of ["host", "guest"]) {
    state.connect(token);
    state.act(token, { action: "ready", ready: true }, connected(state));
  }
  state.act("host", { action: "track", trackId: "oval" }, connected(state));
  assert.ok(state.record.room.players.every((p) => !p.ready));
  for (const token of ["host", "guest"])
    state.act(token, { action: "ready", ready: true }, connected(state));
  assert.throws(
    () => state.act("host", { action: "start" }, new Set()),
    status(409),
  );
  state.act("host", { action: "start" }, connected(state));
  const race = state.record.room.race;
  const finish = new RoomState(state.record, race.startedAt + race.durationMs);
  finish.maintain(connected(finish));
  assert.equal(finish.record.room.phase, "finished");
  finish.act("host", { action: "rematch" }, connected(finish));
  assert.equal(finish.record.room.race, null);
  assert.ok(finish.record.room.players.every((p) => !p.ready && p.animal));
});

let mf, options, persistence;
const sockets = new Set();
before(async () => {
  persistence = await mkdtemp(join(tmpdir(), "draw-derby-do-"));
  // These inspection routes are in the test subclass only, never in the production Worker.
  const script = await bundle(`
    import { RaceRoom as ProductionRoom } from './worker/race-room';
    import { routeRoomRequest } from './worker/room-router';
    export class RaceRoom extends ProductionRoom {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/__inspect') return Response.json(await this.ctx.storage.get('room') ?? null);
        if (path === '/__finish') {
          const record = await this.ctx.storage.get('room');
          record.room.race.startedAt = Date.now() - record.room.race.durationMs;
          await this.ctx.storage.put('room', record);
          await this.ctx.storage.setAlarm(Date.now() + 50);
          return new Response('ok');
        }
        return super.fetch(request);
      }
    }
    export default { fetch: (request, env) => routeRoomRequest(request, env) };
  `);
  options = {
    modules: true,
    script,
    compatibilityDate: "2026-04-01",
    durableObjects: { RACE_ROOMS: { className: "RaceRoom", useSQLite: true } },
    durableObjectsPersist: persistence,
  };
  mf = new Miniflare(options);
  await mf.ready;
});
after(async () => {
  for (const ws of sockets)
    try {
      ws.close();
    } catch {
      /* Already closed. */
    }
  await mf?.dispose();
  if (
    persistence &&
    resolve(persistence).startsWith(resolve(tmpdir()) + sep + "draw-derby-do-")
  )
    await rm(persistence, { recursive: true, force: true });
});
async function request(path, body, token, headers = {}) {
  const response = await mf.dispatchFetch(`https://race.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: await response.json(),
    headers: response.headers,
  };
}
async function inspect(code, path = "/__inspect") {
  const ns = await mf.getDurableObjectNamespace("RACE_ROOMS");
  const response = await ns
    .get(ns.idFromName(code))
    .fetch(`https://race.example${path}`);
  return path === "/__inspect" ? response.json() : response.text();
}
function peer(ws) {
  const queue = [],
    waiters = [];
  ws.addEventListener("message", (event) => {
    const data = event.data === "pong" ? "pong" : JSON.parse(event.data);
    const index = waiters.findIndex((w) => w.predicate(data));
    if (index >= 0) {
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(data);
    } else queue.push(data);
  });
  const next = (predicate) => {
    const index = queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error("WebSocket message timed out"));
        }, 6000),
      };
      waiters.push(waiter);
    });
  };
  let sequence = 0;
  return {
    ws,
    next,
    async act(action) {
      const id = String(++sequence);
      ws.send(JSON.stringify({ type: "action", id, action }));
      return next((m) => m.id === id);
    },
  };
}
async function connect(session) {
  const response = await mf.dispatchFetch(
    `https://race.example/api/rooms/${session.room.code}/socket`,
    {
      headers: {
        Upgrade: "websocket",
        Origin: "https://race.example",
        "Sec-WebSocket-Protocol": `draw-derby.v1, token.${session.token}`,
      },
    },
  );
  assert.equal(response.status, 101);
  assert.equal(response.headers.get("Sec-WebSocket-Protocol"), "draw-derby.v1");
  const ws = response.webSocket;
  const client = peer(ws);
  sockets.add(ws);
  ws.accept();
  await client.next((m) => m.type === "state");
  return client;
}

test("SQLite Durable Object serializes simultaneous joins and pushes one race to four sockets", async () => {
  const host = (await request("/api/rooms", profile())).data;
  const code = host.room.code;
  const clients = [await connect(host)];
  const joins = await Promise.all(
    Array.from({ length: 9 }, (_, i) =>
      request("/api/rooms/join", { code, ...profile(i + 1) }),
    ),
  );
  assert.equal(joins.filter((r) => r.status === 200).length, 3);
  assert.equal(joins.filter((r) => r.status === 409).length, 6);
  const sessions = [
    host,
    ...joins.filter((r) => r.status === 200).map((r) => r.data),
  ];
  for (const session of sessions.slice(1)) clients.push(await connect(session));
  assert.equal((await clients[1].act({ action: "start" })).status, 403);
  for (const client of clients)
    assert.equal(
      (await client.act({ action: "ready", ready: true })).type,
      "result",
    );
  const start = await clients[0].act({ action: "start" });
  assert.equal(start.type, "result");
  for (const client of clients) {
    const pushed = await client.next(
      (m) => m.type === "state" && m.room.phase === "racing",
    );
    assert.deepEqual(pushed.room.race, start.room.race);
    assert.ok(!JSON.stringify(pushed).includes("tokenHash"));
  }
  const reconnect = await connect(sessions[1]);
  const snapshot = (
    await request(`/api/rooms/${code}`, undefined, sessions[1].token)
  ).data;
  assert.equal(snapshot.room.players.length, 4);
  assert.equal(snapshot.room.race.seed, start.room.race.seed);
  await inspect(code, "/__finish");
  await reconnect.next(
    (m) => m.type === "state" && m.room.phase === "finished",
  );
  assert.equal(
    (await clients[0].act({ action: "rematch" })).room.phase,
    "lobby",
  );
  for (const client of clients) client.ws.close();
  reconnect.ws.close();
});

test("idle snapshots, clock sync and hibernation heartbeats do not write room data", async () => {
  const host = (await request("/api/rooms", profile())).data;
  const client = await connect(host);
  const before = await inspect(host.room.code);
  for (let i = 0; i < 8; i++) {
    client.ws.send("ping");
    assert.equal(await client.next((m) => m === "pong"), "pong");
    client.ws.send(JSON.stringify({ type: "sync", sentAt: 123 }));
    assert.equal((await client.next((m) => m.type === "sync")).sentAt, 123);
    assert.equal(
      (await request(`/api/rooms/${host.room.code}`, undefined, host.token))
        .data.revision,
      before.revision,
    );
  }
  assert.deepEqual(await inspect(host.room.code), before);
  assert.equal((await client.act({ action: "leave" })).left, true);
  assert.equal(
    (await request(`/api/rooms/${host.room.code}`, undefined, host.token))
      .status,
    404,
  );
});

test("HTTP and WebSocket reject cross-origin, malformed, oversized and foreign credentials", async () => {
  assert.equal(
    (
      await request("/api/rooms", profile(), undefined, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await request("/api/rooms", {})).status, 400);
  const host = (await request("/api/rooms", profile())).data;
  assert.equal((await request(`/api/rooms/${host.room.code}`)).status, 401);
  assert.equal(
    (await request(`/api/rooms/${host.room.code}`, undefined, "a".repeat(48)))
      .status,
    401,
  );
  for (const [origin, token, expected] of [
    ["https://evil.example", host.token, 403],
    ["https://race.example", "a".repeat(48), 401],
  ]) {
    const response = await mf.dispatchFetch(
      `https://race.example/api/rooms/${host.room.code}/socket`,
      {
        headers: {
          Upgrade: "websocket",
          Origin: origin,
          "Sec-WebSocket-Protocol": `draw-derby.v1, token.${token}`,
        },
      },
    );
    assert.equal(response.status, expected);
  }
  const client = await connect(host);
  client.ws.send("{bad");
  assert.equal((await client.next((m) => m.type === "error")).status, 400);
  client.ws.send("x".repeat(180001));
  assert.equal((await client.next((m) => m.type === "error")).status, 413);
  assert.equal(
    (await client.act({ action: "ready", ready: true })).type,
    "result",
  );
  client.ws.close();
});

test("persisted room and credentials survive a Worker restart", async () => {
  const host = (await request("/api/rooms", profile())).data;
  const client = await connect(host);
  await client.act({ action: "ready", ready: true });
  client.ws.close();
  await mf.dispose();
  mf = new Miniflare(options);
  await mf.ready;
  const reconnected = await connect(host);
  const snapshot = (
    await request(`/api/rooms/${host.room.code}`, undefined, host.token)
  ).data;
  assert.equal(snapshot.room.players[0].id, host.playerId);
  assert.equal(snapshot.room.players[0].ready, true);
  reconnected.ws.close();
});
