// Reconnect keeps the world editable (bead 2ww, ADR 0077). A server restart under an open tab used to
// leave the page showing a world the new session had no manifest for: the autosave file survived
// (ADR 0070), but "make it faster", the knobs and undo all answered "Unknown mod or knob" until a
// reload. These tests walk the real path: a first session builds and autosaves, the server restarts
// (a fresh WorldStore and a fresh manifest), the page reconnects and asks the server to adopt its own
// file back, and then a knob change, an undo and an edit all work on the adopted records.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore, adoptStoredMods, sessionRecOf, snapshotWorld } from "../server/worlds";
import type { SessionMod } from "../server/worlds";
import { compileMod } from "../server/compile";
import { importMod } from "../server/verify";
import { clampKnobValue, validateClientMsg } from "../server/validate";
import { formatManifest } from "../server/prompt";
import { adoptFrame } from "../src/client/home-world";
import type { KnobValues, WorldMod } from "../src/contract";

const tmp = () => mkdtempSync(join(tmpdir(), "metabuild-reconnect-"));
const SLOT = "home-abcdefgh1234";
const store = (root: string) => new WorldStore(join(root, "worlds"), join(root, "demo"));

const fixture = JSON.parse(readFileSync(new URL("./fixtures/playtest-world.json", import.meta.url), "utf8")) as {
  mods: { id: string; title: string; source: string }[];
};

/** The manifest the server holds after verifying these builds, in one pass. */
async function fixtureManifest(): Promise<Map<string, SessionMod>> {
  const manifest = new Map<string, SessionMod>();
  for (const m of fixture.mods) {
    const c = compileMod(m.source);
    expect(c.errors).toEqual([]);
    const def = await importMod(c.js);
    expect(def.id).toBe(m.id);
    manifest.set(m.id, { id: m.id, title: def.title, source: m.source, compiled: c.js, knobs: def.knobs ?? {} });
  }
  return manifest;
}

const BUILTINS = new Set(["player", "ground"]);
const requested = (overrides: Record<string, KnobValues> = {}) => [
  { id: "player", values: {} },
  { id: "ground", values: {} },
  ...fixture.mods.map((m) => ({ id: m.id, values: overrides[m.id] ?? {} })),
];

/** The knob handler's own arithmetic (server/index.ts): clamp into the declared range, keep the def. */
function turnKnob(manifest: Map<string, SessionMod>, modId: string, knob: string, value: number | string | boolean): void {
  const rec = manifest.get(modId);
  const def = rec && Object.prototype.hasOwnProperty.call(rec.knobs, knob) ? rec.knobs[knob] : undefined;
  expect(def).toBeDefined();
  rec!.knobs[knob] = { ...def!, value: clampKnobValue(def, value) };
}

/** A first session: two AI mods built, one knob already turned, written to this browser's slot. */
async function builtAndSaved(): Promise<{ root: string; tuned: KnobValues }> {
  const root = tmp();
  const manifest = await fixtureManifest();
  turnKnob(manifest, "rideable-dragon", "speed", 340);
  const mods = snapshotWorld(requested(), manifest, BUILTINS);
  expect("error" in store(root).saveSlot(SLOT, mods)).toBe(false);
  return { root, tuned: { speed: 340 } };
}

describe("a reconnect keeps the world editable (ADR 0077)", () => {
  it("adopts the browser's own file so a knob, an undo and an edit all work with no reload", async () => {
    const { root } = await builtAndSaved();

    // The server restarted under the open tab: a fresh process has a fresh WorldStore and a fresh
    // session manifest. The page still shows the jetpack and the dragon.
    const restarted = store(root);
    const manifest = new Map<string, SessionMod>();
    const page = adoptFrame({ worldIsHome: true, slot: SLOT, mods: requested({ "rideable-dragon": { speed: 500 } }) })!;
    // The wire door accepts it and hands the handler exactly the ids and values the page reported.
    expect(validateClientMsg(page)).toEqual({ ok: true, msg: page });
    // Before the fix this was the bug: nothing in the manifest, so every edit answered "Unknown mod".
    expect(manifest.has("jetpack")).toBe(false);

    const gained = restarted.adoptSlot(SLOT, page.mods, manifest);
    expect(gained.map((r) => r.id)).toEqual(["jetpack", "rideable-dragon"]);
    expect([...manifest.keys()].sort()).toEqual(["jetpack", "rideable-dragon"]);

    // 1. A knob change: the record and its knob are there, and the value the page reported (tuned
    // while the server was down) wins over the file's older one instead of snapping back.
    expect(manifest.get("rideable-dragon")!.knobs.speed).toMatchObject({ value: 500, min: 80, max: 500 });
    turnKnob(manifest, "jetpack", "thrust", 2000);
    expect(manifest.get("jetpack")!.knobs.thrust.value).toBe(2000);

    // The autosave that change triggers keeps both mods and both tuned knobs, so a later reload is right.
    expect("error" in restarted.saveSlot(SLOT, snapshotWorld(requested(), manifest, BUILTINS))).toBe(false);
    const saved = restarted.get(SLOT)!;
    expect(saved.mods.find((m) => m.id === "jetpack")).toMatchObject({ values: { thrust: 2000 } });
    expect(saved.mods.find((m) => m.id === "rideable-dragon")).toMatchObject({ values: { speed: 500 } });

    // 2. An undo: the handler's branch is `manifest.has(id)`, then a removal. Undo the dragon, and the
    // next autosave writes a world without it — the adopted file never resurrects an undone mod.
    expect(manifest.has("rideable-dragon")).toBe(true);
    manifest.delete("rideable-dragon");
    expect(snapshotWorld(requested(), manifest, BUILTINS).map((m) => m.id)).toEqual(["player", "ground", "jetpack"]);
    expect("error" in restarted.saveSlot(SLOT, snapshotWorld(requested(), manifest, BUILTINS))).toBe(false);
    expect(restarted.get(SLOT)!.mods.map((m) => m.id)).toEqual(["player", "ground", "jetpack"]);

    // 3. An edit: the router targets ids out of the manifest text and the edit prompt is built from
    // that mod's own source, so both have to come back from the file.
    const seen = formatManifest([...manifest.values()].map((r) => ({ id: r.id, title: r.title, knobs: r.knobs })));
    expect(seen).toContain("jetpack");
    expect(manifest.get("jetpack")!.source).toBe(fixture.mods[0].source);
    expect(manifest.get("jetpack")!.compiled.length).toBeGreaterThan(0);
  });

  it("never lets the file override a build made after the reconnect", async () => {
    const { root } = await builtAndSaved();
    const manifest = new Map<string, SessionMod>();
    // A build landed first (a fresh jetpack the player asked for while the socket was still down).
    const newer: SessionMod = { id: "jetpack", title: "Jetpack", source: "// rebuilt", compiled: "export default {}", knobs: { thrust: { value: 900, min: 500, max: 2500 } } };
    manifest.set("jetpack", newer);

    const gained = store(root).adoptSlot(SLOT, requested().map((r) => ({ id: r.id })), manifest);
    expect(gained.map((r) => r.id)).toEqual(["rideable-dragon"]);
    expect(manifest.get("jetpack")).toBe(newer);
  });

  it("adopts only what the page still lists, and invents nothing", async () => {
    const { root } = await builtAndSaved();
    const manifest = new Map<string, SessionMod>();
    // The player undid the jetpack before the socket came back: the page no longer lists it.
    const gained = store(root).adoptSlot(SLOT, requested().filter((r) => r.id !== "jetpack"), manifest);
    expect(gained.map((r) => r.id)).toEqual(["rideable-dragon"]);

    // A built-in is the client's own bundle: it is never a reason to hold a record, and an id the
    // file never had is not invented.
    expect(manifest.has("player")).toBe(false);
    expect(adoptStoredMods([{ id: "ghost", values: {} }], new Map(), store(root).get(SLOT))).toEqual([]);
    // No file at all (a new slot, a pruned one): the session simply starts empty.
    expect(store(root).adoptSlot("home-zzzzzzzz9999", requested(), new Map())).toEqual([]);
  });

  it("keeps the untrusted shapes out and the ids one home slot only", async () => {
    const { root } = await builtAndSaved();
    const manifest = new Map<string, SessionMod>();
    // Only a home slot may name a file the server rewrites, exactly like an autosave and a resume.
    expect(validateClientMsg({ kind: "worldAdopt", id: "demo-one", mods: [] }).ok).toBe(false);
    expect(validateClientMsg({ kind: "worldAdopt", id: "../../etc/passwd", mods: [] }).ok).toBe(false);
    expect(validateClientMsg({ kind: "worldAdopt", mods: [] }).ok).toBe(false);
    expect(store(root).adoptSlot("../etc/passwd", requested(), manifest)).toEqual([]);
    expect(manifest.size).toBe(0);
    // A knob value the client reports that the mod does not declare is dropped, not stored.
    const rec = sessionRecOf(snapshotWorld(requested(), await fixtureManifest(), BUILTINS).find((m) => m.id === "jetpack") as Extract<WorldMod, { builtin?: false }>, { nope: 12 });
    expect(Object.keys(rec.knobs).sort()).toEqual(["fuelMax", "thrust"]);
  });
});

describe("when a page asks the server to adopt its file (ADR 0077)", () => {
  const mods = [{ id: "jetpack", values: { thrust: 1800 } }];

  it("asks only from a page that shows its own autosaved world", () => {
    expect(adoptFrame({ worldIsHome: true, slot: SLOT, mods })).toEqual({ kind: "worldAdopt", id: SLOT, mods });
  });

  it("stays quiet for a world opened from a link or a demo, and for an empty page", () => {
    // A linked world has its own mods; the browser's previous file must not be mixed into it.
    expect(adoptFrame({ worldIsHome: false, slot: SLOT, mods })).toBeNull();
    expect(adoptFrame({ worldIsHome: true, slot: SLOT, mods: [] })).toBeNull();
  });
});
