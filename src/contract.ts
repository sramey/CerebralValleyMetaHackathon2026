// Shared contract for the spike. Pure types only: no DOM, no Node, no Pixi.
// The sim (worker1), server/verifier (worker2) and client (orchestrator) all
// build against this file. Do not change it without updating all three.

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  shoot: boolean;
  /** Primary item/weapon action or use key (e.g. F / E / X / J). */
  use?: boolean;
  /** Mouse/touch aim in WORLD coordinates (ADR 0050). Absent with a keyboard-only player: aim along facing instead. */
  pointerX?: number;
  pointerY?: number;
  /** Primary mouse button / touch is held. */
  pointerDown?: boolean;
}

export const emptyInput = (): InputState => ({ left: false, right: false, jump: false, shoot: false, use: false });

export type EntityKind = "terrain" | "effect" | "projectile" | "shape" | "prop" | "creature" | "player";

export interface Entity {
  id: number;
  type: string;
  kind?: EntityKind;
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
  /** Free-form, wire-safe mod data. A few keys are engine contracts: `collectible`
   *  (true | points | a HUD id) makes the engine collect this entity into one shared
   *  score HUD on player touch (ADR 0055), and `bounce` sets landing restitution
   *  (ADR 0053). */
  data: Record<string, number | string | boolean>;
  /** Set by the engine when the entity is despawned or destroyed; a mod holding a stale reference can check it. */
  dead?: boolean;
  despawned?: boolean;
}

/** Procedural shapes the client draws in code, so primitives never go to Muse Image (ADR 0015). */
export type ShapeName = "circle" | "ring" | "triangle" | "spikes" | "pill" | "diamond" | "star" | "block" | "flag";

/** How the client draws entities of these types: a code-drawn shape, or an engine effect (no outline, no sprite). */
export interface Look { visual: "shape" | "effect"; shape?: ShapeName; types: string[] }

/** A whole-world mood (ADR 0017): palette for the code-drawn world plus a style anchor that drives every sprite restyle. */
export interface MoodSpec {
  name: string; anchor: string;
  skyTop: number; skyBottom: number; ridgeFar: number; ridgeNear: number; moon: number; star: number; grass: number; soil: number;
  tint: number; grade: number; dim: number; fog: number; vignette: number;
  ambient: "none" | "fog" | "snow" | "embers" | "sparks";
  /** Themed parallax scenery that replaces the starter scenery ("change the background to medieval", ADR 0067). */
  backdrop?: ThemedBackdrop;
  /** "background": the ask named only the backdrop, so sprites keep their look (no Muse Image edits). */
  scope?: "world" | "background";
}

/** Landmarks and props the code-drawn backdrop can paint (ADR 0067). Spark picks from this list; nothing else is drawn. */
export const BACKDROP_MOTIFS = [
  "castle", "tower", "village", "church", "windmill", "farmhouse", "barn", "silo", "watertower", "city", "pyramid", "tent",
  "pine", "oak", "deadtree", "palm", "cactus", "rock", "bush", "fence", "lamp", "torch", "haybale", "corn", "banner", "well", "cart",
  "clocktower", "dome", "pagoda", "eiffel", "lighthouse", "igloo", "phonebox", "mesa",
] as const;
export type BackdropMotif = (typeof BACKDROP_MOTIFS)[number];

/**
 * A themed backdrop: the skyline shape plus what stands in each parallax band behind the play plane.
 * `landmark` is the big set piece repeated far apart in the far band (a castle on a hill).
 */
export interface ThemedBackdrop {
  skyline: "mountains" | "hills" | "flat";
  landmark?: BackdropMotif;
  far: BackdropMotif[];
  mid: BackdropMotif[];
  near: BackdropMotif[];
}

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: number; size: number;
}

export interface SpawnDef {
  type: string;
  kind?: EntityKind;
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
  value?: number | string;
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

export interface WaveSpawnOptions {
  type?: string;
  flyerType?: string;
  allowFlyers?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  groundY?: number;
  color?: number;
  flyerColor?: number;
  health?: number;
  damage?: number;
  speed?: number;
  w?: number;
  h?: number;
  kind?: EntityKind;
  side?: "left" | "right" | "top";
  data?: Record<string, number | string | boolean>;
}

export interface SwarmSeparationOptions {
  radius?: number;
  strength?: number;
}

/** api.buildLevel input (ADR 0073). Same seed and numbers, same level. */
export interface LevelBuildOptions {
  seed?: number;
  /** 1 (gentle) to 5 (brutal). */
  difficulty?: number;
  /** Playable run in px from the start to the flag (1200..16000). */
  length?: number;
  /** x of the start platform. */
  startX?: number;
  /** Optional colours (numbers) for ground, platform, block, spikes, walker, flyer, flag. */
  palette?: Partial<Record<"ground" | "platform" | "block" | "spikes" | "walker" | "flyer" | "flag", number>>;
}

/** What api.buildLevel returns: where the level ends, what is in it, and a way to take it down. */
export interface LevelBuild {
  readonly startX: number;
  readonly endX: number;
  readonly difficulty: number;
  readonly length: number;
  readonly stats: { sections: number; gaps: number; hazards: number; enemies: number; platforms: number; heights: number; coins: number };
  readonly spec: unknown;
  readonly cleared: boolean;
  readonly falls: number;
  dispose(): void;
}

export interface WaveControllerOptions {
  baseWaveSize?: number;
  killsPerLevel?: number;
  baseSpeed?: number;
  speedScaling?: number;
  waveSizeScaling?: number;
  spawnInterval?: number;
  maxConcurrent?: number;
  groundY?: number;
  screenWidth?: number;
  screenHeight?: number;
  enemyType?: string;
  flyerType?: string;
  allowFlyers?: boolean;
  separationRadius?: number;
  separationStrength?: number;
  autoTick?: boolean;
}

export interface WaveController {
  readonly level: number;
  readonly kills: number;
  readonly totalKills: number;
  readonly killsRequired: number;
  readonly currentSpeed: number;
  readonly currentWaveSize: number;
  getLevel(): number;
  getKills(): number;
  recordKill(): void;
  step(dt?: number): void;
  spawnWave(): void;
  dispose(): void;
}

export interface ProjectileDamageOptions {
  damage?: number;
  burstColor?: number;
  burstCount?: number;
  despawnOnHit?: boolean;
  despawnOnSolid?: boolean;
  filter?: (target: Entity) => boolean;
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
  /** Pickup overlap: true when `item` is within the collector's reach (its box padded, and for the player up to its drawn head). Use this for collecting coins, gems and powerups instead of a raw box test. */
  touches(collector: Entity, item: Entity): boolean;
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
  /** Optional helper: check projectile collision against hostile entities/solids and damage on hit. ADR 0023. */
  damageHit?: (projectile: Entity, options?: ProjectileDamageOptions) => Entity | undefined;
  /** Grappling/tether helpers (ADR 0050). raycast: walk from (x,y) along the direction (dx,dy) up to `maxDist` px and return the first
   *  point inside a solid entity (not the player, not `ignore`), or undefined. */
  raycast?: (x: number, y: number, dx: number, dy: number, maxDist: number, ignore?: Entity) => { x: number; y: number; entity: Entity } | undefined;
  /** winch: steer `e` toward (ax,ay) at `speed` px/s with smooth acceleration, cancelling gravity; returns the distance left. */
  winch?: (e: Entity, ax: number, ay: number, speed: number) => number;
  /** aim: unit direction from `from` toward the pointer, or along its facing (up while jump is held) when there is no pointer. */
  aim?: (from: Entity) => { x: number; y: number };
  /** Optional camera position reader (top-left of viewport in world coordinates). ADR 0052. */
  camera?: () => { x: number; y: number };
  /** Optional wave spawner helper: multi-angle offscreen spawns (40% left, 40% right, 20% top). ADR 0052. */
  spawnWaveUnit?: (options?: WaveSpawnOptions) => Entity;
  /** Optional anti-clumping separation: apply mild boid separation to avoid stacking. ADR 0052. */
  applySeparation?: (entities: Entity[] | readonly Entity[], options?: SwarmSeparationOptions) => void;
  /** Optional wave controller: handles multi-angle waves, paced level-up milestones, and HUD banners. ADR 0052. */
  createWaveController?: (options?: WaveControllerOptions) => WaveController;
  /** React to what happens to your entities (ADR 0059): touch, hit, death, interact, order, signal. Delivered next tick. */
  on?: (event: ModEventName, fn: (ev: ModEvent) => void) => void;
  /** Show a speech bubble over an entity for `seconds` of sim time (default 3). Text is cut to 60 characters. */
  say?: (entity: Entity, text: string, seconds?: number) => void;
  /** Genre change (ADR 0066): reshape the whole scene, not just add to it. Undone automatically, in stack order, when the mod unloads.
   *  hideTerrain / hideScenery take ground, platforms, towers / trees, lamps, sky layers OUT of the world (nothing can hit, see or collect them);
   *  backdrop paints a code-drawn sky ("space"); playerSkin re-skins the player with generated art (e.g. "spaceship") and
   *  the player's gravity is put back on unload. Calling it again from the same mod adds to its claim. */
  setScene?: (options: SceneOptions) => void;
  /** Build a whole playable level (ADR 0073): floor with pits, platform runs at several heights, spikes, walkers and fliers on their ledges, coins, checkpoints and a goal flag, from a seed and a difficulty. Deterministic; the starter terrain is put aside and returns on undo. */
  buildLevel?: (options?: LevelBuildOptions) => LevelBuild;
  /** Tell every other mod something happened ("boss-down", "door-open"); they get a "signal" event next tick. */
  signal?: (name: string, value?: KnobValue) => void;
}

/** Standing orders the player can give any creature by voice, with no rebuild (ADR 0059). The engine steers
 *  the mod's creatures after its own tick code runs: follow (stay near the player), come (walk over, then carry
 *  on), stay (hold position), flee (back off for a few seconds), free (back to the mod's own behaviour). */
export type CreatureOrder = "follow" | "come" | "stay" | "flee" | "free";
export const CREATURE_ORDERS: readonly CreatureOrder[] = ["follow", "come", "stay", "flee", "free"];

/** Things that happen to a mod's entities, delivered to `api.on` listeners at the start of the next tick (ADR 0059).
 *  - "touch": the player started touching one of your entities (entity, other = the player).
 *  - "hit": one of your entities took damage (entity, amount, by = the mod id that dealt it, or "engine").
 *  - "death": one of your entities was destroyed by damage; entity is a copy taken just before, so x/y are still set.
 *  - "interact": the player pressed the action key next to one of your entities that has data.interact.
 *  - "order": the player gave one of your creatures an order (entity, order).
 *  - "signal": another mod called api.signal(name, value) (name, value, from). */
export type ModEventName = "touch" | "hit" | "death" | "interact" | "order" | "signal";
export interface ModEvent {
  type: ModEventName;
  entity?: Entity;
  other?: Entity;
  amount?: number;
  by?: string;
  order?: CreatureOrder;
  name?: string;
  value?: KnobValue;
  from?: string;
}

/** A speech bubble over an entity (ADR 0059). Pure data on the world, like HUD widgets; the client draws it. */
export interface Speech { entityId: number; owner: string; text: string; remaining: number }

export interface SceneOptions { hideTerrain?: boolean; hideScenery?: boolean; backdrop?: string; playerSkin?: string }
/** What the scene looks like right now, derived from the mods' claims (ADR 0066). Pure data: the client paints it. */
export interface SceneState { backdrop?: string; playerSkin?: string }

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

/** Semantic brush of a sketch stroke: what the drawing means, not just its color. */
export type SketchTag = "terrain" | "coin" | "hazard" | "bouncer" | "freehand";

/** One point of a sketch stroke, in screen pixels relative to the game viewport. */
export interface SketchPoint { x: number; y: number }

/** One hand-drawn stroke: its brush, its screen points, and the world-space box it
 *  covers (screen point + camera), so a builder can place things where they were drawn. */
export interface SketchStroke {
  /** CSS hex color of the brush, e.g. "#3fd06a". */
  color: string;
  tag: SketchTag;
  points: SketchPoint[];
  /** World-space bounds of the stroke: x/y grow right/down like the sim. */
  bbox: { x: number; y: number; w: number; h: number };
}

/** Wire protocol: client <-> server over WebSocket (JSON text frames). */
export type ClientMsg =
  | { kind: "command"; text: string }
  /** Anonymous family-test metrics (ADR 0034), sent only when the page has ?tester=N. Never carries what anyone typed or said. */
  | { kind: "tester"; n: number; ev: "open" | "typed" | "voice" | "landed" | "rejected" | "failed" | "mood" | "close"; cid?: number; mood?: string }
  | { kind: "undo"; modId: string }
  /** Stop a build that is still running (ADR 0060). `command` is the chip's own text - the
   *  same key the server stamps on its stage and timing messages - so one lane of a compound
   *  command stops while its siblings keep building. The server aborts that build's model
   *  calls and answers with stage "failed" / detail "cancelled"; nothing it wrote lands. */
  | { kind: "cancel"; command: string }
  | { kind: "knob"; modId: string; knob: string; value: KnobValue }
  | { kind: "photo"; key: string; image: string; prompt: string }
  | { kind: "photoFind"; key: string; image: string; prompt: string }
  | { kind: "photoBring"; key: string }
  | { kind: "photoBringLocal"; key: string; prompt: string; aspect: number }
  /** The mods in the player's world right now, in load order, sent before each command so the playtest runs in a copy of it (ADR 0013). */
  /** Make step `n` the world again, as a new step; nothing is deleted (ADR 0041). */
  | { kind: "timelineRestore"; n: number }
  | { kind: "worldState"; mods: { id: string; values: Record<string, KnobValue> }[]; /** `reset`: this is a brand-new world (ADR 0070), so drop every mod the session still holds. */ reset?: boolean }
  /** "How does this work?" (ADR 0043): explain one loaded mod's source in plain words. The
   *  server answers from its own copy of the source, so no code travels on this message. */
  | { kind: "explain"; modId: string }
  /** "How was this made?" (ADR 0065): the receipt for one loaded mod. Only the id travels. */
  | { kind: "receipt"; modId: string }
  // Voice (ADR 0012). Mic audio itself travels as binary frames: PCM16 mono 16 kHz.
  | { kind: "voiceWarm" }
  | { kind: "voiceStart" }
  | { kind: "voiceEnd"; cancel?: boolean }
  // Share links (ADR 0014). The server only ever saves mods it verified itself; the client just says which are loaded.
  /** `slot` (ADR 0070) turns the save into the browser's own autosave: the same file is rewritten in
   *  place instead of getting a new share id. Absent = the share button (a new id every time). */
  | { kind: "worldSave"; mods: { id: string; values: KnobValues }[]; slot?: string }
  | { kind: "worldLoad"; id: string }
  /** "Give me back the world this browser was last building" (ADR 0070). Answered with a `world`
   *  frame marked `resumed`, or with `worldMissing` so the client can start fresh. */
  | { kind: "worldResume"; id: string }
  /** "This page still has my world on screen, and it is my own autosave slot" (ADR 0077). A dropped
   *  socket, or a server that restarted under an open tab, leaves the client holding a world the new
   *  session has no manifest for, so edits, undo and knobs had nothing to act on. The server adopts
   *  its own stored file back into the session for the ids listed here and answers with nothing:
   *  no `world` frame, so nothing on screen is re-rendered or reset. */
  | { kind: "worldAdopt"; id: string; mods: { id: string; values: KnobValues }[] }
  // Export single-file HTML game (ADR 0042)
  | { kind: "worldExport"; mods: { id: string; values: KnobValues }[] }
  // Mood restyle (ADR 0017): the client lists the sprite sheets it has; the server edits each toward the mood anchor.
  | { kind: "restyle"; mood: string; keys: string[] }
  // Paper-to-level (ADR 0040)
  | { kind: "paperLevel"; image: string; prompt?: string }
  // Self-improving feedback (ADR 0020): thumbs-up/down on entities or mod cards distills persistent rules & skills.
  | { kind: "feedback"; modId: string; entityType?: string; vote: "up" | "down"; note: string; fixNow?: boolean }
  /** Draw-to-build (ADR 0026): a hand-drawn level sketch. `image` is a compact image data URL
   *  of the sketch canvas (JPEG downscaled to ~720 px, ADR 0054); `strokes` carry exact world
   *  boxes; `view` is the world rect the sketch covers; `prompt` is the optional typed hint. */
  | {
      kind: "sketch";
      image: string;
      strokes: SketchStroke[];
      prompt?: string;
      view?: { x: number; y: number; w: number; h: number };
    };

/** A sprite sheet a mod's subject is drawn from: the key the client files its frames under, and where the image is. */
export interface ArtSheet { key: string; url: string; scenery?: boolean }

/**
 * Every sheet a mod carries. A build can add several subjects (ADR 0066 note: no per-build cap), so `arts` holds all of
 * them; `art` is the first and is still read for worlds saved before `arts` existed. Deduped by key, first one wins.
 */
export function sheetsOf(m: { art?: ArtSheet; arts?: readonly ArtSheet[] }): ArtSheet[] {
  const out: ArtSheet[] = [];
  const seen = new Set<string>();
  for (const s of [...(m.arts ?? []), ...(m.art ? [m.art] : [])]) {
    if (!s || typeof s.key !== "string" || typeof s.url !== "string" || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s);
  }
  return out;
}

/** Every art key a mod message says is still being drawn: the list, or the single older `artPending`. */
export function pendingArtKeys(m: { artPending?: string; artPendingList?: string[] }): string[] {
  const list = Array.isArray(m.artPendingList) ? m.artPendingList.filter((k) => typeof k === "string") : [];
  return list.length > 0 ? list : m.artPending ? [m.artPending] : [];
}

/** One mod in a saved world: a built-in the client bundles, or a verified AI mod with its source. */
export type WorldMod =
  | { builtin: true; id: string; values: KnobValues }
  | { builtin?: false; id: string; title: string; source: string; compiled: string; knobs: KnobDefs; values: KnobValues; art?: ArtSheet; arts?: ArtSheet[]; skinArt?: { key: string; url: string }; look?: Look };

/** One step of the session's time-travel strip (ADR 0041): what the world was after a build, mood, undo or restore. */
export interface TimelineStep { n: number; kind: "start" | "build" | "mood" | "undo" | "restore"; label: string; mood?: string; mods: { id: string; title: string }[] }

export interface DemoWorld { id: string; title: string; blurb: string }

/**
 * The browser's own autosaved world (ADR 0070): a normal world file, but written by the client's
 * autosave under a fixed id this browser keeps in its own storage, so a reload gets the same world
 * back. The prefix is the whole safety story: only ids shaped like this can be rewritten in place,
 * and only ids shaped like this are ever pruned.
 */
export const HOME_WORLD_PREFIX = "home-";
/** Local storage key holding this browser's home slot id. Nothing else is stored there. */
export const HOME_WORLD_KEY = "ttb.home";
const HOME_WORLD_RE = new RegExp(`^${HOME_WORLD_PREFIX}[A-Za-z0-9_-]{8,32}$`);
export const isHomeWorldId = (id: unknown): id is string => typeof id === "string" && HOME_WORLD_RE.test(id);

/**
 * The impact numbers the game shows about itself (ADR 0027): the same aggregate
 * `npm run stats` publishes, reduced to an allow-list of NUMBERS so it can be served
 * from `GET /api/stats` and printed by `npm run stats -- --json`. Never carries a
 * prompt, a mod title, a mod id, an error body or a file path: the log stays local.
 */
export interface StatsFeed {
  /** First and last day in the log, and how many days that spans. */
  window: { first: string | null; last: string | null; days: number };
  /** JSONL lines aggregated, and how many of them could not be read. */
  lines: number;
  malformed: number;
  builds: {
    /** Player requests that reached the pipeline (builds + tweaks + say). */
    total: number;
    /** Requests where AI actually wrote code (landed + failed). */
    attempts: number;
    /** Code written, verified and hot-loaded. */
    landed: number;
    /** Still unverified after the single auto-fix round. */
    failed: number;
    /** landed / attempts, 0..1, or null when nothing was attempted yet. */
    landedPct: number | null;
    /** Landed without needing the auto-fix round. */
    firstPass: number;
    /** firstPass / landed, 0..1, or null when nothing landed yet. */
    firstPassPct: number | null;
    /** Auto-fix rounds that turned a failure into a landed build. */
    fixSaves: number;
    /** Auto-fix rounds attempted. */
    fixAttempts: number;
    /** Median end-to-end time for a landed build (route + write + compile + verify). */
    medianMs: number | null;
    p90Ms: number | null;
  };
  mods: { distinct: number; edits: number };
  /** Wonder's autonomy (ADR 0033), from builds that ran the tool loop. */
  agent: {
    builds: number;
    /** Mean tool calls per agent build, or null with no agent builds. */
    callsPerBuild: number | null;
    /** Playtests Wonder ran on its own drafts, and how many said no. */
    playtests: number;
    rejected: number;
    /** Landed builds that needed a correction (a rejected playtest or the fix round). */
    selfCorrected: number;
    /** selfCorrected / agent builds that landed, 0..1, or null when none landed. */
    selfCorrectedPct: number | null;
  };
}

/**
 * "What it has learned" (ADR 0069): how the open-weights reviewer is doing, each fix it made,
 * and the rules and skills the game has learned. Served by `GET /api/brain`. Carries mod ids,
 * issue sentences, rule sentences and the changed lines of mod code; never a player command,
 * a prompt, a key or a file path.
 */
export interface BrainFix {
  ts: string;
  modId: string;
  issues: string[];
  accepted: boolean;
  ms: number;
  diff: { at: number; del: string[]; add: string[] }[];
  /** Rule sentences this fix taught (accepted fixes only). */
  rules: string[];
}
export interface BrainRule { id: string; subsystem: "router" | "wonder" | "art"; source: "feedback" | "autofix" | "seed" | "review"; rule: string; modId?: string; createdAt: string }
export interface BrainSkill { slug: string; title: string; keywords: string[]; summary: string; modId?: string; learnedAt?: string }
export interface BrainFeed {
  openWeights: { on: boolean; model: string | null; note: string };
  scorecard: {
    reviews: number;
    clean: number;
    fixesFound: number;
    accepted: number;
    rejected: number;
    /** Mean open-weights review latency in ms, or null with no reviews. */
    avgMs: number | null;
    /** Median hosted route time in this log, or null. */
    hostedRouteMs: number | null;
    /** ADR 0032 router benchmark: hosted Spark against Muse Spark Open. */
    bench: { hostedP50: number; openP50: number; hostedP95: number; openP95: number; runs: number };
    /** Verifier auto-fix rounds (hosted Wonder repairing its own draft): attempts and saves. */
    autoFixAttempts: number;
    autoFixSaves: number;
  };
  fixes: BrainFix[];
  rules: BrainRule[];
  skills: BrainSkill[];
  counts: { source: Record<string, number>; subsystem: Record<string, number> };
  /** Changes whenever a review, rule or skill lands, so the client animates only what is new. */
  version: string;
}

export type BuildStage = "routing" | "writing" | "compiling" | "verifying" | "rejected" | "fixing" | "done" | "failed";

export type ServerMsg =
  | { kind: "stage"; stage: BuildStage; detail: string; command?: string }
  | { kind: "mod"; mod: { id: string; title: string; source: string; compiled: string; knobs: KnobDefs; art?: { key: string; url: string; scenery?: boolean }; artPending?: string; artPendingList?: string[]; skinArt?: { key: string; url: string }; skinPending?: string; look?: Look } }
  | { kind: "art"; modId: string; art: { key: string; url: string; scenery?: boolean } }
  | { kind: "mood"; mood: MoodSpec | null }
  | { kind: "restyled"; mood: string; key: string; url: string | null }
  | { kind: "tweak"; modId: string; knob: string; value: KnobValue }
  /** A standing order for a mod's creatures, applied at once with no build (ADR 0059). modId "*" means every mod. */
  | { kind: "order"; modId: string; order: CreatureOrder }
  | { kind: "removed"; modId: string }
  | { kind: "say"; text: string }
  | { kind: "segment"; key: string; box: { x: number; y: number; w: number; h: number } | null }
  /** One bot playtest. The client replays `inputs` (RLE of input masks) in a copy of its own world plus `mod`. */
  | { kind: "playtest"; command: string; attempt: number; ok: boolean; plain: string; seed: number; frames: number; inputs: number[]; mod: { id: string; compiled: string }; replaces?: string; ms: number }
  /** A piece of the code Wonder is writing for `command`, as it arrives (ADR 0022). */
  | { kind: "codeStream"; command: string; text: string }
  // Which model answered the router for `command` (ADR 0032): open-weights Spark on Baseten, or hosted Spark.
  // One finished Wonder tool call (ADR 0033): the pipeline lane shows the loop as it happens.
  | { kind: "agentStep"; command: string; phase: "write" | "fix"; n: number; tool: string; args: string; result: string; ok: boolean; ms: number }
  | { kind: "routed"; command: string; model: string; open: boolean; ms: number; fellBack: boolean }
  | { kind: "timing"; command: string; ms: { route: number; write: number; compile: number; verify: number; total: number } }
  | { kind: "voiceState"; state: "ready" | "listening" | "error"; detail?: string }
  | { kind: "transcript"; text: string; final: boolean; ms?: { firstPartial: number; final: number } }
  | { kind: "worldSaved"; id: string; /** true for an autosave (ADR 0070): no share link to announce. */ slot?: true }
  | { kind: "worldExported"; html: string; filename: string }
  /** The session's steps, newest last; `current` is the step the world is at right now (ADR 0041). */
  | { kind: "timeline"; steps: TimelineStep[]; current: number }
  /** `resumed`: the world this browser was last building (ADR 0070), not an opened link: the client
   *  keeps its URL and says nothing about sharing. */
  | { kind: "world"; id: string; mods: WorldMod[]; mood?: MoodSpec | null; restyled?: Record<string, string>; resumed?: true }
  /** Nothing saved under that autosave slot (ADR 0070): start fresh. */
  | { kind: "worldMissing"; id: string }
  /** A plain-words explanation of one mod (ADR 0043): `text` is three short sentences and
   *  `lines` are the key lines of its source, already resolved from the source itself. */
  | { kind: "explainResult"; modId: string; title: string; text: string; lines: { n: number; code: string }[]; cached: boolean; ms: number }
  /** The whole chain behind one creation (ADR 0065), from the server's own records. No model call. */
  | { kind: "receiptResult"; receipt: BuildReceipt }
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

/** How Spark routed a build (ADR 0065). `model` is what actually answered (hosted or open weights). */
export interface ReceiptRoute { action: string; model: string; open: boolean; fellBack: boolean; ms: number; visual?: string; rules: string[] }
/** One tool call in Wonder's loop. */
export interface ReceiptTool { name: string; ms: number; ok?: boolean }
/** The art behind a creation: Muse Image's prompt and sheet, or a code-drawn look with no image. */
export interface ReceiptArt {
  model: string;
  subject: string;
  /** The sprite-sheet prompt as Muse Image receives it (before learned art rules are appended). */
  prompt?: string;
  url?: string;
  state: "drawing" | "drawn" | "cached" | "code-drawn" | "none";
  ms?: number;
}
/** "How was this made?" (ADR 0065): the chain from words to a verified, playable mod. */
export interface ReceiptReview {
  model: string;
  verdict: "ok" | "fix";
  issues: string[];
  accepted: boolean;
  ms: number;
}

export interface BuildReceipt {
  modId: string;
  title: string;
  /** ai = Wonder wrote it this session; builtin = hand-written engine sample; loaded = came with a shared world. */
  origin: "ai" | "builtin" | "loaded";
  command?: string;
  route?: ReceiptRoute;
  agent?: { turns: number; tools: ReceiptTool[] };
  /** Every version, first draft first; the last is live. A turned-away draft carries why. */
  versions: { source: string; rejected?: string[] }[];
  /** The mod's own test(t) and what it claims to check. */
  test: { source: string; checks: string[] } | null;
  /** What the verifier ran before this could load. */
  proof: { healthFrames: number; msBudget: number; msPerFrame: number; playtestSeeds: number; playtests: number; fixed: boolean };
  art?: ReceiptArt;
  /** Every art order of the build, first one included (`art` stays the first for older readers). */
  arts?: ReceiptArt[];
  review?: ReceiptReview;
  timings?: { route: number; write: number; compile: number; verify: number; total: number };
  at?: string;
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
