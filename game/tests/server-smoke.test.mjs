import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_ANIMALS, generateRace, TRACKS } from "../lib/game.ts";

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
for (const track of TRACKS)
  test(`actual server renders and synchronizes four players on ${track.id}`, async () => {
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /DRAW YOUR ATHLETE/);
    assert.doesNotMatch(html, /codex-preview/);
    const sessions = [];
    const profile = (i) => ({
      name: `연결테스트 ${i + 1}`,
      animal: SAMPLE_ANIMALS[i],
    });
    try {
      const host = await request("/api/rooms", {
        ...profile(0),
        trackId: track.id,
      });
      assert.equal(host.status, 201, JSON.stringify(host.data));
      sessions.push(host.data);
      const code = host.data.room.code;
      const guests = await Promise.all(
        [1, 2, 3].map((i) =>
          request("/api/rooms/join", { code, ...profile(i) }),
        ),
      );
      for (const guest of guests) {
        assert.equal(guest.status, 200);
        sessions.push(guest.data);
      }
      assert.equal(
        (await request("/api/rooms/join", { code, ...profile(0) })).status,
        409,
      );
      assert.equal((await request(`/api/rooms/${code}`)).status, 401);
      for (const member of sessions)
        assert.equal(
          (
            await request(
              `/api/rooms/${code}`,
              { action: "ready", ready: true },
              member.token,
            )
          ).status,
          200,
        );
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
      assert.equal(start.data.room.race.players.length, 4);
      assert.equal(start.data.room.race.trackId, track.id);
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
      for (const member of sessions)
        await request(
          `/api/rooms/${member.room.code}`,
          { action: "leave" },
          member.token,
        );
    }
  });
