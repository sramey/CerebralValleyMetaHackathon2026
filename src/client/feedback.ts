import "./feedback.css";
import type { ClientMsg } from "../contract";

export interface FeedbackTarget {
  modId: string;
  title: string;
  entityType?: string;
  vote: "up" | "down";
}

export interface FeedbackOptions {
  send: (msg: ClientMsg) => void;
  sendWorldState: () => void;
  say: (text: string, state?: string) => void;
  log: (text: string) => void;
}

const THUMBS_UP_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const THUMBS_DOWN_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;

export function initFeedback(opts: FeedbackOptions) {
  const modal = document.querySelector<HTMLElement>("#feedback-modal")!;
  const form = document.querySelector<HTMLFormElement>("#feedback-form")!;
  const badge = document.querySelector<HTMLElement>("#feedback-badge")!;
  const titleEl = document.querySelector<HTMLElement>("#feedback-title")!;
  const promptEl = document.querySelector<HTMLElement>("#feedback-prompt")!;
  const noteEl = document.querySelector<HTMLTextAreaElement>("#feedback-note")!;
  const fixRow = document.querySelector<HTMLElement>("#feedback-fix-row")!;
  const fixNowEl = document.querySelector<HTMLInputElement>("#feedback-fix-now")!;
  const submitBtn = document.querySelector<HTMLButtonElement>("#feedback-submit")!;
  const cancelBtn = document.querySelector<HTMLButtonElement>("#feedback-cancel")!;

  let current: FeedbackTarget | null = null;

  function syncSubmitLabel(): void {
    if (!current) return;
    if (current.vote === "up") {
      submitBtn.textContent = "Save Skill";
    } else {
      submitBtn.textContent = fixNowEl.checked ? "Teach & Fix" : "Save Rule";
    }
  }

  function open(target: FeedbackTarget): void {
    current = target;
    const isUp = target.vote === "up";
    badge.dataset.vote = target.vote;
    badge.textContent = isUp ? "👍 Save Skill" : "👎 Teach Engine";
    const label = target.entityType && target.entityType !== target.modId
      ? `${target.title} (${target.entityType})`
      : target.title;
    titleEl.textContent = label;
    if (isUp) {
      promptEl.textContent = "What worked well? (saves this pattern as a reusable skill)";
      noteEl.placeholder = "e.g. smooth sine-wave bobbing and warm glow particles";
      fixRow.hidden = true;
      fixNowEl.checked = false;
    } else {
      promptEl.textContent = "What was bad or wrong? (e.g. 'a ball should be a simple shape, not a basketball player')";
      noteEl.placeholder = "e.g. a ball should be a simple shape, not a basketball player";
      fixRow.hidden = false;
      fixNowEl.checked = true;
    }
    noteEl.value = "";
    syncSubmitLabel();
    modal.hidden = false;
    setTimeout(() => noteEl.focus(), 20);
  }

  function close(): void {
    current = null;
    modal.hidden = true;
  }

  fixNowEl.addEventListener("change", syncSubmitLabel);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) close();
  });
  addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !modal.hidden) close();
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!current) return;
    const target = current;
    const note = noteEl.value.trim() || (target.vote === "up" ? `Great ${target.title} pattern` : `Fix ${target.title}`);
    const fixNow = target.vote === "down" && fixNowEl.checked;
    close();
    opts.sendWorldState();
    opts.send({
      kind: "feedback",
      modId: target.modId,
      entityType: target.entityType,
      vote: target.vote,
      note,
      fixNow,
    });
    opts.log(`feedback (${target.vote}) on ${target.modId}: ${note}`);
    opts.say(
      target.vote === "up"
        ? `Distilling ${target.title} into a reusable skill…`
        : fixNow
          ? `Learning rule & rebuilding ${target.title}…`
          : `Distilling feedback rule for ${target.title}…`,
      "building",
    );
  });

  function createModActions(mod: { id: string; title: string }, onUndo: () => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "mod-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "mod-rate";
    upBtn.dataset.action = "thumbs-up";
    upBtn.title = "Good — save as reusable skill";
    upBtn.setAttribute("aria-label", `Thumbs up ${mod.title}`);
    upBtn.innerHTML = THUMBS_UP_SVG;
    upBtn.addEventListener("click", () => open({ modId: mod.id, title: mod.title, vote: "up" }));

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "mod-rate";
    downBtn.dataset.action = "thumbs-down";
    downBtn.title = "Bad — teach rule & fix";
    downBtn.setAttribute("aria-label", `Thumbs down ${mod.title}`);
    downBtn.innerHTML = THUMBS_DOWN_SVG;
    downBtn.addEventListener("click", () => open({ modId: mod.id, title: mod.title, vote: "down" }));

    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "undo";
    undo.textContent = "Undo";
    undo.addEventListener("click", onUndo);

    wrap.append(upBtn, downBtn, undo);
    return wrap;
  }

  return { open, close, createModActions };
}
