// Shared contract for the spike. Pure types only: no DOM, no Node, no Pixi.
// The sim (worker1), server/verifier (worker2) and client (orchestrator) all
// build against this file. Do not change it without updating all three.

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  shoot: boolean;
}

export const emptyInput = (): InputState => ({ left: false, right: false, jump: false, shoot: false });

export interface Entity {
  id: number;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  color: number;
  /** Static solids block movement; dynamic entities collide with solids. */
  solid: boolean;
  /** 0 = no gravity (platforms, rain), 1 = full gravity. */
  gravityScale: number;
  facing: 1 | -1;
  onGround: boolean;
  health: number;
  /** Owning mod id, or "engine" for built-ins. Set by the loader. */
  owner: string;
  data: Record<string, number | string | boolean>;
}

/** Procedural shapes the client draws in code, so primitives never go to Muse Image (ADR 0015). */
export type ShapeName = "circle" | "ring" | "triangle" | "spikes" | "pill" | "diamond" | "star" | "block";

/** How the client draws entities of these types: a code-drawn shape, or an engine effect (no outline, no sprite). */
export interface Look { visual: "shape" | "effect"; shape?: ShapeName; types: string[] }

/** A whole-world mood (ADR 0017): palette for the code-drawn world plus a style anchor that drives every sprite restyle. */
export interface MoodSpec {
  name: string; anchor: string;
  skyTop: number; skyBottom: number; ridgeFar: number; ridgeNear: number; moon: number; star: number; grass: number; soil: number;
  tint: number; grade: number; dim: number; fog: number; vignette: number;
  ambient: "none" | "fog" | "snow" | "embers" | "sparks";
}

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: number; size: number;
}

export interface SpawnDef {
  type: string;
  x: number; y: number; w: number; h: number;
  vx?: number; vy?: number;
  color?: number;
  solid?: boolean;
  gravityScale?: number;
  health?: number;
  data?: Record<string, number | string | boolean>;
}

/** Where the client anchors a HUD widget inside the game viewport. */
export type HudPosition =
  | "top-left" | "top-right" | "top-center"
  | "bottom-left" | "bottom-right" | "bottom-center"
  | "center";

/**
 * Declarative HUD widget definition (ADR 0019). Pure data: the sim only stores
 * it on world.hud; the client renders it. Mods never touch the DOM.
 * - "bar": a meter (HP, mana, jetpack fuel, boss health). value/max.
 * - "hearts": discrete pips (lives, ammo, hearts). value = filled pips
 *   (a fraction fills the last pip partially), max = pip count.
 * - "stat": a counter/readout (score, speed, timer, altitude). value + unit.
 * - "banner": a callout. text; with duration it auto-removes after that many
 *   sim seconds, without it stays until removeHud.
 */
export interface HudDef {
  kind: "bar" | "hearts" | "stat" | "banner";
  /** Short label ("HP", "Coins"). Banners use text instead. */
  label?: string;
  /** bar/hearts: current amount. stat: the number to show. */
  value?: number;
  /** bar/hearts: amount when full. stat: optional, adds a "3/20" readout. */
  max?: number;
  /** stat unit suffix ("s", "px/s"). */
  unit?: string;
  /** Short emoji/glyph shown before the label/value. */
  icon?: string;
  /** Fill/pip/accent color, NUMBER hex like 0x3fd06a — never a CSS string. */
  color?: number;
  /** banner: the message to show. */
  text?: string;
  /** banner: seconds of sim time before auto-removal; omit to keep it. */
  duration?: number;
  position?: HudPosition;
  /** Hide without removing (toggle back by setting hidden: false). */
  hidden?: boolean;
}

/** A HUD widget as stored on the world: the def plus its id, owner and, for
 *  auto-removing banners, the sim-seconds it has left. */
export interface HudWidget extends HudDef {
  id: string;
  /** Owning mod id, like entities. Set by the loader; cleaned on unload. */
  owner: string;
  /** Seconds of sim time left before a timed banner disappears. */
  remaining?: number;
}

/** API handed to a mod in setup(). Everything a mod creates is owned by it
 *  and removed on dispose(). Mods get no DOM, network, eval or engine internals. */
export interface ModApi {
  spawn(def: SpawnDef): Entity;
  despawn(id: number): void;
  damage: (id: number, amount: number) => void;
  /** All live entities (read-only view; mutate fields, never the array). */
  entities(): readonly Entity[];
  byType(type: string): Entity[];
  player(): Entity | undefined;
  input(): Readonly<InputState>;
  onTick(fn: (dt: number) => void): void;
  burst(x: number, y: number, color: number, n?: number): void;
  /** Seeded RNG only. Never Math.random in sim code. */
  rand(): number;
  tick(): number;
  /** Create or update a HUD widget (same id = update in place). Widgets you
   *  create are removed automatically when your mod unloads. ADR 0019. */
  setHud(id: string, def: HudDef): void;
  /** Remove one of YOUR widgets by id (owner-scoped, like despawn). */
  removeHud(id: string): void;
  /** Read a widget back by id (any owner) — for tests and coordination. */
  hud(id: string): HudWidget | undefined;
  /** All widgets in creation order (read-only view). */
  hudList(): readonly HudWidget[];
}

export type KnobValue = number | string | boolean;
export interface KnobDef { value: KnobValue; min?: number; max?: number; label?: string }
export type KnobDefs = Record<string, KnobDef>;
export type KnobValues = Record<string, KnobValue>;

export interface TestApi {
  expect(cond: boolean, msg: string): void;
  api: ModApi;
  step(n: number, input?: Partial<InputState>): void;
}

export interface ModDefinition {
  id: string;
  title: string;
  knobs?: KnobDefs;
  setup(api: ModApi, knobs: KnobValues): void;
  dispose(api: ModApi): void;
  test?(t: TestApi): void;
}

/** Wire protocol: client <-> server over WebSocket (JSON text frames). */
export type ClientMsg =
  | { kind: "command"; text: string }
  | { kind: "undo"; modId: string }
  | { kind: "knob"; modId: string; knob: string; value: KnobValue }
  | { kind: "photo"; key: string; image: string; prompt: string }
  | { kind: "photoFind"; key: string; image: string; prompt: string }
  | { kind: "photoBring"; key: string }
  | { kind: "photoBringLocal"; key: string; prompt: string; aspect: number }
  /** The mods in the player's world right now, in load order, sent before each command so the playtest runs in a copy of it (ADR 0013). */
  | { kind: "worldState"; mods: { id: string; values: Record<string, KnobValue> }[] }
  // Voice (ADR 0012). Mic audio itself travels as binary frames: PCM16 mono 16 kHz.
  | { kind: "voiceWarm" }
  | { kind: "voiceStart" }
  | { kind: "voiceEnd"; cancel?: boolean }
  // Share links (ADR 0014). The server only ever saves mods it verified itself; the client just says which are loaded.
  | { kind: "worldSave"; mods: { id: string; values: KnobValues }[] }
  | { kind: "worldLoad"; id: string }
  // Mood restyle (ADR 0017): the client lists the sprite sheets it has; the server edits each toward the mood anchor.
  | { kind: "restyle"; mood: string; keys: string[] }
  // Self-improving feedback (ADR 0020): thumbs-up/down on entities or mod cards distills persistent rules & skills.
  | { kind: "feedback"; modId: string; entityType?: string; vote: "up" | "down"; note: string; fixNow?: boolean };

/** One mod in a saved world: a built-in the client bundles, or a verified AI mod with its source. */
export type WorldMod =
  | { builtin: true; id: string; values: KnobValues }
  | { builtin?: false; id: string; title: string; source: string; compiled: string; knobs: KnobDefs; values: KnobValues; art?: { key: string; url: string; scenery?: boolean }; look?: Look };

export interface DemoWorld { id: string; title: string; blurb: string }

export type BuildStage = "routing" | "writing" | "compiling" | "verifying" | "rejected" | "fixing" | "done" | "failed";

export type ServerMsg =
  | { kind: "stage"; stage: BuildStage; detail: string; command?: string }
  | { kind: "mod"; mod: { id: string; title: string; source: string; compiled: string; knobs: KnobDefs; art?: { key: string; url: string; scenery?: boolean }; artPending?: string; look?: Look } }
  | { kind: "art"; modId: string; art: { key: string; url: string; scenery?: boolean } }
  | { kind: "mood"; mood: MoodSpec | null }
  | { kind: "restyled"; mood: string; key: string; url: string | null }
  | { kind: "tweak"; modId: string; knob: string; value: KnobValue }
  | { kind: "removed"; modId: string }
  | { kind: "say"; text: string }
  | { kind: "segment"; key: string; box: { x: number; y: number; w: number; h: number } | null }
  /** One bot playtest. The client replays `inputs` (RLE of input masks) in a copy of its own world plus `mod`. */
  | { kind: "playtest"; command: string; attempt: number; ok: boolean; plain: string; seed: number; frames: number; inputs: number[]; mod: { id: string; compiled: string }; replaces?: string; ms: number }
  /** A piece of the code Wonder is writing for `command`, as it arrives (ADR 0022). */
  | { kind: "codeStream"; command: string; text: string }
  | { kind: "timing"; command: string; ms: { route: number; write: number; compile: number; verify: number; total: number } }
  | { kind: "voiceState"; state: "ready" | "listening" | "error"; detail?: string }
  | { kind: "transcript"; text: string; final: boolean; ms?: { firstPartial: number; final: number } }
  | { kind: "worldSaved"; id: string }
  | { kind: "world"; id: string; mods: WorldMod[]; mood?: MoodSpec | null; restyled?: Record<string, string> }
  // Visitor mode (no key, kill-switch, or budget spent): the game still plays; offer these instead.
  | { kind: "visitor"; reason: "nokey" | "killswitch" | "budget"; demos: DemoWorld[] };

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  /** Average sim ms per frame over the health-check run. Budget: < 2. */
  msPerFrame: number;
  frames: number;
  entities: number;
}

export const SIM = {
  dt: 1 / 60,
  gravity: 1500,
  maxEntities: 500,
  healthFrames: 600,
  msBudget: 2,
} as const;

/** Forbidden in mod source (verifier layer 0, checked before compile). */
export const FORBIDDEN_MOD_TOKENS = [
  "eval", "Function(", "fetch", "WebSocket", "document", "window",
  "localStorage", "process.", "require(", "import(",
] as const;
