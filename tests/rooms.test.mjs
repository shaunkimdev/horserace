import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { Miniflare } from 'miniflare';

// Execute the production source without filesystem output; D1 runs in workerd.
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function compile(relativePath, replacements = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [from, to] of Object.entries(replacements)) js = js.replace(`from '${from}'`, `from '${to}'`);
  return moduleUrl(js);
}
const gameUrl = await compile('../lib/game.ts');
const roomsUrl = await compile('../lib/rooms.ts');
const storeUrl = await compile('../lib/room-store.ts', { './game': gameUrl, './rooms': roomsUrl });
const { RoomStore, RoomError, sanitizeAnimal } = await import(storeUrl);
const { SAMPLE_ANIMALS, generateRace } = await import(gameUrl);
const dbUrl = moduleUrl("export function getRoomDatabase() { return globalThis[Symbol.for('room-test-database')]; }");
const apiUrl = await compile('../lib/room-api.ts', { '../db': dbUrl, './room-store': storeUrl });
const createRoute = await import(await compile('../app/api/rooms/route.ts', { '../../../lib/room-api': apiUrl }));
const joinRoute = await import(await compile('../app/api/rooms/join/route.ts', { '../../../../lib/room-api': apiUrl }));
const roomRoute = await import(await compile('../app/api/rooms/[code]/route.ts', { '../../../../lib/room-api': apiUrl }));
let miniflare;
let db;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("room tests"); } };',
    compatibilityDate: '2026-04-01',
    d1Databases: ['DB'],
  });
  db = await miniflare.getD1Database('DB');
  globalThis[Symbol.for('room-test-database')] = db;
  const migration = await readFile(new URL('../drizzle/0000_outstanding_loki.sql', import.meta.url), 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await db.prepare(statement.trim()).run();
  }
});
after(async () => {
  delete globalThis[Symbol.for('room-test-database')];
  await miniflare?.dispose();
});

function setup() {
  let now = 1_900_000_000_000;
  return { store: new RoomStore(db, () => now), advance: (ms) => { now += ms; } };
}
const isStatus = (status) => (error) => error instanceof RoomError && error.status === status;
const profile = (i = 0) => ({ name: `참가자 ${i + 1}`, animal: structuredClone(SAMPLE_ANIMALS[i % 4]) });

async function readyRoom(store, count = 2) {
  const host = await store.create(profile());
  const sessions = [host];
  for (let i = 1; i < count; i++) sessions.push(await store.join({ code: host.room.code, ...profile(i) }));
  for (const session of sessions) await store.act(host.room.code, session.token, { action: 'ready', ready: true });
  return sessions;
}

test('real D1 concurrent joins never exceed four players and use distinct colors', async () => {
  const { store } = setup();
  const host = await store.create(profile());
  const attempts = await Promise.allSettled(Array.from({ length: 9 }, (_, i) => store.join({ code: host.room.code, ...profile(i + 1) })));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 3);
  for (const result of attempts.filter((result) => result.status === 'rejected')) assert.equal(result.reason.status, 409);
  const { room } = await store.get(host.room.code, host.token);
  assert.equal(room.players.length, 4);
  assert.equal(new Set(room.players.map((player) => player.color)).size, 4);
  assert.equal(new Set(room.players.map((player) => player.id)).size, 4);
});

test('public revisions increase on every committed heartbeat and mutation under concurrency', async () => {
  const { store } = setup();
  const host = await store.create(profile());
  assert.equal(host.revision, 1);
  const joined = await store.join({ code: host.room.code, ...profile(1) });
  assert.equal(joined.revision, 2);
  const responses = await Promise.all([
    store.get(host.room.code, host.token),
    store.act(host.room.code, joined.token, { action: 'ready', ready: true }),
    store.get(host.room.code, joined.token),
    store.act(host.room.code, host.token, { action: 'animal', animal: SAMPLE_ANIMALS[2] }),
  ]);
  assert.deepEqual(responses.map((response) => response.revision).sort((a, b) => a - b), [3, 4, 5, 6]);
  const latest = await store.get(host.room.code, host.token);
  assert.equal(latest.revision, 7);
  const raw = await db.prepare('SELECT version FROM race_rooms WHERE code = ?').bind(host.room.code).first();
  assert.equal(raw.version, latest.revision);
});

test('animal rename updates the authoritative participant name with a 20-character limit', async () => {
  const { store } = setup();
  const [host, guest] = await readyRoom(store);
  const newName = '가'.repeat(24);
  const renamed = await store.act(host.room.code, guest.token, {
    action: 'animal', animal: { ...structuredClone(SAMPLE_ANIMALS[1]), name: newName },
  });
  const player = renamed.room.players.find((member) => member.id === guest.playerId);
  assert.equal(player.name, newName.slice(0, 20));
  assert.equal(player.animal.name, newName);
  assert.equal(player.ready, false);
  await store.act(host.room.code, guest.token, { action: 'ready', ready: true });
  const started = await store.act(host.room.code, host.token, { action: 'start' });
  assert.equal(started.room.race.players.find((member) => member.id === guest.playerId).name, newName.slice(0, 20));
});

test('rooms expose no credentials and reject missing, foreign, or invented identities', async () => {
  const { store } = setup();
  const [host, guest] = await readyRoom(store);
  const outsider = await store.create(profile(2));
  const serialized = JSON.stringify((await store.get(host.room.code, guest.token)).room);
  for (const privateValue of ['tokenHash', 'lastSeenAt', host.token, guest.token]) assert.ok(!serialized.includes(privateValue));
  await assert.rejects(store.get(host.room.code, ''), isStatus(401));
  await assert.rejects(store.get(host.room.code, outsider.token), isStatus(401));
  await assert.rejects(store.act(host.room.code, outsider.token, { action: 'leave', playerId: host.playerId }), isStatus(401));
  await assert.rejects(store.act(host.room.code, guest.token, { action: 'start' }), isStatus(403));
  const ownChange = await store.act(host.room.code, guest.token, { action: 'ready', ready: false, playerId: host.playerId });
  assert.equal(ownChange.room.players.find((player) => player.id === host.playerId).ready, true);
  assert.equal(ownChange.room.players.find((player) => player.id === guest.playerId).ready, false);
  const raw = await db.prepare('SELECT data FROM race_rooms WHERE code = ?').bind(host.room.code).first();
  assert.ok(!raw.data.includes(host.token));
});

test('empty animal cannot become ready, all players must be ready, edits revoke readiness', async () => {
  const { store } = setup();
  const host = await store.create({ name: '새 동물' });
  await assert.rejects(store.act(host.room.code, host.token, { action: 'ready', ready: true }), isStatus(400));
  await store.act(host.room.code, host.token, { action: 'animal', animal: SAMPLE_ANIMALS[0] });
  await store.act(host.room.code, host.token, { action: 'ready', ready: true });
  await assert.rejects(store.act(host.room.code, host.token, { action: 'start' }), isStatus(409));
  const guest = await store.join({ code: host.room.code, ...profile(1) });
  await assert.rejects(store.act(host.room.code, host.token, { action: 'start' }), isStatus(409));
  await store.act(host.room.code, guest.token, { action: 'ready', ready: true });
  const changed = await store.act(host.room.code, guest.token, { action: 'animal', animal: SAMPLE_ANIMALS[2] });
  assert.equal(changed.room.players.find((player) => player.id === guest.playerId).ready, false);
  await assert.rejects(store.act(host.room.code, host.token, { action: 'start' }), isStatus(409));
});

test('race start snapshots server-derived results and remains immutable across leave and reconnect', async () => {
  const { store } = setup();
  const [host, guest] = await readyRoom(store);
  const started = await store.act(host.room.code, host.token, { action: 'start', seed: 'cheat', results: [{ playerId: host.playerId, rank: 1 }] });
  assert.equal(started.room.phase, 'racing');
  const race = started.room.race;
  assert.equal(race.startedAt, started.serverNow + 4000);
  assert.notEqual(race.seed, 'cheat');
  const expected = generateRace(race.players, race.seed);
  assert.deepEqual(race.results, expected.results.map((result) => ({
    playerId: result.id, finishTimeMs: Math.round(result.time * 1000), rank: result.place,
    collisions: result.collisions, jumps: result.jumps,
  })));
  await assert.rejects(store.join({ code: host.room.code, ...profile(2) }), isStatus(409));
  await assert.rejects(store.act(host.room.code, guest.token, { action: 'animal', animal: SAMPLE_ANIMALS[2] }), isStatus(409));
  await assert.rejects(store.act(host.room.code, host.token, { action: 'rematch' }), isStatus(409));
  const rejoined = await store.join({ code: host.room.code }, guest.token);
  assert.equal(rejoined.playerId, guest.playerId);
  assert.equal(rejoined.room.players.length, 2);
  assert.deepEqual(rejoined.room.race, race);
  const departed = await store.act(host.room.code, host.token, { action: 'leave' });
  assert.equal(departed.room.hostId, guest.playerId);
  assert.equal(departed.room.players.length, 1);
  assert.deepEqual(departed.room.race, race);
  assert.deepEqual((await store.get(host.room.code, guest.token)).room.race, race);
});

test('simultaneous start and edit serialize without overwriting a running race', async () => {
  const { store } = setup();
  const [host, guest] = await readyRoom(store);
  const result = await Promise.allSettled([
    store.act(host.room.code, host.token, { action: 'start' }),
    store.act(host.room.code, guest.token, { action: 'animal', animal: SAMPLE_ANIMALS[2] }),
  ]);
  assert.equal(result.filter((value) => value.status === 'fulfilled').length, 1);
  const { room } = await store.get(host.room.code, host.token);
  if (room.phase === 'racing') assert.deepEqual(room.race.players[1].animal, sanitizeAnimal(SAMPLE_ANIMALS[1]));
  else assert.equal(room.players.find((player) => player.id === guest.playerId).ready, false);
});

test('race finish uses server time and only host can open a rematch with readiness cleared', async () => {
  const { store, advance } = setup();
  const [host, guest] = await readyRoom(store);
  const { room } = await store.act(host.room.code, host.token, { action: 'start' });
  advance(4000 + room.race.durationMs);
  const finished = await store.get(host.room.code, guest.token);
  assert.equal(finished.room.phase, 'finished');
  // The active guest takes over when the original host has missed heartbeats.
  assert.equal(finished.room.hostId, guest.playerId);
  await assert.rejects(store.act(host.room.code, host.token, { action: 'rematch' }), isStatus(403));
  const rematch = await store.act(host.room.code, guest.token, { action: 'rematch' });
  assert.equal(rematch.room.phase, 'lobby');
  assert.equal(rematch.room.race, null);
  assert.ok(rematch.room.players.every((player) => !player.ready));
  assert.ok(rematch.room.players.every((player) => player.animal));
});

test('heartbeat restores sessions at capacity, transfers stale host, and removes absent lobby members', async () => {
  const { store, advance } = setup();
  const sessions = await readyRoom(store, 4);
  const restored = await store.join({ code: sessions[0].room.code }, sessions[3].token);
  assert.equal(restored.room.players.length, 4);
  assert.equal(restored.playerId, sessions[3].playerId);
  advance(21_000);
  const guest = sessions[1];
  const heartbeat = await store.get(guest.room.code, guest.token);
  assert.equal(heartbeat.room.hostId, guest.playerId);
  assert.equal(heartbeat.room.players.find((player) => player.id === sessions[0].playerId).connected, false);
  advance(40_000);
  const cleaned = await store.get(guest.room.code, guest.token);
  assert.equal(cleaned.room.players.length, 1);
  assert.equal(cleaned.room.players[0].id, guest.playerId);
  await assert.rejects(store.get(guest.room.code, sessions[0].token), isStatus(401));
});

test('leaving last player deletes room and idle rooms expire', async () => {
  const { store, advance } = setup();
  const host = await store.create(profile());
  await store.act(host.room.code, host.token, { action: 'leave' });
  await assert.rejects(store.get(host.room.code, host.token), isStatus(404));
  const idle = await store.create(profile());
  advance(2 * 60 * 60 * 1000 + 1);
  await assert.rejects(store.get(idle.room.code, idle.token), isStatus(404));
  await store.create(profile());
  const old = await db.prepare('SELECT code FROM race_rooms WHERE code = ?').bind(idle.room.code).first();
  assert.equal(old, null);
});

test('animal validation rejects nonfinite/out-of-bounds shapes, script colors and excessive payloads', () => {
  for (const animal of SAMPLE_ANIMALS) assert.ok(sanitizeAnimal(animal));
  const invalid = (modify) => { const animal = structuredClone(SAMPLE_ANIMALS[0]); modify(animal); return animal; };
  assert.throws(() => sanitizeAnimal(invalid((animal) => { animal.strokes[0].points[0].x = Infinity; })), isStatus(400));
  assert.throws(() => sanitizeAnimal(invalid((animal) => { animal.strokes[0].points[0].y = 441; })), isStatus(400));
  assert.throws(() => sanitizeAnimal(invalid((animal) => { animal.strokes[0].color = 'url(javascript:bad)'; })), isStatus(400));
  assert.throws(() => sanitizeAnimal(invalid((animal) => { animal.strokes = Array(81).fill(animal.strokes[0]); })), isStatus(400));
  assert.throws(() => sanitizeAnimal({ name: '빈 그림', strokes: [] }), isStatus(400));
  assert.throws(() => sanitizeAnimal({ name: '점', strokes: [{ color: '#123456', points: [{ x: 3, y: 3 }, { x: 3, y: 3 }] }] }), isStatus(400));
});

test('production HTTP routes create, join, authenticate polls and return non-cacheable JSON', async () => {
  const post = (path, body, token) => new Request(`https://race.example${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const response = await createRoute.POST(post('/api/rooms', profile()));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const host = await response.json();
  const joined = await joinRoute.POST(post('/api/rooms/join', { code: host.room.code.toLowerCase(), ...profile(1) }));
  assert.equal(joined.status, 200);
  const guest = await joined.json();
  assert.equal(guest.room.players.length, 2);
  const path = `/api/rooms/${host.room.code}`;
  const context = { params: Promise.resolve({ code: host.room.code }) };
  assert.equal((await roomRoute.GET(new Request(`https://race.example${path}`), context)).status, 401);
  const polled = await roomRoute.GET(new Request(`https://race.example${path}`, { headers: { Authorization: `Bearer ${guest.token}` } }), context);
  assert.equal(polled.status, 200);
  const action = await roomRoute.POST(post(path, { action: 'ready', ready: true }, guest.token), context);
  assert.equal(action.status, 200);
  assert.equal((await action.json()).room.players.find((player) => player.id === guest.playerId).ready, true);
});

test('HTTP parser rejects oversized, malformed, non-JSON, and cross-origin requests', async () => {
  const request = (body, headers = { 'Content-Type': 'application/json' }) => new Request('https://race.example/api/rooms', {
    method: 'POST', headers, body,
  });
  assert.equal((await createRoute.POST(request('x'.repeat(180_001)))).status, 413);
  assert.equal((await createRoute.POST(request('{broken'))).status, 400);
  assert.equal((await createRoute.POST(request('{}', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await createRoute.POST(request('{}', { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }))).status, 403);
  const invalid = await createRoute.POST(request('{}'));
  assert.equal(invalid.status, 400);
  assert.equal(typeof (await invalid.json()).error, 'string');
});
