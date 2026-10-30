// The cold-start check's judgement calls, tested without spawning a server (bead q2s):
// which frames count as a greeting, and how the entry bundle is found in the built page.
import { describe, expect, it } from "vitest";
import { bundleSrcFromHtml, isGreetingFrame } from "../scripts/cold-start-check";

describe("cold-start check", () => {
  it("accepts a say or world frame as the greeting", () => {
    expect(isGreetingFrame({ kind: "say", text: "hello!" })).toBe(true);
    expect(isGreetingFrame({ kind: "world", mods: [] })).toBe(true);
  });

  it("does not accept anything else as the greeting", () => {
    for (const kind of ["visitor", "stage", "timing", "mod", "removed", "mood"]) {
      expect(isGreetingFrame({ kind })).toBe(false);
    }
    expect(isGreetingFrame({})).toBe(false);
  });

  it("finds the entry module script in a vite build", () => {
    const html = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-a1b2c3.js"></script></head></html>';
    expect(bundleSrcFromHtml(html)).toBe("/assets/index-a1b2c3.js");
  });

  it("finds a dev page's source module", () => {
    const html = '<html><body><script type="module" src="/src/client/main.ts"></script></body></html>';
    expect(bundleSrcFromHtml(html)).toBe("/src/client/main.ts");
  });

  it("returns null when the page has no script at all", () => {
    expect(bundleSrcFromHtml("<html><body>nothing</body></html>")).toBeNull();
  });
});
