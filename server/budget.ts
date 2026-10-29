// Spend guard (ADR 0014). Every Meta call the product makes is counted here before it
// happens: per visitor (IP) and globally, per UTC day, with a kill-switch. A refusal is a
// friendly sentence for the orb, never an error: the game keeps playing in visitor mode.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Kind = "build" | "image" | "sam" | "voice";
export type Limits = Record<Kind, number>;

/** Voice is counted in seconds of Meta session time (standby + live); the env vars are minutes. */
export const DEFAULT_SESSION: Limits = { build: 20, image: 8, sam: 6, voice: 8 * 60 };
export const DEFAULT_GLOBAL: Limits = { build: 400, image: 120, sam: 100, voice: 120 * 60 };

export type Verdict =
  | { ok: true }
  | { ok: false; scope: "killswitch" | "session" | "global"; message: string };

const WHAT: Record<Kind, string> = {
  build: "AI builds",
  image: "AI art",
  sam: "photo cutouts",
  voice: "voice",
};

export function readLimits(env: Record<string, string | undefined>): { session: Limits; global: Limits } {
  const num = (name: string, dflt: number, scale = 1) => {
    const v = Number(env[name]);
    return env[name] !== undefined && env[name] !== "" && Number.isFinite(v) && v >= 0 ? v * scale : dflt;
  };
  return {
    session: {
      build: num("BUDGET_SESSION_BUILDS", DEFAULT_SESSION.build),
      image: num("BUDGET_SESSION_IMAGES", DEFAULT_SESSION.image),
      sam: num("BUDGET_SESSION_SAM", DEFAULT_SESSION.sam),
      voice: num("BUDGET_SESSION_VOICE_MIN", DEFAULT_SESSION.voice / 60, 60),
    },
    global: {
      build: num("BUDGET_GLOBAL_BUILDS", DEFAULT_GLOBAL.build),
      image: num("BUDGET_GLOBAL_IMAGES", DEFAULT_GLOBAL.image),
      sam: num("BUDGET_GLOBAL_SAM", DEFAULT_GLOBAL.sam),
      voice: num("BUDGET_GLOBAL_VOICE_MIN", DEFAULT_GLOBAL.voice / 60, 60),
    },
  };
}

interface Persisted { day: string; global: Limits; sessions: Record<string, Limits> }

const zero = (): Limits => ({ build: 0, image: 0, sam: 0, voice: 0 });

export interface BudgetOptions {
  session?: Limits;
  global?: Limits;
  /** True while the AI_KILL_SWITCH env var is set (checked live, so it can be flipped without a restart of state). */
  killSwitch?: () => boolean;
  now?: () => number;
  /** Persist counters here so a restart does not reset the day's spend. */
  file?: string;
}

export class Budget {
  private session: Limits;
  private global: Limits;
  private killSwitch: () => boolean;
  private now: () => number;
  private file?: string;
  private day: string;
  private used: Persisted;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: BudgetOptions = {}) {
    this.session = opts.session ?? DEFAULT_SESSION;
    this.global = opts.global ?? DEFAULT_GLOBAL;
    this.killSwitch = opts.killSwitch ?? (() => false);
    this.now = opts.now ?? Date.now;
    this.file = opts.file;
    this.day = this.today();
    this.used = { day: this.day, global: zero(), sessions: {} };
    this.load();
    if (this.file) {
      this.timer = setInterval(() => this.flush(), 10_000);
      this.timer.unref();
    }
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private roll(): void {
    const t = this.today();
    if (t === this.day) return;
    this.day = t;
    this.used = { day: t, global: zero(), sessions: {} };
    this.dirty = true;
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const p = JSON.parse(readFileSync(this.file, "utf8")) as Persisted;
      if (p.day === this.day && p.global && p.sessions) this.used = p;
    } catch { /* a corrupt counter file just starts the day fresh */ }
  }

  flush(): void {
    if (!this.file || !this.dirty) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.used));
      this.dirty = false;
    } catch { /* never let accounting break the game */ }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  /** Would `amount` of `kind` be allowed right now? Does not spend. */
  check(who: string, kind: Kind, amount = 1): Verdict {
    this.roll();
    if (this.killSwitch()) {
      return { ok: false, scope: "killswitch", message: "The AI is switched off right now, but you can still play and try the demo worlds." };
    }
    const s = (this.used.sessions[who] ??= zero());
    if (s[kind] + amount > this.session[kind]) {
      return { ok: false, scope: "session", message: `You've used your ${WHAT[kind]} for today. Play on, or open a demo world. Come back tomorrow for more.` };
    }
    if (this.used.global[kind] + amount > this.global[kind]) {
      return { ok: false, scope: "global", message: `The ${WHAT[kind]} budget for the whole game is used up for today. You can still play and try the demo worlds.` };
    }
    return { ok: true };
  }

  /** Check, and if allowed spend `amount` atomically. */
  take(who: string, kind: Kind, amount = 1): Verdict {
    const v = this.check(who, kind, amount);
    if (v.ok) this.add(who, kind, amount);
    return v;
  }

  /** Record usage after the fact (e.g. voice seconds when a Meta session closes). */
  add(who: string, kind: Kind, amount: number): void {
    this.roll();
    const s = (this.used.sessions[who] ??= zero());
    s[kind] += amount;
    this.used.global[kind] += amount;
    this.dirty = true;
  }

  snapshot(): { day: string; global: Limits; limits: { session: Limits; global: Limits } } {
    this.roll();
    return { day: this.day, global: { ...this.used.global }, limits: { session: this.session, global: this.global } };
  }
}
