// "Double-check my world" (ADR 0078): a local command that runs the open-weights reviewer
// (ADR 0068) over every live AI-built mod, a few at a time, so the second opinion is visible
// on demand instead of only when a background review happens to find something. No router,
// no Wonder: the command is matched here, so it is instant and deterministic.
import type { WebSocket } from "ws";
import type { ServerMsg } from "../src/contract";
import { openConfig } from "./router-model";
import { reviewBuild, type BuildReviewInput, type BuildReviewOutcome, type ReviewableMod } from "./reviewer";

const SWEEP_RE = new RegExp(
  "^(?:(?:hey|ok|okay|please|can you|could you|would you|go)\\s+)*" +
  "(?:double[- ]?check|re[- ]?check|review|audit|check|look over|go over|test|scan|inspect)\\s+" +
  "(?:(?:all\\s+of\\s+)?(?:my|the|our|every|all)\\s+)?(?:whole\\s+|entire\\s+)?" +
  "(?:world|game|level|builds?|mods?|everything|stuff|things|creations?)" +
  "(?:\\s+(?:again|once more|for me))?" +
  "(?:\\s+(?:for|with|using|on)\\s+(?:any\\s+)?(?:bugs?|problems?|issues?|errors?|mistakes?|muse spark(?: open)?|open weights?|the (?:second|open[- ]weights?) (?:opinion|reviewer)))?" +
  "(?:\\s+(?:please|now))?$",
);

/** True for "double-check my world", "review my world", "check everything for bugs" and close phrasings. */
export function detectReviewSweep(text: string): boolean {
  const s = text.toLowerCase().replace(/[’']/g, "").replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > 0 && s.length < 90 && SWEEP_RE.test(s);
}

export type SweepOff = "off" | "no-key";

/** Why the sweep cannot run, or null when it can. */
export function sweepBlocked(): SweepOff | null {
  if (process.env.REVIEWER === "off") return "off";
  return openConfig() ? null : "no-key";
}

/** The orb's one-sentence explanation when the reviewer is not available. */
export function sweepOffReply(why: SweepOff): string {
  return why === "off"
    ? "The open-weights reviewer is switched off (REVIEWER=off). Remove that setting and restart the server to turn it back on."
    : "The open-weights reviewer is off: it needs a Baseten key. Put BASETEN_API_KEY in the server's .env file and restart, and Muse Spark Open will double-check every build.";
}

export interface SweepInput {
  ws: WebSocket;
  /** Candidate mods; only AI-built ones are reviewed. */
  mods: (ReviewableMod & { receipt?: { origin?: string; command?: string } })[];
  send: (ws: WebSocket, msg: ServerMsg) => void;
  worldMods?: BuildReviewInput["worldMods"];
  /** Injected in tests; defaults to the real open-weights review. */
  review?: (input: BuildReviewInput) => Promise<BuildReviewOutcome>;
  /** Reviews in flight at once. */
  parallel?: number;
  /** Most builds one sweep will review (the spend guard). */
  max?: number;
}

export interface SweepResult { reviewed: number; fixed: number; held: number; clean: number; failed: number; skipped: number; capped: number }

/** Environment override first, then the default. Always at least 1. */
function envInt(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Math.max(1, Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt);
}

/** Most builds reviewed per sweep, and sweeps per connection: the reviewer is a real model call each time. */
export const sweepMax = (): number => envInt("REVIEW_SWEEP_MAX", 6);
export const sweepsPerSession = (): number => envInt("REVIEW_SWEEPS_PER_SESSION", 5);

export function aiBuilt(mods: SweepInput["mods"]): SweepInput["mods"] {
  return mods.filter((m) => m.receipt?.origin === "ai");
}

/** Review every AI-built mod, `parallel` at a time, and report how it went. Never throws. */
export async function runReviewSweep(input: SweepInput): Promise<SweepResult> {
  const review = input.review ?? reviewBuild;
  const max = input.max ?? sweepMax();
  const all = aiBuilt(input.mods);
  const picked = all.slice(-max); // the newest builds are the ones on screen
  const result: SweepResult = { reviewed: 0, fixed: 0, held: 0, clean: 0, failed: 0, skipped: 0, capped: all.length - picked.length };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < picked.length) {
      const idx = next++;
      const mod = picked[idx];
      const out = await review({
        ws: input.ws,
        command: mod.receipt?.command ?? mod.title,
        mod,
        worldMods: input.worldMods,
        send: input.send,
        force: true,
        sweep: { n: idx + 1, of: picked.length },
      }).catch((): BuildReviewOutcome => ({ error: "unhandled" }));
      if (out.skipped) result.skipped++;
      else if (out.error) result.failed++;
      else {
        result.reviewed++;
        if (out.verdict === "ok") result.clean++;
        else if (out.accepted) result.fixed++;
        else result.held++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, input.parallel ?? 2), picked.length) }, worker));
  return result;
}

/** The orb's closing sentence. */
export function sweepSummary(r: SweepResult): string {
  if (r.reviewed === 0 && r.failed === 0) return "There are no AI-built mods to double-check yet. Build something, then ask again.";
  const parts = [`Muse Spark Open reviewed ${r.reviewed} build${r.reviewed === 1 ? "" : "s"}, fixed ${r.fixed}`];
  if (r.held > 0) parts.push(`${r.held} fix${r.held === 1 ? "" : "es"} held back by the verifier`);
  if (r.failed > 0) parts.push(`${r.failed} couldn't be reviewed`);
  if (r.capped > 0) parts.push(`${r.capped} older build${r.capped === 1 ? "" : "s"} skipped (limit)`);
  return parts.join("; ") + ".";
}
