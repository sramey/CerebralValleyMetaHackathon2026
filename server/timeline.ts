/**
 * Time-travel timeline (ADR 0041). Every change to a session's world (a build landing, a mood, an
 * undo, a restore) becomes a step holding a full snapshot, in the same shape a shared world uses
 * (`WorldMod[]`), so restoring is the existing world-load path. Pure and in-memory: no clock, no I/O.
 */
import type { MoodSpec, TimelineStep, WorldMod } from "../src/contract";

export const MAX_STEPS = 60;

export interface Snapshot {
  mods: WorldMod[];
  mood?: MoodSpec;
  restyled?: Record<string, string>;
  /** Level mods a sketch replaced, by sketch id (bug j2t), as plain arrays so a restore keeps undo working. */
  stash?: [string, unknown[]][];
}

export interface Step extends Snapshot { n: number; kind: TimelineStep["kind"]; label: string }

/** Cheap stable string hash (djb2): identity of a mod's source without keeping a second copy. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What makes two worlds "the same step": which mods, which code, which mood. Knob values are not a step. */
export function fingerprint(s: Snapshot): string {
  const mods = s.mods.map((m) => (m.builtin ? `b:${m.id}` : `m:${m.id}:${hash(m.source)}`)).sort();
  return `${mods.join("|")}#${s.mood?.name ?? ""}`;
}

const nameOf = (m: WorldMod): string => (m.builtin ? m.id : m.title || m.id);

/** Plain-words label for what changed from `prev` to `next`, used when no command text explains it. */
export function describeChange(prev: Snapshot | undefined, next: Snapshot): { kind: TimelineStep["kind"]; label: string } {
  if (!prev) return { kind: "start", label: next.mods.length === 0 ? "Empty world" : "Start" };
  if ((next.mood?.name ?? "") !== (prev.mood?.name ?? "")) {
    return next.mood ? { kind: "mood", label: `Mood: ${next.mood.name}` } : { kind: "undo", label: "Back to normal" };
  }
  const before = new Map(prev.mods.map((m) => [m.id, m]));
  const after = new Map(next.mods.map((m) => [m.id, m]));
  const added = next.mods.filter((m) => !before.has(m.id));
  const removed = prev.mods.filter((m) => !after.has(m.id));
  if (added.length > 0 && removed.length > 0) return { kind: "build", label: `${nameOf(added[0])}${added.length > 1 ? ` +${added.length - 1}` : ""} replaces ${removed.length} mod${removed.length > 1 ? "s" : ""}` };
  if (added.length > 0) return { kind: "build", label: added.length === 1 ? `Added ${nameOf(added[0])}` : `Added ${nameOf(added[0])} +${added.length - 1}` };
  if (removed.length > 0) return { kind: "undo", label: removed.length === 1 ? `Removed ${nameOf(removed[0])}` : `Removed ${removed.length} mods` };
  return { kind: "build", label: "Edited a mod" };
}

export class Timeline {
  private steps: Step[] = [];
  private next = 1;
  private last = "";

  /** Record `snap` when it differs from the current world. `command` (what the player said) beats the generated label. */
  record(snap: Snapshot, command?: string, force?: { kind: TimelineStep["kind"]; label: string }): Step | null {
    const fp = fingerprint(snap);
    if (!force && fp === this.last) return null;
    if (!force && this.steps.length === 0 && snap.mods.length === 0 && !snap.mood) { this.last = fp; return null; }
    const prev = this.steps[this.steps.length - 1];
    const d = force ?? describeChange(prev, snap);
    const label = (force ? force.label : command?.trim() ? command.trim().slice(0, 60) : d.label);
    const step: Step = { ...snap, n: this.next++, kind: d.kind, label };
    this.last = fp;
    this.steps.push(step);
    // Keep the first step (the starting point) and the most recent ones.
    if (this.steps.length > MAX_STEPS) this.steps.splice(1, this.steps.length - MAX_STEPS);
    return step;
  }

  get(n: number): Step | undefined { return this.steps.find((s) => s.n === n); }

  /** Light list for the strip: no sources, just ids and titles per step. */
  list(): TimelineStep[] {
    return this.steps.map((s) => ({ n: s.n, kind: s.kind, label: s.label, mood: s.mood?.name, mods: s.mods.map((m) => ({ id: m.id, title: nameOf(m) })) }));
  }

  get size(): number { return this.steps.length; }
}
