// Spend guard (ADR 0014). Every Meta call the product makes is counted here before it
// happens: per visitor (IP) and globally, per UTC day, with a kill-switch. A refusal is a
// friendly sentence for the orb, never an error: the game keeps playing in visitor mode.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Kind = "build" | "image" | "sam" | "voice" | "explain";
export type Limits = Record<Kind, number>;

/**
 * Unlimited by default (owner 2026-10-30): there is no public page and every player brings
 * their own Meta key, so a local build is never capped. A host can still set any `BUDGET_*`
 * env var (listed in `.env.example`) and `AI_KILL_SWITCH` still stops every call at once.
 * Voice is counted in seconds of Meta session time (standby + live); the env vars are minutes.
 */
export const DEFAULT_SESSION: Limits = { build: Infinity, image: Infinity, sam: Infinity, voice: Infinity, explain: Infinity };
export const DEFAULT_GLOBAL: Limits = { build: Infinity, image: Infinity, sam: Infinity, voice: Infinity, explain: Infinity };

export type Verdict =
  | { ok: true }
  | { ok: false; scope: "killswitch" | "session" | "global"; message: string };

/** Local loopback IPs never count against visitor session caps in dev (bead hvd). */
export function isLocalIp(ip: string): boolean {
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, "");
  return clean === "127.0.0.1" || clean === "::1" || clean === "localhost" || clean === "unknown";
}

const WHAT: Record<Kind, string> = {
  build: "AI builds",
  image: "AI art",
  sam: "photo cutouts",
  voice: "voice",
  explain: "code explanations",
};

export function readLimits(env: Record<string, string | undefined>): { session: Limits; global: Limits } {
  const num = (name: string, dflt: number, scale = 1) => {
    const v = Number(env[name]);
    // dflt is in the env var's unit (voice: minutes), so it scales the same way an explicit value does.
    return (env[name] !== undefined && env[name] !== "" && Number.isFinite(v) && v >= 0 ? v : dflt) * scale;
  };
  return {
    session: {
      build: num("BUDGET_SESSION_BUILDS", DEFAULT_SESSION.build),
      image: num("BUDGET_SESSION_IMAGES", DEFAULT_SESSION.image),
      sam: num("BUDGET_SESSION_SAM", DEFAULT_SESSION.sam),
      voice: num("BUDGET_SESSION_VOICE_MIN", DEFAULT_SESSION.voice / 60, 60),
      explain: num("BUDGET_SESSION_EXPLAINS", DEFAULT_SESSION.explain),
    },
    global: {
      build: num("BUDGET_GLOBAL_BUILDS", DEFAULT_GLOBAL.build),
      image: num("BUDGET_GLOBAL_IMAGES", DEFAULT_GLOBAL.image),
      sam: num("BUDGET_GLOBAL_SAM", DEFAULT_GLOBAL.sam),
      voice: num("BUDGET_GLOBAL_VOICE_MIN", DEFAULT_GLOBAL.voice / 60, 60),
      explain: num("BUDGET_GLOBAL_EXPLAINS", DEFAULT_GLOBAL.explain),
    },
  };
}

interface Persisted { day: string; global: Limits; sessions: Record<string, Limits> }

const zero = (): Limits => ({ build: 0, image: 0, sam: 0, voice: 0, explain: 0 });

/**
 * A persisted counter set, completed with 0 for any kind this version added since the file was
 * written (ADR 0043 added `explain`). Without this an old counter file turns a new kind into NaN.
 */
function fill(l: Partial<Limits> | undefined): Limits {
  const out = zero();
  for (const k of Object.keys(out) as Kind[]) {
    const v = l?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

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
      if (p.day !== this.day || !p.global || !p.sessions) return;
      this.used = {
        day: p.day,
        global: fill(p.global),
        sessions: Object.fromEntries(Object.entries(p.sessions).map(([who, l]) => [who, fill(l)])),
      };
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
    // Development loopback: local developer & family playtesting on localhost
    // must never be locked out with session build caps (bead hvd, ADR 0014).
    if (isLocalIp(who) && process.env.NODE_ENV !== "production") {
      return { ok: true };
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
