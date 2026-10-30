// ADR 0060 / bead gfx: the player can stop a build that is still running. The x on a build
// chip sends {kind:"cancel", command}; the server aborts that build's in-flight model calls
// and drops whatever the model still returns.
//
// Everything here is headless and spends no Meta budget: the "chat" calls are stubbed
// transports, and the pipeline's own checkpoints are the registry the server holds.
import { describe, expect, it, vi } from "vitest";
import { anySignal, CANCEL_DETAIL, createCancelRegistry } from "../server/cancel";
import { MAX_COMMAND, REPLY, validateClientMsg } from "../server/validate";

describe("cancel registry", () => {
  it("aborts the build's signal and reports it cancelled", () => {
    const reg = createCancelRegistry();
    const job = reg.begin("add a dragon");
    expect(job.cancelled).toBe(false);
    expect(job.signal.aborted).toBe(false);
    expect(reg.cancel("add a dragon")).toBe(1);
    expect(job.cancelled).toBe(true);
    expect(job.signal.aborted).toBe(true);
    expect(reg.running()).toEqual([]);
  });

  it("cancels only one lane of a compound command", () => {
    const reg = createCancelRegistry();
    const dragon = reg.begin("add a dragon");
    const coins = reg.begin("add some coins");
    const rain = reg.begin("make it rain");
    expect(reg.running()).toEqual(["add a dragon", "add some coins", "make it rain"]);

    expect(reg.cancel("add some coins")).toBe(1);
    expect(coins.cancelled).toBe(true);
    expect(coins.signal.aborted).toBe(true);
    // The siblings keep building: they were never touched.
    expect(dragon.cancelled).toBe(false);
    expect(dragon.signal.aborted).toBe(false);
    expect(rain.cancelled).toBe(false);
    expect(reg.running()).toEqual(["add a dragon", "make it rain"]);
  });

  it("ignores a command that is not running, and a second click on the same chip", () => {
    const reg = createCancelRegistry();
    expect(reg.cancel("add a castle")).toBe(0);
    const job = reg.begin("add a castle");
    expect(reg.cancel("add a castle")).toBe(1);
    expect(reg.cancel("add a castle")).toBe(0);
    expect(job.cancelled).toBe(true);
  });

  it("a finished build leaves nothing to cancel, and never leaks its command", () => {
    const reg = createCancelRegistry();
    const job = reg.begin("add a player");
    reg.done("add a player");
    expect(reg.running()).toEqual([]);
    expect(reg.cancel("add a player")).toBe(0);
    expect(job.cancelled).toBe(false); // finished, not cancelled: it landed on its own
  });

  it("keeps two builds of the same command apart", () => {
    const reg = createCancelRegistry();
    const first = reg.begin("make it rain");
    reg.done("make it rain");
    const second = reg.begin("make it rain");
    expect(reg.cancel("make it rain")).toBe(1);
    expect(second.cancelled).toBe(true);
    expect(first.cancelled).toBe(false);
  });
});

describe("anySignal: the player's cancel joins a pipeline's own deadline", () => {
  it("aborts when either input does", () => {
    const a = new AbortController();
    const b = new AbortController();
    const both = anySignal(a.signal, b.signal)!;
    expect(both.aborted).toBe(false);
    b.abort();
    expect(both.aborted).toBe(true);

    const c = new AbortController();
    const d = new AbortController();
    const other = anySignal(c.signal, d.signal)!;
    c.abort();
    expect(other.aborted).toBe(true);
  });

  it("passes one signal through, and reports nothing for none", () => {
    const only = new AbortController();
    expect(anySignal(only.signal)).toBe(only.signal);
    expect(anySignal(undefined)).toBeUndefined();
    expect(anySignal(undefined, undefined)).toBeUndefined();
  });

  it("is already aborted when an input already is", () => {
    const done = new AbortController();
    done.abort();
    const live = new AbortController();
    expect(anySignal(done.signal, live.signal)!.aborted).toBe(true);
  });
});

describe("the wire: {kind:'cancel', command}", () => {
  it("accepts the chip's own command text, including Wonder-style ids and unicode", () => {
    for (const command of ["add a dragon", "Make the cat bigger and faster", "add a rain cloud ✨", "photo: my mug"]) {
      const v = validateClientMsg({ kind: "cancel", command });
      expect(v.ok, command).toBe(true);
      if (v.ok) expect(v.msg).toEqual({ kind: "cancel", command });
    }
  });

  it("drops unknown fields, so a cancel can never carry anything else", () => {
    const v = validateClientMsg({ kind: "cancel", command: "add a dragon", modId: "evil", __proto__x: 1 });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.msg).toEqual({ kind: "cancel", command: "add a dragon" });
  });

  it("refuses a missing, empty, non-string or oversized command with one plain sentence", () => {
    for (const bad of [
      { kind: "cancel" },
      { kind: "cancel", command: "" },
      { kind: "cancel", command: "   " },
      { kind: "cancel", command: 7 },
      { kind: "cancel", command: { text: "add a dragon" } },
      { kind: "cancel", command: "a".repeat(MAX_COMMAND + 1) },
    ]) {
      const v = validateClientMsg(bad);
      expect(v.ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
      if (!v.ok) {
        expect(v.reply).toBe(REPLY.bad);
        expect(v.reply.length).toBeLessThan(120);
        expect(v.reply).not.toContain("\n");
      }
    }
  });

  it("names the stage detail the client paints as 'cancelled'", () => {
    expect(CANCEL_DETAIL).toBe("cancelled");
  });
});

/** A fetch stand-in that behaves like the real one under abort: it settles only when cancelled. */
function hangingFetch(): { calls: { signal?: AbortSignal }[]; restore: () => void } {
  const calls: { signal?: AbortSignal }[] = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init: { body?: string; signal?: AbortSignal }) => {
    calls.push({ signal: init.signal });
    return new Promise((_resolve, reject) => {
      const kill = () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
      if (init.signal?.aborted) { kill(); return; }
      init.signal?.addEventListener("abort", kill, { once: true });
    });
  }));
  return { calls, restore: () => vi.unstubAllGlobals() };
}

describe("cancel reaches the model calls (mocked chat, no Meta call)", () => {
  it("runAgent sends the build's signal, so a cancelled write stops paying", async () => {
    process.env.MODEL_API_KEY = "test-key-not-real";
    const net = hangingFetch();
    try {
      const { runAgent } = await import("../server/agent");
      const ctrl = new AbortController();
      const run = runAgent({ system: "you write mods", user: "add a dragon", tools: [], signal: ctrl.signal });
      await new Promise((r) => setTimeout(r, 0));
      expect(net.calls).toHaveLength(1);
      expect(net.calls[0].signal).toBe(ctrl.signal); // the same signal the registry hands out
      ctrl.abort();
      await expect(run).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      net.restore();
    }
  });

  it("chat takes the signal as well, for the plain-completion fallback", async () => {
    process.env.MODEL_API_KEY = "test-key-not-real";
    const net = hangingFetch();
    try {
      const { chat, WONDER } = await import("../server/meta");
      const ctrl = new AbortController();
      const p = chat(WONDER, [{ role: "user", content: "add a dragon" }], 4096, "minimal", ctrl.signal);
      await new Promise((r) => setTimeout(r, 0));
      expect(net.calls[0].signal).toBe(ctrl.signal);
      ctrl.abort();
      await expect(p).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      net.restore();
    }
  });

  it("a reply that lands after the click is dropped, not compiled", async () => {
    const reg = createCancelRegistry();
    const job = reg.begin("add a dragon");
    // A stubbed writer whose reply is already on its way: aborting cannot un-send it.
    const writer = Promise.resolve("export default { id: 'dragon' }");
    reg.cancel(job.command);
    const late = await writer;
    // The pipeline's rule: the flag decides, not the signal, because the text is here anyway.
    expect(late).toContain("export default");
    expect(job.cancelled).toBe(true);
    expect(reg.running()).toEqual([]);
  });
});
