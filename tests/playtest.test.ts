import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileMod } from "../server/compile";
import { importMod } from "../server/verify";
import { playtestMod } from "../server/playtest";
import type { WorldMod } from "../server/playtest";
import { PLAYTEST, rleDecode, rleEncode, runBot, unpackInput } from "../src/sim/playtest";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";

const builtin = (file: string) => readFileSync(`src/mods/${file}`, "utf8");
const js = (src: string) => { const c = compileMod(src); if (!c.ok) throw new Error(c.errors.join(";")); return c.js; };
const starter: WorldMod[] = [
  { id: "player", compiled: js(builtin("player.ts")) },
  { id: "ground", compiled: js(builtin("ground.ts")) },
];
const candidate = async (src: string) => ({ def: await importMod(js(src)) });

const wallAtSpawn = `export default {
  id: "wall", title: "Wall",
  setup(api) { api.spawn({ type: "wall", x: 160, y: 0, w: 40, h: 400, solid: true, gravityScale: 0 }); },
  dispose(api) { for (const e of api.byType("wall")) api.despawn(e.id); },
};`;

const hugePlayer = `export default {
  id: "player", title: "Player",
  setup(api) {
    const p = api.spawn({ type: "player", x: 120, y: 0, w: 110, h: 400, gravityScale: 1 });
    api.onTick(() => { const i = api.input(); p.vx = i.right ? 260 : i.left ? -260 : 0; if (i.jump && p.onGround) p.vy = -720; });
  },
  dispose(api) { for (const e of api.byType("player")) api.despawn(e.id); },
};`;

const knockout = `export default {
  id: "ko", title: "Knockout",
  setup(api) { api.onTick(() => { const p = api.player(); if (p) api.damage(p.id, 100); }); },
  dispose() {},
};`;

const goodTurtle = `export default {
  id: "turtle", title: "Turtle",
  setup(api) { const t = api.spawn({ type: "turtle", x: 600, y: 360, w: 30, h: 30, gravityScale: 1 }); api.onTick(() => { t.vx = 40; }); },
  dispose(api) { for (const e of api.byType("turtle")) api.despawn(e.id); },
};`;

describe("playtest", () => {
  it("passes a known-good mod", async () => {
    const r = await playtestMod(starter, await candidate(goodTurtle));
    expect(r.ok, r.detail).toBe(true);
  });

  it("passes the bare starter world as its own baseline", async () => {
    const r = await playtestMod(starter, await candidate(builtin("rain.ts")));
    expect(r.ok, r.detail).toBe(true);
  });

  it("catches a wall at spawn and explains it", async () => {
    const r = await playtestMod(starter, await candidate(wallAtSpawn));
    expect(r.ok).toBe(false);
    expect(r.plain).toMatch(/stuck/i);
    expect(r.detail).toMatch(/wall/);
  });

  it("catches a player made too big to get through", async () => {
    const r = await playtestMod(starter, await candidate(hugePlayer));
    expect(r.ok).toBe(false);
    expect(r.plain).toMatch(/too big/i);
  });

  it("catches a mod that knocks the player out on spawn", async () => {
    const r = await playtestMod(starter, await candidate(knockout));
    expect(r.ok).toBe(false);
    expect(r.plain).toMatch(/knocked out/i);
  });

  it("skips judging when there is no player to play", async () => {
    const r = await playtestMod([], await candidate(goodTurtle));
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it("is deterministic and its recorded inputs replay to the same run", async () => {
    const a = await playtestMod(starter, await candidate(goodTurtle));
    const b = await playtestMod(starter, await candidate(goodTurtle));
    expect(a.inputs).toEqual(b.inputs);
    const world = new World(a.seed);
    const loader = new ModLoader(world);
    for (const m of [...starter, { id: "turtle", compiled: js(goodTurtle) }]) loader.load(await importMod(m.compiled));
    const direct = runBot(world, a.seed);
    expect(direct.inputs).toEqual(a.inputs);
    const replay = new World(a.seed);
    const rl = new ModLoader(replay);
    for (const m of [...starter, { id: "turtle", compiled: js(goodTurtle) }]) rl.load(await importMod(m.compiled));
    for (const mask of rleDecode(a.inputs)) { replay.input = unpackInput(mask); replay.step(); }
    expect(Math.round(replay.entities.find((e) => e.type === "player")!.x)).toBe(Math.round(world.entities.find((e) => e.type === "player")!.x));
  });

  it("stays well under a second", async () => {
    const t0 = performance.now();
    await playtestMod(starter, await candidate(goodTurtle));
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("round-trips run-length input encoding", () => {
    const masks = [2, 2, 2, 6, 6, 2, 0];
    expect(rleDecode(rleEncode(masks))).toEqual(masks);
    expect(PLAYTEST.frames).toBeGreaterThan(0);
  });

  it("lets a normal player, the bot and every built-in mod get past the overhang", async () => {
    for (const f of ["enemy.ts", "coins.ts", "rain.ts", "fire-arrow.ts", "platform-moving.ts", "chicken.ts"]) {
      const r = await playtestMod(starter, await candidate(builtin(f)));
      expect(r.ok, `${f}: ${r.detail}`).toBe(true);
    }
    const w = new World(11);
    const l = new ModLoader(w);
    for (const m of starter) l.load(await importMod(m.compiled));
    expect(runBot(w, 11).progress).toBeGreaterThan(1000);
  });

  it("only rejects a huge player because of the overhang", async () => {
    const noOverhang: WorldMod[] = [starter[0], { ...starter[1], values: { overhang: false } }];
    const r = await playtestMod(noOverhang, await candidate(hugePlayer));
    expect(r.ok, r.detail).toBe(true);
  });
});
