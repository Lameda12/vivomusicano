import * as Tone from "tone";
import { parseChord, type ParsedChord } from "./songs";

export type PresetName = "Pad" | "Keys" | "Pluck";
export const PRESETS: PresetName[] = ["Pad", "Keys", "Pluck"];

const hz = (midi: number) => Tone.Frequency(midi, "midi").toFrequency();

// ---------- voicing ----------

const UPPER_LO = 52; // E3
const UPPER_HI = 79; // G5
const CENTER = 64;

export type Voicing = { bass: number; upper: number[] };

function upperPitchClasses(chord: ParsedChord): number[] {
  let ivs = [...new Set(chord.intervals.map((i) => i % 12))];
  // keep at most 4 upper voices: drop the fifth first on extended chords
  if (ivs.length > 4) ivs = ivs.filter((i) => i !== 7);
  return ivs.map((i) => (chord.root + i) % 12);
}

function movementCost(next: number[], prev: number[]): number {
  if (next.length === prev.length) {
    const a = [...next].sort((x, y) => x - y);
    const b = [...prev].sort((x, y) => x - y);
    return a.reduce((s, n, i) => s + Math.abs(n - b[i]), 0);
  }
  return next.reduce((s, n) => s + Math.min(...prev.map((p) => Math.abs(n - p))), 0);
}

/** Close-position voicing whose upper voices move as little as possible from `prev`. */
export function voiceChord(chord: ParsedChord, prev: number[] | null): Voicing {
  const pcs = upperPitchClasses(chord).sort((a, b) => a - b);
  let best: number[] = [];
  let bestCost = Infinity;
  for (let r = 0; r < pcs.length; r++) {
    const rotated = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let octave = 3; octave <= 6; octave++) {
      const notes: number[] = [];
      let last = -Infinity;
      for (const p of rotated) {
        let n = octave * 12 + p;
        while (n <= last) n += 12;
        notes.push(n);
        last = n;
      }
      if (notes[0] < UPPER_LO || notes[notes.length - 1] > UPPER_HI) continue;
      const mean = notes.reduce((s, n) => s + n, 0) / notes.length;
      const cost = prev
        ? movementCost(notes, prev) + 0.25 * Math.abs(mean - CENTER)
        : Math.abs(mean - CENTER);
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  const bass = 36 + chord.bass; // C2..B2
  return { bass, upper: best };
}

// ---------- instruments ----------

function createSynth(preset: PresetName): Tone.PolySynth {
  switch (preset) {
    case "Pad":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
        envelope: { attack: 0.2, decay: 0.4, sustain: 0.85, release: 1.5 },
        volume: -14,
      });
    case "Keys":
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 2.2,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.004, decay: 1.6, sustain: 0.3, release: 1.3 },
        modulationEnvelope: { attack: 0.002, decay: 0.6, sustain: 0.1, release: 0.8 },
        volume: -8,
      });
    case "Pluck":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
        envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.5 },
        volume: -12,
      });
  }
}

// ---------- engine ----------

export class AudioEngine {
  private filter: Tone.Filter;
  private chorus: Tone.Chorus;
  private reverb: Tone.Reverb;
  private master: Tone.Gain;
  private limiter: Tone.Limiter;
  private synth: Tone.PolySynth;
  private held: number[] = [];
  private prevUpper: number[] | null = null;
  private current: ParsedChord | null = null;
  private bpm = 90;
  preset: PresetName;

  private constructor(preset: PresetName) {
    this.preset = preset;
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Gain(0.56).connect(this.limiter);
    this.reverb = new Tone.Reverb({ decay: 4.5, preDelay: 0.02, wet: 0.3 }).connect(this.master);
    this.chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.5, wet: 0.35 })
      .connect(this.reverb)
      .start();
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 2400, rolloff: -24, Q: 0.8 }).connect(
      this.chorus,
    );
    this.synth = createSynth(preset).connect(this.filter);
    this.synth.maxPolyphony = 24;
  }

  /** Must be called from a user gesture (autoplay rules). */
  static async create(preset: PresetName = "Pad"): Promise<AudioEngine> {
    // lookAhead 0 = trigger immediately instead of Tone's default 100ms scheduling buffer
    Tone.setContext(new Tone.Context({ latencyHint: "interactive", lookAhead: 0 }));
    await Tone.start();
    const engine = new AudioEngine(preset);
    await engine.reverb.ready;
    return engine;
  }

  /** Hardware + browser output buffering, in ms (what we can't shave off in JS). */
  get outputLatencyMs(): number {
    const raw = Tone.getContext().rawContext as unknown as { baseLatency?: number; outputLatency?: number };
    return ((raw.baseLatency ?? 0) + (raw.outputLatency ?? 0)) * 1000;
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
  }

  /** 0..1 → gain (perceptual curve) */
  setVolume(v: number) {
    this.master.gain.rampTo(v * v * 0.9, 0.05);
  }

  /** 0..1 → 180 Hz .. 9 kHz exponential */
  setFilter(f: number) {
    this.filter.frequency.rampTo(180 * Math.pow(50, f), 0.05);
  }

  playChord(name: string) {
    const chord = parseChord(name);
    if (!chord) return;
    const { bass, upper } = voiceChord(chord, this.prevUpper);
    this.prevUpper = upper;
    this.current = chord;
    this.sound([bass, ...upper]);
  }

  private sound(notes: number[]) {
    const now = Tone.now();
    if (this.preset === "Pad") {
      // Common tones keep ringing; leaving tones release (1.5s) while new ones swell (0.2s) = crossfade.
      const release = this.held.filter((n) => !notes.includes(n));
      const attack = notes.filter((n) => !this.held.includes(n));
      if (release.length) this.synth.triggerRelease(release.map(hz), now);
      if (attack.length) this.synth.triggerAttack(attack.map(hz), now, 0.55);
      this.held = notes;
    } else if (this.preset === "Keys") {
      if (this.held.length) this.synth.triggerRelease(this.held.map(hz), now);
      this.synth.triggerAttack(notes.map(hz), now + 0.001, 0.7);
      this.held = notes;
    } else {
      // Pluck: arpeggiate up the voicing in eighth notes, then the top note an octave up.
      const step = 60 / this.bpm / 2;
      const seq = [...notes, notes[notes.length - 1] + 12].slice(0, 6);
      seq.forEach((n, i) => this.synth.triggerAttackRelease(hz(n), step * 0.9, now + i * step, i === 0 ? 0.8 : 0.6));
      this.held = [];
    }
  }

  setPreset(preset: PresetName) {
    if (preset === this.preset) return;
    const old = this.synth;
    old.releaseAll();
    setTimeout(() => old.dispose(), 2500);
    this.preset = preset;
    this.synth = createSynth(preset).connect(this.filter);
    this.synth.maxPolyphony = 24;
    this.held = [];
    // keep the current chord sounding through the switch (pads/keys); old voices fade out
    if (this.current && preset !== "Pluck") {
      const { bass, upper } = voiceChord(this.current, this.prevUpper);
      this.sound([bass, ...upper]);
    }
  }

  stop() {
    this.synth.releaseAll();
    this.held = [];
  }
}
