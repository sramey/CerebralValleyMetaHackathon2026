// Bead y0k: beat 8 shows all five Meta models lit. This drives the message-to-node mapping
// with fake server messages, so it costs zero Meta calls.
import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../src/contract";
import { ON_DEMAND, ranNode } from "../src/client/pipeline-ran";

const art = { key: "k", url: "/a.png" };

describe("pipeline: which nodes a message proves ran", () => {
  it("lights Muse Image for drawn art and for a restyle that came back", () => {
    expect(ranNode({ kind: "art", modId: "m", art })).toBe("image");
    expect(ranNode({ kind: "restyled", mood: "spooky", key: "k", url: "/b.png" })).toBe("image");
  });

  it("does not light Muse Image for a failed restyle or still-pending art", () => {
    expect(ranNode({ kind: "restyled", mood: "spooky", key: "k", url: null })).toBeNull();
    const pending = { kind: "mod", mod: { id: "m", title: "t", source: "", compiled: "", knobs: {}, artPending: "x" } } as ServerMsg;
    expect(ranNode(pending)).toBeNull();
  });

  it("lights SAM 3.1 only when a cut-out came back (a null box may be the budget-spent reply)", () => {
    expect(ranNode({ kind: "segment", key: "k", box: { x: 0, y: 0, w: 1, h: 1 } })).toBe("sam");
    expect(ranNode({ kind: "segment", key: "k", box: null })).toBeNull();
  });

  it("lights the build nodes from stage events, but only for a named build", () => {
    expect(ranNode({ kind: "stage", stage: "routing", detail: "", command: "add a bee" } as ServerMsg)).toBe("spark");
    expect(ranNode({ kind: "stage", stage: "writing", detail: "", command: "add a bee" } as ServerMsg)).toBe("wonder");
    expect(ranNode({ kind: "stage", stage: "done", detail: "", command: "add a bee" } as ServerMsg)).toBe("live");
    expect(ranNode({ kind: "stage", stage: "writing", detail: "" } as ServerMsg)).toBeNull();
  });

  it("counts calls only for the on-demand models", () => {
    expect([...ON_DEMAND].sort()).toEqual(["image", "reviewer", "sam", "voice"]);
  });
});
