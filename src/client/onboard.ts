// First-run experience (bead okp): a skippable three-step coach, rotating known-good ideas in the orb placeholder,
// a celebration on the first landed build, plain-language build failures and a visible speaker/mute button.
// The step logic and the message wording are pure (tested); the DOM below only renders them.
import "./onboard.css";
import type { Sound } from "./sound";

/** Ideas the pipeline is known to land (from the rehearse sets), shown in the placeholder in rotation. */
export const IDEAS: readonly string[] = [
  "add a bouncing green slime",
  "make it rain",
  "add trees",
  "make this christmas themed",
  "add a dragon and some coins",
  "make it so my character can double jump",
  "make it spooky",
  "let me shoot fireballs",
];
export const FIRST_IDEA = IDEAS[0];

export type CoachEvent = "submit" | "working" | "built" | "move" | "skip";
/** Steps are 1 (say it), 2 (watch it get built), 3 (play it); 4 means the tour is over. */
export type CoachStep = 1 | 2 | 3 | 4;

export function coachNext(step: CoachStep, ev: CoachEvent): CoachStep {
  if (step === 4 || ev === "skip") return 4;
  if ((ev === "submit" || ev === "working") && step === 1) return 2;
  if (ev === "built" && step < 3) return 3;
  if (ev === "move" && step === 3) return 4;
  return step;
}

const TECHNICAL = /error|exception|undefined|\bnull\b|\bTS\d+|typescript|stack|\bat \S+:\d+|expected|unexpected|syntax|token|api\.|\.ts\b|playtest:|verif|compil|[{}]|=>|\bNaN\b/i;

/** What to tell a non-coder when a build is turned down. The raw reason never reaches the screen unless it already reads plainly. */
export function plainBuildMessage(stage: "rejected" | "failed", detail: string): string {
  const d = detail.trim();
  if (stage === "rejected") {
    return d && d.length <= 160 && !TECHNICAL.test(d)
      ? `That version didn't pass the check: ${d} Fixing it now…`
      : "That version didn't pass the check, so it was thrown away. Fixing it now…";
  }
  if (/budget|limit|quota|\b429\b|rate|busy/i.test(d)) return "The builder is busy right now. Wait a few seconds and try again.";
  if (/timed? ?out|network|fetch|socket|econn|connect|offline/i.test(d)) return "I lost touch with the builder. Make sure the server is running, then try again.";
  return `I couldn't build that one this time, and your game is unchanged. Try saying it another way, like “${FIRST_IDEA}”.`;
}

/** Placeholder text for slot `i` of the rotation. */
export const ideaPlaceholder = (i: number): string => `Try: “${IDEAS[((i % IDEAS.length) + IDEAS.length) % IDEAS.length]}”`;

const STEP_TEXT: Record<1 | 2 | 3, { title: string; body: string }> = {
  1: { title: "1 · Tell it what to build", body: "Type an idea in the box at the top, or hold Shift and say it out loud." },
  2: { title: "2 · Watch it get built", body: "It writes the code, then a robot player tests it. This takes about 20 seconds." },
  3: { title: "3 · Now play it!", body: "Move: A / D or arrows. Jump: W or Space. Shoot: X or B. Ask for anything else and it keeps building." },
};

const KEY = "metabuild.coach";
const FIRST_KEY = "metabuild.firstbuild";
const store = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* per-viewer extra only */ } },
};

export interface OnboardingHooks {
  /** Run an idea as if the person had typed it. */
  submit(text: string): void;
  orbInput: HTMLInputElement;
  mount: HTMLElement;
  /** Anything with a `has` check: the defensive decoder (`UrlFlags`) or a raw `URLSearchParams`. */
  flags: { has(name: string): boolean };
}

export interface Onboarding {
  event(ev: CoachEvent): void;
  readonly step: CoachStep;
}

export function createOnboarding(h: OnboardingHooks): Onboarding {
  // Rotating suggestions in the orb placeholder (only while the box is empty and unfocused).
  let slot = 0;
  h.orbInput.placeholder = ideaPlaceholder(slot);
  window.setInterval(() => {
    if (h.orbInput.value || document.activeElement === h.orbInput) return;
    h.orbInput.placeholder = ideaPlaceholder(++slot);
  }, 4500);

  if (h.flags.has("coach")) store.set(KEY, "");
  let step: CoachStep = store.get(KEY) === "done" || h.flags.has("nocoach") ? 4 : 1;
  let celebrated = store.get(FIRST_KEY) === "1" || h.flags.has("nocoach");

  const card = document.createElement("div");
  card.id = "coach";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Quick tour");
  card.setAttribute("aria-live", "polite");
  card.hidden = true;
  h.mount.appendChild(card);

  const render = (): void => {
    if (step === 4) { card.hidden = true; return; }
    const t = STEP_TEXT[step];
    card.hidden = false;
    card.dataset.step = String(step);
    card.replaceChildren();
    const top = document.createElement("div");
    top.className = "coach-top";
    const dots = document.createElement("span");
    dots.className = "coach-dots";
    for (let i = 1; i <= 3; i++) { const d = document.createElement("i"); if (i <= step) d.className = "on"; dots.appendChild(d); }
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "coach-skip";
    skip.textContent = "Skip tour";
    skip.addEventListener("click", () => event("skip"));
    top.append(dots, skip);
    const title = document.createElement("div");
    title.className = "coach-title";
    title.textContent = t.title;
    const body = document.createElement("div");
    body.className = "coach-body";
    body.textContent = t.body;
    card.append(top, title, body);
    if (step === 1) {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "coach-go";
      go.textContent = `Build “${FIRST_IDEA}”`;
      go.addEventListener("click", () => { h.submit(FIRST_IDEA); event("submit"); });
      card.appendChild(go);
    } else if (step === 3) {
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "coach-go";
      ok.textContent = "Got it";
      ok.addEventListener("click", () => event("skip"));
      card.appendChild(ok);
    }
  };

  const celebrate = (): void => {
    celebrated = true;
    store.set(FIRST_KEY, "1");
    const box = document.createElement("div");
    box.id = "celebrate";
    box.setAttribute("role", "status");
    const big = document.createElement("div");
    big.className = "celebrate-big";
    big.textContent = "You just built your first thing!";
    const small = document.createElement("div");
    small.className = "celebrate-small";
    small.textContent = "Go play it, or ask for something else.";
    box.append(big, small);
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      const colors = ["#ffc94d", "#7ee081", "#58e6ff", "#ff8fa3", "#c9a7ff"];
      for (let i = 0; i < 36; i++) {
        const p = document.createElement("i");
        p.className = "confetti";
        const a = (i / 36) * Math.PI * 2;
        const r = 120 + (i % 5) * 36;
        p.style.setProperty("--dx", `${Math.round(Math.cos(a) * r)}px`);
        p.style.setProperty("--dy", `${Math.round(Math.sin(a) * r * 0.7 - 60)}px`);
        p.style.setProperty("--rot", `${(i * 47) % 360}deg`);
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = `${(i % 6) * 25}ms`;
        box.appendChild(p);
      }
    }
    h.mount.appendChild(box);
    window.setTimeout(() => box.remove(), 5200);
  };

  function event(ev: CoachEvent): void {
    if (ev === "built" && !celebrated) celebrate();
    const next = coachNext(step, ev);
    if (next === step) return;
    step = next;
    if (step === 4) store.set(KEY, "done");
    render();
  }
  render();
  return { event, get step() { return step; } };
}

const ICON_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 6 6M22 9l-6 6"/></svg>';

/** A visible speaker button (the M key does the same). Returns a sync() to call after the mute state changes elsewhere. */
export function createSoundButton(sound: Sound, mount: HTMLElement, unlock: () => void): () => void {
  const b = document.createElement("button");
  b.id = "sound-btn";
  b.type = "button";
  const sync = (): void => {
    b.innerHTML = sound.muted ? ICON_OFF : ICON_ON;
    b.title = sound.muted ? "Sound is off (press M)" : "Sound is on (press M)";
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", String(!sound.muted));
    b.classList.toggle("off", sound.muted);
  };
  b.addEventListener("click", () => { unlock(); sound.toggleMute(); sync(); });
  mount.appendChild(b);
  sync();
  return sync;
}
