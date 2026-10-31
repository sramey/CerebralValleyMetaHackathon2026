// The open-weights second opinion, on stage (ADR 0078). Muse Spark Open reviews each finished
// build in the background (ADR 0068); this turns its verdicts into something you can see:
// a fix card when it caught a bug (and the swap landed), a small chip when it found nothing,
// and a "+1 rule" pulse on the 🧠 button when the fix taught the game something.
import "./second-opinion.css";
import type { ServerMsg } from "../contract";

type ReviewMsg = Extract<ServerMsg, { kind: "review" }>;

export const CARD_MS = 5000;
export const CHIP_MS = 2000;
export const PULSE_MS = 6000;

/** Trim an issue sentence for the card: first sentence, at most `max` characters, on a word boundary. */
export function trimIssue(issue: string, max = 150): string {
  const one = issue.replace(/\s+/g, " ").trim();
  const first = one.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? one;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  return `${cut.slice(0, Math.max(20, cut.lastIndexOf(" ")))}…`;
}

export interface CardView { kind: "card" | "chip" | "reading" | "none"; title?: string; issue?: string; foot?: string; text?: string; pulse?: string }

/** What a review message should look like (pure; the DOM below just paints it). */
export function viewOf(msg: ReviewMsg): CardView {
  const of = msg.sweep && msg.sweep.of > 1 ? ` (${msg.sweep.n} of ${msg.sweep.of})` : "";
  if (msg.phase === "running") return msg.sweep ? { kind: "reading", text: `Muse Spark Open is reading ${msg.title}${of}` } : { kind: "none" };
  if (msg.phase === "ok") return { kind: "chip", text: `✓ reviewed by Muse Spark Open${msg.sweep ? ` · ${msg.title}` : ""}` };
  if (msg.phase === "fixed") {
    return {
      kind: "card",
      title: "🔍 Muse Spark Open (open weights) caught a bug",
      issue: trimIssue(msg.issue ?? "a problem in the build"),
      foot: `Fixed · re-verified · live${msg.title ? ` · ${msg.title}` : ""}`,
      ...(msg.rule ? { pulse: "+1 rule" } : {}),
    };
  }
  return { kind: "none" }; // held back: the 🧠 panel tells that story, the stage stays calm
}

export interface SecondOpinionHooks {
  /** Flash the fixed mod's entities as the swap lands. */
  flash?: (modId: string) => void;
  /** After a fix (or a rule), nudge the 🧠 panel to refresh. */
  onFixed?: () => void;
}

export interface SecondOpinion { onMsg(msg: ServerMsg): void; clear(): void }

export function createSecondOpinion(host: HTMLElement, hooks: SecondOpinionHooks = {}): SecondOpinion {
  const root = document.createElement("div");
  root.id = "second-opinion";
  root.setAttribute("aria-live", "polite");
  host.appendChild(root);
  let timer = 0;
  let pulseTimer = 0;

  const hide = (): void => { root.dataset.state = "off"; root.replaceChildren(); window.clearTimeout(timer); timer = 0; };
  hide();

  function show(v: CardView, ms: number): void {
    window.clearTimeout(timer);
    const el = document.createElement("div");
    el.className = `so-${v.kind}`;
    if (v.kind === "card") {
      const h = document.createElement("b"); h.textContent = v.title ?? "";
      const p = document.createElement("p"); p.textContent = v.issue ?? "";
      const f = document.createElement("i"); f.textContent = v.foot ?? "";
      el.append(h, p, f);
    } else el.textContent = v.text ?? "";
    root.replaceChildren(el);
    root.dataset.state = v.kind;
    timer = window.setTimeout(hide, ms);
  }

  const brainButtons = (): HTMLElement[] => ["quick-brain-btn", "brain-btn"].map((id) => document.getElementById(id)).filter((b): b is HTMLElement => b !== null);

  function pulse(text: string): void {
    for (const b of brainButtons()) { b.classList.add("so-pulse"); b.dataset.soBadge = text; }
    window.clearTimeout(pulseTimer);
    pulseTimer = window.setTimeout(() => {
      for (const b of brainButtons()) { b.classList.remove("so-pulse"); delete b.dataset.soBadge; }
    }, PULSE_MS);
  }

  return {
    clear: hide,
    onMsg(msg) {
      if (msg.kind !== "review") return;
      const v = viewOf(msg);
      if (v.kind === "none") { if (msg.phase !== "running") hide(); return; }
      show(v, v.kind === "card" ? CARD_MS : v.kind === "chip" ? CHIP_MS : 30000);
      if (msg.phase === "fixed") {
        hooks.flash?.(msg.modId);
        hooks.onFixed?.();
        if (v.pulse) pulse(v.pulse);
      }
    },
  };
}
