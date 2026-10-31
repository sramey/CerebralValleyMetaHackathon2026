// Which pipeline nodes a server message proves have run (bead y0k). The glow on a node
// fades after 1.4 s; this is the part that stays, so beat 8 can show every Meta model
// that did real work this session, including art and SAM jobs that are not builds.
import type { ServerMsg } from "../contract";

export type RanNode = "voice" | "spark" | "wonder" | "esbuild" | "verifier" | "live" | "image" | "sam" | "reviewer";

/** Nodes that run on demand, outside a build: each message is one call, so we count them. */
export const ON_DEMAND: ReadonlySet<RanNode> = new Set<RanNode>(["voice", "image", "sam", "reviewer"]);

const STAGE_NODE: Record<string, RanNode> = {
  routing: "spark", writing: "wonder", fixing: "wonder", compiling: "esbuild", verifying: "verifier", rejected: "verifier", done: "live",
};

/** The node this message proves ran, or null. Pending art (not yet drawn) proves nothing. */
export function ranNode(msg: ServerMsg): RanNode | null {
  switch (msg.kind) {
    case "transcript": return "voice";
    case "routed": return "spark";
    case "agentStep": return "wonder";
    case "art": return "image";
    case "restyled": return msg.url ? "image" : null; // a null url means the draw failed
    case "segment": return msg.box ? "sam" : null; // a null box is also the budget-spent reply
    case "review": return msg.phase === "running" ? "reviewer" : null;
    case "mod": return msg.mod.art ? "image" : null;
    case "stage": return msg.command ? STAGE_NODE[msg.stage] ?? null : null;
    default: return null;
  }
}
