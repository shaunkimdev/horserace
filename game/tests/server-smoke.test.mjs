import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_ANIMALS, generateRace, TRACKS } from "../lib/game.ts";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL("../lib/room-connection.ts", import.meta.url)),
  ],
  bundle: true,
  format: "esm",
  write: false,
  platform: "browser",
});
const { RoomConnection } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const base = process.env.TEST_URL || "http://localhost:3000";
async function request(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, data: await response.json() };
}
for (const [trackIndex, track] of TRACKS.entries())
  test(`actual server renders and synchronizes ${[2, 4, 8, 8][trackIndex]} players on ${track.id}`, async () => {
    const capacity = [2, 4, 8, 8][trackIndex];
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /aria-label="동물 그리기 캔버스/);
    assert.doesNotMatch(html, /codex-preview/);
    const sessions = [],
      clients = [];
    const connect = async (session) => {
      const states = [];
      let resolveInitial, rejectInitial;
      const initial = new Promise((resolve, reject) => {
        resolveInitial = resolve;
        rejectInitial = reject;
      });
      const client = new RoomConnection(
        { code: session.room.code, token: session.token },
        {
          state: (data) => {
            states.push(data);
            resolveInitial();
          },
          clock: (offset) => assert.ok(Number.isFinite(offset)),
          status: () => {},
          ended: (message) => rejectInitial(new Error(message)),
        },
        base,
      );
      clients.push(client);
      client.start();
      const timer = setTimeout(
        () => rejectInitial(new Error("Initial WebSocket state timed out")),
        12000,
      );
      try {
        await initial;
      } finally {
        clearTimeout(timer);
      }
      return { client, states };
    };
    const profile = (i) => ({
      name: `연결테스트 ${i + 1}`,
      animal: SAMPLE_ANIMALS[i % SAMPLE_ANIMALS.length],
    });
    try {
      const host = await request("/api/rooms", {
        ...profile(0),
        trackId: track.id,
      });
      assert.equal(host.status, 201, JSON.stringify(host.data));
      sessions.push(host.data);
      const live = [await connect(host.data)];
      assert.equal(host.data.room.capacity, 4);
      await live[0].client.action({ action: "capacity", capacity });
      const code = host.data.room.code;
      const guests = await Promise.all(
        Array.from({ length: capacity - 1 }, (_, i) => i + 1).map((i) =>
          request("/api/rooms/join", { code, ...profile(i) }),
        ),
      );
      for (const guest of guests) {
        assert.equal(guest.status, 200);
        sessions.push(guest.data);
        live.push(await connect(guest.data));
      }
      assert.equal(
        (await request("/api/rooms/join", { code, ...profile(0) })).status,
        409,
      );
      assert.equal((await request(`/api/rooms/${code}`)).status, 401);
      for (const { client } of live)
        await client.action({ action: "ready", ready: true });
      assert.equal(
        (
          await request(
            `/api/rooms/${code}`,
            { action: "start" },
            sessions[1].token,
          )
        ).status,
        403,
      );
      const start = await request(
        `/api/rooms/${code}`,
        { action: "start" },
        host.data.token,
      );
      assert.equal(start.status, 200, JSON.stringify(start.data));
      assert.equal(start.data.room.race.players.length, capacity);
      assert.equal(start.data.room.capacity, capacity);
      assert.equal(start.data.room.race.trackId, track.id);
      for (const { client, states } of live) {
        await client
          .action({ action: "track", trackId: track.id })
          .catch(() => {});
        assert.ok(
          states.some(
            (state) => state.room.race?.seed === start.data.room.race.seed,
          ),
          "race pushed over WebSocket",
        );
      }
      for (const member of sessions) {
        const snapshot = await request(
          `/api/rooms/${code}`,
          null,
          member.token,
        );
        assert.equal(snapshot.status, 200);
        assert.equal(snapshot.data.room.race.seed, start.data.room.race.seed);
        assert.equal(
          snapshot.data.room.race.startedAt,
          start.data.room.race.startedAt,
        );
        const { players, seed, results, trackId } = snapshot.data.room.race;
        assert.deepEqual(
          generateRace(players, seed, trackId).results.map((r) => r.id),
          results.map((r) => r.playerId),
        );
        assert.ok(!JSON.stringify(snapshot.data).includes(member.token));
      }
    } finally {
      for (const client of clients) client.stop();
      for (const member of sessions)
        await request(
          `/api/rooms/${member.room.code}`,
          { action: "leave" },
          member.token,
        );
    }
  });
