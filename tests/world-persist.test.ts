// The world survives a reload and a server restart (ADR 0070). These tests use the same path the
// game uses: the client's own mod list -> snapshotWorld (the server's verified manifest) -> the
// autosave slot file -> a fresh WorldStore (the restart) -> the mods actually loading again.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOME_SLOT_TTL_MS, WorldStore, parseWorld, reuseStoredMods, snapshotWorld } from "../server/worlds";
import type { SessionMod } from "../server/worlds";
import { compileMod } from "../server/compile";
import { importMod } from "../server/verify";
import { envSecrets, scrubText, scrubWorld } from "../server/hygiene";
import { validateClientMsg } from "../server/validate";
import { HOME_WORLD_PREFIX, isHomeWorldId } from "../src/contract";
import type { WorldMod } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import playerMod from "../src/mods/player";
import groundMod from "../src/mods/ground";

const tmp = () => mkdtempSync(join(tmpdir(), "metabuild-persist-"));
const SLOT = "home-abcdefgh1234";
const store = (root: string) => new WorldStore(join(root, "worlds"), join(root, "demo"));

const fixture = JSON.parse(readFileSync(new URL("./fixtures/playtest-world.json", import.meta.url), "utf8")) as {
  mods: { id: string; title: string; source: string }[];
};

/** The manifest the server would hold after verifying these builds, in one pass. */
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
const requestedList = () => [
  { id: "player", values: {} },
  { id: "ground", values: {} },
  ...fixture.mods.map((m) => ({ id: m.id, values: {} })),
];

describe("the world survives a reload (ADR 0070)", () => {
  it("saves the world under this browser's slot and hands the same world back after a restart", async () => {
    const root = tmp();
    const manifest = await fixtureManifest();
    const mods = snapshotWorld(requestedList(), manifest, BUILTINS);
    expect(mods.map((m) => m.id)).toEqual(["player", "ground", "jetpack", "rideable-dragon"]);

    const first = store(root).saveSlot(SLOT, mods);
    expect("error" in first).toBe(false);

    // A reload: same process, a new connection.
    const reloaded = store(root).get(SLOT);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.mods.map((m) => m.id)).toEqual(["player", "ground", "jetpack", "rideable-dragon"]);
    // A server restart: nothing survives but the file on disk.
    const restarted = new WorldStore(join(root, "worlds"), join(root, "demo")).get(SLOT);
    expect(restarted!.mods).toEqual(reloaded!.mods);
  });

  it("restores mods that still load, tick and clean up after themselves", async () => {
    const root = tmp();
    const manifest = await fixtureManifest();
    store(root).saveSlot(SLOT, snapshotWorld(requestedList(), manifest, BUILTINS));
    const back = new WorldStore(join(root, "worlds"), join(root, "demo")).get(SLOT)!;

    const world = new World(1337);
    const loader = new ModLoader(world);
    loader.load(playerMod);
    loader.load(groundMod);
    for (const m of back.mods) {
      if (m.builtin) continue;
      loader.load(await importMod(m.compiled), m.values);
    }
    for (let i = 0; i < 90; i++) world.step();

    expect(world.entities.some((e) => e.type === "player")).toBe(true);
    expect(world.entities.some((e) => e.type === "dragon")).toBe(true);
    expect(world.entities.some((e) => e.type === "jetpack")).toBe(true);
    expect(world.hud.has("jetpack-fuel")).toBe(true);
    // The restored knobs came from the file, so the mods keep their tuned values.
    expect(back.mods.find((m) => m.id === "rideable-dragon")).toMatchObject({ values: { speed: 260 } });

    for (const m of back.mods) if (!m.builtin) loader.unload(m.id);
    expect(world.entities.some((e) => e.type === "dragon" || e.type === "jetpack")).toBe(false);
    expect(world.hud.has("jetpack-fuel")).toBe(false);
  });

  it("keeps an emptied world empty instead of raising the old one", () => {
    const root = tmp();
    store(root).saveSlot(SLOT, [{ builtin: true, id: "player", values: {} }]);
    // The player undid everything: the file must say so, or the next reload resurrects it.
    expect("error" in store(root).saveSlot(SLOT, [])).toBe(false);
    expect(store(root).get(SLOT)!.mods).toEqual([]);
  });

  it("only lets a home slot be rewritten in place; the share button still makes a new id", async () => {
    const root = tmp();
    const manifest = await fixtureManifest();
    const mods = snapshotWorld(requestedList(), manifest, BUILTINS);
    const s = store(root);

    // A share id, a demo id or a traversal attempt may not overwrite anything.
    expect("error" in s.saveSlot("demo-one", mods)).toBe(true);
    expect("error" in s.saveSlot("../../etc/passwd", mods)).toBe(true);
    expect("error" in s.saveSlot("abcdef", mods)).toBe(true);

    const shared = s.save(mods);
    expect("error" in shared).toBe(false);
    if (!("error" in shared)) {
      expect(isHomeWorldId(shared.id)).toBe(false);
      expect(s.get(shared.id)!.mods).toHaveLength(4);
      // Sharing still refuses an empty world, unlike the autosave.
      expect("error" in s.save([])).toBe(true);
    }
  });

  it("a restarted server cannot empty the player's world: the slot file supplies the mods it forgot", async () => {
    const root = tmp();
    const manifest = await fixtureManifest();
    const requested = requestedList();
    const first = snapshotWorld(requested, manifest, BUILTINS);
    expect("error" in store(root).saveSlot(SLOT, first)).toBe(false);

    // The server restarted between builds: only the built-ins can be adopted, the AI mods are gone
    // from the session. The next autosave must keep them from the file, not write a hollow world.
    const afterRestart = store(root);
    const rebuilt = snapshotWorld(requested, new Map(), BUILTINS);
    expect(rebuilt.map((m) => m.id)).toEqual(["player", "ground"]);
    const kept = reuseStoredMods(requested, rebuilt, afterRestart.get(SLOT));
    expect(kept.map((m) => m.id)).toEqual(["player", "ground", "jetpack", "rideable-dragon"]);
    expect("error" in afterRestart.saveSlot(SLOT, kept)).toBe(false);
    expect(afterRestart.get(SLOT)!.mods.map((m) => m.id)).toEqual(["player", "ground", "jetpack", "rideable-dragon"]);

    // An undo still removes a mod: it is simply no longer requested.
    const undone = reuseStoredMods(requested.filter((r) => r.id !== "jetpack"), rebuilt, afterRestart.get(SLOT));
    expect(undone.map((m) => m.id)).toEqual(["player", "ground", "rideable-dragon"]);
    // A brand-new slot has nothing to reuse, and an unknown id is not invented.
    expect(reuseStoredMods([{ id: "ghost" }], [], null)).toEqual([]);
    expect(reuseStoredMods([{ id: "ghost" }], [], afterRestart.get(SLOT))).toEqual([]);
  });

  it("prunes only old autosaved worlds, never a shared world or a demo", () => {
    const root = tmp();
    const worldsDir = join(root, "worlds");
    const demoDir = join(root, "demo");
    mkdirSync(worldsDir, { recursive: true });
    mkdirSync(demoDir, { recursive: true });
    const body = (id: string) => JSON.stringify({ v: 1, id, createdAt: "", mods: [{ builtin: true, id: "player", values: {} }] });
    const old = Date.now() / 1000 - (HOME_SLOT_TTL_MS / 1000) * 2;
    const write = (dir: string, id: string) => {
      const file = join(dir, `${id}.json`);
      writeFileSync(file, body(id));
      utimesSync(file, old, old);
      return file;
    };
    const oldSlot = write(worldsDir, `${HOME_WORLD_PREFIX}oldoldold1234`);
    const freshSlot = join(worldsDir, `${HOME_WORLD_PREFIX}freshfresh12.json`);
    writeFileSync(freshSlot, body(`${HOME_WORLD_PREFIX}freshfresh12`));
    const shared = write(worldsDir, "sharedworld1");
    const demo = write(demoDir, "demo-one");

    const removed = store(root).pruneSlots();
    expect(removed).toBe(1);
    expect(() => statSync(oldSlot)).toThrow();
    expect(statSync(freshSlot).isFile()).toBe(true);
    expect(statSync(shared).isFile()).toBe(true);
    expect(statSync(demo).isFile()).toBe(true);
  });
});

describe("a saved world carries no secrets and no personal data (ADR 0070)", () => {
  const dirty = (): WorldMod[] => [
    { builtin: true, id: "player", values: {} },
    {
      id: "note-board",
      title: "Note board for ada@example.com",
      source: `const token = "sk-live-abcdefghijklmnopqrst";\n// saved from C:\\Users\\ada\\Documents\\game\nconst id = "note-board";`,
      compiled: `const token = "sk-live-abcdefghijklmnopqrst";export default { id: "note-board" };`,
      knobs: {},
      values: { owner: "ada@example.com" },
    },
  ];

  it("redacts keys, emails and home paths on the way to the file, and the file still parses", () => {
    const root = tmp();
    const saved = store(root).saveSlot(SLOT, dirty());
    expect("error" in saved).toBe(false);
    const text = readFileSync(join(root, "worlds", `${SLOT}.json`), "utf8");
    expect(text).not.toContain("sk-live-abcdefghijklmnopqrst");
    expect(text).not.toContain("ada@example.com");
    expect(text).not.toContain("Users\\ada");
    expect(text).toContain("[redacted]");
    const back = parseWorld(text)!;
    expect(back.mods).toHaveLength(2);
    expect(back.id).toBe(SLOT);
  });

  it("cuts the process's own key out of a world even when an env var is not a known pattern", () => {
    const secret = "zq8fJ2kLmN4pQ7rT9vW1";
    expect(scrubText(`token=${secret}`, [secret])).not.toContain(secret);
    const world = scrubWorld({ mods: [{ source: `const k = "${secret}";` }] }, [secret]);
    expect(world.mods[0].source).not.toContain(secret);
    expect(envSecrets({ MODEL_API_KEY: secret, BASETEN_API_KEY: "short", PORT: "8787" })).toEqual([secret]);
  });

  it("leaves an honest mod alone, so a scrubbed world still compiles", () => {
    const source = fixture.mods[0].source;
    expect(scrubText(source)).toBe(source);
    const compiled = compileMod(scrubText(source));
    expect(compiled.errors).toEqual([]);
  });
});

describe("the autosave wire messages (ADR 0070)", () => {
  const mods = [{ id: "player", values: {} }];

  it("accepts an autosave for a home slot and drops any other slot id", () => {
    const good = validateClientMsg({ kind: "worldSave", mods, slot: SLOT });
    expect(good).toEqual({ ok: true, msg: { kind: "worldSave", mods, slot: SLOT } });
    const wrong = validateClientMsg({ kind: "worldSave", mods, slot: "demo-one" });
    expect(wrong).toEqual({ ok: true, msg: { kind: "worldSave", mods } });
    const evil = validateClientMsg({ kind: "worldSave", mods, slot: "../../etc" });
    expect(evil).toEqual({ ok: true, msg: { kind: "worldSave", mods } });
  });

  it("accepts a resume only for a home slot", () => {
    expect(validateClientMsg({ kind: "worldResume", id: SLOT })).toEqual({ ok: true, msg: { kind: "worldResume", id: SLOT } });
    expect(validateClientMsg({ kind: "worldResume", id: "demo-one" }).ok).toBe(false);
    expect(validateClientMsg({ kind: "worldResume" }).ok).toBe(false);
  });

  it("carries the new-world reset flag through validation", () => {
    expect(validateClientMsg({ kind: "worldState", mods, reset: true })).toEqual({ ok: true, msg: { kind: "worldState", mods, reset: true } });
    expect(validateClientMsg({ kind: "worldState", mods, reset: "yes" })).toEqual({ ok: true, msg: { kind: "worldState", mods } });
  });
});
