// The cold-start gate (bead q2s): the client's websocket opens before the sprite sheets
// load, so its handlers wait on `ready`. What matters is that nothing is lost or reordered
// while it waits. No DOM, no timers: pure promise ordering.
import { describe, expect, it } from "vitest";
import { createBootGate } from "../src/client/boot-gate";

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("boot gate", () => {
  it("holds waiters until markReady, then runs them in arrival order", async () => {
    const gate = createBootGate();
    const ran: number[] = [];
    // Three frames arrive while the module is still evaluating (assets loading).
    void gate.ready.then(() => ran.push(1));
    void gate.ready.then(() => ran.push(2));
    void gate.ready.then(() => ran.push(3));
    await flush();
    expect(ran).toEqual([]); // nothing ran against half-built state
    gate.markReady();
    await flush();
    expect(ran).toEqual([1, 2, 3]); // queued, in order, none dropped
  });

  it("runs a waiter immediately once the gate is open", async () => {
    const gate = createBootGate();
    gate.markReady();
    let ran = false;
    void gate.ready.then(() => { ran = true; });
    await flush();
    expect(ran).toBe(true);
  });

  it("survives markReady being called twice", async () => {
    const gate = createBootGate();
    gate.markReady();
    gate.markReady();
    await expect(gate.ready).resolves.toBeUndefined();
  });
});
