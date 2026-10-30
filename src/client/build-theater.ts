// Build theater (ADR 0022): while a build runs, the code Wonder is writing scrolls
// behind the stage as a translucent, gradient-faded stream, and a small stepper
// pops each stage (Route, Forge, Compile, Playtest, Live) as the build clears it.
// Text arrives in bursts, so it is paced out at a steady rate that speeds up when
// the backlog grows and flushes when the build ends. window.preview_idle_fx()
// replays a canned build through the same path for review without any API calls.
import "./build-theater.css";
import type { ServerMsg } from "../contract";
import { chain } from "./agent-steps";
import type { AgentStepMsg } from "./agent-steps";

const STEPS = ["Route", "Forge", "Compile", "Playtest", "Live"] as const;
const STAGE_STEP: Record<string, number> = { routing: 0, writing: 1, fixing: 1, compiling: 2, verifying: 3, rejected: 3, done: 4 };
const MAX_LINES = 16;
const BASE_CPS = 110; // characters per second when there is no backlog
const LINGER_MS = 1800;

const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(export|default|const|let|function|return|if|else|for|of|new|true|false|null|undefined|import|type|as)\b|\b(\d+(?:\.\d+)?)\b/g;

/** Tint one finished line: comments, strings, keywords and numbers get their own class. */
function tint(line: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index! > last) frag.append(line.slice(last, m.index));
    const span = document.createElement("span");
    span.className = m[1] ? "bt-c" : m[2] ? "bt-s" : m[3] ? "bt-k" : "bt-n";
    span.textContent = m[0];
    frag.append(span);
    last = m.index! + m[0].length;
  }
  if (last < line.length) frag.append(line.slice(last));
  return frag;
}

export interface TheaterView { lines: string[]; partial: string; active: boolean }

export interface Theater {
  onMsg(msg: ServerMsg): void;
  /** Play a canned 6 s build through the same path (no server, no API credits). */
  preview(): void;
}

const PREVIEW_CODE = `export default {
  id: "ember-drake",
  title: "Ember Drake",
  knobs: { speed: { value: 90, min: 20, max: 240, label: "Wing speed" } },
  setup(api, knobs) {
    const drake = api.spawn({ type: "drake", x: 520, y: 180, w: 56, h: 40, gravityScale: 0, color: 0xe2483d });
    api.onTick(() => {
      const t = api.tick() / 60;
      drake.x = 520 + Math.sin(t) * 180;
      drake.y = 180 + Math.sin(t * 2.3) * 40;
      if (api.tick() % 45 === 0) api.burst(drake.x, drake.y, 0xffa73d, 8);
    });
  },
  dispose(api) { for (const e of api.byType("drake")) api.despawn(e.id); },
  test(t) { t.step(120); t.expect(t.api.byType("drake").length === 1, "the drake flies"); },
};`;

/**
 * @param host   the stage wrapper; the stream and stepper are absolutely positioned inside it.
 * @param sink   gets the paced text (finished lines + the line being typed) so other views, like the pipeline's Wonder node, can show the same stream.
 * @param feed   where preview() sends its canned messages; main routes them to every view.
 */
export function createTheater(host: HTMLElement, sink: (v: TheaterView) => void, feed: (msg: ServerMsg) => void): Theater {
  const stream = document.createElement("div");
  stream.className = "bt-stream";
  stream.setAttribute("aria-hidden", "true");

  const card = document.createElement("div");
  card.className = "bt-card";

  const head = document.createElement("div");
  head.className = "bt-head";

  const label = document.createElement("div");
  label.className = "bt-label";

  const status = document.createElement("div");
  status.className = "bt-status";

  const stepsEl = document.createElement("div");
  stepsEl.className = "bt-steps";

  const code = document.createElement("div");
  code.className = "bt-code";

  const tail = document.createElement("div");
  tail.className = "bt-line bt-tail";

  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.className = "bt-min-btn";
  minBtn.title = "Minimize / Expand code stream (or press Esc)";
  minBtn.textContent = "−";
  minBtn.setAttribute("aria-label", "Minimize code stream");
  minBtn.addEventListener("click", () => {
    const isMin = card.classList.toggle("minimized");
    minBtn.textContent = isMin ? "+" : "−";
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && stream.classList.contains("on") && !card.classList.contains("minimized")) {
      card.classList.add("minimized");
      minBtn.textContent = "+";
    }
  });
  head.append(label, status, stepsEl, minBtn);
  card.append(head, code);
  stream.append(card);
  host.appendChild(stream);

  const stepper = document.createElement("div");
  stepper.className = "bt-stepper";
  stepper.setAttribute("aria-hidden", "true");
  for (const name of STEPS) {
    const pip = document.createElement("div");
    pip.className = "bt-pip";
    pip.innerHTML = `<i></i><span>${name}</span>`;
    stepper.appendChild(pip);
  }
  host.appendChild(stepper);
  const pips = [...stepper.querySelectorAll<HTMLElement>(".bt-pip")];

  let buffer = ""; // received, not yet shown
  let lines: string[] = [];
  let partial = "";
  let focus = ""; // command whose stream is on screen
  let running = new Set<string>();
  let steps: AgentStepMsg[] = [];
  let currentDetail = "";
  let step = -1;
  let raf = 0;
  let last = 0;
  let owed = 0;
  let hideTimer = 0;
  let flushing = false;

  /** The card shows one lane at a time, so say which sub-build it is streaming. */
  const setFocusLabel = (command: string): void => { label.textContent = `code · ${command}`; };

  function show(active: boolean): void {
    stream.classList.toggle("on", active);
    stepper.classList.toggle("on", active);
  }

  function paintSteps(): void {
    stepsEl.replaceChildren();
    const chips = chain(steps);
    if (chips.length === 0 && (currentDetail.includes("writing") || currentDetail.includes("world") || currentDetail.includes("playtest"))) {
      const chip = document.createElement("span");
      chip.className = "bt-chip write active";
      chip.textContent = "write …";
      stepsEl.appendChild(chip);
    } else {
      for (const c of chips) {
        const chip = document.createElement("span");
        chip.className = `bt-chip ${c.kind}`;
        chip.textContent = c.label;
        stepsEl.appendChild(chip);
      }
    }
    if (currentDetail) {
      status.textContent = `Wonder · ${currentDetail}`;
    } else if (steps.length > 0) {
      const last = steps[steps.length - 1];
      status.textContent = `${last.tool} → ${last.result}`;
    } else {
      status.textContent = "";
    }
  }

  function paintLines(): void {
    code.replaceChildren(...lines.map((l) => { const d = document.createElement("div"); d.className = "bt-line"; d.append(tint(l)); return d; }));
    tail.textContent = partial;
    code.appendChild(tail);
    sink({ lines, partial, active: running.size > 0 || buffer.length > 0 });
  }

  function pump(now: number): void {
    raf = 0;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (buffer.length > 0) {
      // Steady typing, faster as the backlog grows; everything left when the build is over.
      const cps = flushing ? 4000 : BASE_CPS + buffer.length * 1.6;
      owed += cps * dt;
      const n = Math.min(buffer.length, Math.floor(owed));
      if (n > 0) {
        owed -= n;
        const piece = buffer.slice(0, n);
        buffer = buffer.slice(n);
        const parts = (partial + piece).split("\n");
        partial = parts.pop() ?? "";
        if (parts.length) {
          lines.push(...parts);
          if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
          paintLines();
        } else {
          tail.textContent = partial;
          sink({ lines, partial, active: true });
        }
      }
    }
    if (buffer.length > 0 || running.size > 0) raf = requestAnimationFrame(pump);
    else sink({ lines, partial, active: false });
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(pump); } };

  /** The build reached step `i`: everything before it is done, the one just cleared pops, `i` is now live. */
  function advance(i: number): void {
    pips.forEach((p, k) => { p.classList.toggle("done", k < i || (i === STEPS.length - 1 && k === i)); p.classList.toggle("now", k === i && i < STEPS.length - 1); });
    const cleared = i === STEPS.length - 1 ? i : i - 1;
    if (cleared >= 0) {
      pips[cleared].classList.remove("pop");
      void pips[cleared].offsetWidth; // restart the animation
      pips[cleared].classList.add("pop");
      spark(pips[cleared]);
    }
  }

  /** A few particles flying out of the pip that just completed. */
  function spark(pip: HTMLElement): void {
    const r = pip.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    for (let k = 0; k < 7; k++) {
      const p = document.createElement("b");
      p.className = "bt-spark";
      p.style.left = `${r.left - h.left + 12}px`;
      p.style.top = `${r.top - h.top + 12}px`;
      const a = (k / 7) * Math.PI * 2 + Math.random();
      p.style.setProperty("--dx", `${Math.cos(a) * 30}px`);
      p.style.setProperty("--dy", `${Math.sin(a) * 26 - 8}px`);
      host.appendChild(p);
      window.setTimeout(() => p.remove(), 700);
    }
  }

  function reset(): void {
    step = -1;
    for (const p of pips) p.classList.remove("done", "pop", "now");
    pips[0].classList.add("now");
  }

  function end(command: string): void {
    running.delete(command);
    if (running.size > 0) return;
    flushing = true;
    kick();
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      flushing = false;
      if (running.size === 0 && buffer.length === 0) {
        show(false);
        lines = [];
        partial = "";
        steps = [];
        currentDetail = "";
        paintLines();
        paintSteps();
      }
    }, LINGER_MS);
  }

  function begin(command: string): void {
    window.clearTimeout(hideTimer);
    flushing = false;
    if (running.size === 0) {
      reset();
      lines = [];
      partial = "";
      buffer = "";
      focus = command;
      setFocusLabel(command);
      steps = [];
      currentDetail = "routing your command";
      paintLines();
      paintSteps();
    }
    running.add(command);
    show(true);
    kick();
  }

  function onMsg(msg: ServerMsg): void {
    if (msg.kind === "stage" && msg.command) {
      if (!running.has(msg.command)) begin(msg.command);
      if (msg.command !== focus) {
        focus = msg.command;
        setFocusLabel(msg.command);
      }
      currentDetail = msg.detail || msg.stage;
      paintSteps();
      const i = STAGE_STEP[msg.stage];
      if (i !== undefined && i > step) { step = i; advance(i); }
      if (msg.stage === "done" || msg.stage === "failed") end(msg.command);
    } else if (msg.kind === "agentStep" && msg.command) {
      if (!running.has(msg.command)) begin(msg.command);
      if (msg.command !== focus) {
        focus = msg.command;
        setFocusLabel(msg.command);
      }
      steps.push(msg);
      currentDetail = msg.tool === "inspect_world" ? "looking at world" : msg.tool === "run_playtest" ? (msg.ok ? "playtest passed" : "playtest rejected") : `${msg.tool} done`;
      paintSteps();
    } else if (msg.kind === "codeStream") {
      if (!running.has(msg.command)) begin(msg.command);
      if (msg.command !== focus) {
        if (focus) buffer += `\n// ${msg.command}\n`;
        focus = msg.command;
        setFocusLabel(msg.command);
      }
      buffer += msg.text;
      kick();
    } else if (msg.kind === "timing") end(msg.command);
  }

  function preview(): void {
    const command = "preview: add an ember drake";
    const at = (ms: number, m: ServerMsg) => window.setTimeout(() => feed(m), ms);
    at(0, { kind: "stage", stage: "routing", detail: "routing your command", command });
    at(700, { kind: "stage", stage: "writing", detail: "looking at the world", command });
    at(850, { kind: "agentStep", command, phase: "write", n: 1, tool: "inspect_world", args: "{}", result: "1 mod, 1 player", ok: true, ms: 120 });
    at(1100, { kind: "stage", stage: "writing", detail: "writing the mod", command });
    for (let i = 0, t = 1200; i < PREVIEW_CODE.length; i += 38, t += 240) at(t, { kind: "codeStream", command, text: PREVIEW_CODE.slice(i, i + 38) });
    at(3800, { kind: "stage", stage: "writing", detail: "playtesting a draft", command });
    at(4100, { kind: "agentStep", command, phase: "write", n: 2, tool: "run_playtest", args: "source", result: "passed", ok: true, ms: 280 });
    at(4300, { kind: "stage", stage: "compiling", detail: "compiling the mod", command });
    at(4700, { kind: "stage", stage: "verifying", detail: "verifying the mod", command });
    at(5500, { kind: "stage", stage: "done", detail: "loaded ember-drake (600 frames OK)", command });
    at(5600, { kind: "timing", command, ms: { route: 700, write: 3400, compile: 4, verify: 800, total: 5600 } });
  }

  const api: Theater = { onMsg, preview };
  (window as unknown as { preview_idle_fx?: () => void }).preview_idle_fx = preview;
  return api;
}
