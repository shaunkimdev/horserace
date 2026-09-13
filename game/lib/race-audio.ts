/** Original procedural race music. All timing uses the same race clock as the visuals. */
export const RACE_BPM = 164;
export const MUSIC_STEP = 60 / RACE_BPM / 4;

type Instrument = "kick" | "snare" | "hat" | "bass" | "arp" | "lead";
export type MusicNote = {
  instrument: Instrument;
  midi: number;
  length: number;
  volume: number;
  pan: number;
};

/** Four-bar E minor / C / G / D progression, with a denser final-stretch arrangement. */
export function musicStep(step: number, finalStretch: boolean): MusicNote[] {
  const beat = step % 16;
  const bar = Math.floor(step / 16);
  const chord = bar % 4;
  const root = [40, 36, 43, 38][chord];
  const third = chord === 0 ? 3 : 4;
  const notes: MusicNote[] = [];
  const add = (
    instrument: Instrument,
    midi: number,
    length: number,
    volume: number,
    pan = 0,
  ) => notes.push({ instrument, midi, length, volume, pan });
  if (beat % 4 === 0 || (finalStretch && beat === 14))
    add("kick", 0, 2.5, 0.54);
  if (beat === 4 || beat === 12) add("snare", 0, 1.5, 0.19, 0.08);
  if (beat % 2 === 0 || finalStretch)
    add(
      "hat",
      0,
      beat % 4 === 2 ? 1.5 : 0.5,
      beat % 2 ? 0.045 : 0.065,
      beat % 4 ? 0.28 : -0.28,
    );
  if ([0, 3, 6, 8, 11, 14].includes(beat))
    add("bass", root + (beat === 14 ? 12 : 0), 1.55, 0.25);
  if (beat % 2 === 0) {
    const interval = [0, 7, 12, third, 7, 12, 7, third][beat / 2];
    add("arp", root + 24 + interval, 1.7, 0.075, beat % 4 ? 0.38 : -0.38);
  }
  const melody = [7, 12, third + 12, 7, 12, 19, 12, third + 12];
  const positions = finalStretch
    ? [0, 3, 6, 8, 10, 12, 14, 15]
    : [0, 6, 10, 14];
  const index = positions.indexOf(beat);
  if (index >= 0)
    add(
      "lead",
      root + 24 + melody[(index + bar * 2) % melody.length],
      finalStretch ? 1.6 : 2.7,
      finalStretch ? 0.1 : 0.065,
      -0.08,
    );
  if (finalStretch && chord === 3 && beat >= 14)
    add("snare", 0, 0.7, 0.085, -0.18);
  return notes;
}

type Voice = {
  source: AudioScheduledSourceNode;
  gain: GainNode;
  music: boolean;
};
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** One shared, gesture-unlocked context for music, countdowns, jumps and impacts. */
export class RaceAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = new Set<Voice>();
  private enabled = true;
  private visible = true;
  private disposed = false;
  private nextStep = -1;
  private lastTime: number | null = null;
  private createContext: () => AudioContext;

  constructor(createContext: () => AudioContext = () => new AudioContext()) {
    this.createContext = createContext;
  }

  /** Call directly from a click/touch handler, before awaiting network work. */
  unlock() {
    if (this.disposed || !this.enabled) return;
    try {
      if (!this.context) {
        const ctx = this.createContext();
        this.context = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.visible ? 0.6 : 0;
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -16;
        this.compressor.knee.value = 15;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.14;
        this.master.connect(this.compressor);
        this.compressor.connect(ctx.destination);
        this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        // Seeded noise avoids generating a new large buffer for every drum hit.
        let seed = 731;
        for (let i = 0; i < data.length; i++) {
          seed = (seed * 16807) % 2147483647;
          data[i] = (seed / 2147483647) * 2 - 1;
        }
      }
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {});
    } catch {
      // Audio is optional; unsupported or blocked audio never interrupts the race.
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.updateVolume();
    if (!enabled) this.stop();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.updateVolume();
    if (!visible) this.stop();
    else if (this.enabled && this.context?.state === "suspended")
      void this.context.resume().catch(() => {});
  }

  private updateVolume() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(
      this.enabled && this.visible ? 0.6 : 0,
      now,
      0.012,
    );
  }

  private get audible() {
    return (
      !this.disposed &&
      this.enabled &&
      this.visible &&
      this.context?.state === "running"
    );
  }

  /** Schedule slightly ahead, but skip missed notes after a tab switch or network seek. */
  sync(elapsed: number, progress: number) {
    if (!Number.isFinite(elapsed) || elapsed < 0 || !this.audible) return;
    const ctx = this.context!;
    if (
      this.lastTime !== null &&
      (elapsed < this.lastTime - 0.025 || elapsed - this.lastTime > 0.5)
    )
      this.stopMusic();
    if (this.nextStep < 0)
      this.nextStep = Math.max(0, Math.ceil((elapsed - 0.015) / MUSIC_STEP));
    this.nextStep = Math.max(
      this.nextStep,
      Math.ceil((elapsed - 0.025) / MUSIC_STEP),
    );
    const until = Math.floor((elapsed + 0.14) / MUSIC_STEP);
    for (; this.nextStep <= until; this.nextStep++) {
      const when =
        ctx.currentTime + Math.max(0.006, this.nextStep * MUSIC_STEP - elapsed);
      for (const note of musicStep(this.nextStep, progress >= 0.8))
        this.playNote(note, when);
    }
    this.lastTime = elapsed;
  }

  beep(pitch = 440, duration = 0.08) {
    if (!this.audible) return;
    this.tone(
      pitch,
      this.context!.currentTime + 0.005,
      duration,
      0.11,
      "sine",
      false,
    );
  }

  effect(kind: "jump" | "impact" | "land") {
    if (!this.audible) return;
    const at = this.context!.currentTime + 0.005;
    if (kind === "jump") this.tone(430, at, 0.2, 0.085, "sine", false, 900);
    else if (kind === "impact") {
      this.tone(170, at, 0.19, 0.16, "triangle", false, 58);
      this.noise(at, 0.105, 0.075, 950, false, "lowpass");
    } else this.noise(at, 0.065, 0.04, 650, false, "lowpass");
  }

  finish() {
    if (!this.audible) return;
    const now = this.context!.currentTime + 0.012;
    [76, 79, 83, 88].forEach((note, i) =>
      this.tone(
        frequency(note),
        now + i * 0.085,
        i === 3 ? 0.42 : 0.17,
        0.12,
        "triangle",
        false,
      ),
    );
  }

  private playNote(note: MusicNote, at: number) {
    const duration = note.length * MUSIC_STEP;
    if (note.instrument === "kick")
      this.tone(145, at, duration, note.volume, "sine", true, 44);
    else if (note.instrument === "snare") {
      this.noise(at, duration, note.volume, 1700, true, "bandpass", note.pan);
      this.tone(185, at, 0.07, note.volume * 0.4, "triangle", true, 95);
    } else if (note.instrument === "hat")
      this.noise(at, duration, note.volume, 7200, true, "highpass", note.pan);
    else
      this.tone(
        frequency(note.midi),
        at,
        duration,
        note.volume,
        note.instrument === "bass" ? "triangle" : "sawtooth",
        true,
        undefined,
        note.pan,
        note.instrument === "bass"
          ? 680
          : note.instrument === "lead"
            ? 1900
            : 1250,
      );
  }

  private tone(
    pitch: number,
    at: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    music: boolean,
    endPitch?: number,
    pan = 0,
    cutoff = 0,
  ) {
    const ctx = this.context!;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(pitch, at);
    if (endPitch)
      oscillator.frequency.exponentialRampToValueAtTime(
        endPitch,
        at + duration * 0.78,
      );
    let filter: BiquadFilterNode | undefined;
    if (cutoff) {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(cutoff * 1.8, at);
      filter.frequency.exponentialRampToValueAtTime(cutoff, at + duration);
      filter.Q.value = 0.7;
    }
    this.connectVoice(oscillator, at, duration, volume, music, pan, filter);
  }

  private noise(
    at: number,
    duration: number,
    volume: number,
    cutoff: number,
    music: boolean,
    type: BiquadFilterType,
    pan = 0,
  ) {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    filter.Q.value = 0.7;
    this.connectVoice(source, at, duration, volume, music, pan, filter);
  }

  private connectVoice(
    source: AudioScheduledSourceNode,
    at: number,
    duration: number,
    volume: number,
    music: boolean,
    pan: number,
    filter?: BiquadFilterNode,
  ) {
    const ctx = this.context!;
    const gain = ctx.createGain();
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = pan;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    if (filter) {
      source.connect(filter);
      filter.connect(gain);
    } else source.connect(gain);
    gain.connect(stereo);
    stereo.connect(this.master!);
    const voice = { source, gain, music };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
      stereo.disconnect();
      this.voices.delete(voice);
    };
    source.start(at);
    source.stop(at + duration + 0.015);
  }

  private silence(musicOnly: boolean) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if (musicOnly && !voice.music) continue;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.008);
      voice.source.stop(now + 0.025);
      this.voices.delete(voice);
    }
    this.nextStep = -1;
    this.lastTime = null;
  }

  stopMusic() {
    this.silence(true);
  }
  stop() {
    this.silence(false);
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.master?.disconnect();
    this.compressor?.disconnect();
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.context = null;
    this.noiseBuffer = null;
  }
}
