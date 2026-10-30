// Bead u5o: a build can add several subjects, each with its own sprite sheet (bead 852). Every layer that
// used to carry ONE sheet (the pending placeholder, saved worlds, the export, the receipt) now carries all of them.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingArtKeys, sheetsOf } from "../src/contract";
import type { WorldMod } from "../src/contract";
import { planArtOrders } from "../server/art";
import { planBuildArt } from "../server/art-orders";
import { parseWorld, restyledForWorld, snapshotWorld, type SessionMod } from "../server/worlds";
import { collectSprites } from "../server/export";
import { aiReceipt } from "../server/receipt";
import { receiptSteps } from "../src/client/receipt-model";

const FARM = `
export default {
  id: "farm", title: "Farm",
  setup(api) {
    api.spawn({ type: "barn", x: 520, y: 200, w: 120, h: 90 });
    api.spawn({ type: "cow", x: 300, y: 340, w: 40, h: 30 });
    api.spawn({ type: "fence", x: 180, y: 356, w: 80, h: 24 });
  },
  dispose(api) {},
}`;

describe("artPendingList: a placeholder for every pending sheet", () => {
  it("the plan lists every key still to draw, and the first stays in artPending", () => {
    const orders = planArtOrders(FARM, "add a farm");
    expect(orders.length).toBeGreaterThanOrEqual(3);
    const plan = planBuildArt(orders, { cached: () => null, spend: () => true });
    expect(plan.artPendingList).toEqual(orders.map((o) => o.key));
    expect(plan.artPending).toBe(orders[0]!.key);
  });

  it("a fully cached build has no pending list", () => {
    const plan = planBuildArt(planArtOrders(FARM, "add a farm"), { cached: (k) => `/art/gen/${k}.webp`, spend: () => true });
    expect(plan.artPendingList).toBeUndefined();
  });

  it("pendingArtKeys reads the list, falls back to the single key, and ignores junk", () => {
    expect(pendingArtKeys({ artPendingList: ["barn", "cow"], artPending: "barn" })).toEqual(["barn", "cow"]);
    expect(pendingArtKeys({ artPending: "barn" })).toEqual(["barn"]);
    expect(pendingArtKeys({})).toEqual([]);
    expect(pendingArtKeys({ artPendingList: ["a", 3 as unknown as string] })).toEqual(["a"]);
  });
});

const SHEETS = [
  { key: "airplane", url: "/art/gen/airplane.webp" },
  { key: "chest", url: "/art/gen/chest.webp", scenery: true },
  { key: "cat", url: "/art/gen/cat.webp" },
];

describe("sheetsOf", () => {
  it("reads old single-art records, new lists, and both without duplicates", () => {
    expect(sheetsOf({ art: SHEETS[0] })).toEqual([SHEETS[0]]);
    expect(sheetsOf({ arts: SHEETS })).toEqual(SHEETS);
    expect(sheetsOf({ art: SHEETS[0], arts: SHEETS })).toEqual(SHEETS);
    expect(sheetsOf({})).toEqual([]);
  });
});

function mod(over: Partial<SessionMod> = {}): SessionMod {
  return { id: "farm", title: "Farm", source: FARM, compiled: "x", knobs: {}, ...over };
}

describe("saved worlds keep every sheet", () => {
  it("snapshot -> JSON -> parse round-trips all of them, with art as the first", () => {
    const manifest = new Map([["farm", mod({ art: SHEETS[0], arts: SHEETS })]]);
    const [saved] = snapshotWorld([{ id: "farm", values: {} }], manifest, new Set());
    const back = parseWorld(JSON.stringify({ v: 1, id: "abcdefgh", mods: [saved], createdAt: 1 }));
    const m = back?.mods[0] as Extract<WorldMod, { builtin?: false }>;
    expect(m.arts).toEqual(SHEETS);
    expect(m.art).toEqual(SHEETS[0]);
  });

  it("a world saved before `arts` existed still loads its one sheet, as a list too", () => {
    const old = { v: 1, id: "abcdefgh", mods: [{ id: "farm", title: "Farm", source: "s", compiled: "c", knobs: {}, values: {}, art: SHEETS[0] }], createdAt: 1 };
    const m = parseWorld(JSON.stringify(old))?.mods[0] as Extract<WorldMod, { builtin?: false }>;
    expect(m.art).toEqual(SHEETS[0]);
    expect(m.arts).toEqual([SHEETS[0]]);
  });

  it("a hand-edited world cannot smuggle a path or script in as a sheet", () => {
    const evil = { v: 1, id: "abcdefgh", mods: [{ id: "farm", title: "Farm", source: "s", compiled: "c", knobs: {}, values: {}, arts: [{ key: "ok", url: "/art/gen/ok.webp" }, { key: "../x", url: "/art/gen/x.webp" }, { key: "y", url: "https://evil.test/y.webp" }, { key: "z", url: "/art/gen/../../.env" }] }], createdAt: 1 };
    const m = parseWorld(JSON.stringify(evil))?.mods[0] as Extract<WorldMod, { builtin?: false }>;
    expect(m.arts).toEqual([{ key: "ok", url: "/art/gen/ok.webp" }]);
  });

  it("a mood restyle covers every sheet, not just the first", () => {
    const root = mkdtempSync(join(tmpdir(), "u5o-"));
    mkdirSync(join(root, "public", "art", "gen"), { recursive: true });
    for (const s of SHEETS) writeFileSync(join(root, "public", "art", "gen", `${s.key}--spooky.webp`), "x");
    const mods = [{ id: "farm", title: "Farm", source: "s", compiled: "c", knobs: {}, values: {}, art: SHEETS[0], arts: SHEETS }] as WorldMod[];
    const out = restyledForWorld({ name: "spooky" } as never, mods, undefined, root);
    expect(Object.keys(out ?? {}).sort()).toEqual(["airplane", "cat", "chest"]);
  });
});

describe("Download game keeps every sheet", () => {
  it("collects a data URI for each sheet of a mod, and for an old single-art mod", () => {
    const base = { id: "farm", title: "Farm", source: "s", compiled: "c", knobs: {}, values: {} };
    const sprites = collectSprites({ mods: [{ ...base, art: SHEETS[0], arts: SHEETS }] }, process.cwd());
    for (const s of SHEETS) expect(sprites[s.key]).toMatch(/^data:image\/webp;base64,/);
    const oldSprites = collectSprites({ mods: [{ ...base, art: SHEETS[1] }] }, process.cwd());
    expect(oldSprites["chest"]).toMatch(/^data:image\/webp;base64,/);
    expect(oldSprites["airplane"]).toBeUndefined();
  });
});

describe("the receipt lists every art order", () => {
  const route = { action: "new", model: "Muse Spark", open: false, fellBack: false, ms: 800, rules: [] };
  const timings = { route: 800, write: 7000, compile: 40, verify: 600, total: 8500 };
  const arts = [
    { model: "muse-image-1.0", subject: "barn", state: "drawn" as const, url: "/art/gen/barn.webp", ms: 9000, prompt: "a barn" },
    { model: "muse-image-1.0", subject: "cow", state: "drawing" as const, prompt: "a cow" },
    { model: "muse-image-1.0", subject: "fence", state: "cached" as const, url: "/art/gen/fence.webp" },
  ];

  it("keeps all of them on the record, with art as the first", () => {
    const r = aiReceipt({ modId: "farm", title: "Farm", command: "add a farm", route, source: FARM, rejected: [], tools: [], turns: 1, playtests: 1, msPerFrame: 0.002, timings, art: arts[0], arts });
    expect(r.art).toEqual(arts[0]);
    expect(r.arts).toEqual(arts);
  });

  it("shows one art step per order, each with its own sheet", () => {
    const r = aiReceipt({ modId: "farm", title: "Farm", command: "add a farm", route, source: FARM, rejected: [], tools: [], turns: 1, playtests: 1, msPerFrame: 0.002, timings, art: arts[0], arts });
    const steps = receiptSteps(r).filter((s) => s.tone === "art");
    expect(steps.map((s) => s.title)).toEqual(["Drew the art: barn", "Drawing the art: cow", "Drew the art: fence"]);
    expect(steps.map((s) => s.artUrl)).toEqual(["/art/gen/barn.webp", undefined, "/art/gen/fence.webp"]);
  });

  it("an older receipt with only `art` still shows its one step", () => {
    const r = aiReceipt({ modId: "farm", title: "Farm", command: "add a barn", route, source: FARM, rejected: [], tools: [], turns: 1, playtests: 1, msPerFrame: 0.002, timings, art: arts[0] });
    expect(r.arts).toBeUndefined();
    expect(receiptSteps(r).filter((s) => s.tone === "art")).toHaveLength(1);
  });
});
