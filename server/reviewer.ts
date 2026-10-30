// Open-weights build reviewer (ADR 0068). Muse Spark Open on Baseten reviews
// full Wonder generations asynchronously after they land and are live.
// If it finds real bugs or improvements and provides a valid patch that passes
// the exact compile + verify + playtest gates, it hot-swaps the mod in and
// turns the accepted fix into a learned rule via server/learn.ts.
import type { WebSocket } from "ws";
import type { BuildReceipt, KnobDefs, Look, ModDefinition, ServerMsg } from "../src/contract";
import { compileMod } from "./compile";
import { logReview } from "./createlog";
import { learnRuleFromReview } from "./learn";
import { diffHunks } from "./line-diff";
import { forceModId } from "./modid";
import { playtestMod, type PlaytestWorldMod } from "./playtest";
import { openChat, openConfig, type OpenConfig } from "./router-model";
import { verifyMod } from "./verify";
import { REVIEWER_SYSTEM } from "./reviewer-prompt";

export { REVIEWER_SYSTEM };

export function buildReviewerPrompt(command: string, source: string, playtest?: { ok: boolean; msPerFrame?: number; plain?: string }): string {
  const ptInfo = playtest
    ? `Verifier/Playtest: ok=${playtest.ok}, msPerFrame=${playtest.msPerFrame !== undefined ? playtest.msPerFrame.toFixed(3) : "n/a"}${playtest.plain ? ` (${playtest.plain})` : ""}`
    : "Verifier/Playtest: ok";
  return `Command: "${command}"\n${ptInfo}\n\nMod Source:\n\`\`\`ts\n${source}\n\`\`\``;
}

export interface ReviewParsed {
  verdict: "ok" | "fix";
  issues: string[];
  patchedSource?: string;
}

export function parseReviewJson(raw: string): ReviewParsed | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    const verdict = obj.verdict === "fix" ? "fix" : obj.verdict === "ok" ? "ok" : null;
    if (!verdict) return null;
    const issues = Array.isArray(obj.issues)
      ? obj.issues.filter((i: unknown): i is string => typeof i === "string" && Boolean(i.trim())).map((i) => i.trim())
      : [];
    const patchedSource = typeof obj.patchedSource === "string" && obj.patchedSource.trim() ? obj.patchedSource.trim() : undefined;
    return { verdict, issues, ...(patchedSource ? { patchedSource } : {}) };
  } catch {
    return null;
  }
}

export interface ReviewableMod {
  id: string;
  title: string;
  source: string;
  compiled: string;
  knobs: KnobDefs;
  art?: { key: string; url: string; scenery?: boolean };
  look?: Look;
  receipt?: BuildReceipt;
}

export interface BuildReviewInput {
  ws?: WebSocket;
  command: string;
  mod: ReviewableMod;
  playtest?: { ok: boolean; msPerFrame?: number; plain?: string };
  worldMods?: () => PlaytestWorldMod[];
  send?: (ws: WebSocket, msg: ServerMsg) => void;
}

export interface BuildReviewOutcome {
  skipped?: "off" | "no-key" | "already-reviewed";
  verdict?: "ok" | "fix";
  issues?: string[];
  accepted?: boolean;
  error?: string;
  ms?: number;
}

const reviewedMods = new WeakSet<ReviewableMod>();
const reviewedIds = new Set<string>();

/** Clear review tracking (used by tests). */
export function resetReviewTracking(): void {
  reviewedIds.clear();
}

/**
 * Review a live build with Muse Spark Open on Baseten.
 * Async, never throws, and never alters the live world unless a fix passes all gates.
 */
export async function reviewBuild(input: BuildReviewInput): Promise<BuildReviewOutcome> {
  // 1. Kill switch
  if (process.env.REVIEWER === "off") {
    return { skipped: "off" };
  }

  // 2. Open-weights config
  const cfg = openConfig();
  if (!cfg) {
    return { skipped: "no-key" };
  }

  // 3. Cap at one review per build
  const buildKey = `${input.mod.id}:${input.command}`;
  if (reviewedMods.has(input.mod) || reviewedIds.has(buildKey)) {
    return { skipped: "already-reviewed" };
  }
  reviewedMods.add(input.mod);
  reviewedIds.add(buildKey);

  // 4. Call open-weights endpoint
  const timeoutMs = Number(process.env.REVIEWER_TIMEOUT_MS) || Math.max(cfg.timeoutMs, 25000);
  const openCfg: OpenConfig = { ...cfg, timeoutMs };
  const messages = [
    { role: "system" as const, content: REVIEWER_SYSTEM },
    { role: "user" as const, content: buildReviewerPrompt(input.command, input.mod.source, input.playtest) },
  ];

  const t0 = performance.now();
  let rawText = "";
  try {
    const res = await openChat(openCfg, messages, 5000);
    rawText = res.text;
  } catch (err) {
    console.log(`[reviewer] open weights call failed/timed out: ${err instanceof Error ? err.message : String(err)}`);
    return { error: String(err) };
  }
  const callMs = Math.round(performance.now() - t0);

  // 5. Parse response JSON
  const parsed = parseReviewJson(rawText);
  if (!parsed) {
    console.log("[reviewer] bad JSON reply from open-weights reviewer");
    return { error: "bad json" };
  }

  const modelSlug = cfg.model;

  // 6. Verdict: ok
  if (parsed.verdict === "ok" || !parsed.patchedSource || parsed.patchedSource.trim() === input.mod.source.trim()) {
    logReview({
      modId: input.mod.id,
      command: input.command,
      model: modelSlug,
      verdict: "ok",
      issues: [],
      accepted: false,
      ms: callMs,
    });
    if (input.mod.receipt) {
      input.mod.receipt.review = {
        model: modelSlug,
        verdict: "ok",
        issues: [],
        accepted: false,
        ms: callMs,
      };
    }
    return { verdict: "ok", issues: [], accepted: false, ms: callMs };
  }

  // 7. Verdict: fix -> run compile, verify, and playtest gates
  const cleanPatched = forceModId(parsed.patchedSource, input.mod.id);
  const compiled = compileMod(cleanPatched);
  let accepted = false;
  let verifiedDef: ModDefinition | undefined;

  if (compiled.ok) {
    const verified = await verifyMod(cleanPatched, compiled.js);
    if (verified.ok && verified.def) {
      verifiedDef = verified.def;
      const world = input.worldMods ? input.worldMods() : [];
      const pt = await playtestMod(world, { def: verified.def, replaces: input.mod.id });
      if (pt.ok) {
        accepted = true;
      } else {
        console.log(`[reviewer] playtest gate failed on patch: ${pt.plain}`);
      }
    } else {
      console.log(`[reviewer] verify gate failed on patch: ${verified.errors.join("; ")}`);
    }
  } else {
    console.log(`[reviewer] compile gate failed on patch: ${compiled.errors.join("; ")}`);
  }

  // 8. Learn a rule from each accepted issue (step 10 used to), then update receipt and log
  const taught: string[] = [];
  if (accepted) {
    for (const issue of parsed.issues) {
      const rule = learnRuleFromReview(input.mod.id, issue, input.command, "wonder");
      if (rule) taught.push(rule.rule);
    }
  }
  if (input.mod.receipt) {
    input.mod.receipt.review = {
      model: modelSlug,
      verdict: "fix",
      issues: parsed.issues,
      accepted,
      ms: callMs,
    };
  }
  logReview({
    modId: input.mod.id,
    command: input.command,
    model: modelSlug,
    verdict: "fix",
    issues: parsed.issues,
    accepted,
    ms: callMs,
    diff: diffHunks(input.mod.source, cleanPatched),
    rules: accepted ? taught : undefined,
  });

  if (!accepted) {
    return { verdict: "fix", issues: parsed.issues, accepted: false, ms: callMs };
  }

  // 9. Hot-swap the accepted patch
  input.mod.source = cleanPatched;
  input.mod.compiled = compiled.js;
  if (verifiedDef?.knobs) input.mod.knobs = verifiedDef.knobs;

  if (input.ws && input.send) {
    input.send(input.ws, {
      kind: "mod",
      mod: {
        id: input.mod.id,
        title: input.mod.title,
        source: input.mod.source,
        compiled: input.mod.compiled,
        knobs: input.mod.knobs,
        ...(input.mod.art ? { art: input.mod.art } : {}),
        ...(input.mod.look ? { look: input.mod.look } : {}),
      },
    });

    const fixedNote = parsed.issues[0] ?? "detected issue";
    input.send(input.ws, {
      kind: "say",
      text: `Reviewed by Muse Spark Open (open weights): fixed ${fixedNote}`,
    });
  }

  return { verdict: "fix", issues: parsed.issues, accepted: true, ms: callMs };
}

/**
 * Queue a review asynchronously after the build is delivered to the player.
 * Never blocks, never slows the build, and errors are safely caught.
 */
export function queueBuildReview(input: BuildReviewInput): void {
  setImmediate(() => {
    reviewBuild(input).catch((err) => {
      console.log(`[reviewer] unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}
