// Ghost playtest window (ADR 0013): a small picture-in-picture that replays the
// REAL bot run the server just judged. The sim is deterministic, so we rebuild
// a copy of the player's world (+ the candidate mod) and feed it the recorded
// inputs; nothing here is a canned animation.
import type { KnobValues, ModDefinition } from "../contract";
import { World } from "../sim/world";
import { ModLoader } from "../sim/loader";
import { rleDecode, unpackInput } from "../sim/playtest";

export interface GhostPlay {
  /** The player's current mods, in load order. */
  base: { def: ModDefinition; values: KnobValues }[];
  candidate: { id: string; compiled: string };
  /** Id of the mod the candidate replaces (an edit that renamed it), else its own id. */
  replaces?: string;
  seed: number;
  inputs: number[];
  ok: boolean;
  plain: string;
}

const W = 320;
const H = 180;
const SCALE = 0.34;
const STEPS_PER_FRAME = 6;
const HOLD_MS = 1400;

async function importDef(compiled: string): Promise<ModDefinition> {
  const url = URL.createObjectURL(new Blob([compiled], { type: "text/javascript" }));
  try {
    return ((await import(/* @vite-ignore */ url)) as { default: ModDefinition }).default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function createGhost(host: HTMLElement) {
  const box = document.createElement("div");
  box.id = "ghost";
  box.hidden = true;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const caption = document.createElement("div");
  caption.className = "ghost-caption";
  box.append(canvas, caption);
  host.appendChild(box);
  const ctx = canvas.getContext("2d")!;

  let running: Promise<void> = Promise.resolve();
  let token = 0;
  let hideTimer = 0;

  function draw(world: World): void {
    const p = world.entities.find((e) => e.type === "player");
    const viewW = W / SCALE;
    const camX = p ? p.x + p.w / 2 - viewW * 0.38 : world.camera.x;
    const camY = 470 - H / SCALE;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(8,12,18,.78)";
    ctx.fillRect(0, 0, W, H);
    for (const e of world.entities) {
      const isP = e === p;
      ctx.globalAlpha = isP ? 0.9 : e.solid ? 0.75 : 0.55;
      ctx.fillStyle = isP ? "#cfe8ff" : hex(e.color);
      ctx.fillRect((e.x - camX) * SCALE, (e.y - camY) * SCALE, Math.max(1, e.w * SCALE), Math.max(1, e.h * SCALE));
      if (isP) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#7fd0ff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect((e.x - camX) * SCALE, (e.y - camY) * SCALE, e.w * SCALE, e.h * SCALE);
      }
    }
    ctx.globalAlpha = 1;
  }

  async function run(play: GhostPlay, my: number): Promise<void> {
    window.clearTimeout(hideTimer);
    box.hidden = false;
    box.dataset.state = "running";
    caption.textContent = "PLAYTEST · can you still play?";
    const world = new World(play.seed);
    const loader = new ModLoader(world);
    try {
      const candidate = await importDef(play.candidate.compiled);
      const defs = play.base.map((m) => ({ def: m.def, values: m.values }));
      const idx = defs.findIndex((m) => m.def.id === (play.replaces ?? candidate.id));
      if (idx >= 0) defs[idx] = { def: candidate, values: defs[idx].values }; else defs.push({ def: candidate, values: {} });
      for (const m of defs) loader.load(m.def, m.values);
    } catch {
      box.hidden = true;
      return;
    }
    const masks = rleDecode(play.inputs);
    let i = 0;
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (my !== token) return resolve();
        for (let k = 0; k < STEPS_PER_FRAME && i < masks.length; k++, i++) {
          world.input = unpackInput(masks[i]);
          try { world.step(); } catch { i = masks.length; }
        }
        draw(world);
        if (i < masks.length) requestAnimationFrame(tick); else resolve();
      };
      tick();
    });
    if (my !== token) return;
    box.dataset.state = play.ok ? "pass" : "fail";
    caption.textContent = play.ok ? "✓ You can still play" : `✗ ${play.plain}`;
    if (play.ok) hideTimer = window.setTimeout(() => { if (my === token) box.hidden = true; }, HOLD_MS);
  }

  return {
    /** Replay one playtest. Replaces any replay in progress. */
    play(play: GhostPlay): Promise<void> {
      const my = ++token;
      running = run(play, my).catch(() => { box.hidden = true; });
      return running;
    },
    /** Resolves when the current replay has finished (immediately if none). */
    idle(): Promise<void> { return running; },
    /** Hide a lingering rejected replay after the fix has landed. */
    hideSoon(ms = HOLD_MS): void {
      window.clearTimeout(hideTimer);
      const my = token;
      hideTimer = window.setTimeout(() => { if (my === token) box.hidden = true; }, ms);
    },
  };
}
