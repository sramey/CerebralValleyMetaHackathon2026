// Impact numbers inside the pipeline overlay (ADR 0027): builds landed, first-try rate,
// auto-fix saves, median time to a playable change, and how many builds the log holds.
//
// Every number is fetched from `GET /api/stats`, which aggregates the game's own
// creation log (logs/builds.jsonl) with the same code `npm run stats` uses. Numbers
// only: the endpoint never sends a prompt, a mod title or a path. The panel is a view,
// never a source — when the endpoint is down it says so instead of inventing a figure.
import "./stats-panel.css";
import type { StatsFeed } from "../contract";

export interface StatsPanel {
  /** The strip to insert into the pipeline overlay. */
  element: HTMLElement;
  /** Fetch fresh numbers. Called whenever the overlay opens; also polls while visible. */
  refresh(): void;
}

/** Dev: the page is on Vite's port, the log endpoint on the game server's (VITE_WS_URL). Production: one port (ADR 0014). */
function apiBase(): string {
  if (!import.meta.env.DEV) return "";
  const ws = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://127.0.0.1:8787";
  try {
    const u = new URL(ws);
    return `${u.protocol === "wss:" ? "https:" : "http:"}//${u.host}`;
  } catch {
    return "";
  }
}

const POLL_MS = 20_000;
const TIMEOUT_MS = 5_000;

const pct = (v: number | null): string => (v === null ? "–" : `${Math.round(v * 100)}%`);
const num = (v: number): string => String(v);
const msText = (v: number | null): string =>
  v === null ? "–" : v < 950 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;

const TILES = [
  { key: "landed", label: "builds landed" },
  { key: "first", label: "landed first try" },
  { key: "fix", label: "auto-fix saves" },
  { key: "median", label: "median build" },
  { key: "total", label: "builds logged" },
] as const;

// Wonder's autonomy (ADR 0033): what the agent did on its own, from the same log.
const AUTO_TILES = [
  { key: "calls", label: "tool calls / build" },
  { key: "selfFix", label: "self-corrected" },
  { key: "playtests", label: "playtests run" },
] as const;

export function createStatsPanel(): StatsPanel {
  const root = document.createElement("section");
  root.className = "st-panel";
  root.setAttribute("aria-label", "Build impact numbers from this machine's build log");
  root.innerHTML = `
    <div class="st-head">
      <span class="st-kicker">Impact, measured in the app</span>
      <span class="st-note" data-note>reading the build log…</span>
    </div>
    <div class="st-tiles">
      ${TILES.map((t) => `<div class="st-tile" data-k="${t.key}"><b data-big>–</b><span>${t.label}</span><i data-sub></i></div>`).join("")}
    </div>
    <div class="st-tiles st-auto">
      ${AUTO_TILES.map((t) => `<div class="st-tile" data-k="${t.key}"><b data-big>–</b><span>${t.label}</span><i data-sub></i></div>`).join("")}
    </div>`;

  const big = (key: string) => root.querySelector<HTMLElement>(`[data-k="${key}"] [data-big]`)!;
  const sub = (key: string) => root.querySelector<HTMLElement>(`[data-k="${key}"] [data-sub]`)!;
  const note = root.querySelector<HTMLElement>("[data-note]")!;

  let timer = 0;
  let inflight: AbortController | null = null;

  function render(feed: StatsFeed): void {
    const b = feed.builds;
    big("landed").textContent = pct(b.landedPct);
    sub("landed").textContent = b.attempts > 0 ? `${b.landed} of ${b.attempts} attempts` : "no builds attempted yet";
    big("first").textContent = pct(b.firstPassPct);
    sub("first").textContent = b.landed > 0 ? `${b.firstPass} of ${b.landed} landed` : "waiting for the first landing";
    big("fix").textContent = num(b.fixSaves);
    sub("fix").textContent = b.fixAttempts > 0 ? `${b.fixSaves} of ${b.fixAttempts} fix rounds` : "no fix round needed yet";
    big("median").textContent = msText(b.medianMs);
    sub("median").textContent = b.p90Ms === null ? "" : `p90 ${msText(b.p90Ms)}`;
    big("total").textContent = num(b.total);
    sub("total").textContent = feed.window.days > 0 ? `${feed.lines} log lines · ${feed.window.days} day${feed.window.days === 1 ? "" : "s"}` : `${feed.lines} log lines`;
    const a = feed.agent;
    big("calls").textContent = a.callsPerBuild === null ? "–" : String(a.callsPerBuild);
    sub("calls").textContent = a.builds > 0 ? `over ${a.builds} agent build${a.builds === 1 ? "" : "s"}` : "no agent builds yet";
    big("selfFix").textContent = pct(a.selfCorrectedPct);
    sub("selfFix").textContent = a.selfCorrected > 0 ? `${a.selfCorrected} landed after a rejection` : "none needed a correction yet";
    big("playtests").textContent = num(a.playtests);
    sub("playtests").textContent = a.playtests > 0 ? `${a.rejected} said no, Wonder fixed them` : "Wonder has not playtested yet";
    note.dataset.state = "ok";
    note.textContent = b.total === 0 ? "build log is empty — build something" : "source: this machine's build log (GET /api/stats)";
  }

  function fail(): void {
    note.dataset.state = "error";
    note.textContent = "stats endpoint offline — start the server (npm run server)";
  }

  async function load(): Promise<void> {
    inflight?.abort();
    const control = new AbortController();
    inflight = control;
    const stop = window.setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${apiBase()}/api/stats`, { cache: "no-store", signal: control.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StatsFeed;
      if (!data || typeof data !== "object" || typeof data.builds?.total !== "number") throw new Error("bad shape");
      render(data);
    } catch {
      if (control.signal.aborted && inflight !== control) return; // superseded by a newer request
      fail();
    } finally {
      window.clearTimeout(stop);
      if (inflight === control) inflight = null;
    }
  }

  /** Poll only while the overlay is actually on screen (a hidden panel has zero width). */
  function tick(): void {
    if (root.clientWidth > 0 && document.visibilityState === "visible") void load();
  }

  return {
    element: root,
    refresh() {
      void load();
      if (!timer) timer = window.setInterval(tick, POLL_MS);
    },
  };
}
