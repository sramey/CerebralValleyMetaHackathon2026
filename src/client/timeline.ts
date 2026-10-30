/**
 * Time-travel strip (ADR 0041): one dot per world the session has been in, labelled with the
 * command that made it. Hover or click shows what that world held (against the current one);
 * Restore asks the server to make it current as a NEW step. Never destructive.
 *
 * The strip is server-owned, with one client-side exception (bug bv4): a change the client makes
 * itself — undoing a mood — is not echoed by the server (it sends no mood/removed frame, so no
 * timeline frame follows), and the current chip kept reading the old world until the next action
 * recorded one. `localStep` fills that gap optimistically; the server's next frame replaces it.
 */
import type { TimelineStep } from "../contract";

/** A world the client changed itself, waiting for the server to record it. */
export interface LocalStep {
  kind: "mood" | "undo";
  label: string;
  mood?: string;
  mods: { id: string; title: string }[];
}

export interface TimelineView {
  update(steps: TimelineStep[], current: number): void;
  /** Show `step` as the world now (the client just changed it); the server's next frame wins. */
  localStep(step: LocalStep): void;
  /** Forget a pending local step (e.g. the server's own frame is about to replace it). */
  clearLocal(): void;
}

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
  /** The client's own, not-yet-served change (bug bv4); at most one at a time. */
  let local: TimelineStep | null = null;
  let pinned: number | null = null;
  let hovered: number | null = null;

  /** The strip as the player sees it: the server's steps plus any pending local one. */
  const shownSteps = (): TimelineStep[] => (local ? [...steps, local] : steps);
  /** Which step is "now": the local one while it is pending, else the server's current step. */
  const nowN = (): number => (local ? local.n : current);

  const shown = (): TimelineStep | undefined => shownSteps().find((s) => s.n === (hovered ?? pinned));

  function renderCard(): void {
    const step = shown();
    if (!step) { card.hidden = true; return; }
    const now = shownSteps().find((s) => s.n === nowN());
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
    for (const m of step.mods) bits.push(have.has(m.id) || step.n === nowN() ? m.title : `+ ${m.title}`);
    for (const m of now?.mods ?? []) if (!had.has(m.id) && step.n !== nowN()) bits.push(`− ${m.title}`);
    if (step.mood) bits.unshift(`mood: ${step.mood}`);
    list.textContent = bits.length > 0 ? bits.join(" · ") : "an empty world";
    card.append(list);
    if (step.n === nowN()) {
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
    for (const s of shownSteps()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `tl-dot ${s.kind}${s.n === nowN() ? " now" : ""}${s.n === pinned ? " pin" : ""}`;
      b.setAttribute("aria-label", `Step ${s.n}: ${s.label}`);
      b.addEventListener("mouseenter", () => { hovered = s.n; renderCard(); });
      b.addEventListener("focus", () => { hovered = s.n; renderCard(); });
      b.addEventListener("click", () => { pinned = pinned === s.n ? null : s.n; renderTrack(); renderCard(); });
      track.append(b);
    }
    const last = shownSteps()[shownSteps().length - 1];
    const cap = document.createElement("span");
    cap.className = "tl-cap";
    cap.textContent = shownSteps().find((s) => s.n === nowN())?.label ?? last?.label ?? "";
    track.append(cap);
    track.scrollLeft = track.scrollWidth;
  }

  function renderAll(): void {
    root.hidden = shownSteps().length < 2;
    renderTrack();
    renderCard();
  }

  root.addEventListener("mouseleave", () => { hovered = null; renderCard(); });

  return {
    update(next, cur) {
      steps = next;
      current = cur;
      // The server's frame is the whole truth: any local guess is superseded by it.
      local = null;
      if (pinned !== null && !steps.some((s) => s.n === pinned)) pinned = null;
      renderAll();
    },
    localStep(step) {
      local = { ...step, n: (steps[steps.length - 1]?.n ?? 0) + 1 };
      renderAll();
    },
    clearLocal() {
      if (!local) return;
      local = null;
      renderAll();
    },
  };
}
