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
  | { kind: "worldLoad"; id: string };

/** One mod in a saved world: a built-in the client bundles, or a verified AI mod with its source. */
export type WorldMod =
  | { builtin: true; id: string; values: KnobValues }
  | { builtin?: false; id: string; title: string; source: string; compiled: string; knobs: KnobDefs; values: KnobValues; art?: { key: string; url: string; scenery?: boolean } };

export interface DemoWorld { id: string; title: string; blurb: string }

export type BuildStage = "routing" | "writing" | "compiling" | "verifying" | "rejected" | "fixing" | "done" | "failed";

export type ServerMsg =
  | { kind: "stage"; stage: BuildStage; detail: string; command?: string }
  | { kind: "mod"; mod: { id: string; title: string; source: string; compiled: string; knobs: KnobDefs; art?: { key: string; url: string; scenery?: boolean }; artPending?: string } }
  | { kind: "art"; modId: string; art: { key: string; url: string; scenery?: boolean } }
  | { kind: "tweak"; modId: string; knob: string; value: KnobValue }
  | { kind: "removed"; modId: string }
  | { kind: "say"; text: string }
  | { kind: "segment"; key: string; box: { x: number; y: number; w: number; h: number } | null }
  /** One bot playtest. The client replays `inputs` (RLE of input masks) in a copy of its own world plus `mod`. */
  | { kind: "playtest"; command: string; attempt: number; ok: boolean; plain: string; seed: number; frames: number; inputs: number[]; mod: { id: string; compiled: string }; replaces?: string; ms: number }
  | { kind: "timing"; command: string; ms: { route: number; write: number; compile: number; verify: number; total: number } }
  | { kind: "voiceState"; state: "ready" | "listening" | "error"; detail?: string }
  | { kind: "transcript"; text: string; final: boolean; ms?: { firstPartial: number; final: number } }
  | { kind: "worldSaved"; id: string }
  | { kind: "world"; id: string; mods: WorldMod[] }
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
