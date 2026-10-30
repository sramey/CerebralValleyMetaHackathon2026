// Per-build orb UI (ADR 0016). A compound command ("add trees, make it rain, and
// add a bouncing slime") runs as parallel builds on the server; each one shows as
// a chip with its own trail of stages, and the orb stays "building" until every
// in-flight build has settled. Builds are keyed by their (sub-)command text,
// which the server stamps on every stage and timing message.
//
// A running chip carries a small x (ADR 0060): it sends {kind:"cancel", command}
// so the player can stop a build they no longer want, and settles the chip even if
// the server never answers, so the orb can never be left building forever.
import "./builds.css";

type Phase = "running" | "landed" | "failed";

interface Build {
  command: string;
  phase: Phase;
  trail: string[];
  detail: string;
  chip: HTMLElement;
  startedAt: number;
  timer: number;
  /** The player clicked the x: no second click, and the chip says so until the server answers. */
  cancelling: boolean;
}

const STALE_MS = 120_000; // a build whose server never reports back is dropped, so the orb cannot stick
const LINGER_MS = 2500; // how long a settled chip stays visible
const CANCEL_GRACE_MS = 8000; // a clicked x settles the chip by itself if no stage ever comes back
const CANCEL_LABEL = "cancelled";

const STAGE_LABEL: Record<string, string> = {
  routing: "routing",
  writing: "writing",
  verifying: "verifying",
  rejected: "rejected",
  fixing: "fixing",
  compiling: "compiling",
  done: "live",
  failed: "failed",
};

export interface Builds {
  /** A stage message arrived for `command`. Starts the build on first sight. */
  stage(command: string, stage: string, detail: string): void;
  /** The server is finished with `command` (timing message). */
  finish(command: string): void;
  /** Builds still running. */
  active(): number;
  /** Total started since the orb was last idle (for the "N things" headline). */
  headline(): string;
}

/** `onCancel`: called with a build's command when the player clicks the x on its chip (ADR 0060). */
export function createBuilds(host: HTMLElement, onChange: () => void, onCancel?: (command: string) => void): Builds {
  const list = document.createElement("div");
  list.className = "builds";
  list.setAttribute("aria-live", "polite");
  host.appendChild(list);
  const builds = new Map<string, Build>();

  const running = (): Build[] => [...builds.values()].filter((b) => b.phase === "running");

  function paint(b: Build): void {
    b.chip.dataset.phase = b.phase;
    b.chip.title = b.detail;
    if (b.cancelling && b.phase === "running") b.chip.dataset.cancelling = "1";
    else delete b.chip.dataset.cancelling;
    b.chip.replaceChildren();
    const name = document.createElement("span");
    name.className = "builds-name";
    name.textContent = b.command;
    const trail = document.createElement("span");
    trail.className = "builds-trail";
    trail.textContent = b.trail.join(" › ");
    b.chip.append(name, trail);
    if (b.phase === "running") b.chip.append(cancelButton(b));
  }

  /** The x that stops a build still running (ADR 0060). Clicking it once is enough: the button
   *  disables, and a grace timer settles the chip if the server never reports back. */
  function cancelButton(b: Build): HTMLButtonElement {
    const x = document.createElement("button");
    x.type = "button";
    x.className = "builds-cancel";
    x.textContent = "×";
    x.title = `Cancel "${b.command}"`;
    x.setAttribute("aria-label", `Cancel ${b.command}`);
    x.disabled = b.cancelling;
    x.addEventListener("click", () => {
      if (b.phase !== "running" || b.cancelling) return;
      b.cancelling = true;
      paint(b);
      onChange();
      onCancel?.(b.command);
      window.setTimeout(() => { markCancelled(b); onChange(); }, CANCEL_GRACE_MS);
    });
    return x;
  }

  function settle(b: Build, phase: Phase): void {
    if (b.phase !== "running") return;
    b.phase = phase;
    paint(b);
    window.clearTimeout(b.timer);
    window.setTimeout(() => {
      b.chip.remove();
      if (builds.get(b.command) === b) builds.delete(b.command);
    }, LINGER_MS);
  }

  /** End a chip the player stopped: the trail says "cancelled", not "failed" (ADR 0060). */
  function markCancelled(b: Build): void {
    if (b.phase !== "running") return;
    b.cancelling = true;
    b.detail = CANCEL_LABEL;
    if (b.trail[b.trail.length - 1] !== CANCEL_LABEL) b.trail.push(CANCEL_LABEL);
    settle(b, "failed");
  }

  return {
    stage(command, stage, detail) {
      let b = builds.get(command);
      if (!b || b.phase !== "running") {
        if (b) b.chip.remove();
        const chip = document.createElement("div");
        chip.className = "builds-chip";
        list.appendChild(chip);
        b = { command, phase: "running", trail: [], detail, chip, startedAt: performance.now(), timer: 0, cancelling: false };
        builds.set(command, b);
        const mine = b;
        b.timer = window.setTimeout(() => { settle(mine, "failed"); onChange(); }, STALE_MS);
      }
      const label = stage === "failed" && detail === CANCEL_LABEL ? CANCEL_LABEL : STAGE_LABEL[stage] ?? stage;
      if (b.trail[b.trail.length - 1] !== label) b.trail.push(label);
      b.detail = detail;
      paint(b);
      if (stage === "done") settle(b, "landed");
      else if (stage === "failed") settle(b, "failed");
      onChange();
    },
    finish(command) {
      const b = builds.get(command);
      if (b) settle(b, b.trail.includes("live") ? "landed" : "failed");
      onChange();
    },
    active: () => running().length,
    headline() {
      const r = running();
      if (r.length <= 1) return "";
      return `Building ${r.length} things at once: ${r.map((b) => b.command).join(" · ")}`;
    },
  };
}
