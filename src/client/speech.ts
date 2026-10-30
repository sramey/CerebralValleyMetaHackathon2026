// Speech bubbles and the action-key prompt (ADR 0059): renders world.speech and
// world.interactable, pure data the sim keeps, as DOM over the stage. Like the HUD,
// nodes are made once per entity and only touched when the text or spot changes.
import "./speech.css";
import type { Entity } from "../contract";
import type { World } from "../sim/world";

/** Screen spot above an entity's drawn head, from its top-left and drawn height. */
export function bubbleSpot(e: Entity, camX: number, camY: number, drawnH: number): { x: number; y: number } {
  return { x: Math.round(e.x - camX + e.w / 2), y: Math.round(e.y - camY + e.h - drawnH - 6) };
}

export function createSpeech(parent: HTMLElement) {
  const root = document.createElement("div");
  root.id = "speech-layer";
  parent.appendChild(root);
  const nodes = new Map<number, { el: HTMLDivElement; text: string; pos: string }>();
  const prompt = document.createElement("div");
  prompt.className = "speech-prompt";
  prompt.hidden = true;
  root.appendChild(prompt);
  let promptSig = "";

  const place = (el: HTMLElement, x: number, y: number, prev: string): string => {
    const pos = `${x},${y}`;
    if (pos !== prev) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
    return pos;
  };

  function render(world: World, camX: number, camY: number, drawnHeight: (e: Entity) => number): void {
    const byId = new Map<number, Entity>();
    if (world.speech.size > 0 || world.interactable) for (const e of world.entities) byId.set(e.id, e);
    const live = new Set<number>();
    for (const b of world.speech.values()) {
      const e = byId.get(b.entityId);
      if (!e) continue;
      live.add(b.entityId);
      let node = nodes.get(b.entityId);
      if (!node) {
        const el = document.createElement("div");
        el.className = "speech-bubble";
        root.appendChild(el);
        node = { el, text: "", pos: "" };
        nodes.set(b.entityId, node);
      }
      if (node.text !== b.text) { node.text = b.text; node.el.textContent = b.text; }
      const s = bubbleSpot(e, camX, camY, drawnHeight(e));
      node.pos = place(node.el, s.x, s.y, node.pos);
    }
    for (const [id, node] of nodes) if (!live.has(id)) { node.el.remove(); nodes.delete(id); }

    // The prompt hides while that entity is talking, so the two never stack.
    const it = world.interactable;
    const target = it && !live.has(it.id) ? byId.get(it.id) : undefined;
    prompt.hidden = !target;
    if (target && it) {
      if (promptSig !== it.label) { promptSig = it.label; prompt.innerHTML = ""; const k = document.createElement("kbd"); k.textContent = "B"; prompt.append(k, it.label); }
      const s = bubbleSpot(target, camX, camY, drawnHeight(target));
      place(prompt, s.x, s.y, "");
    }
  }

  return { render, root };
}
