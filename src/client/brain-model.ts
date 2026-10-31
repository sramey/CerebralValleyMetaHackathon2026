// Pure helpers for the "What it has learned" area (ADR 0069): number text, the
// open-versus-hosted bars, and the rule timeline grouping. No DOM, so they are unit tested.
import type { BrainFeed, BrainRule } from "../contract";

export const msText = (v: number | null): string => (v === null ? "–" : v < 950 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);

/** "12%" faster / slower of `open` against `hosted`, or null when either is missing. */
export function fasterPct(open: number | null, hosted: number | null): number | null {
  if (open === null || hosted === null || hosted <= 0) return null;
  return Math.round(((hosted - open) / hosted) * 100);
}

/** Two bars scaled to the larger value, so the shorter one reads as the win. */
export function speedBars(hosted: number, open: number): { hosted: number; open: number } {
  const max = Math.max(hosted, open, 1);
  return { hosted: Math.round((hosted / max) * 100), open: Math.round((open / max) * 100) };
}

/** Share of reviewed fixes that passed every gate, 0..100, or null with no fixes. */
export function acceptedPct(f: BrainFeed): number | null {
  const s = f.scorecard;
  return s.fixesFound > 0 ? Math.round((s.accepted / s.fixesFound) * 100) : null;
}

export const SOURCE_LABEL: Record<string, string> = { feedback: "player feedback", autofix: "verifier auto-fix", review: "learned from open-weights review", seed: "starter rule" };
export const SUBSYSTEM_LABEL: Record<string, string> = { router: "Router", wonder: "Wonder", art: "Art" };

/** "Oct 29" in UTC, so a recording made at any hour shows the same day. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Rules newest first, with a day header whenever the day changes. */
export function ruleTimeline(rules: BrainRule[]): { day: string; rules: BrainRule[] }[] {
  const out: { day: string; rules: BrainRule[] }[] = [];
  for (const r of [...rules].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) {
    const day = dayLabel(r.createdAt);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rules.push(r);
    else out.push({ day, rules: [r] });
  }
  return out;
}

/** Ids present in `next` but not `prev`: what to flash as "new". An empty `prev` flashes nothing (first paint). */
export function newIds(prev: Set<string> | null, next: string[]): Set<string> {
  if (!prev) return new Set();
  return new Set(next.filter((id) => !prev.has(id)));
}

export function fixKey(f: { ts: string; modId: string }): string {
  return `${f.ts}|${f.modId}`;
}

/** Valid-shape guard for the endpoint reply, so a half-written response never paints NaN. */
export function isBrainFeed(v: unknown): v is BrainFeed {
  const f = v as Partial<BrainFeed> | null;
  return Boolean(f && typeof f === "object" && f.scorecard && typeof f.scorecard.reviews === "number" && Array.isArray(f.fixes) && Array.isArray(f.rules) && Array.isArray(f.skills) && f.openWeights);
}
