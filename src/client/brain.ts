// "What it has learned" (ADR 0069): a full-stage area that shows how the open-weights
// reviewer is doing, each fix it made (with the changed lines and the rule it taught), and
// the rules and skills the game has learned. Every figure comes from `GET /api/brain`, which
// reads the game's own build log and learned/ folder; the view invents nothing.
//
// Live: while open it re-reads every few seconds, and a build that settles asks for a fresh
// read at once, so a review or rule that lands right after a build slides in on camera.
import "./brain.css";
import type { BrainFeed, BrainFix } from "../contract";
import { acceptedPct, dayLabel, fasterPct, fixKey, isBrainFeed, msText, newIds, ruleTimeline, SOURCE_LABEL, SUBSYSTEM_LABEL, speedBars } from "./brain-model";
import { isGameKeyEvent } from "./keys";
import { isLiveBuildMsg, MIN_REFRESH_GAP_MS } from "./stats-refresh";

export interface Brain {
  open(): void;
  close(): void;
  toggle(): void;
  /** Server messages: a settled build, or a say that mentions a review, asks for a fresh read. */
  onMsg(msg: { kind: string; stage?: string; text?: string }): void;
}

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

const POLL_MS = 4000;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function diffHtml(f: BrainFix): string {
  if (f.diff.length === 0) return `<div class="br-nodiff">patch not recorded</div>`;
  return `<pre class="br-diff" aria-label="Changed lines">${f.diff
    .map((h) => `<span class="br-at">@@ line ${h.at}</span>${h.del.map((l) => `<span class="br-del">- ${esc(l)}</span>`).join("")}${h.add.map((l) => `<span class="br-add">+ ${esc(l)}</span>`).join("")}`)
    .join("")}</pre>`;
}

function fixCard(f: BrainFix, fresh: boolean): string {
  const issue = f.issues[0] ?? "Improvement";
  const more = f.issues.length > 1 ? `<span class="br-more">+${f.issues.length - 1} more</span>` : "";
  const taught = f.rules.length
    ? `<div class="br-taught"><span>taught the game</span>${f.rules.map((r) => `<q>${esc(r)}</q>`).join("")}</div>`
    : f.accepted
      ? ""
      : `<div class="br-taught br-held"><span>held back</span><q>The patch failed a gate (compile, verify or playtest), so the live mod was left alone.</q></div>`;
  return `<article class="br-fix${fresh ? " new" : ""}" data-state="${f.accepted ? "accepted" : "rejected"}">
    <header><b>${esc(f.modId || "mod")}</b><span class="br-badge">${f.accepted ? "fix accepted" : "fix rejected"}</span><i>${msText(f.ms)} · ${dayLabel(f.ts)}</i></header>
    <p>${esc(issue)} ${more}</p>
    ${diffHtml(f)}
    ${taught}
  </article>`;
}

export function createBrain(host: HTMLElement): Brain {
  const root = document.createElement("section");
  root.id = "brain";
  root.hidden = true;
  root.setAttribute("aria-label", "What the game has learned");
  root.innerHTML = `
    <div class="br-head">
      <div>
        <div class="br-kicker">WHAT IT HAS LEARNED</div>
        <h2>A second model reviews every build, then teaches the game</h2>
      </div>
      <div class="br-head-r">
        <span class="br-ow" data-ow data-on="false"><i></i><span data-ow-text>checking…</span></span>
        <button type="button" class="br-close" aria-label="Close (Esc)">×</button>
      </div>
    </div>
    <div class="br-score" data-score></div>
    <div class="br-cols">
      <section class="br-col br-col-fixes"><h3>Fixes it found <span data-fix-count></span></h3><div class="br-scroll" data-fixes></div></section>
      <section class="br-col br-col-learn">
        <h3>Rules learned over time <span data-rule-count></span></h3>
        <div class="br-chips" data-chips></div>
        <div class="br-scroll br-timeline" data-timeline></div>
        <h3 class="br-skills-h">Skills library <span data-skill-count></span></h3>
        <div class="br-skills" data-skills></div>
      </section>
    </div>
    <div class="br-foot" data-foot>reading the build log…</div>`;
  host.appendChild(root);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  let isOpen = false;
  let timer = 0;
  let pending = 0;
  let lastStarted: number | null = null;
  let inflight: AbortController | null = null;
  let lastVersion = "";
  let seenFixes: Set<string> | null = null;
  let seenRules: Set<string> | null = null;
  let seenSkills: Set<string> | null = null;

  function score(f: BrainFeed): string {
    const s = f.scorecard;
    const pct = acceptedPct(f);
    const bars = speedBars(s.bench.hostedP50, s.bench.openP50);
    const faster = fasterPct(s.bench.openP50, s.bench.hostedP50);
    const accW = s.fixesFound > 0 ? (s.accepted / s.fixesFound) * 100 : 0;
    return `
      <div class="br-tile" data-k="reviews"><b>${s.reviews}</b><span>reviews run</span><i>${s.clean} clean · ${s.fixesFound} with a fix</i></div>
      <div class="br-tile" data-k="fixes"><b>${s.fixesFound}</b><span>fixes found</span>
        <div class="br-stack" title="accepted vs rejected"><em style="width:${accW}%"></em></div>
        <i>${s.accepted} accepted · ${s.rejected} rejected${pct === null ? "" : ` · ${pct}%`}</i></div>
      <div class="br-tile" data-k="lat"><b>${msText(s.avgMs)}</b><span>avg review time</span><i>${s.hostedRouteMs === null ? "open weights, after the build lands" : `hosted route median ${msText(s.hostedRouteMs)}`}</i></div>
      <div class="br-tile" data-k="auto"><b>${s.autoFixSaves}<small>/${s.autoFixAttempts}</small></b><span>verifier auto-fixes</span><i>hosted Wonder repairing its own draft</i></div>
      <div class="br-tile br-versus" data-k="vs"><span>router speed · open vs hosted <u>${s.bench.runs} runs</u></span>
        <div class="br-bar"><label>Muse Spark Open</label><div><em class="open" style="width:${bars.open}%"></em></div><b>${s.bench.openP50} ms</b></div>
        <div class="br-bar"><label>Muse Spark (hosted)</label><div><em class="hosted" style="width:${bars.hosted}%"></em></div><b>${s.bench.hostedP50} ms</b></div>
        <i>${faster === null ? "" : `${faster}% faster at p50, 100% valid replies on both (ADR 0032)`}</i></div>`;
  }

  function render(f: BrainFeed): void {
    const ow = q<HTMLElement>("[data-ow]");
    ow.dataset.on = String(f.openWeights.on);
    q("[data-ow-text]").textContent = f.openWeights.on ? `Muse Spark Open · on` : "open weights off";
    q("[data-score]").innerHTML = score(f);

    const fixKeys = f.fixes.map(fixKey);
    const freshFix = newIds(seenFixes, fixKeys);
    q("[data-fix-count]").textContent = f.fixes.length ? `· ${f.fixes.length}` : "";
    q("[data-fixes]").innerHTML = f.fixes.length
      ? f.fixes.map((x) => fixCard(x, freshFix.has(fixKey(x)))).join("")
      : `<div class="br-empty"><b>No fixes yet</b><p>${f.openWeights.on
          ? "Build something. The open-weights model reads each new mod right after it lands, and any bug it fixes shows up here with the changed lines."
          : "Open weights are off, so no review ran. The hosted verifier still gates every build; its history is in the scorecard and the rules."}</p></div>`;
    seenFixes = new Set(fixKeys);

    q("[data-chips]").innerHTML =
      Object.entries(f.counts.source).map(([k, n]) => `<span class="br-chip" data-src="${esc(k)}">${esc(SOURCE_LABEL[k] ?? k)} <b>${n}</b></span>`).join("") +
      Object.entries(f.counts.subsystem).map(([k, n]) => `<span class="br-chip br-sub" data-sub="${esc(k)}">${esc(SUBSYSTEM_LABEL[k] ?? k)} <b>${n}</b></span>`).join("");
    q("[data-rule-count]").textContent = f.rules.length ? `· ${f.rules.length}` : "";
    const freshRule = newIds(seenRules, f.rules.map((r) => r.id));
    q("[data-timeline]").innerHTML = f.rules.length
      ? ruleTimeline(f.rules).map((g) => `<div class="br-day">${esc(g.day)}</div>${g.rules.map((r) => `<div class="br-rule${freshRule.has(r.id) ? " new" : ""}" data-src="${esc(r.source)}"><i></i><div><span class="br-tag" data-sub="${esc(r.subsystem)}">${esc(SUBSYSTEM_LABEL[r.subsystem] ?? r.subsystem)}</span><span class="br-src">${esc(SOURCE_LABEL[r.source] ?? r.source)}</span><p>${esc(r.rule)}</p></div></div>`).join("")}`).join("")
      : `<div class="br-empty"><b>Nothing learned yet</b><p>Rules appear when you give feedback, when the verifier repairs a draft, or when a review fix passes every gate.</p></div>`;
    seenRules = new Set(f.rules.map((r) => r.id));

    const freshSkill = newIds(seenSkills, f.skills.map((s) => s.slug));
    q("[data-skill-count]").textContent = f.skills.length ? `· ${f.skills.length}` : "";
    q("[data-skills]").innerHTML = f.skills.length
      ? f.skills.map((s) => `<div class="br-skill${freshSkill.has(s.slug) ? " new" : ""}"><b>${esc(s.title)}</b><p>${esc(s.summary)}</p><div>${s.keywords.slice(0, 4).map((k) => `<span>${esc(k)}</span>`).join("")}</div></div>`).join("")
      : `<div class="br-empty"><p>No skills saved yet.</p></div>`;
    seenSkills = new Set(f.skills.map((s) => s.slug));

    q("[data-foot]").textContent = `${f.openWeights.note} Source: this machine's build log and learned/ folder (GET /api/brain).`;
    root.dataset.version = f.version;
  }

  async function load(): Promise<void> {
    inflight?.abort();
    const control = new AbortController();
    inflight = control;
    lastStarted = Date.now();
    const stop = window.setTimeout(() => control.abort(), 5000);
    try {
      const res = await fetch(`${apiBase()}/api/brain`, { cache: "no-store", signal: control.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (!isBrainFeed(data)) throw new Error("bad shape");
      if (data.version !== lastVersion) { lastVersion = data.version; render(data); }
    } catch {
      if (inflight === control && !control.signal.aborted) q("[data-foot]").textContent = "The server is offline. Start it with npm start to see what it has learned.";
    } finally {
      window.clearTimeout(stop);
      if (inflight === control) inflight = null;
    }
  }

  function schedule(wait: number): void {
    if (pending) return;
    pending = window.setTimeout(() => { pending = 0; void load(); }, Math.max(0, wait));
  }

  function setOpen(v: boolean): void {
    isOpen = v;
    root.hidden = !v;
    window.clearInterval(timer);
    if (v) {
      lastVersion = "";
      seenFixes = seenRules = seenSkills = null; // first paint flashes nothing
      void load();
      timer = window.setInterval(() => void load(), POLL_MS);
      q<HTMLButtonElement>(".br-close").focus({ preventScroll: true });
    }
  }

  q(".br-close").addEventListener("click", () => setOpen(false));
  addEventListener("keydown", (e) => {
    if (!isGameKeyEvent(e)) return;
    if (e.code === "Escape" && isOpen) setOpen(false);
  });

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen),
    onMsg(msg) {
      if (!isOpen) return;
      const review = msg.kind === "say" && typeof msg.text === "string" && /reviewed by/i.test(msg.text);
      if (isLiveBuildMsg(msg) || review) {
        const wait = lastStarted === null ? 0 : Math.max(0, lastStarted + MIN_REFRESH_GAP_MS - Date.now());
        schedule(review ? 0 : Math.max(wait, 600));
      }
    },
  };
}
