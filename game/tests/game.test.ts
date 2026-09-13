import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeAnimal,
  generateCourse,
  generateRace,
  obstacleEffect,
  sampleRace,
  SAMPLE_ANIMALS,
  RACE_DISTANCE,
  TRACKS,
  trackPoint,
  trackEffect,
  trackHandling,
  trackAffinity,
} from '../lib/game.ts';
import type {
  Animal,
  Obstacle,
  Participant,
  Stroke,
  TrackId,
} from '../lib/game.ts';

const stroke = (points: number[][]): Stroke => ({
  color: '#234534',
  points: points.map(([x, y]) => ({ x, y })),
});
const creature = (legLength: number, feet = [270, 410, 550, 690]): Stroke[] => [
  stroke([
    [220, 120],
    [740, 120],
    [740, 220],
    [220, 220],
    [220, 120],
  ]),
  ...feet.map((x) =>
    stroke([
      [x, 220],
      [x, 220 + legLength],
    ]),
  ),
];
const players: Participant[] = SAMPLE_ANIMALS.map(
  (animal: Animal, i: number) => ({
    id: `player-${i}`,
    name: animal.name,
    color: ['#ed7166', '#77ad95', '#8182ca', '#efb759'][i],
    animal,
  }),
);
const obstacle = (
  type: Obstacle['type'],
  overrides: Partial<Obstacle> = {},
): Obstacle => ({
  id: 'test',
  type,
  x: 150,
  width: 56,
  height: 0.53,
  label: '테스트 장애물',
  ...overrides,
});

test('all editable animal examples have identifiable bodies and four feet', () => {
  for (const animal of SAMPLE_ANIMALS) {
    const stats = analyzeAnimal(animal.strokes);
    assert.equal(stats.valid, true, `${animal.name}: ${stats.reason}`);
    assert.equal(stats.legCount, 4, animal.name);
    assert.ok(stats.speed > 0 && stats.speed <= 100);
  }
});

test('empty drawings, dots, featureless boxes, disconnected legs, and invalid coordinates cannot race', () => {
  assert.equal(analyzeAnimal([]).valid, false);
  assert.equal(
    analyzeAnimal([
      stroke([
        [10, 10],
        [10, 10],
      ]),
    ]).valid,
    false,
  );
  assert.equal(
    analyzeAnimal([
      stroke([
        [200, 100],
        [800, 100],
        [800, 390],
        [200, 390],
        [200, 100],
      ]),
    ]).valid,
    false,
  );
  assert.equal(
    analyzeAnimal([
      stroke([
        [200, 100],
        [200, 400],
      ]),
      stroke([
        [700, 100],
        [700, 400],
      ]),
    ]).valid,
    false,
  );
  assert.equal(
    analyzeAnimal([
      stroke([
        [0, 0],
        [NaN, 42],
      ]),
    ]).valid,
    false,
  );
  assert.equal(
    analyzeAnimal([
      stroke([
        [10, 10],
        [2000, 900],
      ]),
    ]).valid,
    false,
  );
});

test('line complexity and excessive leg counts cannot give unlimited ability', () => {
  const excessive = Array.from({ length: 129 }, () =>
    stroke([
      [20, 20],
      [40, 40],
    ]),
  );
  assert.equal(analyzeAnimal(excessive).valid, false);
  const four = analyzeAnimal(creature(170));
  const six = analyzeAnimal(creature(170, [270, 354, 438, 522, 606, 690]));
  assert.equal(six.valid, true);
  assert.equal(six.legCount, 6);
  assert.equal(six.speed, four.speed);
  assert.equal(six.stability, four.stability);
});

test('translation and uniform resizing preserve creature traits within raster tolerance', () => {
  const original = SAMPLE_ANIMALS[0].strokes;
  const scaled = original.map((line: Stroke) => ({
    ...line,
    points: line.points.map((p) => ({
      x: p.x * 0.72 + 90,
      y: p.y * 0.72 + 25,
    })),
  }));
  const before = analyzeAnimal(original),
    after = analyzeAnimal(scaled);
  assert.equal(after.valid, true);
  assert.equal(after.legCount, before.legCount);
  assert.ok(Math.abs(after.legLength - before.legLength) < 0.04);
  assert.ok(Math.abs(after.legSpacing - before.legSpacing) < 0.03);
  assert.ok(Math.abs(after.speed - before.speed) <= 3);
});

test('longer drawn legs increase stride and clear a hurdle that catches short legs', () => {
  const short = analyzeAnimal(creature(70)),
    long = analyzeAnimal(creature(185));
  assert.equal(short.valid && long.valid, true);
  assert.ok(long.legLength > short.legLength);
  assert.ok(long.speed > short.speed);
  assert.equal(
    obstacleEffect(short, obstacle('hurdle', { height: 0.58 })).collision,
    true,
  );
  assert.equal(
    obstacleEffect(long, obstacle('hurdle', { height: 0.58 })).collision,
    false,
  );
});

test('wider drawn foot spacing improves balance and water-crossing distance', () => {
  const narrow = analyzeAnimal(creature(100, [390, 430, 470, 510]));
  const wide = analyzeAnimal(creature(100));
  assert.equal(narrow.valid && wide.valid, true);
  assert.ok(wide.legSpacing > narrow.legSpacing);
  assert.ok(wide.stability > narrow.stability);
  assert.equal(
    obstacleEffect(narrow, obstacle('water', { width: 62 })).collision,
    true,
  );
  assert.equal(
    obstacleEffect(wide, obstacle('water', { width: 62 })).collision,
    false,
  );
  assert.ok(
    obstacleEffect(wide, obstacle('mud')).speedMultiplier >
      obstacleEffect(narrow, obstacle('mud')).speedMultiplier,
  );
});

test('low bodies have a tunnel advantage over tall long-legged animals', () => {
  const short = analyzeAnimal(SAMPLE_ANIMALS[2].strokes);
  const tall = analyzeAnimal(SAMPLE_ANIMALS[1].strokes);
  const tunnel = obstacle('tunnel', { height: 0.47 });
  assert.equal(obstacleEffect(short, tunnel).collision, false);
  assert.equal(obstacleEffect(tall, tunnel).collision, true);
});

test('seeded courses contain all obstacle mechanics and never overlap', () => {
  const course = generateCourse('course-test');
  assert.deepEqual(course, generateCourse('course-test'));
  assert.notDeepEqual(course, generateCourse('different-course'));
  assert.deepEqual(
    [
      ...new Set(
        TRACKS.flatMap((track) =>
          generateCourse('all-obstacles', track.id).map((o) => o.type),
        ),
      ),
    ].sort(),
    ['hurdle', 'mud', 'rocks', 'tunnel', 'water'],
  );
  for (let i = 1; i < course.length; i++)
    assert.ok(course[i].x > course[i - 1].x + course[i - 1].width);
  assert.ok(
    course[course.length - 1].x + course[course.length - 1].width <
      RACE_DISTANCE,
  );
});

test('server and browser can independently produce identical snapshots and results', () => {
  const first = generateRace(players, 'shared-room-seed');
  const second = generateRace(structuredClone(players), 'shared-room-seed');
  assert.deepEqual(second, first);
  assert.deepEqual(
    generateRace([...players].reverse(), 'shared-room-seed').results,
    first.results,
  );
  assert.ok(first.duration > 12 && first.duration < 27);
  assert.equal(first.events.length, players.length * first.course.length);
  assert.equal(first.results.length, 4);
  assert.deepEqual(
    first.results.map((r) => r.place),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(first.results.map((r) => r.time)).size, 4);
});

test('seeded course tradeoffs let multiple body shapes win without one dominant template', () => {
  const victories = new Map<string, number>();
  for (let seed = 0; seed < 100; seed++) {
    const race = generateRace(players, `balance-${seed}`, TRACKS[seed % 4].id);
    const winner = race.results[0].id;
    victories.set(winner, (victories.get(winner) ?? 0) + 1);
    assert.ok(
      race.duration < 53,
      `Course ${seed} takes ${race.duration} seconds`,
    );
  }
  assert.ok(
    victories.size >= 3,
    'At least three body forms should win on different courses',
  );
  assert.ok(
    Math.max(...victories.values()) <= 70,
    'No template should win more than 70% of these courses',
  );
});

test('race progress never goes backward and every racer reaches the finish', () => {
  const race = generateRace(players, 'progress');
  for (let i = 1; i < race.frames.length; i++) {
    for (let p = 0; p < players.length; p++) {
      const current = race.frames[i].racers[p];
      assert.ok(current.x >= race.frames[i - 1].racers[p].x);
      assert.ok(current.x >= 0 && current.x <= RACE_DISTANCE);
      assert.ok(Number.isFinite(current.y) && Number.isFinite(current.tilt));
    }
  }
  assert.ok(
    race.frames
      .at(-1)!
      .racers.every((r) => r.finished && r.x === RACE_DISTANCE),
  );
  const status = new Set(
    race.frames.flatMap((f) => f.racers.map((r) => r.status)),
  );
  assert.ok(status.has('jumping'));
  assert.ok(status.has('stumbling'));
  assert.ok(status.has('slowed'));
});

test('sampling supports before-start, interpolated, reconnect, and completed times', () => {
  const race = generateRace(players.slice(0, 2), 'sampling');
  assert.equal(sampleRace(race, -99).racers[0].x, 0);
  assert.equal(sampleRace(race, NaN).racers[0].x, 0);
  const midpoint = sampleRace(race, 0.025).racers[0].x;
  assert.ok(midpoint > 0 && midpoint < race.frames[1].racers[0].x);
  assert.deepEqual(sampleRace(race, 13.77), sampleRace(race, 13.77));
  assert.ok(
    sampleRace(race, race.duration + 10).racers.every((r) => r.finished),
  );
});

test('rooms reject more than four racers, duplicate identities, and blank drawings', () => {
  assert.throws(() => generateRace([], 'invalid'));
  assert.throws(() =>
    generateRace([...players, { ...players[0], id: 'extra' }], 'invalid'),
  );
  assert.throws(() => generateRace([players[0], players[0]], 'invalid'));
  assert.throws(() =>
    generateRace(
      [{ ...players[0], animal: { name: 'blank', strokes: [] } }],
      'invalid',
    ),
  );
});

test('four distinct centerlines have real circular and alternating turns inside the viewport', () => {
  assert.equal(TRACKS.length, 4);
  const circleStart = trackPoint('oval', 0),
    circleEnd = trackPoint('oval', 1);
  assert.ok(
    Math.hypot(circleStart.x - circleEnd.x, circleStart.y - circleEnd.y) < 0.01,
  );
  for (const track of TRACKS) {
    const turns = [];
    for (let i = 0; i <= 500; i++) {
      const p = trackPoint(track.id, i / 500);
      turns.push(p.turn);
      for (const offset of [-52, -39, 39, 52]) {
        const lane = trackPoint(track.id, i / 500, offset);
        assert.ok(
          lane.x >= 0 && lane.x <= 1200 && lane.y >= 0 && lane.y <= 620,
        );
        assert.ok(Number.isFinite(lane.angle));
        if (i > 0) {
          const previous=trackPoint(track.id,(i-1)/500,offset);
          const forward=(lane.x-previous.x)*Math.cos(previous.angle)+(lane.y-previous.y)*Math.sin(previous.angle);
          assert.ok(forward>0,`${track.id}: inner lanes must not fold back at corners`);
        }
      }
    }
    if (track.id === 'straight')
      assert.ok(turns.every((turn) => Math.abs(turn) < 0.001));
    if (track.id === 'zigzag' || track.id === 'woodland') {
      assert.ok(Math.max(...turns) > 0.25);
      assert.ok(Math.min(...turns) < -0.25);
    }
    if (!track.closed)
      assert.ok(
        Math.hypot(
          trackPoint(track.id, 1).x - trackPoint(track.id, 0).x,
          trackPoint(track.id, 1).y - trackPoint(track.id, 0).y,
        ) > 700,
      );
  }
});

test('wider physical corners limit heading changes instead of forming hairpins', () => {
  for (const track of TRACKS) {
    let previous = trackPoint(track.id, 0);
    for (let metre = 1; metre <= RACE_DISTANCE; metre++) {
      const current = trackPoint(track.id, metre / RACE_DISTANCE);
      const change = Math.abs(Math.atan2(Math.sin(current.angle - previous.angle), Math.cos(current.angle - previous.angle))) * 180 / Math.PI;
      assert.ok(change < 0.75, `${track.id} turns ${change} degrees in one metre at ${metre}`);
      previous = current;
    }
  }
});

test('themed obstacles remain seeded, non-overlapping, and specific to each track', () => {
  for (const track of TRACKS) {
    const course = generateCourse('four-routes', track.id);
    assert.deepEqual(course, generateCourse('four-routes', track.id));
    for (let i = 1; i < course.length; i++)
      assert.ok(course[i].x > course[i - 1].x + course[i - 1].width);
    assert.ok(course.at(-1)!.x + course.at(-1)!.width < 1000);
  }
  assert.equal(
    generateCourse('theme', 'straight').filter((o) => o.type === 'hurdle')
      .length,
    3,
  );
  assert.equal(
    generateCourse('theme', 'woodland').filter((o) => o.type === 'tunnel')
      .length,
    3,
  );
  assert.throws(() => generateCourse('invalid', 'invented' as TrackId));
});

test('wide footing retains corner speed and a compact torso changes direction faster', () => {
  const wide = analyzeAnimal(creature(150)),
    narrow = analyzeAnimal(creature(150, [390, 430, 470, 510]));
  let peak = 0;
  for (let i = 1; i < 500; i++)
    if (
      Math.abs(trackPoint('oval', i / 500).turn) >
      Math.abs(trackPoint('oval', peak).turn)
    )
      peak = i / 500;
  assert.ok(
    trackEffect(wide, 'oval', peak).speedMultiplier >
      trackEffect(narrow, 'oval', peak).speedMultiplier,
  );
  const compact = analyzeAnimal(
    creature(150).map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: 220 + (p.x - 220) * 0.57, y: p.y })),
    })),
  );
  assert.ok(compact.bodyLength < wide.bodyLength);
  assert.ok(trackHandling(compact, 'zigzag') > trackHandling(wide, 'zigzag'));
});

test('the same drawn legs win the straight and lose the low tunnel course', () => {
  const entrants = [
    {
      id: 'short',
      name: '짧은 다리',
      color: '#333',
      animal: { name: '짧은 다리', strokes: creature(70) },
    },
    {
      id: 'long',
      name: '긴 다리',
      color: '#444',
      animal: { name: '긴 다리', strokes: creature(185) },
    },
  ];
  for (let i = 0; i < 8; i++) {
    assert.equal(
      generateRace(entrants, `matchup-${i}`, 'straight').results[0].id,
      'long',
    );
    assert.equal(
      generateRace(entrants, `matchup-${i}`, 'woodland').results[0].id,
      'short',
    );
  }
});

test('every track stays deterministic and lane order cannot change a race result', () => {
  for (const track of TRACKS) {
    const race = generateRace(players, 'same-server-clock', track.id);
    assert.equal(race.trackId, track.id);
    assert.deepEqual(
      generateRace(structuredClone(players), 'same-server-clock', track.id),
      race,
    );
    assert.deepEqual(
      generateRace([...players].reverse(), 'same-server-clock', track.id)
        .results,
      race.results,
    );
    assert.ok(
      sampleRace(race, race.duration).racers.every(
        (r) => r.finished && r.x === 1000,
      ),
    );
    for (const result of race.results)
      assert.equal(
        result.collisions,
        race.events.filter((e) => e.racerId === result.id && e.effect.collision)
          .length,
      );
  }
});

test('poor corner handling produces visible skids and one collision per bend', () => {
  const race = generateRace(
    [
      {
        ...players[0],
        animal: {
          name: '불안정',
          strokes: creature(175, [390, 430, 470, 510]),
        },
      },
    ],
    'tight-turns',
    'zigzag',
  );
  assert.ok(race.frames.some((f) => f.racers[0].status === 'sliding'));
  const impacts = race.events.filter(
    (e) => e.kind === 'turn' && e.effect.collision,
  );
  assert.ok(impacts.length > 0);
  assert.equal(new Set(impacts.map((e) => e.obstacleId)).size, impacts.length);
});

test('track preview estimates use the current geometry and track mechanics', () => {
  const long = analyzeAnimal(creature(185)),
    short = analyzeAnimal(creature(70));
  assert.ok(
    trackAffinity(long, 'straight').seconds <
      trackAffinity(short, 'straight').seconds,
  );
  assert.ok(
    trackAffinity(short, 'woodland').seconds <
      trackAffinity(long, 'woodland').seconds,
  );
  assert.equal(trackAffinity(analyzeAnimal([]), 'oval').seconds, 0);
});

test('faster racing keeps preview times accurate on all four tracks', () => {
  for (const track of TRACKS) {
    const race = generateRace(players, 'track-preview', track.id);
    for (const result of race.results) {
      const estimate = trackAffinity(result.stats, track.id).seconds;
      assert.ok(Math.abs(result.time - estimate) < 0.9, `${track.id}: estimate ${estimate}, actual ${result.time}`);
      assert.ok(result.time > 10 && result.time < 48);
    }
    assert.ok(race.frames[0].racers.every(r => r.speed > 60), 'Clear road should feel fast from the start');
  }
});

test('gallop follows distance, freezes on impact, and jumps have a brief landing compression', () => {
  const race = generateRace(players, 'dynamic-motion');
  assert.ok(sampleRace(race, -2).racers.every(r => r.bob === 0 && r.tilt === 0 && r.landing === 0));
  let stoppedPairs = 0;
  for (let i = 1; i < race.frames.length; i++) {
    for (let lane = 0; lane < players.length; lane++) {
      const before = race.frames[i - 1].racers[lane];
      const racer = race.frames[i].racers[lane];
      assert.ok(racer.stride >= before.stride);
      assert.ok(racer.landing >= 0 && racer.landing <= 1);
      if (racer.x === before.x && racer.speed === 0 && before.speed === 0) {
        assert.equal(racer.stride, before.stride);
        assert.equal(racer.bob, 0);
        stoppedPairs++;
      }
    }
  }
  const states = race.frames.flatMap(f => f.racers);
  assert.ok(stoppedPairs > 0);
  assert.ok(states.some(r => r.bob > 8));
  assert.ok(states.some(r => r.y > 55));
  assert.ok(states.some(r => r.landing > 0.5 && r.y === 0));
  assert.ok(states.filter(r => r.finished).every(r => r.bob === 0 && r.landing === 0 && r.tilt === 0));
});
