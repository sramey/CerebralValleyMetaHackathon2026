// Per-build orb UI (ADR 0016). A compound command ("add trees, make it rain, and
// add a bouncing slime") runs as parallel builds on the server; each one shows as
// a chip with its own trail of stages, and the orb stays "building" until every
// in-flight build has settled. Builds are keyed by their (sub-)command text,
// which the server stamps on every stage and timing message.
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
}

const STALE_MS = 120_000; // a build whose server never reports back is dropped, so the orb cannot stick
const LINGER_MS = 2500; // how long a settled chip stays visible

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

export function createBuilds(host: HTMLElement, onChange: () => void): Builds {
  const list = document.createElement("div");
  list.className = "builds";
  list.setAttribute("aria-live", "polite");
  host.appendChild(list);
  const builds = new Map<string, Build>();

  const running = (): Build[] => [...builds.values()].filter((b) => b.phase === "running");

  function paint(b: Build): void {
    b.chip.dataset.phase = b.phase;
    b.chip.title = b.detail;
    b.chip.replaceChildren();
    const name = document.createElement("span");
    name.className = "builds-name";
    name.textContent = b.command;
    const trail = document.createElement("span");
    trail.className = "builds-trail";
    trail.textContent = b.trail.join(" › ");
    b.chip.append(name, trail);
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

  return {
    stage(command, stage, detail) {
      let b = builds.get(command);
      if (!b || b.phase !== "running") {
        if (b) b.chip.remove();
        const chip = document.createElement("div");
        chip.className = "builds-chip";
        list.appendChild(chip);
        b = { command, phase: "running", trail: [], detail, chip, startedAt: performance.now(), timer: 0 };
        builds.set(command, b);
        const mine = b;
        b.timer = window.setTimeout(() => { settle(mine, "failed"); onChange(); }, STALE_MS);
      }
      const label = STAGE_LABEL[stage] ?? stage;
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
