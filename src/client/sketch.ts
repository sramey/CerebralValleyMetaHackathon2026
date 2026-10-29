// Draw-to-build (ADR 0023): the in-game Sketch Level overlay.
//
// The player presses ✏️, draws platforms / coins / enemies straight onto the game screen,
// presses Done, and the exact world-space boxes of every stroke travel with the sketch
// image to the server, which turns them into verified level geometry. This module is the
// UI half: brushes, strokes, undo/clear/cancel, and the PNG + stroke payload. It never
// touches the sim beyond reading the camera.
import type { ClientMsg, SketchPoint, SketchStroke, SketchTag } from "../contract";

export interface SketchCamera { x: number; y: number }

/** The four semantic brushes. The tag, not the pixel color, tells the builder what a stroke means. */
export const SKETCH_BRUSHES: { tag: SketchTag; color: string; label: string; glyph: string }[] = [
  { tag: "terrain", color: "#3fd06a", label: "Platform", glyph: "▬" },
  { tag: "coin", color: "#ffd34d", label: "Coin", glyph: "●" },
  { tag: "hazard", color: "#ff5a4d", label: "Enemy", glyph: "▲" },
  { tag: "bouncer", color: "#54e0ff", label: "Bouncer", glyph: "⌒" },
];

export const MAX_STROKES = 80;
export const MAX_POINTS = 300;
/** Screen -> world is a translation (the sim has no zoom); x/y grow right/down in both. */
const MIN_EXTENT = 4;

export interface RawStroke { tag: SketchTag; color: string; points: SketchPoint[] }

/** World-space box of a screen-space polyline, offset by the camera. */
export function strokeBbox(points: readonly SketchPoint[], camera: SketchCamera): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: camera.x, y: camera.y, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX + camera.x, y: minY + camera.y, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

/** Subsample a long polyline down to `max` evenly spaced points (keeps both ends). */
export function thinPoints(points: readonly SketchPoint[], max = MAX_POINTS): SketchPoint[] {
  if (points.length <= max) return points.map((p) => ({ x: p.x, y: p.y }));
  const out: SketchPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const p = points[Math.round(i * step)];
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** One drawn stroke as the wire contract wants it: screen points plus the exact world box. */
export function toWorldStroke(stroke: RawStroke, camera: SketchCamera): SketchStroke {
  const points = thinPoints(stroke.points);
  const bbox = strokeBbox(points, camera);
  return {
    color: stroke.color,
    tag: stroke.tag,
    points,
    // A dot-like stroke still gets a buildable box; the builder sizes entities from it.
    bbox: { ...bbox, w: Math.max(MIN_EXTENT, bbox.w), h: Math.max(MIN_EXTENT, bbox.h) },
  };
}

/** World rect the sketch covers, from the canvas size and the camera (for the prompt). */
export function sketchViewOf(width: number, height: number, camera: SketchCamera): { x: number; y: number; w: number; h: number } {
  return { x: camera.x, y: camera.y, w: Math.max(1, width), h: Math.max(1, height) };
}

export interface SketchPayload { image: string; strokes: SketchStroke[]; prompt: string; view: { x: number; y: number; w: number; h: number } }

/** The full message the server needs: image + world boxes + hint + the world rect covered. */
export function buildSketchPayload(strokes: readonly RawStroke[], camera: SketchCamera, image: string, prompt: string, width: number, height: number): SketchPayload {
  return {
    image,
    strokes: strokes.slice(-MAX_STROKES).map((s) => toWorldStroke(s, camera)),
    prompt: prompt.trim().slice(0, 200),
    view: sketchViewOf(width, height, camera),
  };
}

export interface SketchDeps {
  /** Send the finished sketch to the server. */
  send: (msg: ClientMsg) => void;
  /** Orb line ("reading your sketch..."). */
  say: (text: string, state?: string) => void;
  /** Live camera offset used to turn screen points into world points. */
  camera: () => SketchCamera;
  log?: (text: string) => void;
}

export interface SketchHandle {
  open(): void;
  close(): void;
  active(): boolean;
  /** Feed server messages: a landed mod dissolves the sketch, a failure lets the player retry. */
  onServerMsg(msg: { kind: string; stage?: string; detail?: string }): void;
}

const STATUS: Record<string, string> = {
  drawing: "Draw platforms, coins and enemies. Press Done and it builds itself.",
  building: "Reading your sketch...",
};

/** Mount the overlay inside the stage container and wire its palette. */
export function createSketch(parent: HTMLElement, deps: SketchDeps): SketchHandle {
  const root = document.createElement("div");
  root.id = "sketch-overlay";
  root.hidden = true;

  const canvas = document.createElement("canvas");
  canvas.id = "sketch-canvas";
  root.appendChild(canvas);

  const palette = document.createElement("div");
  palette.id = "sketch-palette";

  const brushes = document.createElement("div");
  brushes.className = "sketch-brushes";
  let brush = SKETCH_BRUSHES[0];
  const brushButtons = SKETCH_BRUSHES.map((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sketch-brush";
    btn.dataset.tag = b.tag;
    btn.style.setProperty("--brush", b.color);
    btn.innerHTML = `<span class="glyph"></span><span class="name"></span>`;
    (btn.querySelector(".glyph") as HTMLElement).textContent = b.glyph;
    (btn.querySelector(".name") as HTMLElement).textContent = b.label;
    btn.title = `${b.label} (${b.tag})`;
    btn.addEventListener("click", () => selectBrush(b.tag));
    return btn;
  });
  brushes.append(...brushButtons);
  palette.appendChild(brushes);

  const hint = document.createElement("input");
  hint.id = "sketch-hint";
  hint.type = "text";
  hint.placeholder = "optional: “a stairway up to a tower”";
  hint.autocomplete = "off";
  hint.maxLength = 200;
  palette.appendChild(hint);

  const actions = document.createElement("div");
  actions.className = "sketch-actions";
  const mkButton = (act: string, label: string, cls = ""): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.act = act;
    b.textContent = label;
    if (cls) b.className = cls;
    actions.appendChild(b);
    return b;
  };
  const undoBtn = mkButton("undo", "Undo stroke");
  const clearBtn = mkButton("clear", "Clear");
  const cancelBtn = mkButton("cancel", "Cancel");
  const doneBtn = mkButton("done", "✓ Done — build map", "primary");
  palette.appendChild(actions);
  root.appendChild(palette);

  const status = document.createElement("div");
  status.id = "sketch-status";
  root.appendChild(status);
  parent.appendChild(root);

  type State = "closed" | "drawing" | "building";
  let state: State = "closed";
  const strokes: RawStroke[] = [];
  let live: RawStroke | null = null;
  let cameraAtOpen: SketchCamera = { x: 0, y: 0 };
  let ctx: CanvasRenderingContext2D | null = null;
  let settleTimer = 0;

  function selectBrush(tag: SketchTag): void {
    const b = SKETCH_BRUSHES.find((x) => x.tag === tag);
    if (!b) return;
    brush = b;
    for (const btn of brushButtons) btn.classList.toggle("on", btn.dataset.tag === tag);
  }
  selectBrush(SKETCH_BRUSHES[0].tag);

  function setStatus(text: string, kind: "drawing" | "building" | "error" = "drawing"): void {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function resize(): void {
    const rect = parent.getBoundingClientRect();
    const w = Math.max(64, Math.round(rect.width));
    const h = Math.max(64, Math.round(rect.height));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx = canvas.getContext("2d");
    redraw();
  }

  /** Blueprint backdrop: sky, a faint world grid, and the ground line, so the sketch reads in world space. */
  function drawBackdrop(c: CanvasRenderingContext2D): void {
    const w = canvas.width;
    const h = canvas.height;
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0b1220");
    sky.addColorStop(1, "#131c2b");
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    // World-space grid every 120 px, anchored to the world origin (not to the screen).
    c.strokeStyle = "rgba(140,180,220,0.10)";
    c.lineWidth = 1;
    for (let gx = -(((cameraAtOpen.x % 120) + 120) % 120); gx < w; gx += 120) {
      c.beginPath();
      c.moveTo(Math.round(gx) + 0.5, 0);
      c.lineTo(Math.round(gx) + 0.5, h);
      c.stroke();
    }
    for (let gy = -(((cameraAtOpen.y % 120) + 120) % 120); gy < h; gy += 120) {
      c.beginPath();
      c.moveTo(0, Math.round(gy) + 0.5);
      c.lineTo(w, Math.round(gy) + 0.5);
      c.stroke();
    }
    // The ground surface is y = 400 in world space.
    const groundY = 400 - cameraAtOpen.y;
    if (groundY > -4 && groundY < h + 4) {
      c.strokeStyle = "rgba(63,208,106,0.55)";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, Math.round(groundY) + 0.5);
      c.lineTo(w, Math.round(groundY) + 0.5);
      c.stroke();
      c.fillStyle = "rgba(63,208,106,0.55)";
      c.font = "11px Consolas, monospace";
      c.fillText("ground", 8, Math.round(groundY) - 6);
    }
  }

  function pigmentStroke(c: CanvasRenderingContext2D, s: RawStroke): void {
    if (s.points.length === 0) return;
    c.save();
    c.strokeStyle = s.color;
    c.lineWidth = 9;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.shadowColor = s.color;
    c.shadowBlur = 14;
    c.beginPath();
    c.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y);
    if (s.points.length === 1) c.lineTo(s.points[0].x + 0.5, s.points[0].y + 0.5);
    c.stroke();
    c.restore();
  }

  function redraw(): void {
    if (!ctx) ctx = canvas.getContext("2d");
    const c = ctx;
    if (!c) return;
    drawBackdrop(c);
    for (const s of strokes) pigmentStroke(c, s);
    if (live) pigmentStroke(c, live);
  }

  function canvasPoint(ev: PointerEvent): SketchPoint {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.round(ev.clientX - rect.left), y: Math.round(ev.clientY - rect.top) };
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (state !== "drawing") return;
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* synthetic pointers have no capture */ }
    live = { tag: brush.tag, color: brush.color, points: [canvasPoint(ev)] };
    ev.preventDefault();
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!live || state !== "drawing") return;
    const p = canvasPoint(ev);
    const last = live.points[live.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return; // keep the payload small
    live.points.push(p);
    pigmentStroke(ctx ?? canvas.getContext("2d")!, { ...live, points: [last, p] });
    ev.preventDefault();
  });
  const endStroke = (ev: PointerEvent): void => {
    if (!live) return;
    live.points.push(canvasPoint(ev));
    if (strokes.length >= MAX_STROKES) strokes.shift();
    strokes.push(live);
    live = null;
    redraw();
  };
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", () => { live = null; redraw(); });

  undoBtn.addEventListener("click", () => { strokes.pop(); redraw(); });
  clearBtn.addEventListener("click", () => { strokes.length = 0; live = null; redraw(); });
  cancelBtn.addEventListener("click", () => close());

  doneBtn.addEventListener("click", () => {
    if (state !== "drawing") return;
    if (strokes.length === 0) {
      setStatus("Draw at least one platform first.", "error");
      return;
    }
    const payload = buildSketchPayload(strokes, cameraAtOpen, canvas.toDataURL("image/png"), hint.value, canvas.width, canvas.height);
    state = "building";
    root.dataset.state = "building";
    setStatus(STATUS.building, "building");
    palette.classList.add("busy");
    deps.send({ kind: "sketch", ...payload });
    deps.say("Reading your sketch...", "building");
    deps.log?.(`sketch sent: ${payload.strokes.length} strokes, image ${Math.round(payload.image.length / 1024)} KB`);
  });

  function open(): void {
    if (state !== "closed") return;
    window.clearTimeout(settleTimer);
    root.classList.remove("settle");
    root.hidden = false;
    root.dataset.state = "drawing";
    state = "drawing";
    cameraAtOpen = deps.camera();
    strokes.length = 0;
    live = null;
    hint.value = "";
    palette.classList.remove("busy");
    selectBrush(SKETCH_BRUSHES[0].tag);
    resize();
    redraw();
    setStatus(STATUS.drawing);
    deps.say("Sketch mode: draw the level, then press Done.", "building");
  }

  /** Fade the sketch out once its mod is live (the real level pops in underneath). */
  function finish(state_: "done" | "failed"): void {
    root.dataset.state = state_;
    root.classList.add("settle");
    settleTimer = window.setTimeout(() => { close(); }, 700);
  }

  function close(): void {
    window.clearTimeout(settleTimer);
    root.hidden = true;
    root.classList.remove("settle", "building");
    delete root.dataset.state;
    state = "closed";
    strokes.length = 0;
    live = null;
  }

  addEventListener("resize", () => { if (state !== "closed") resize(); });

  return {
    open,
    close,
    active: () => state !== "closed",
    onServerMsg(msg) {
      if (state !== "building") return;
      if (msg.kind === "mod") {
        finish("done");
        return;
      }
      if (msg.kind === "stage" && (msg.stage === "failed" || msg.stage === "rejected")) {
        // Let the player draw again instead of losing the sketch.
        state = "drawing";
        root.dataset.state = "drawing";
        palette.classList.remove("busy");
        setStatus(msg.detail ? `Didn't build: ${msg.detail}` : "That didn't build — try again.", "error");
      }
    },
  };
}
