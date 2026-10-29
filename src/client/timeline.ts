/**
 * Time-travel strip (ADR 0041): one dot per world the session has been in, labelled with the
 * command that made it. Hover or click shows what that world held (against the current one);
 * Restore asks the server to make it current as a NEW step. Never destructive.
 */
import type { TimelineStep } from "../contract";

export interface TimelineView { update(steps: TimelineStep[], current: number): void }

const KIND_LABEL: Record<TimelineStep["kind"], string> = { start: "start", build: "build", mood: "mood", undo: "undo", restore: "restore" };

export function mountTimeline(root: HTMLElement, onRestore: (n: number) => void): TimelineView {
  root.hidden = true;
  const track = document.createElement("div");
  track.className = "tl-track";
  const card = document.createElement("div");
  card.className = "tl-card";
  card.hidden = true;
  root.append(card, track);

  let steps: TimelineStep[] = [];
  let current = 0;
  let pinned: number | null = null;
  let hovered: number | null = null;

  const shown = (): TimelineStep | undefined => steps.find((s) => s.n === (hovered ?? pinned));

  function renderCard(): void {
    const step = shown();
    if (!step) { card.hidden = true; return; }
    const now = steps.find((s) => s.n === current);
    const have = new Set(now?.mods.map((m) => m.id) ?? []);
    const had = new Set(step.mods.map((m) => m.id));
    card.replaceChildren();
    const head = document.createElement("div");
    head.className = "tl-head";
    const title = document.createElement("b");
    title.textContent = `#${step.n} ${step.label}`;
    const kind = document.createElement("span");
    kind.className = `tl-kind ${step.kind}`;
    kind.textContent = KIND_LABEL[step.kind];
    head.append(title, kind);
    card.append(head);
    const list = document.createElement("div");
    list.className = "tl-mods";
    const bits: string[] = [];
    for (const m of step.mods) bits.push(have.has(m.id) || step.n === current ? m.title : `+ ${m.title}`);
    for (const m of now?.mods ?? []) if (!had.has(m.id) && step.n !== current) bits.push(`− ${m.title}`);
    if (step.mood) bits.unshift(`mood: ${step.mood}`);
    list.textContent = bits.length > 0 ? bits.join(" · ") : "an empty world";
    card.append(list);
    if (step.n === current) {
      const here = document.createElement("div");
      here.className = "tl-here";
      here.textContent = "This is the world now.";
      card.append(here);
    } else {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tl-restore";
      b.textContent = "Restore this world";
      b.addEventListener("click", () => { onRestore(step.n); pinned = null; hovered = null; renderCard(); });
      card.append(b);
    }
    card.hidden = false;
  }

  function renderTrack(): void {
    track.replaceChildren();
    for (const s of steps) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `tl-dot ${s.kind}${s.n === current ? " now" : ""}${s.n === pinned ? " pin" : ""}`;
      b.setAttribute("aria-label", `Step ${s.n}: ${s.label}`);
      b.addEventListener("mouseenter", () => { hovered = s.n; renderCard(); });
      b.addEventListener("focus", () => { hovered = s.n; renderCard(); });
      b.addEventListener("click", () => { pinned = pinned === s.n ? null : s.n; renderTrack(); renderCard(); });
      track.append(b);
    }
    const last = steps[steps.length - 1];
    const cap = document.createElement("span");
    cap.className = "tl-cap";
    cap.textContent = steps.find((s) => s.n === current)?.label ?? last?.label ?? "";
    track.append(cap);
    track.scrollLeft = track.scrollWidth;
  }

  root.addEventListener("mouseleave", () => { hovered = null; renderCard(); });

  return {
    update(next, cur) {
      steps = next;
      current = cur;
      if (pinned !== null && !steps.some((s) => s.n === pinned)) pinned = null;
      root.hidden = steps.length < 2;
      renderTrack();
      renderCard();
    },
  };
}
