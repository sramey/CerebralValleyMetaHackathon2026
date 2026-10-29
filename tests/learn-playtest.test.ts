import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { learnFromFix } from "../server/learn";

describe("auto-fix learning and playtest rejections (ADR 0023)", () => {
  it("does not distill a rule from a playtest rejection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "learn-"));
    const r = await learnFromFix("make me huge", ["playtest: You'd be too big to fit through the gap (headroom 72)"], "export default {}", undefined, dir);
    expect(r).toBeNull();
  });
});
