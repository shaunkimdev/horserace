import assert from "node:assert/strict";
import test from "node:test";
import { TRACKS } from "../lib/game.ts";
import { createRaceCamera, RACE_VIEW } from "../lib/race-camera.ts";

test("two to eight lanes stay inside the road and landscape reveals more track without shrinking distances", () => {
  for (let count = 2; count <= 8; count++) {
    for (const track of TRACKS) {
      const camera = createRaceCamera(track.id, 400, 1000, count);
      const lanes = Array.from({ length: count }, (_, lane) => camera.surface(400, lane));
      assert.ok(lanes.every(p => p.y > 130 && p.y < 550));
      assert.ok(lanes.every((p, i) => i === 0 || p.y > lanes[i - 1].y));
      assert.equal(camera.laneLines.length, count + 1);
      const wide = createRaceCamera(track.id, 400, 1000, count, 1900);
      assert.ok(wide.to > camera.to + 200);
      assert.deepEqual(wide.surface(430, count - 1), camera.surface(430, count - 1));
    }
  }
});

const close = (actual: number, expected: number, tolerance = 0.00001) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );

test("all four tracks keep every player at the original straight-track camera anchor", () => {
  for (const track of TRACKS) {
    for (let metres = 0; metres <= 1000; metres += 5) {
      const camera = createRaceCamera(track.id, metres);
      for (let lane = 0; lane < 4; lane++) {
        const player = camera.surface(metres, lane);
        close(player.x, 260);
        close(player.y, 215 + lane * 100 - 260 * 0.1);
        // Framing leaves the same room for the complete drawing on every lane.
        assert.ok(player.x - RACE_VIEW.animalWidth / 2 > 0);
        assert.ok(player.y - RACE_VIEW.animalHeight > 0);
        assert.ok(player.y < RACE_VIEW.height);
      }
    }
  }
});

test("straight-course ground and obstacle surfaces preserve their original pixel projection", () => {
  for (const follow of [0, 275, 680, 1000]) {
    const camera = createRaceCamera("straight", follow);
    for (const metres of [-40, 0, 110, 500, 1000, 1050]) {
      for (let lane = 0; lane < 4; lane++) {
        const x = (metres - follow) * 3.2 + 260;
        for (const across of [-45, 0, 7]) {
          const point = camera.surface(metres, lane, across);
          close(point.x, x);
          close(point.y, 215 + lane * 100 - x * 0.1 + across);
        }
      }
    }
  }
});

test("corners preserve the local zoom and continuously follow direction without camera jumps", () => {
  for (const track of TRACKS) {
    let previous: { x: number; y: number } | undefined;
    for (let metres = 1; metres < 999; metres += 0.5) {
      const camera = createRaceCamera(track.id, metres);
      const before = camera.project(metres - 0.05),
        after = camera.project(metres + 0.05);
      close((after.x - before.x) / 0.1, 3.2, 0.12);
      const ahead = camera.project(metres + 40);
      if (previous)
        assert.ok(
          Math.hypot(ahead.x - previous.x, ahead.y - previous.y) < 3,
          `${track.id} jumps near ${metres}m`,
        );
      previous = ahead;
      for (const point of [
        camera.project(camera.from, -57.2),
        camera.project(camera.to, 50.7),
        ahead,
      ]) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      }
    }
  }
});

test("upcoming bends stay gentle and the inside fences cannot fold back", () => {
  for (const track of TRACKS) {
    for (let follow = 0; follow <= 1000; follow += 10) {
      const camera = createRaceCamera(track.id, follow);
      const ahead = camera.project(follow + 70);
      const bend =
        ahead.y - RACE_VIEW.centerY + (ahead.x - RACE_VIEW.anchorX) * 0.1;
      assert.ok(
        Math.abs(bend) < (track.id === "oval" ? 32 : 60),
        `${track.id}: the next 70m bends by ${bend}px`,
      );
      assert.ok(
        ahead.x - RACE_VIEW.anchorX > 190,
        "Approaching racers and obstacles must keep moving forward",
      );
      for (let metres = camera.from; metres < camera.to; metres += 10) {
        const a = camera.project(metres),
          b = camera.project(metres + 0.5);
        for (const offset of [-60, -39, 39, 54]) {
          const before = camera.project(metres, offset),
            after = camera.project(metres + 0.5, offset);
          assert.ok(
            (after.x - before.x) * (b.x - a.x) +
              (after.y - before.y) * (b.y - a.y) >
              0,
            `${track.id}: lane or fence folds at ${metres}m`,
          );
        }
      }
    }
  }
});

test("the oval camera closes its lap seamlessly and curves remain visible in the close view", () => {
  const start = createRaceCamera("oval", 0),
    finish = createRaceCamera("oval", 1000);
  for (const offset of [-39, 0, 39]) {
    for (const distance of [-70, -10, 0, 10, 70]) {
      const a = start.project(distance, offset),
        b = finish.project(1000 + distance, offset);
      close(a.x, b.x);
      close(a.y, b.y);
    }
  }
  for (const track of TRACKS.filter((t) => t.id !== "straight")) {
    let bends = 0;
    for (let metres = 0; metres < 900; metres += 20) {
      const camera = createRaceCamera(track.id, metres),
        p = camera.project(metres + 70);
      if (
        Math.abs(p.y - (RACE_VIEW.centerY - (p.x - RACE_VIEW.anchorX) * 0.1)) >
        (track.id === "oval" ? 15 : 25)
      )
        bends++;
    }
    assert.ok(
      bends >= 4,
      `${track.id} must retain visible bends instead of becoming a straight road`,
    );
  }
});
