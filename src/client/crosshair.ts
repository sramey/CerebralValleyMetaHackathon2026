/**
 * The game cursor (bead r8n). The stage canvas used to keep the OS pointer over it, and the
 * canvas is painted every frame, so the pointer was invisible exactly where aiming matters:
 * `api.aim` reads InputState.pointerX/Y (ADR 0050), and a first-time player aiming a grappling
 * hook was guessing. This module draws a crosshair at the pointer instead, and hides the OS
 * cursor while it does.
 *
 * Keyboard and gamepad play stay clean: the crosshair only shows while the pointer has been
 * seen on the stage in the last couple of seconds and the last input came from the mouse. Move
 * away, play with keys, pick up a pad, or cover the stage with the sketch overlay and it is gone.
 *
 * The decision (`shouldShowCrosshair`) and the blink-free drawing are plain data, so the tests
 * run it without a browser.
 */
import type { InputMode } from "./gamepad";

/** How long the pointer can sit still before the crosshair gets out of the way (ms). */
export const CURSOR_IDLE_MS = 2600;
/** Drawn size of the crosshair on screen (CSS px). */
export const CROSSHAIR_SIZE = 26;

export interface CursorState {
  /** The pointer is over the stage. */
  seen: boolean;
  /** Milliseconds since it last moved (or clicked). */
  idleMs: number;
  /** Which device the player used last. */
  mode: InputMode;
  /** Something else owns the pointer: the sketch overlay, a dialog, the radial menu. */
  blocked: boolean;
}

/** Show the crosshair only for a live mouse over the stage. Pure: no DOM, no clock. */
export function shouldShowCrosshair(s: CursorState): boolean {
  if (!s.seen || s.blocked) return false;
  if (s.mode === "pad") return false; // a controller player has no pointer
  return s.idleMs < CURSOR_IDLE_MS;
}

export interface Crosshair {
  /** True while the drawn crosshair is on screen. */
  readonly shown: boolean;
  /** The pointer moved to this position, in stage-wrap pixels; `now` is performance.now(). */
  move(x: number, y: number, now: number): void;
  /** The pointer left the stage. */
  setSeen(seen: boolean): void;
  /** The last device in use changed. */
  setMode(mode: InputMode): void;
  /** Something else owns the pointer (sketch overlay open, radial menu, a dialog). */
  setBlocked(blocked: boolean): void;
  /** Re-evaluate once a frame: fades the crosshair out after the pointer goes still. */
  update(now: number): void;
}

/** Paint the crosshair itself: a light ring with four ticks and a centre dot, dark-outlined so it reads on any scene. */
export function paintCrosshair(ctx: CanvasRenderingContext2D, size = CROSSHAIR_SIZE): void {
  const c = size / 2;
  const r = size * 0.34;
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  // Dark outline first, then the light line over it: a thin white ring alone disappears on snow.
  for (const [color, width] of [["#0b0e13", 3.4], ["#ffffff", 1.6]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(c + dx * (r - 1.5), c + dy * (r - 1.5));
      ctx.lineTo(c + dx * (r + size * 0.17), c + dy * (r + size * 0.17));
    }
    ctx.stroke();
  }
  // Centre dot: two squares so it stays crisp, dark behind light.
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(c - 2.4, c - 2.4, 4.8, 4.8);
  ctx.fillStyle = "#ffc94d";
  ctx.fillRect(c - 1.2, c - 1.2, 2.4, 2.4);
}

/** Build the crosshair element inside the stage wrap and return the handle main.ts drives. */
export function createCrosshair(wrap: HTMLElement, doc: Document = document): Crosshair {
  const el = doc.createElement("canvas");
  el.id = "crosshair";
  el.className = "crosshair off";
  const dpr = Math.max(1, Math.min(2, (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1));
  el.width = Math.round(CROSSHAIR_SIZE * dpr);
  el.height = Math.round(CROSSHAIR_SIZE * dpr);
  el.style.width = `${CROSSHAIR_SIZE}px`;
  el.style.height = `${CROSSHAIR_SIZE}px`;
  const ctx = el.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
    paintCrosshair(ctx, CROSSHAIR_SIZE);
  }
  wrap.appendChild(el);

  let seen = false;
  let blocked = false;
  let mode: InputMode = "key";
  /** When the pointer last moved (or entered): the idle fade is measured from here. */
  let activeAt = -Infinity;
  let shown = false;

  const apply = (next: boolean): void => {
    if (next === shown) return;
    shown = next;
    el.className = next ? "crosshair" : "crosshair off";
    // Hide the OS pointer exactly while the drawn one is there, so there is never two cursors.
    if (next) wrap.dataset.crosshair = "on";
    else delete wrap.dataset.crosshair;
  };

  const evaluate = (now: number): void => {
    apply(shouldShowCrosshair({ seen, idleMs: now - activeAt, mode, blocked }));
  };

  return {
    get shown() { return shown; },
    move(px, py, now) {
      activeAt = now;
      seen = true;
      el.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`;
      evaluate(now);
    },
    setSeen(next) {
      seen = next;
      const now = performanceNow();
      if (next) activeAt = now; // coming back onto the stage counts as movement
      evaluate(now);
    },
    setMode(next) {
      mode = next;
      evaluate(performanceNow());
    },
    setBlocked(next) {
      blocked = next;
      evaluate(performanceNow());
    },
    update(now) {
      evaluate(now);
    },
  };
}

/** One place for the clock, so the tests can drive `setSeen` without a fake performance. */
const performanceNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
