// Wonder's tool loop as a short readable chain (ADR 0033): "inspect -> write -> playtest -> rejected -> fix -> ...".
// Pure, so the sequence a viewer reads is unit-tested rather than eyeballed.
import type { ServerMsg } from "../contract";

export type AgentStepMsg = Extract<ServerMsg, { kind: "agentStep" }>;
export interface Chip { label: string; kind: "inspect" | "write" | "playtest" | "reject" | "fix" | "pass" }

/** The chain for a build's steps, in order. A playtest is write + playtest + its verdict; the fix round gets a divider. */
export function chain(steps: AgentStepMsg[]): Chip[] {
  const out: Chip[] = [];
  let phase: "write" | "fix" = "write";
  let rejected = false;
  for (const s of steps) {
    // A new draft after a "no" is the fix, whether Wonder retried inside its loop or the server started the fix round.
    if ((s.phase === "fix" && phase === "write") || (rejected && s.tool === "run_playtest")) { out.push({ label: "fix", kind: "fix" }); phase = s.phase; }
    rejected = s.tool === "run_playtest" && !s.ok;
    if (s.tool === "inspect_world") { out.push({ label: "inspect", kind: "inspect" }); continue; }
    out.push({ label: "write", kind: "write" }, { label: "playtest", kind: "playtest" }, s.ok ? { label: "pass", kind: "pass" } : { label: "rejected", kind: "reject" });
  }
  return out;
}

/** "inspect_world(no arguments) -> 2 mods, 5 entity types" for the detail rows under the chain. */
export function stepLine(s: AgentStepMsg): string {
  return `${s.n}. ${s.tool}(${s.args}) → ${s.result}`;
}
