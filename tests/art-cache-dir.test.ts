// Bead cvu: art tests leaked on the checkout's generated-art cache. `server/art.ts` reads and
// writes sheets under `public/art/gen/`; a live session leaves real .webp files there, so a test
// that asked for the same subject found a "cached" sheet, skipped generation, and failed
// (tests/ontology.test.ts "classifies held items" with a planted gun.webp). The test run now
// points `ART_GEN_DIR` at a throwaway folder (tests/setup/art-cache-dir.ts). These tests pin
// both halves: tests never see public/art/gen, and production still uses it by default.
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { artCachedUrl, artFilePath, artGenDir, generateSubjectArt } from "../server/art";

const checkoutGenDir = join(process.cwd(), "public", "art", "gen");

describe("art cache directory is hermetic in tests (cvu)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(artFilePath("cacheprobe"), { force: true });
  });

  it("points the cache at a throwaway folder, not the checkout's public/art/gen", () => {
    expect(process.env.ART_GEN_DIR).toBeTruthy();
    expect(artGenDir()).toBe(process.env.ART_GEN_DIR);
    expect(artGenDir()).not.toBe(checkoutGenDir);
    expect(artGenDir().startsWith(tmpdir())).toBe(true);
    expect(artFilePath("gun")).toBe(join(artGenDir(), "gun.webp"));
  });

  it("does not see a real sheet that sits in the checkout's public/art/gen", () => {
    // The repo ships some sheets (tree.webp, robot.webp, …). A cache lookup must miss them all,
    // or any test that expects a generation call would silently skip it.
    const shipped = ["tree", "robot", "cat"].filter((k) => existsSync(join(checkoutGenDir, `${k}.webp`)));
    expect(shipped.length).toBeGreaterThan(0);
    for (const k of shipped) expect(artCachedUrl(k), k).toBeNull();
  });

  it("writes a generated sheet into the throwaway folder and then finds it there", async () => {
    process.env.MODEL_API_KEY = "test-key-not-real";
    const prevSafety = process.env.SAFETY;
    process.env.SAFETY = "off";
    const b64 = Buffer.from("not-really-a-webp").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/images/generations")) {
          return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: b64 }] }), text: async () => "" };
        }
        return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
      }),
    );
    try {
      expect(await generateSubjectArt("a cache probe", "cacheprobe", false)).toBe("/art/gen/cacheprobe.webp");
      expect(existsSync(artFilePath("cacheprobe"))).toBe(true);
      // …and the checkout's cache stayed clean.
      expect(existsSync(join(checkoutGenDir, "cacheprobe.webp"))).toBe(false);
      expect(artCachedUrl("cacheprobe")).toBe("/art/gen/cacheprobe.webp");
    } finally {
      if (prevSafety === undefined) delete process.env.SAFETY;
      else process.env.SAFETY = prevSafety;
    }
  });

  it("still defaults to public/art/gen in production (no ART_GEN_DIR)", () => {
    const prev = process.env.ART_GEN_DIR;
    delete process.env.ART_GEN_DIR;
    try {
      expect(artGenDir()).toBe(checkoutGenDir);
      expect(artFilePath("gun")).toBe(join(checkoutGenDir, "gun.webp"));
    } finally {
      process.env.ART_GEN_DIR = prev;
    }
  });
});
