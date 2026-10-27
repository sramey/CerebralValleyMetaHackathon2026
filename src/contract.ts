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
  data?: Record<string, number | string | boolean>;
}

/** API handed to a mod in setup(). Everything a mod creates is owned by it
 *  and removed on dispose(). Mods get no DOM, network, eval or engine internals. */
export interface ModApi {
  spawn(def: SpawnDef): Entity;
  despawn(id: number): void;
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
  | { kind: "knob"; modId: string; knob: string; value: KnobValue };

export type BuildStage = "routing" | "writing" | "compiling" | "verifying" | "fixing" | "done" | "failed";

export type ServerMsg =
  | { kind: "stage"; stage: BuildStage; detail: string; command?: string }
  | { kind: "mod"; mod: { id: string; title: string; source: string; compiled: string; knobs: KnobDefs } }
  | { kind: "tweak"; modId: string; knob: string; value: KnobValue }
  | { kind: "removed"; modId: string }
  | { kind: "say"; text: string }
  | { kind: "timing"; command: string; ms: { route: number; write: number; compile: number; verify: number; total: number } };

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
