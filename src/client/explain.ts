// "How does this work?" panel (ADR 0043). The radial menu offers it on any object: the
// server turns the mod's source into three plain sentences plus the three lines that matter,
// and this file shows them in a small code view under a question badge. The point is
// learning: a kid clicks what they built and reads, in words they know, what the code does.
//
// Nothing here calls a model. The client asks (one short message) and renders the answer;
// the server holds the code, the prompt and the per-source cache.
import "./explain.css";
import type { ClientMsg, ServerMsg } from "../contract";

export interface ExplainTarget {
  /** The mod that owns the clicked object. */
  modId: string;
  title: string;
  /** The entity type, for the title line when the mod has no friendlier name. */
  entityType: string;
}

export type ExplainResultMsg = Extract<ServerMsg, { kind: "explainResult" }>;

export interface ExplainOptions {
  /** Where the panel is mounted (never inside the canvas). */
  host: HTMLElement;
  send: (msg: ClientMsg) => void;
  say: (text: string, state?: string) => void;
  /** True while the socket can carry the request. */
  connected: () => boolean;
  log: (text: string) => void;
}

/** Entities the engine owns have no mod source: say what the engine is instead of spending a call. */
export const ENGINE_SAY =
  "This one belongs to the engine: the part that never changes, like the loop, gravity and collisions. " +
  "Everything you build sits on top of it as a mod with code you can read. " +
  "Click a thing you built and I will show you the code that makes it work.";

export const OFFLINE_SAY =
  "Explaining reads the code the server keeps, and the server is not connected right now. " +
  "Everything still plays without it. " +
  "Start the server (npm run server) and click the object again.";

export function initExplain(opts: ExplainOptions) {
  const panel = document.createElement("section");
  panel.id = "explain-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("aria-label", "How this works");

  const head = document.createElement("header");
  head.className = "explain-head";
  const badge = document.createElement("span");
  badge.className = "explain-badge";
  badge.textContent = "How does this work?";
  const titleEl = document.createElement("h3");
  titleEl.className = "explain-title";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "explain-close";
  closeBtn.setAttribute("aria-label", "Close explanation");
  closeBtn.textContent = "×";
  head.append(badge, titleEl, closeBtn);

  const body = document.createElement("div");
  body.className = "explain-body";
  const sayEl = document.createElement("p");
  sayEl.className = "explain-say";
  const codeEl = document.createElement("ol");
  codeEl.className = "explain-code";
  const footEl = document.createElement("footer");
  footEl.className = "explain-foot";
  body.append(sayEl, codeEl, footEl);

  panel.append(head, body);
  opts.host.appendChild(panel);

  /** The mod this panel is about; a reply for any other mod is stale and ignored. */
  let target: ExplainTarget | null = null;

  function setState(state: "loading" | "ready"): void {
    panel.dataset.state = state;
  }

  function renderCode(lines: ExplainResultMsg["lines"]): void {
    codeEl.replaceChildren();
    let prev = 0;
    for (const line of lines) {
      if (prev > 0 && line.n > prev + 1) {
        const gap = document.createElement("li");
        gap.className = "explain-gap";
        gap.textContent = "⋯";
        codeEl.append(gap);
      }
      const li = document.createElement("li");
      li.className = "explain-line";
      const n = document.createElement("span");
      n.className = "explain-n";
      n.textContent = String(line.n);
      const code = document.createElement("code");
      code.textContent = line.code;
      li.append(n, code);
      codeEl.append(li);
      prev = line.n;
    }
    codeEl.hidden = lines.length === 0;
  }

  /** The two local answers (engine-owned object, no server): same card, no model call. */
  function renderLocal(text: string, note: string): void {
    sayEl.textContent = text;
    sayEl.hidden = false;
    codeEl.replaceChildren();
    codeEl.hidden = true;
    footEl.textContent = note;
    setState("ready");
  }

  function open(t: ExplainTarget): void {
    target = t;
    titleEl.textContent = t.title || t.entityType;
    panel.hidden = false;
    panel.dataset.state = "loading";
    sayEl.hidden = true;
    codeEl.replaceChildren();
    codeEl.hidden = true;
    footEl.textContent = "Reading the code…";

    if (t.modId === "engine") { renderLocal(ENGINE_SAY, "Engine, not a mod"); return; }
    if (!opts.connected()) { renderLocal(OFFLINE_SAY, "Server not connected"); return; }
    opts.say(`Reading ${t.title || t.entityType}…`, "building");
    opts.send({ kind: "explain", modId: t.modId });
  }

  function close(): void {
    target = null;
    panel.hidden = true;
  }

  /** A finished explanation. Ignored unless it is the one the panel is waiting for. */
  function onMsg(msg: ExplainResultMsg): void {
    if (panel.hidden || !target || msg.modId !== target.modId) return;
    titleEl.textContent = msg.title || titleEl.textContent;
    sayEl.textContent = msg.text;
    sayEl.hidden = false;
    renderCode(Array.isArray(msg.lines) ? msg.lines : []);
    const time = msg.cached ? "from cache" : `${(Math.max(0, msg.ms) / 1000).toFixed(1)}s`;
    footEl.textContent = `Muse Spark · ${time}`;
    setState("ready");
    opts.say(`Here is how ${msg.title || "it"} works.`, "done");
    opts.log(`explain: ${msg.modId} (${msg.lines?.length ?? 0} lines, ${msg.cached ? "cached" : `${msg.ms}ms`})`);
  }

  closeBtn.addEventListener("click", close);
  addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !panel.hidden) close(); });
  // Clicking the game or the rail dismisses it, like the radial menu.
  document.addEventListener("pointerdown", (ev) => {
    if (panel.hidden) return;
    const el = ev.target as Node | null;
    if (el && panel.contains(el)) return;
    close();
  });

  return { open, close, onMsg, isOpen: () => !panel.hidden, target: () => target };
}
