import assert from "node:assert/strict";
import test from "node:test";
import { musicStep, RaceAudio, MUSIC_STEP } from "../lib/race-audio.ts";

class Param {
  value = 0;
  events: { kind: string; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number) {
    this.events.push({ kind: "set", value, at });
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number) {
    assert.ok(value > 0);
    this.events.push({ kind: "ramp", value, at });
    return this;
  }
  setTargetAtTime(value: number, at: number) {
    this.events.push({ kind: "target", value, at });
    return this;
  }
  cancelScheduledValues(at: number) {
    this.events = this.events.filter((e) => e.at < at);
    return this;
  }
}
class GraphNode {
  connections: GraphNode[] = [];
  disconnected = false;
  gain = new Param();
  pan = new Param();
  frequency = new Param();
  Q = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  type = "";
  connect(node: GraphNode) {
    this.connections.push(node);
    return node;
  }
  disconnect() {
    this.connections = [];
    this.disconnected = true;
  }
}
class Source extends GraphNode {
  started = -1;
  stopped = Infinity;
  ended = false;
  onended: (() => void) | null = null;
  buffer: unknown = null;
  start(at: number) {
    assert.ok(Number.isFinite(at));
    this.started = at;
  }
  stop(at: number) {
    assert.ok(Number.isFinite(at));
    this.stopped = at;
  }
}
class MockContext {
  currentTime = 100;
  sampleRate = 48000;
  state = "suspended";
  destination = new GraphNode();
  sources: Source[] = [];
  nodes: GraphNode[] = [];
  resumes = 0;
  closes = 0;
  blocked = false;
  createGain() {
    return this.node();
  }
  createStereoPanner() {
    return this.node();
  }
  createDynamicsCompressor() {
    return this.node();
  }
  createBiquadFilter() {
    return this.node();
  }
  node() {
    const node = new GraphNode();
    this.nodes.push(node);
    return node;
  }
  createOscillator() {
    return this.source();
  }
  createBufferSource() {
    return this.source();
  }
  source() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  async resume() {
    this.resumes++;
    if (this.blocked) throw new Error("Autoplay blocked");
    this.state = "running";
  }
  async close() {
    this.closes++;
    this.state = "closed";
  }
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const source of this.sources) {
      if (!source.ended && source.stopped <= this.currentTime) {
        source.ended = true;
        source.onended?.();
      }
    }
  }
}
function setup() {
  const context = new MockContext();
  let created = 0;
  const audio = new RaceAudio(() => {
    created++;
    return context as unknown as AudioContext;
  });
  return { audio, context, created: () => created };
}

test("the original score has drums, bass, harmony and melody, with a denser final stretch", () => {
  const normal = Array.from({ length: 64 }, (_, i) =>
    musicStep(i, false),
  ).flat();
  const finale = Array.from({ length: 64 }, (_, i) =>
    musicStep(i, true),
  ).flat();
  assert.equal(new Set(normal.map((n) => n.instrument)).size, 6);
  assert.ok(
    new Set(normal.filter((n) => n.instrument === "bass").map((n) => n.midi))
      .size >= 4,
  );
  assert.ok(
    new Set(normal.filter((n) => n.instrument === "lead").map((n) => n.midi))
      .size >= 6,
  );
  assert.ok(
    finale.filter((n) => n.instrument === "hat").length >
      normal.filter((n) => n.instrument === "hat").length,
  );
  assert.ok(
    finale.filter((n) => n.instrument === "lead").length >
      normal.filter((n) => n.instrument === "lead").length,
  );
  assert.ok(
    normal.every(
      (n) =>
        n.length * MUSIC_STEP > 0.006 &&
        n.volume > 0 &&
        n.volume < 0.6 &&
        Math.abs(n.pan) <= 1,
    ),
  );
});

test("no context is created by rendering or a countdown; a user gesture unlocks one shared context", () => {
  const { audio, context, created } = setup();
  audio.sync(0, 0);
  audio.beep();
  audio.finish();
  assert.equal(created(), 0);
  audio.unlock();
  audio.unlock();
  assert.equal(created(), 1);
  assert.equal(context.resumes, 1);
  audio.sync(-3, 0);
  assert.equal(context.sources.length, 0);
  audio.sync(0, 0);
  assert.ok(context.sources.length > 4);
  const scheduled = context.sources.length;
  audio.sync(0, 0);
  audio.sync(0.005, 0);
  assert.equal(
    context.sources.length,
    scheduled,
    "Repeated frames must not double the music",
  );
  assert.ok(
    context.sources.every(
      (s) => s.started >= context.currentTime && s.stopped > s.started,
    ),
  );
  audio.dispose();
});

test("muting stops both scheduled music and effects, and unmuting joins the current beat", () => {
  const { audio, context, created } = setup();
  audio.unlock();
  audio.sync(0, 0);
  audio.effect("jump");
  const scheduled = context.sources.length;
  audio.setEnabled(false);
  assert.ok(
    context.sources.every((s) => s.stopped <= context.currentTime + 0.03),
  );
  audio.sync(4, 0.3);
  audio.effect("impact");
  audio.beep();
  audio.finish();
  audio.unlock();
  assert.equal(context.sources.length, scheduled);
  context.advance(4);
  audio.setEnabled(true);
  audio.unlock();
  audio.sync(4, 0.3);
  const resumed = context.sources.slice(scheduled);
  assert.ok(
    resumed.length > 0 && resumed.length < 20,
    "Do not replay four seconds of missed notes",
  );
  assert.ok(
    resumed.every(
      (s) =>
        s.started >= context.currentTime &&
        s.started < context.currentTime + 0.16,
    ),
  );
  assert.equal(created(), 1);
  audio.dispose();
});

test("hidden tabs silence everything, and returning skips ahead without a backlog", () => {
  const { audio, context } = setup();
  audio.unlock();
  audio.sync(1, 0.05);
  audio.setVisible(false);
  const before = context.sources.length;
  context.advance(20);
  audio.sync(21, 0.85);
  audio.effect("land");
  assert.equal(context.sources.length, before);
  audio.setVisible(true);
  audio.sync(21, 0.85);
  const resumed = context.sources.slice(before);
  assert.ok(resumed.length > 0 && resumed.length < 25);
  assert.ok(resumed.every((s) => s.started >= context.currentTime));
  audio.dispose();
});

test("seeks and rematches replace scheduled music; stopping music preserves the finish cue", () => {
  const { audio, context } = setup();
  audio.unlock();
  audio.sync(8, 0.5);
  const old = [...context.sources];
  audio.sync(0, 0);
  assert.ok(old.every((s) => s.stopped <= context.currentTime + 0.03));
  const restart = context.sources.length;
  audio.finish();
  const fanfare = context.sources.slice(restart);
  audio.stopMusic();
  assert.equal(fanfare.length, 4);
  assert.ok(fanfare.at(-1)!.stopped > context.currentTime + 0.6);
  context.advance(1);
  assert.ok(context.sources.every((s) => s.disconnected));
  assert.ok(
    context.nodes.slice(2).every((n) => n.disconnected),
    "Per-note filters, gains and panners must be released",
  );
  audio.dispose();
  audio.dispose();
  audio.unlock();
  audio.sync(0, 0);
  assert.equal(context.closes, 1);
  assert.ok(context.nodes.every((n) => n.disconnected));
});

test("unsupported audio and rejected autoplay promises do not break gameplay", async () => {
  const unsupported = new RaceAudio(() => {
    throw new Error("No Web Audio");
  });
  assert.doesNotThrow(() => {
    unsupported.unlock();
    unsupported.sync(1, 0.1);
    unsupported.beep();
    unsupported.dispose();
  });
  const { audio, context } = setup();
  context.blocked = true;
  audio.unlock();
  await Promise.resolve();
  audio.sync(0, 0);
  audio.beep();
  assert.equal(context.sources.length, 0);
  context.blocked = false;
  audio.unlock();
  await Promise.resolve();
  audio.sync(2, 0.1);
  assert.ok(context.sources.length > 0);
  audio.dispose();
});
