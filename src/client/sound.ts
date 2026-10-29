// Sound (bead 6d3): every effect and ambience bed is synthesized with WebAudio at runtime. No audio files exist in
// the repo, so every sound is ours. It plays under narration, so peaks are low and the beds barely there.
// The event -> sound mapping (sfxFor, buildSfx, bedFor) is pure and unit-tested; the Sound class only renders it.
import type { BuildStage, MoodSpec } from "../contract";
import type { FeelEvent } from "./feel";

export type Sfx = "jump" | "land" | "step" | "coin" | "hit" | "hurt" | "shoot" | "portal" | "chime" | "thunk" | "swell";
export type Bed = "night" | "christmas" | "spooky" | "day";

/** Which sound a game-feel event makes, and how loud (0..1). */
export function sfxFor(ev: FeelEvent): { sfx: Sfx; gain: number } | null {
  switch (ev.kind) {
    case "jump": return { sfx: "jump", gain: 1 };
    case "land": return ev.impact < 0.12 ? null : { sfx: "land", gain: 0.35 + 0.65 * Math.min(1, ev.impact) };
    case "step": return { sfx: "step", gain: 1 };
    case "coin": return { sfx: "coin", gain: 1 };
    case "hit": return { sfx: ev.self ? "hurt" : "hit", gain: Math.min(1, 0.5 + ev.damage / 40) };
    case "shoot": return { sfx: "shoot", gain: 1 };
  }
}

/** Build stage messages: a landed build rings, a rejected or failed one thuds, the stages in between stay quiet. */
export function buildSfx(stage: BuildStage): Sfx | null {
  if (stage === "done") return "chime";
  if (stage === "rejected" || stage === "failed") return "thunk";
  return null;
}

const luma = (c: number): number => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

/** The ambience bed for a mood (null = the default night world). */
export function bedFor(m: MoodSpec | null): Bed {
  if (!m) return "night";
  const n = m.name.toLowerCase();
  if (m.ambient === "snow" || /christmas|snow|winter|holiday|frost/.test(n)) return "christmas";
  if (/spook|haunt|horror|ghost|creep|halloween|gloom|dread/.test(n) || m.ambient === "embers") return "spooky";
  if (luma(m.skyBottom) > 0.42 || /day|sun|morning|bright|meadow|summer|spring/.test(n)) return "day";
  return "night";
}

/** Shortest gap (ms) between two plays of one sound, so a held key or a burst never machine-guns. */
const MIN_GAP: Record<Sfx, number> = { jump: 80, land: 80, step: 140, coin: 40, hit: 50, hurt: 120, shoot: 70, portal: 150, chime: 300, thunk: 300, swell: 800 };

export interface SoundOpts { muted?: boolean; volume?: number }

export class Sound {
  muted: boolean;
  volume: number;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private bedBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sfx, number>();
  private bed: Bed | null = null;
  private wantBed: Bed = "night";
  private stopBed: (() => void) | null = null;

  constructor(opts: SoundOpts = {}) {
    this.muted = !!opts.muted;
    this.volume = Number.isFinite(opts.volume) ? Math.min(1, Math.max(0, opts.volume as number)) : 0.6;
  }

  get ready(): boolean { return this.ctx !== null; }

  /** Browsers only allow audio after a user gesture: call this from the first pointer or key event. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume?.(); return; }
    const AC = typeof AudioContext !== "undefined" ? AudioContext : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume * 0.5;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.bedBus = ctx.createGain();
    this.bedBus.gain.value = 0.7;
    this.bedBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    void ctx.resume?.();
    this.startBed(this.wantBed);
  }

  private applyMaster(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.03);
  }
  setMuted(m: boolean): void { this.muted = m; this.applyMaster(); }
  toggleMute(): boolean { this.setMuted(!this.muted); return this.muted; }
  setVolume(v: number): void { this.volume = Math.min(1, Math.max(0, v)); this.applyMaster(); }

  playEvent(ev: FeelEvent): void {
    const s = sfxFor(ev);
    if (s) this.play(s.sfx, s.gain);
  }

  play(sfx: Sfx, gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state === "suspended") return;
    const now = performance.now();
    if (now - (this.last.get(sfx) ?? -1e9) < MIN_GAP[sfx]) return;
    this.last.set(sfx, now);
    SFX[sfx](this, gain);
  }

  /** The world changed mood: swell once, then settle into that mood's bed. */
  setMood(m: MoodSpec | null, swell = false): void {
    this.wantBed = bedFor(m);
    if (this.ctx) this.startBed(this.wantBed);
    if (swell) this.play("swell");
  }

  // --- synthesis helpers (used by SFX and beds) -------------------------------------------------------------
  /** A pitched blip: oscillator gliding f0 -> f1 under a fast-attack exponential decay. */
  tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0, bus: AudioNode | null = this.sfxBus): void {
    const ctx = this.ctx;
    if (!ctx || !bus) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A filtered noise burst sweeping its filter f0 -> f1. */
  hiss(filter: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, delay = 0, q = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.sfxBus) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** A slow swell of two detuned saws through a sweeping lowpass (the mood change). */
  pad(peak: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + dur * 0.45);
    f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.sfxBus);
    for (const [hz, det] of [[196, -6], [293.66, 5], [392, 0]] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  // --- ambience beds ----------------------------------------------------------------------------------------
  private startBed(bed: Bed): void {
    const ctx = this.ctx;
    if (!ctx || !this.bedBus || this.bed === bed) return;
    const prevStop = this.stopBed;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 2.5);
    g.connect(this.bedBus);
    const stopNodes = BEDS[bed](this, ctx, g);
    this.bed = bed;
    this.stopBed = () => {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
      window.setTimeout(() => { stopNodes(); g.disconnect(); }, 2000);
    };
    prevStop?.();
  }

  /** Looping wind: noise through a slowly wandering bandpass. Returns a stopper. */
  wind(ctx: AudioContext, out: AudioNode, center: number, level: number, wander = 0.07): () => void {
    if (!this.noise) return () => {};
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = center;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = level;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = wander;
    const depth = ctx.createGain();
    depth.gain.value = center * 0.45;
    lfo.connect(depth).connect(f.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = wander * 1.7;
    const depth2 = ctx.createGain();
    depth2.gain.value = level * 0.5;
    lfo2.connect(depth2).connect(g.gain);
    src.connect(f).connect(g).connect(out);
    src.start();
    lfo.start();
    lfo2.start();
    return () => { src.stop(); lfo.stop(); lfo2.stop(); };
  }

  /** Call `fn` at random intervals (seconds) until the returned stopper runs. */
  every(min: number, max: number, fn: () => void): () => void {
    let id = 0;
    let live = true;
    const next = (): void => { id = window.setTimeout(() => { if (!live) return; if (!this.muted) fn(); next(); }, (min + Math.random() * (max - min)) * 1000); };
    next();
    return () => { live = false; window.clearTimeout(id); };
  }
}

type BedFn = (s: Sound, ctx: AudioContext, out: AudioNode) => () => void;

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const BEDS: Record<Bed, BedFn> = {
  // Night wind and nothing else.
  night: (s, ctx, out) => s.wind(ctx, out, 420, 0.05),
  // Thin winter wind and the odd bell shimmering by.
  christmas: (s, ctx, out) => {
    const stopWind = s.wind(ctx, out, 520, 0.03, 0.05);
    const stopBells = s.every(1.6, 3.4, () => {
      const f = pick([1568, 1760, 2093, 2349, 2637]);
      s.tone("sine", f, f, 2.2, 0.03, 0, out);
      s.tone("sine", f * 2.41, f * 2.41, 1.1, 0.01, 0, out);
    });
    return () => { stopWind(); stopBells(); };
  },
  // A low unsteady drone with a whisper of wind.
  spooky: (s, ctx, out) => {
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 170;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    lp.connect(g).connect(out);
    const oscs: OscillatorNode[] = [];
    for (const [hz, type] of [[55, "sawtooth"], [55.8, "sawtooth"], [82.4, "sine"]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.connect(lp);
      o.start(t);
      oscs.push(o);
    }
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.18;
    const td = ctx.createGain();
    td.gain.value = 0.02;
    trem.connect(td).connect(g.gain);
    trem.start(t);
    oscs.push(trem);
    const stopWind = s.wind(ctx, out, 260, 0.035, 0.05);
    return () => { for (const o of oscs) o.stop(); stopWind(); };
  },
  // A breath of breeze and birdish chirps.
  day: (s, ctx, out) => {
    const stopWind = s.wind(ctx, out, 900, 0.018, 0.09);
    const stopBirds = s.every(0.9, 2.8, () => {
      const base = 2200 + Math.random() * 1400;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        s.tone("sine", base, base * 1.45, 0.07, 0.028, i * 0.11, out);
        s.tone("sine", base * 1.45, base * 1.1, 0.05, 0.02, i * 0.11 + 0.05, out);
      }
    });
    return () => { stopWind(); stopBirds(); };
  },
};

const SFX: Record<Sfx, (s: Sound, g: number) => void> = {
  jump: (s, g) => s.tone("triangle", 280, 600, 0.14, 0.11 * g),
  land: (s, g) => { s.hiss("lowpass", 700, 150, 0.14, 0.2 * g); s.tone("sine", 120, 55, 0.12, 0.16 * g); },
  step: (s, g) => s.hiss("bandpass", 700 + Math.random() * 500, 400, 0.05, 0.05 * g, 0, 1.2),
  coin: (s) => { s.tone("triangle", 988, 988, 0.08, 0.09); s.tone("triangle", 1319, 1319, 0.28, 0.09, 0.07); },
  hit: (s, g) => { s.hiss("bandpass", 1300, 300, 0.13, 0.15 * g, 0, 0.9); s.tone("sawtooth", 190, 90, 0.1, 0.07 * g); },
  hurt: (s, g) => { s.tone("sawtooth", 230, 65, 0.24, 0.1 * g); s.hiss("lowpass", 900, 200, 0.18, 0.12 * g); },
  shoot: (s) => { s.hiss("highpass", 3200, 900, 0.12, 0.09); s.tone("sine", 900, 220, 0.1, 0.07); },
  portal: (s) => {
    s.tone("sawtooth", 160, 1400, 0.3, 0.035);
    s.tone("sawtooth", 1400, 220, 0.4, 0.03, 0.3);
    s.hiss("bandpass", 2600, 5200, 0.7, 0.04, 0, 3);
  },
  chime: (s) => { [1047, 1319, 1568, 2093].forEach((f, i) => s.tone("sine", f, f, 0.9, 0.075, i * 0.085)); },
  thunk: (s) => { s.tone("sine", 125, 52, 0.24, 0.22); s.hiss("lowpass", 320, 90, 0.1, 0.1); },
  swell: (s) => s.pad(0.05, 2.4),
};
