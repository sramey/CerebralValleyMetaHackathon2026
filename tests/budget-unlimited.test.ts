// Bead 852: there is no public page and every player brings their own Meta key, so the
// spend guard defaults to unlimited. A host can still set any BUDGET_* env var, and
// AI_KILL_SWITCH still refuses everything.
import { describe, expect, it } from "vitest";
import { Budget, DEFAULT_GLOBAL, DEFAULT_SESSION, readLimits } from "../server/budget";

const VISITOR = "203.0.113.7"; // never loopback: local IPs bypass session caps in dev

describe("unlimited spend defaults (bead 852)", () => {
  it("defaults to Infinity for every kind, per visitor and globally", () => {
    for (const kind of ["build", "image", "sam", "voice", "explain"] as const) {
      expect(DEFAULT_SESSION[kind]).toBe(Infinity);
      expect(DEFAULT_GLOBAL[kind]).toBe(Infinity);
      expect(readLimits({}).session[kind]).toBe(Infinity);
      expect(readLimits({}).global[kind]).toBe(Infinity);
    }
  });

  it("allows 1000 builds in one day for one visitor", () => {
    const budget = new Budget();
    for (let i = 0; i < 1000; i++) expect(budget.take(VISITOR, "build").ok).toBe(true);
    expect(budget.snapshot().global.build).toBe(1000);
    expect(budget.snapshot().limits.session.build).toBe(Infinity);
  });

  it("still enforces an env-set session limit", () => {
    const limits = readLimits({ BUDGET_SESSION_BUILDS: "3" });
    const budget = new Budget(limits);
    expect(budget.take(VISITOR, "build").ok).toBe(true);
    expect(budget.take(VISITOR, "build").ok).toBe(true);
    expect(budget.take(VISITOR, "build").ok).toBe(true);
    const refused = budget.take(VISITOR, "build");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.scope).toBe("session");
    // Another kind is still unlimited.
    expect(budget.take(VISITOR, "image").ok).toBe(true);
  });

  it("still enforces an env-set global limit and the kill switch", () => {
    const budget = new Budget({ ...readLimits({ BUDGET_GLOBAL_IMAGES: "1" }), killSwitch: () => false });
    expect(budget.take("203.0.113.8", "image").ok).toBe(true);
    const refused = budget.take("203.0.113.9", "image");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.scope).toBe("global");

    const off = new Budget({ killSwitch: () => true });
    const killed = off.take(VISITOR, "build");
    expect(killed.ok).toBe(false);
    if (!killed.ok) expect(killed.scope).toBe("killswitch");
  });

  it("counts a host-set voice limit in seconds from minutes", () => {
    const budget = new Budget(readLimits({ BUDGET_SESSION_VOICE_MIN: "1" }));
    expect(budget.check(VISITOR, "voice", 10).ok).toBe(true);
    budget.add(VISITOR, "voice", 60);
    expect(budget.check(VISITOR, "voice", 10).ok).toBe(false);
  });
});
