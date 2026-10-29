// In-app architecture view (ADR 0021): press P (or the button) and the real build
// pipeline lights up over the stage. Every number comes from server messages: stage
// events place a build on a node, the timing message supplies the measured
// milliseconds, and parallel builds from a compound command get one lane each.
import "./pipeline.css";
import type { ServerMsg } from "../contract";
import { createStatsPanel } from "./stats-panel";
import { isLiveBuildMsg } from "./stats-refresh";
import { chain, stepLine } from "./agent-steps";
import type { AgentStepMsg } from "./agent-steps";

type NodeId = "voice" | "spark" | "wonder" | "esbuild" | "verifier" | "live" | "image" | "sam";
type Slot = "route" | "write" | "compile" | "verify";
type Phase = "running" | "landed" | "failed" | "other";

interface Lane {
  command: string;
  node: NodeId;
  phase: Phase;
  times: Partial<Record<Slot, number>>;
  total?: number;
  startedAt: number;
  lastAt: number;
  slot: Slot;
  rejected: boolean;
  tool?: string;
  counted: boolean;
  steps: AgentStepMsg[];
}

interface NodeDef { id: NodeId; name: string; model: string; role: string; col: number; row: number; slot?: Slot }

const NODES: NodeDef[] = [
  { id: "voice", name: "Voice / text", model: "muse-voice-transcribe-1.0", role: "You talk or type; hold Shift to speak", col: 1, row: 1 },
  { id: "spark", name: "Muse Spark", model: "muse-spark-1.2", role: "Routes: new, edit, tweak, undo, or several builds", col: 2, row: 1, slot: "route" },
  { id: "wonder", name: "Muse Wonder agent", model: "muse-wonder-1.0", role: "Writes the mod, then tests its own draft", col: 3, row: 1, slot: "write" },
  { id: "esbuild", name: "esbuild", model: "compile + safety scan", role: "TypeScript in, sandboxed module out", col: 4, row: 1, slot: "compile" },
  { id: "verifier", name: "Verifier", model: "health, test(), bot playtest", role: "A bot plays the level with and without it", col: 5, row: 1, slot: "verify" },
  { id: "live", name: "Hot-load", model: "mod loader", role: "Lands in the running game; undo stays clean", col: 6, row: 1 },
  { id: "image", name: "Muse Image", model: "muse-image-1.0", role: "Draws sprites on demand", col: 3, row: 2 },
  { id: "sam", name: "SAM 3.1", model: "sam-3.1", role: "Finds the object you hold up to the camera", col: 5, row: 2 },
];

const STAGE_NODE: Record<string, NodeId> = {
  routing: "spark", writing: "wonder", fixing: "wonder", compiling: "esbuild", verifying: "verifier", rejected: "verifier", done: "live", failed: "live",
};
const STAGE_SLOT: Record<string, Slot> = { routing: "route", writing: "write", fixing: "write", compiling: "compile", verifying: "verify", rejected: "verify" };
const SLOT_LABEL: Record<Slot, string> = { route: "route", write: "write", compile: "build", verify: "verify" };
const FLASH_MS = 1400;
const MAX_LANES = 5;

const fmt = (ms: number | undefined): string => (ms === undefined ? "" : ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

interface Counters { day: string; builds: number; landed: number; fixed: number }

function loadCounters(): Counters {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const c = JSON.parse(localStorage.getItem("metabuild.pipeline") ?? "null") as Counters | null;
    if (c && c.day === day) return c;
  } catch { /* storage unavailable: counters just start at zero */ }
  return { day, builds: 0, landed: 0, fixed: 0 };
}

export interface Pipeline {
  /** Feed every server message; the view picks out what it needs. */
  onMsg(msg: ServerMsg): void;
  toggle(force?: boolean): void;
  /** The paced code stream from the build theater, shown in the Wonder node. */
  setCode(lines: string[], partial: string, active: boolean): void;
}

export function createPipeline(host: HTMLElement): Pipeline {
  const counters = loadCounters();
  const lanes: Lane[] = [];
  const flash = new Map<NodeId, number>();
  let open = false;
  let ticker = 0;

  const root = document.createElement("section");
  root.id = "pipeline";
  root.hidden = true;
  root.setAttribute("aria-label", "How Metabuild builds itself");
  root.innerHTML = `
    <div class="pl-head">
      <div><div class="pl-kicker">LIVE PIPELINE</div><h2>Every build, start to finish</h2></div>
      <div class="pl-stats">
        <div><b data-stat="builds">0</b><span>builds today</span></div>
        <div><b data-stat="landed">0%</b><span>landed</span></div>
        <div><b data-stat="fixed">0</b><span>auto-fixed</span></div>
      </div>
    </div>
    <div class="pl-graph"></div>
    <div class="pl-lanes-head">Builds in flight <i>one lane per parallel build</i></div>
    <div class="pl-lanes"></div>
    <div class="pl-foot">All AI in the game runs on Meta models. Press <kbd>P</kbd> to close.</div>`;
  host.appendChild(root);

  const btn = document.createElement("button");
  btn.id = "pipeline-btn";
  btn.type = "button";
  btn.title = "Show the build pipeline (P)";
  btn.textContent = "Pipeline";
  host.appendChild(btn);

  const graph = root.querySelector<HTMLElement>(".pl-graph")!;
  const laneBox = root.querySelector<HTMLElement>(".pl-lanes")!;
  // Impact numbers read from the game's own build log, live in the overlay (ADR 0027).
  const statsPanel = createStatsPanel();
  root.insertBefore(statsPanel.element, root.querySelector(".pl-lanes-head"));
  const nodeEls = new Map<NodeId, HTMLElement>();
  for (const n of NODES) {
    const el = document.createElement("div");
    el.className = "pl-node";
    el.dataset.node = n.id;
    el.style.gridColumn = String(n.col);
    el.style.gridRow = String(n.row);
    el.innerHTML = `<div class="pl-name">${n.name}</div><div class="pl-model">${n.model}</div><div class="pl-role">${n.role}</div>
      ${n.id === "wonder" ? `<pre class="pl-code" aria-hidden="true"></pre><div class="pl-tools"><span data-tool="inspect_world">inspect_world</span><span data-tool="run_playtest">run_playtest</span></div>` : ""}
      <div class="pl-meta"><span class="pl-count"></span><span class="pl-last"></span></div>`;
    graph.appendChild(el);
    nodeEls.set(n.id, el);
  }

  function counts(): Map<NodeId, number> {
    const m = new Map<NodeId, number>();
    for (const l of lanes) if (l.phase === "running") m.set(l.node, (m.get(l.node) ?? 0) + 1);
    return m;
  }

  function paint(): void {
    root.querySelector('[data-stat="builds"]')!.textContent = String(counters.builds);
    root.querySelector('[data-stat="landed"]')!.textContent = counters.builds ? `${Math.round((100 * counters.landed) / counters.builds)}%` : "–";
    root.querySelector('[data-stat="fixed"]')!.textContent = String(counters.fixed);
    const now = performance.now();
    const c = counts();
    for (const n of NODES) {
      const el = nodeEls.get(n.id)!;
      const running = c.get(n.id) ?? 0;
      const flashed = (flash.get(n.id) ?? 0) > now;
      el.classList.toggle("on", running > 0 || flashed);
      el.querySelector(".pl-count")!.textContent = running > 1 ? `${running} builds` : running === 1 ? "building" : "";
      const last = n.slot ? [...lanes].reverse().find((l) => l.times[n.slot!] !== undefined) : undefined;
      el.querySelector(".pl-last")!.textContent = last ? fmt(last.times[n.slot!]) : "";
      if (n.id === "wonder") {
        const tool = [...lanes].reverse().find((l) => l.phase === "running" && l.node === "wonder")?.tool;
        for (const t of el.querySelectorAll<HTMLElement>("[data-tool]")) t.classList.toggle("hot", running > 0 && t.dataset.tool === tool);
      }
    }
    laneBox.replaceChildren(...lanes.slice(-MAX_LANES).map(laneEl));
    if (open && (lanes.some((l) => l.phase === "running") || [...flash.values()].some((t) => t > now))) {
      if (!ticker) ticker = window.setInterval(paint, 150);
    } else if (ticker) { window.clearInterval(ticker); ticker = 0; }
  }

  function laneEl(l: Lane): HTMLElement {
    const el = document.createElement("div");
    el.className = "pl-lane";
    el.dataset.phase = l.phase;
    const title = document.createElement("div");
    title.className = "pl-lane-cmd";
    title.textContent = l.command;
    const segs = document.createElement("div");
    segs.className = "pl-segs";
    const now = performance.now();
    for (const slot of ["route", "write", "compile", "verify"] as Slot[]) {
      const seg = document.createElement("div");
      const ms = l.times[slot];
      const active = l.phase === "running" && l.slot === slot;
      seg.className = `pl-seg${active ? " active" : ms !== undefined ? " done" : ""}${slot === "verify" && l.rejected ? " rejected" : ""}`;
      seg.innerHTML = `<span>${SLOT_LABEL[slot]}</span><b>${active ? fmt(now - l.lastAt + (ms ?? 0)) : fmt(ms)}</b>`;
      segs.appendChild(seg);
    }
    const out = document.createElement("div");
    out.className = "pl-lane-out";
    out.textContent = l.phase === "running" ? fmt(now - l.startedAt) : l.phase === "landed" ? `${l.rejected ? "fixed + " : ""}live · ${fmt(l.total ?? l.lastAt - l.startedAt)}` : l.phase === "failed" ? "rolled back" : fmt(l.total);
    el.append(title, segs, out);
    if (l.steps.length > 0) {
      const box = document.createElement("div");
      box.className = "pl-steps";
      const row = document.createElement("div");
      row.className = "pl-chain";
      for (const c of chain(l.steps)) {
        const chip = document.createElement("span");
        chip.className = `pl-chip ${c.kind}`;
        chip.textContent = c.label;
        row.appendChild(chip);
      }
      box.appendChild(row);
      for (const s of l.steps) {
        const d = document.createElement("div");
        d.className = `pl-step${s.ok ? "" : " bad"}`;
        d.textContent = stepLine(s);
        box.appendChild(d);
      }
      el.appendChild(box);
    }
    return el;
  }

  function laneFor(command: string): Lane {
    let l = [...lanes].reverse().find((x) => x.command === command && x.phase === "running");
    if (!l) {
      const now = performance.now();
      l = { command, node: "spark", phase: "running", times: {}, startedAt: now, lastAt: now, slot: "route", rejected: false, counted: false, steps: [] };
      lanes.push(l);
      if (lanes.length > 24) lanes.shift();
    }
    return l;
  }

  function settle(l: Lane, phase: Phase): void {
    if (l.phase !== "running") return;
    l.phase = phase;
    if ((phase === "landed" || phase === "failed") && !l.counted) {
      l.counted = true;
      counters.builds++;
      if (phase === "landed") counters.landed++;
      if (phase === "landed" && l.rejected) counters.fixed++;
      try { localStorage.setItem("metabuild.pipeline", JSON.stringify(counters)); } catch { /* per-viewer extra only */ }
    }
  }

  const lit = (id: NodeId) => { flash.set(id, performance.now() + FLASH_MS); };

  function onMsg(msg: ServerMsg): void {
    const now = performance.now();
    if (msg.kind === "transcript") lit("voice");
    else if (msg.kind === "routed") {
      // Name the model that actually answered on the Spark node (open weights or hosted).
      nodeEls.get("spark")!.querySelector(".pl-model")!.textContent = msg.open ? `${msg.model} (open weights)` : msg.model;
    }
    else if (msg.kind === "agentStep") {
      const l = laneFor(msg.command);
      l.steps.push(msg);
      l.tool = msg.tool;
      lit("wonder");
    }
    else if (msg.kind === "art") lit("image");
    else if (msg.kind === "segment") lit("sam");
    else if (msg.kind === "mod" && (msg.mod.art || msg.mod.artPending)) lit("image");
    else if (msg.kind === "stage" && msg.command) {
      const l = laneFor(msg.command);
      if (l.node === "spark" && msg.stage === "routing" && Object.keys(l.times).length === 0) lit("voice");
      // The time since the last event belongs to the stage the build was just in.
      l.times[l.slot] = (l.times[l.slot] ?? 0) + (now - l.lastAt);
      l.lastAt = now;
      l.node = STAGE_NODE[msg.stage] ?? l.node;
      l.slot = STAGE_SLOT[msg.stage] ?? l.slot;
      if (msg.stage === "rejected") l.rejected = true;
      if (msg.stage === "writing") l.tool = /look/.test(msg.detail) ? "inspect_world" : /playtest/.test(msg.detail) ? "run_playtest" : l.tool;
      if (msg.stage === "done") settle(l, "landed");
      else if (msg.stage === "failed") settle(l, "failed");
      lit(l.node);
    } else if (msg.kind === "timing") {
      const l = [...lanes].reverse().find((x) => x.command === msg.command);
      if (l) {
        // The server's own measurements replace the client-side estimates.
        const t = msg.ms;
        l.times = { ...(t.route ? { route: t.route } : {}), ...(t.write ? { write: t.write } : {}), ...(t.compile ? { compile: t.compile } : {}), ...(t.verify ? { verify: t.verify } : {}) };
        l.total = t.total;
        settle(l, "other"); // tweaks, undo and questions end here without landing a mod
      }
    }
    // A build that just settled moved the impact numbers: re-read the log now (ADR 0027),
    // not on the next 20 s poll. Coalesced and skipped while the panel is off screen.
    if (isLiveBuildMsg(msg)) statsPanel.refreshSoon();
    paint();
  }

  function toggle(force?: boolean): void {
    open = force ?? !open;
    root.hidden = !open;
    btn.classList.toggle("on", open);
    if (open) {
      paint();
      statsPanel.refresh();
    }
  }

  btn.addEventListener("click", () => toggle());
  addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.code === "KeyP" && !e.ctrlKey && !e.metaKey && !e.altKey) toggle();
    else if (e.code === "Escape" && open) toggle(false);
  });
  paint();
  const codeEl = root.querySelector<HTMLElement>(".pl-code")!;
  function setCode(lines: string[], partial: string, active: boolean): void {
    codeEl.classList.toggle("live", active);
    if (!open) return;
    codeEl.textContent = [...lines.slice(-7), partial].join("\n");
  }
  return { onMsg, toggle, setCode };
}
