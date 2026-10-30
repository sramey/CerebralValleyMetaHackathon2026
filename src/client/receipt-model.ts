// "How was this made?" (ADR 0065): the receipt as a list of steps, one per link in the chain
// from your words to a playable mod. Pure (no DOM), so the wording is pinned by tests and the
// panel in receipt.ts only draws it.
import type { BuildReceipt } from "../contract";

export type StepTone = "you" | "model" | "rejected" | "proof" | "art" | "live" | "note";

export interface ReceiptCheck { text: string; ok: boolean }

export interface ReceiptStep {
  tone: StepTone;
  /** Short heading: what happened. */
  title: string;
  /** Who did it: a Meta model name, the engine, or you. */
  by: string;
  /** Plain detail lines under the heading. */
  lines: string[];
  /** Pass/fail rows (the proof). */
  checks?: ReceiptCheck[];
  /** Code shown on demand (collapsed). */
  code?: { label: string; text: string };
  /** Seconds, when this step has its own time. */
  secs?: number;
}

const secs = (ms: number | undefined): number | undefined => (ms === undefined || !Number.isFinite(ms) || ms <= 0 ? undefined : Math.round(ms / 100) / 10);

/** Lines only in `b` and only in `a`, counted as multisets (a cheap diff summary, not an alignment). */
export function lineDelta(a: string, b: string): { added: number; removed: number } {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n").map((x) => x.trim()).filter(Boolean)) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  let added = 0;
  let removed = 0;
  for (const [l, n] of cb) added += Math.max(0, n - (ca.get(l) ?? 0));
  for (const [l, n] of ca) removed += Math.max(0, n - (cb.get(l) ?? 0));
  return { added, removed };
}

/** A verifier error as one plain sentence plus the technical detail, when it has both
 *  ("playtest: <plain> (<detail>)" from the playtest bot). */
export function splitReason(err: string): { plain: string; detail: string } {
  const m = /^playtest:\s*([\s\S]*?)\s*\(([\s\S]*)\)?\s*$/.exec(err);
  if (m && m[2]) return { plain: `Playtest: ${m[1]}`, detail: m[2].replace(/\)$/, "") };
  return { plain: err.replace(/^playtest:\s*/, "Playtest: "), detail: "" };
}

/** One line for the fix step: how much of the draft changed, then the re-run. */
export function fixLine(d: { added: number; removed: number }): string {
  const n = Math.max(d.added, d.removed);
  if (n === 0) return "Kept the code, re-ran the playtest, and it passed";
  return `Changed ${n} line${n === 1 ? "" : "s"} (+${d.added} −${d.removed}), re-ran the playtest, and it passed`;
}

const MODEL_NAMES: Record<string, string> = {
  "muse-spark-1.2": "Muse Spark",
  "muse-wonder-1.0": "Muse Wonder",
  "muse-image-1.0": "Muse Image",
};

/** A friendly name for a model id; open-weights routers say so. */
export function modelName(id: string, open = false): string {
  if (open) return `Muse Spark Open (open weights)`;
  return MODEL_NAMES[id] ?? id;
}

const ORIGIN_NOTE: Record<Exclude<BuildReceipt["origin"], "ai">, string> = {
  builtin: "A hand-written sample that ships with the engine, not AI-built. Its own test still runs.",
  loaded: "No build record in this session: it came from a shared world, a sketch, a photo or an earlier session. Its code and test are below.",
};

export function receiptSteps(r: BuildReceipt): ReceiptStep[] {
  const steps: ReceiptStep[] = [];
  const live = r.versions[r.versions.length - 1]?.source ?? "";
  const loc = live.split("\n").filter((l) => l.trim()).length;

  if (r.origin !== "ai") {
    steps.push({ tone: "note", title: r.origin === "builtin" ? "Built into the engine" : "Loaded, not built here", by: "engine", lines: [ORIGIN_NOTE[r.origin]] });
  }

  if (r.command) steps.push({ tone: "you", title: "You asked", by: "you", lines: [`“${r.command}”`] });

  if (r.route) {
    const lines = [`Decided: ${r.route.action === "edit" ? "change something that exists" : r.route.action === "new" ? "build something new" : r.route.action}${r.route.visual ? ` · looks like a ${r.route.visual}` : ""}`];
    if (r.route.fellBack) lines.push("The open-weights router missed its deadline, so hosted Spark answered.");
    if (r.route.rules.length > 0) lines.push(`Checked by ${r.route.rules.length} deterministic route rule${r.route.rules.length === 1 ? "" : "s"}`);
    steps.push({ tone: "model", title: "Routed", by: modelName(r.route.model, r.route.open), lines, secs: secs(r.route.ms) });
  }

  if (r.origin === "ai") {
    const tools = r.agent?.tools ?? [];
    const lines = [`${loc} lines of TypeScript against the mod API`];
    if (tools.length > 0) lines.push(`Agent tool calls: ${tools.map((t) => `${t.name}${t.ok === false ? " ✗" : t.ok === true ? " ✓" : ""}`).join(" → ")}`);
    steps.push({ tone: "model", title: r.versions.length > 1 ? "Wrote a first draft" : "Wrote the code", by: "Muse Wonder", lines, code: { label: "Show the code", text: r.versions.length > 1 ? r.versions[0].source : live }, secs: secs(r.timings?.write) });
  }

  if (r.versions.length > 1) {
    const away = r.versions.slice(0, -1);
    const reasons = away.flatMap((v) => v.rejected ?? []).map(splitReason);
    const why = [...new Set(reasons.map((x) => x.plain))];
    const detail = [...new Set(reasons.map((x) => x.detail).filter(Boolean))].join("\n\n");
    const d = lineDelta(away[away.length - 1].source, live);
    const title = away.length === 1 ? "Rejected before you ever saw it" : `${away.length} drafts rejected before you ever saw one`;
    steps.push({ tone: "rejected", title, by: "verifier", lines: why.length > 0 ? why : ["The draft failed verification."], ...(detail ? { code: { label: "Show what the playtest bot saw", text: detail } } : {}) });
    steps.push({ tone: "model", title: "Fixed itself", by: "Muse Wonder (agent)", lines: [fixLine(d)], code: { label: "Show the fixed code", text: live } });
  }

  const checks: ReceiptCheck[] = [];
  if (r.origin === "ai") {
    const p = r.proof;
    checks.push({ text: "Compiled with esbuild: no eval, DOM or network calls, and every loop guarded", ok: true });
    checks.push({ text: `Ran ${p.healthFrames} frames headless: no crash, no NaN, ${p.msPerFrame > 0 ? `${p.msPerFrame.toFixed(3)} ms/frame` : "inside"} (budget ${p.msBudget} ms)`, ok: true });
  }
  for (const c of r.test?.checks ?? []) checks.push({ text: `Its own test: ${c}`, ok: true });
  if (r.origin === "ai") {
    checks.push({ text: "dispose() removed everything it made (undo is clean)", ok: true });
    checks.push({ text: r.proof.playtests > 0 ? `Playtest bot played a copy of your world on ${r.proof.playtestSeeds} seeds: you can still play` : "Playtest bot: no player in the world yet, so nothing to block", ok: true });
  }
  if (checks.length > 0 || r.test) {
    steps.push({
      tone: "proof",
      title: r.origin === "ai" ? "Proved before it loaded" : "Its test",
      by: "verifier",
      lines: r.test ? [] : ["This mod has no test() of its own."],
      checks,
      ...(r.test ? { code: { label: "Show the test", text: r.test.source } } : {}),
      secs: secs(r.timings ? r.timings.compile + r.timings.verify : undefined),
    });
  }

  const a = r.art;
  if (a && a.state !== "none") {
    if (a.state === "code-drawn") {
      steps.push({ tone: "art", title: "Drawn in code", by: "engine", lines: ["A shape or effect the engine draws itself: no image call, no wait."] });
    } else {
      const lines = [`Subject: ${a.subject}`];
      lines.push(a.state === "drawing" ? "Still drawing: a digitize placeholder stands in until the sheet lands." : a.state === "cached" ? "Reused a sheet drawn earlier for the same subject." : "One sprite sheet on a magenta background, cut out and sliced into frames in your browser.");
      steps.push({ tone: "art", title: a.state === "drawing" ? "Drawing the art" : "Drew the art", by: modelName(a.model), lines, ...(a.prompt ? { code: { label: "Show the image prompt", text: a.prompt } } : {}), secs: secs(a.ms) });
    }
  }

  if (r.origin === "ai" && r.timings) {
    steps.push({ tone: "live", title: "Hot-loaded while you played", by: "engine", lines: [`No restart. ${r.proof.fixed ? "Fixed and verified" : "Verified"} in ${(r.timings.total / 1000).toFixed(1)} s from your words.`] });
  }

  if (r.review) {
    const rev = r.review;
    const by = modelName(rev.model, true);
    const title = rev.verdict === "fix"
      ? (rev.accepted ? "Reviewed & improved (open weights)" : "Reviewed (patch rejected)")
      : "Reviewed (open weights)";
    const lines: string[] = [];
    if (rev.issues.length > 0) {
      for (const iss of rev.issues) {
        lines.push(rev.accepted ? "Fixed: " + iss : "Issue: " + iss);
      }
    } else {
      lines.push("No bugs or issues found: clean mod.");
    }
    if (rev.accepted) {
      lines.push("Verified and hot-swapped into the live world.");
    }
    steps.push({
      tone: rev.accepted ? "live" : "model",
      title,
      by,
      lines,
      secs: secs(rev.ms),
    });
  }
  return steps;
}

/** Time bar segments (route, write, compile + verify), as fractions of the total. */
export function timeSegments(t: NonNullable<BuildReceipt["timings"]>): { label: string; ms: number; frac: number }[] {
  const parts = [
    { label: "route", ms: t.route },
    { label: "write", ms: t.write },
    { label: "verify", ms: t.compile + t.verify },
  ].filter((p) => p.ms > 0);
  const sum = parts.reduce((n, p) => n + p.ms, 0) || 1;
  return parts.map((p) => ({ ...p, frac: p.ms / sum }));
}
