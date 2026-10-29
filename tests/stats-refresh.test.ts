// Live stats refresh (ADR 0027 follow-up): a build that settles must move the panel's tiles
// at once instead of on the next 20 s poll. This pins which server messages count as "live"
// and how the panel spaces its reads out, without a DOM or a socket.
import { describe, expect, it } from "vitest";
import { MIN_REFRESH_GAP_MS, isLiveBuildMsg, refreshDelay } from "../src/client/stats-refresh";

describe("live stats refresh", () => {
  it("treats a settled build as live", () => {
    expect(isLiveBuildMsg({ kind: "stage", stage: "done" })).toBe(true);
    expect(isLiveBuildMsg({ kind: "stage", stage: "failed" })).toBe(true);
  });

  it("treats the command's timing message as live (the log line is already written)", () => {
    expect(isLiveBuildMsg({ kind: "timing" })).toBe(true);
  });

  it("ignores stages that cannot have logged anything yet", () => {
    for (const stage of ["routing", "writing", "fixing", "compiling", "verifying", "rejected"]) {
      expect(isLiveBuildMsg({ kind: "stage", stage })).toBe(false);
    }
  });

  it("ignores everything that is not a build message", () => {
    for (const kind of ["mod", "art", "transcript", "segment", "removed", "worldSaved", "sketch"]) {
      expect(isLiveBuildMsg({ kind })).toBe(false);
    }
    // A stage without a stage name (malformed) must not trigger a read either.
    expect(isLiveBuildMsg({ kind: "stage" })).toBe(false);
  });

  it("reads immediately the first time, then waits out the settle gap", () => {
    const now = 100_000;
    expect(refreshDelay(null, now)).toBe(0);
    expect(refreshDelay(now - MIN_REFRESH_GAP_MS, now)).toBe(0);
    expect(refreshDelay(now - MIN_REFRESH_GAP_MS - 1, now)).toBe(0);
    expect(refreshDelay(now - 100, now)).toBe(MIN_REFRESH_GAP_MS - 100);
    expect(refreshDelay(now, now)).toBe(MIN_REFRESH_GAP_MS);
  });

  it("keeps the gap short enough to look instant but long enough to coalesce a burst", () => {
    expect(MIN_REFRESH_GAP_MS).toBeGreaterThanOrEqual(500);
    expect(MIN_REFRESH_GAP_MS).toBeLessThanOrEqual(3_000);
    // Beats the 20 s poll by an order of magnitude: that is the whole point of the hook.
    expect(MIN_REFRESH_GAP_MS).toBeLessThan(20_000);
    expect(refreshDelay(1_000, 1_500, 800)).toBe(300);
  });
});
