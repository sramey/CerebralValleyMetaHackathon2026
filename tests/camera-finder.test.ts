import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINDER_IDLE, FINDER_LINE, finderLine, finderNext } from "../src/client/camera-finder";
import type { FinderEvent } from "../src/client/camera-finder";

const attempt = (offline = false): FinderEvent => ({ kind: "attempt", offline });
const OPEN: FinderEvent = { kind: "open" };
const CLOSE: FinderEvent = { kind: "close" };
const FOUND: FinderEvent = { kind: "found" };
const MISSED: FinderEvent = { kind: "missed" };
const COVERED: FinderEvent = { kind: "covered" };

/** What the strip says after a whole session of events. */
const run = (evs: FinderEvent[]): string | null => finderLine(evs.reduce(finderNext, FINDER_IDLE));

describe("camera finder status (bead q4u)", () => {
  it("says it is looking, then reports what came back", () => {
    expect(run([OPEN])).toBe("");
    expect(run([attempt()])).toBe(FINDER_LINE.looking);
    expect(run([attempt(), FOUND])).toBe(FINDER_LINE.found);
    expect(run([attempt(), MISSED])).toBe(FINDER_LINE.missed);
  });

  it("never leaves a miss up after a later success", () => {
    expect(run([attempt(), MISSED, attempt(), FOUND])).toBe(FINDER_LINE.found);
    // The object the second photo found is what the strip reports, not the first photo's miss.
    expect(run([attempt(), MISSED, attempt()])).not.toBe(FINDER_LINE.missed);
  });

  it("clears on a new attempt, so the miss line belongs to one photo only", () => {
    expect(run([attempt(), MISSED, attempt()])).toBe(FINDER_LINE.looking);
    expect(run([attempt(), MISSED, attempt(true)])).toBe(FINDER_LINE.offline);
  });

  it("clears on close and stays clear when the panel is reopened", () => {
    expect(run([attempt(), MISSED, CLOSE])).toBe("");
    expect(run([attempt(), MISSED, CLOSE, OPEN])).toBe("");
    expect(run([attempt(), FOUND, CLOSE, OPEN])).toBe("");
  });

  it("says the AI is offline instead of promising a box, and stops saying it once online", () => {
    expect(run([attempt(true)])).toBe(FINDER_LINE.offline);
    expect(run([attempt(true), attempt(false)])).toBe(FINDER_LINE.looking);
    expect(run([attempt(true), MISSED])).toBe(FINDER_LINE.missed);
  });

  it("stands down while a hand cut owns the strip, and never covers one with a late answer", () => {
    expect(run([attempt(), COVERED])).toBeNull();
    expect(run([attempt(), MISSED, COVERED])).toBeNull();
    expect(run([attempt(), COVERED, MISSED])).toBeNull();
    expect(run([attempt(), COVERED, FOUND])).toBeNull();
    // A new photo wipes the hand cut, so the finder owns the strip again.
    expect(run([attempt(), COVERED, MISSED, attempt()])).toBe(FINDER_LINE.looking);
    expect(run([attempt(true), COVERED, attempt()])).toBe(FINDER_LINE.looking);
  });

  it("keeps the state small enough to read: no line survives a close", () => {
    for (const evs of [[attempt()], [attempt(), FOUND], [attempt(), MISSED], [attempt(true)], [attempt(), COVERED]]) {
      expect(run([...evs, CLOSE])).toBe("");
    }
  });

  it("is the only writer of these lines in the panel", () => {
    // A direct `setCameraStatus("Couldn't find it…")` is exactly how the stale line came back
    // before: the panel has to go through cameraFinder for every finder line.
    const main = readFileSync(join(process.cwd(), "src", "client", "main.ts"), "utf8");
    const code = main.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of [FINDER_LINE.looking, FINDER_LINE.missed, FINDER_LINE.found, FINDER_LINE.offline]) {
      expect(code).not.toContain(line);
    }
    for (const ev of ['{ kind: "open" }', '{ kind: "close" }', '{ kind: "found" }', '{ kind: "missed" }']) {
      expect(main).toContain(`cameraFinder(${ev})`);
    }
  });
});
