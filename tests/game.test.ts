import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node 22+ runs these TypeScript tests directly without a build step.
import { analyzeAnimal, generateCourse, generateRace, obstacleEffect, sampleRace, SAMPLE_ANIMALS, RACE_DISTANCE } from '../lib/game.ts';
import type { Animal, Obstacle, Participant, Stroke } from '../lib/game.ts';

const stroke = (points: number[][]): Stroke => ({
  color: '#234534', points: points.map(([x, y]) => ({ x, y })),
});
const creature = (legLength: number, feet = [270, 410, 550, 690]): Stroke[] => [
  stroke([[220, 120], [740, 120], [740, 220], [220, 220], [220, 120]]),
  ...feet.map(x => stroke([[x, 220], [x, 220 + legLength]])),
];
const players: Participant[] = SAMPLE_ANIMALS.map((animal: Animal, i: number) => ({
  id: `player-${i}`, name: animal.name, color: ['#ed7166', '#77ad95', '#8182ca', '#efb759'][i], animal,
}));
const obstacle = (type: Obstacle['type'], overrides: Partial<Obstacle> = {}): Obstacle => ({
  id: 'test', type, x: 150, width: 56, height: 0.53, label: '테스트 장애물', ...overrides,
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
  assert.equal(analyzeAnimal([stroke([[10, 10], [10, 10]])]).valid, false);
  assert.equal(analyzeAnimal([stroke([[200, 100], [800, 100], [800, 390], [200, 390], [200, 100]])]).valid, false);
  assert.equal(analyzeAnimal([stroke([[200, 100], [200, 400]]), stroke([[700, 100], [700, 400]])]).valid, false);
  assert.equal(analyzeAnimal([stroke([[0, 0], [NaN, 42]])]).valid, false);
  assert.equal(analyzeAnimal([stroke([[10, 10], [2000, 900]])]).valid, false);
});

test('line complexity and excessive leg counts cannot give unlimited ability', () => {
  const excessive = Array.from({ length: 129 }, () => stroke([[20, 20], [40, 40]]));
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
    ...line, points: line.points.map(p => ({ x: p.x * 0.72 + 90, y: p.y * 0.72 + 25 })),
  }));
  const before = analyzeAnimal(original), after = analyzeAnimal(scaled);
  assert.equal(after.valid, true);
  assert.equal(after.legCount, before.legCount);
  assert.ok(Math.abs(after.legLength - before.legLength) < 0.04);
  assert.ok(Math.abs(after.legSpacing - before.legSpacing) < 0.03);
  assert.ok(Math.abs(after.speed - before.speed) <= 3);
});

test('longer drawn legs increase stride and clear a hurdle that catches short legs', () => {
  const short = analyzeAnimal(creature(70)), long = analyzeAnimal(creature(185));
  assert.equal(short.valid && long.valid, true);
  assert.ok(long.legLength > short.legLength);
  assert.ok(long.speed > short.speed);
  assert.equal(obstacleEffect(short, obstacle('hurdle', { height: 0.58 })).collision, true);
  assert.equal(obstacleEffect(long, obstacle('hurdle', { height: 0.58 })).collision, false);
});

test('wider drawn foot spacing improves balance and water-crossing distance', () => {
  const narrow = analyzeAnimal(creature(100, [390, 430, 470, 510]));
  const wide = analyzeAnimal(creature(100));
  assert.equal(narrow.valid && wide.valid, true);
  assert.ok(wide.legSpacing > narrow.legSpacing);
  assert.ok(wide.stability > narrow.stability);
  assert.equal(obstacleEffect(narrow, obstacle('water', { width: 62 })).collision, true);
  assert.equal(obstacleEffect(wide, obstacle('water', { width: 62 })).collision, false);
  assert.ok(obstacleEffect(wide, obstacle('mud')).speedMultiplier > obstacleEffect(narrow, obstacle('mud')).speedMultiplier);
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
  assert.deepEqual([...new Set(course.map(o => o.type))].sort(), ['hurdle', 'mud', 'rocks', 'tunnel', 'water']);
  for (let i = 1; i < course.length; i++) assert.ok(course[i].x > course[i - 1].x + course[i - 1].width);
  assert.ok(course[course.length - 1].x + course[course.length - 1].width < RACE_DISTANCE);
});

test('server and browser can independently produce identical snapshots and results', () => {
  const first = generateRace(players, 'shared-room-seed');
  const second = generateRace(structuredClone(players), 'shared-room-seed');
  assert.deepEqual(second, first);
  assert.deepEqual(generateRace([...players].reverse(), 'shared-room-seed').results, first.results);
  assert.ok(first.duration > 20 && first.duration < 45);
  assert.equal(first.events.length, players.length * first.course.length);
  assert.equal(first.results.length, 4);
  assert.deepEqual(first.results.map(r => r.place), [1, 2, 3, 4]);
  assert.equal(new Set(first.results.map(r => r.time)).size, 4);
});

test('seeded course tradeoffs let multiple body shapes win without one dominant template', () => {
  const victories = new Map<string, number>();
  for (let seed = 0; seed < 100; seed++) {
    const race = generateRace(players, `balance-${seed}`);
    const winner = race.results[0].id;
    victories.set(winner, (victories.get(winner) ?? 0) + 1);
    assert.ok(race.duration < 50, `Course ${seed} takes ${race.duration} seconds`);
  }
  assert.ok(victories.size >= 3, 'At least three body forms should win on different courses');
  assert.ok(Math.max(...victories.values()) <= 70, 'No template should win more than 70% of these courses');
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
  assert.ok(race.frames.at(-1)!.racers.every(r => r.finished && r.x === RACE_DISTANCE));
  const status = new Set(race.frames.flatMap(f => f.racers.map(r => r.status)));
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
  assert.ok(sampleRace(race, race.duration + 10).racers.every(r => r.finished));
});

test('rooms reject more than four racers, duplicate identities, and blank drawings', () => {
  assert.throws(() => generateRace([], 'invalid'));
  assert.throws(() => generateRace([...players, { ...players[0], id: 'extra' }], 'invalid'));
  assert.throws(() => generateRace([players[0], players[0]], 'invalid'));
  assert.throws(() => generateRace([{ ...players[0], animal: { name: 'blank', strokes: [] } }], 'invalid'));
});
