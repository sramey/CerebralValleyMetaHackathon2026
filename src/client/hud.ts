// Declarative HUD overlay (ADR 0019): renders world.hud — pure data written by
// mods via api.setHud — as DOM widgets over the stage. The sim never touches
// the DOM; everything visual lives here. Reconciled per frame: DOM nodes are
// created once per widget id and only updated when a value actually changes.
import type { HudWidget } from "../contract";
import type { World } from "../sim/world";

const POSITIONS = [
  "top-left", "top-right", "top-center",
  "bottom-left", "bottom-right", "bottom-center",
  "center",
] as const;
type Position = (typeof POSITIONS)[number];

const DEFAULT_POS: Record<HudWidget["kind"], Position> = {
  bar: "top-left",
  hearts: "top-left",
  stat: "top-left",
  banner: "top-center",
};

const DEFAULT_COLOR: Record<HudWidget["kind"], number> = {
  bar: 0x3fd06a,
  hearts: 0xff5a4d,
  stat: 0xffc94d,
  banner: 0xffc94d,
};

function hex(n: number | undefined, fallback: number): string {
  return `#${((n ?? fallback) & 0xffffff).toString(16).padStart(6, "0")}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function posOf(w: HudWidget): Position {
  return POSITIONS.includes(w.position as Position) ? (w.position as Position) : DEFAULT_POS[w.kind];
}

/** Fraction of a bar that is filled, clamped to 0..1. */
function frac(w: HudWidget): number {
  const max = w.max ?? 100;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, (w.value ?? 0) / max));
}

/** Bar color: an explicit color wins; the default shifts green → amber → red. */
function barColor(w: HudWidget): string {
  if (w.color !== undefined) return hex(w.color, DEFAULT_COLOR.bar);
  const f = frac(w);
  return hex(f > 0.5 ? 0x3fd06a : f > 0.25 ? 0xffc94d : 0xff5a4d, DEFAULT_COLOR.bar);
}

interface HudNode {
  el: HTMLElement;
  layer: HTMLElement;
  pos: Position;
  icon: HTMLElement | null;
  label: HTMLElement | null;
  num: HTMLElement | null;
  unit: HTMLElement | null;
  fill: HTMLElement | null;
  pipFills: HTMLElement[];
  text: HTMLElement | null;
  /** Last applied display state; skip DOM writes when nothing changed. */
  sig: string;
  opacity: string;
}

export function createHud(host: HTMLElement) {
  const root = document.createElement("div");
  root.id = "game-hud";
  host.appendChild(root);
  const layers = new Map<Position, HTMLElement>();
  const nodes = new Map<string, HudNode>();

  function layer(pos: Position): HTMLElement {
    let el = layers.get(pos);
    if (!el) {
      el = document.createElement("div");
      el.className = `hud-pos hud-pos-${pos}`;
      root.appendChild(el);
      layers.set(pos, el);
    }
    return el;
  }

  function span(cls: string): HTMLElement {
    const s = document.createElement("span");
    s.className = cls;
    return s;
  }

  function build(w: HudWidget): HudNode {
    const el = document.createElement("div");
    el.className = `hud-widget hud-${w.kind}`;
    el.dataset.hudId = w.id;
    const node: HudNode = {
      el,
      layer: layer(posOf(w)),
      pos: posOf(w),
      icon: null, label: null, num: null, unit: null, fill: null,
      pipFills: [], text: null, sig: "", opacity: "",
    };
    if (w.kind === "bar") {
      node.icon = span("hud-icon");
      const body = document.createElement("div");
      body.className = "hud-body";
      const row = document.createElement("div");
      row.className = "hud-row";
      node.label = span("hud-label");
      node.num = span("hud-num");
      row.append(node.label, node.num);
      const track = document.createElement("div");
      track.className = "hud-bar-track";
      node.fill = span("hud-bar-fill");
      track.appendChild(node.fill);
      body.append(row, track);
      el.append(node.icon, body);
    } else if (w.kind === "hearts") {
      node.icon = span("hud-icon");
      node.label = span("hud-label");
      const pips = document.createElement("div");
      pips.className = "hud-pips";
      el.append(node.icon, node.label, pips);
    } else if (w.kind === "stat") {
      node.icon = span("hud-icon");
      node.label = span("hud-label");
      node.num = span("hud-num");
      node.unit = span("hud-unit");
      el.append(node.icon, node.label, node.num, node.unit);
    } else {
      node.text = span("hud-banner-text");
      el.appendChild(node.text);
    }
    node.layer.appendChild(el);
    return node;
  }

  /** Hearts: rebuild the pip row when the pip count changes. */
  function syncPips(node: HudNode, w: HudWidget): void {
    const pips = node.el.querySelector(".hud-pips") as HTMLElement | null;
    if (!pips) return;
    const count = Math.max(1, Math.min(20, Math.ceil(w.max ?? w.value ?? 3)));
    while (pips.children.length < count) {
      const pip = span("hud-pip");
      const bg = span("hud-pip-bg");
      bg.textContent = "♥";
      const fill = span("hud-pip-fill");
      fill.textContent = "♥";
      pip.append(bg, fill);
      pips.appendChild(pip);
    }
    while (pips.children.length > count) pips.lastChild!.remove();
    node.pipFills = [...pips.querySelectorAll<HTMLElement>(".hud-pip-fill")];
  }

  function update(node: HudNode, w: HudWidget): void {
    const el = node.el;
    // A position change moves the widget to another anchor layer.
    const pos = posOf(w);
    if (pos !== node.pos) {
      node.pos = pos;
      node.layer = layer(pos);
      node.layer.appendChild(el);
    }
    const hidden = w.hidden === true;
    const display = hidden ? "none" : "";
    if (el.style.display !== display) el.style.display = display;

    if (w.kind === "bar") {
      const sig = `${w.label ?? ""}|${w.icon ?? ""}|${w.value ?? ""}|${w.max ?? ""}|${w.color ?? ""}`;
      if (sig !== node.sig) {
        node.sig = sig;
        if (node.icon) node.icon.textContent = w.icon ?? "";
        if (node.label) node.label.textContent = w.label ?? "";
        if (node.num) node.num.textContent = `${fmt(w.value ?? 0)}/${fmt(w.max ?? 100)}`;
        if (node.fill) {
          node.fill.style.width = `${Math.round(frac(w) * 100)}%`;
          node.fill.style.background = barColor(w);
        }
      }
    } else if (w.kind === "hearts") {
      const count = Math.max(1, Math.min(20, Math.ceil(w.max ?? w.value ?? 3)));
      const sig = `${w.label ?? ""}|${w.icon ?? ""}|${w.value ?? ""}|${count}|${w.color ?? ""}`;
      if (sig !== node.sig) {
        node.sig = sig;
        syncPips(node, w);
        if (node.icon) node.icon.textContent = w.icon ?? "";
        if (node.label) node.label.textContent = w.label ?? "";
        const color = hex(w.color, DEFAULT_COLOR.hearts);
        for (let i = 0; i < node.pipFills.length; i++) {
          const f = Math.min(1, Math.max(0, (w.value ?? 0) - i));
          node.pipFills[i].style.width = `${Math.round(f * 100)}%`;
          node.pipFills[i].style.color = color;
        }
      }
    } else if (w.kind === "stat") {
      const sig = `${w.label ?? ""}|${w.icon ?? ""}|${w.value ?? ""}|${w.max ?? ""}|${w.unit ?? ""}|${w.color ?? ""}`;
      if (sig !== node.sig) {
        node.sig = sig;
        if (node.icon) node.icon.textContent = w.icon ?? "";
        if (node.label) node.label.textContent = w.label ?? "";
        if (node.num) {
          node.num.textContent = w.max !== undefined ? `${fmt(w.value ?? 0)}/${fmt(w.max)}` : fmt(w.value ?? 0);
          node.num.style.color = hex(w.color, DEFAULT_COLOR.stat);
        }
        if (node.unit) node.unit.textContent = w.unit ?? "";
      }
    } else {
      // banner: re-trigger the pop-in when the message changes.
      const sig = `${w.text ?? ""}|${w.color ?? ""}`;
      if (sig !== node.sig) {
        node.sig = sig;
        if (node.text) {
          node.text.textContent = w.text ?? "";
          node.text.style.color = hex(w.color, DEFAULT_COLOR.banner);
        }
        el.style.borderColor = hex(w.color, DEFAULT_COLOR.banner);
        el.style.animation = "none";
        void el.offsetWidth; // restart the CSS animation
        el.style.animation = "";
      }
      // Fade out over the last 0.35 s of a timed banner.
      const remaining = w.remaining;
      let opacity = "1";
      if (remaining !== undefined && w.duration !== undefined && w.duration > 0) {
        opacity = Math.min(1, Math.max(0, remaining / Math.min(w.duration, 0.35))).toFixed(2);
      }
      if (opacity !== node.opacity) {
        node.opacity = opacity;
        el.style.opacity = opacity;
      }
    }
  }

  function render(world: World): void {
    const live = new Set<string>();
    for (const w of world.hud.values()) {
      live.add(w.id);
      let node = nodes.get(w.id);
      // A widget id whose kind changed gets a fresh element (cheap, rare).
      if (!node || node.el.className !== `hud-widget hud-${w.kind}`) {
        if (node) node.el.remove();
        node = build(w);
        nodes.set(w.id, node);
      }
      update(node, w);
    }
    for (const [id, node] of nodes) {
      if (!live.has(id)) {
        node.el.remove();
        nodes.delete(id);
      }
    }
    // Empty layers keep a zero-footprint overlay.
    root.hidden = world.hud.size === 0;
  }

  return { render, root };
}
