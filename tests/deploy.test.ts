import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Budget, DEFAULT_SESSION, readLimits } from "../server/budget";
import { WorldStore, isWorldId, parseWorld, sanitizeValues, snapshotWorld } from "../server/worlds";
import type { SessionMod } from "../server/worlds";
import { createStaticHandler, resolveInside } from "../server/static";

const tmp = () => mkdtempSync(join(tmpdir(), "metabuild-"));
const lim = (n: number) => ({ build: n, image: n, sam: n, voice: n });

describe("budget", () => {
  it("allows up to the per-visitor limit, then refuses with a friendly message", () => {
    const b = new Budget({ session: lim(2), global: lim(100) });
    expect(b.take("a", "build").ok).toBe(true);
    expect(b.take("a", "build").ok).toBe(true);
    const v = b.take("a", "build");
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.scope).toBe("session"); expect(v.message).toMatch(/AI builds/); expect(v.message).toMatch(/demo/i); }
    expect(b.take("b", "build").ok).toBe(true); // another visitor is unaffected
  });

  it("enforces the global cap across visitors", () => {
    const b = new Budget({ session: lim(10), global: lim(2) });
    b.take("a", "image"); b.take("b", "image");
    const v = b.take("c", "image");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.scope).toBe("global");
  });

  it("a refused take spends nothing, and kinds are independent", () => {
    const b = new Budget({ session: { ...lim(5), sam: 0 }, global: lim(100) });
    expect(b.take("a", "sam").ok).toBe(false);
    expect(b.snapshot().global.sam).toBe(0);
    expect(b.take("a", "build").ok).toBe(true);
  });

  it("the kill-switch refuses everything, and can be flipped live", () => {
    let on = true;
    const b = new Budget({ session: lim(5), global: lim(5), killSwitch: () => on });
    const v = b.take("a", "build");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.scope).toBe("killswitch");
    on = false;
    expect(b.take("a", "build").ok).toBe(true);
  });

  it("voice seconds are booked after the fact and eventually refuse new sessions", () => {
    const b = new Budget({ session: { ...lim(5), voice: 60 }, global: lim(1000) });
    expect(b.check("a", "voice", 10).ok).toBe(true);
    b.add("a", "voice", 55);
    expect(b.check("a", "voice", 10).ok).toBe(false);
  });

  it("counters reset at the UTC day boundary", () => {
    let t = Date.parse("2026-10-29T23:59:00Z");
    const b = new Budget({ session: lim(1), global: lim(1), now: () => t });
    expect(b.take("a", "build").ok).toBe(true);
    expect(b.take("a", "build").ok).toBe(false);
    t = Date.parse("2026-10-30T00:00:01Z");
    expect(b.take("a", "build").ok).toBe(true);
  });

  it("counters survive a restart within the same day", () => {
    const file = join(tmp(), "budget.json");
    const t = () => Date.parse("2026-10-29T12:00:00Z");
    const one = new Budget({ session: lim(1), global: lim(5), now: t, file });
    one.take("a", "build");
    one.stop();
    const two = new Budget({ session: lim(1), global: lim(5), now: t, file });
    two.stop();
    expect(two.take("a", "build").ok).toBe(false);
  });

  it("reads limits from env, voice in minutes, ignoring junk", () => {
    const l = readLimits({ BUDGET_SESSION_BUILDS: "3", BUDGET_GLOBAL_VOICE_MIN: "2", BUDGET_SESSION_IMAGES: "lots" });
    expect(l.session.build).toBe(3);
    expect(l.global.voice).toBe(120);
    expect(l.session.image).toBe(DEFAULT_SESSION.image);
  });
});

const mod = (id: string): SessionMod => ({
  id, title: id.toUpperCase(), source: `export default {id:"${id}"}`, compiled: `export default {id:"${id}"}`,
  knobs: { speed: { value: 5, min: 1, max: 9 } },
});

describe("worlds", () => {
  const builtins = new Set(["player", "ground"]);

  it("snapshots built-ins as references and AI mods from the verified manifest, dropping unknown ids", () => {
    const manifest = new Map([["ball", mod("ball")]]);
    manifest.get("ball")!.knobs.speed.value = 7; // a tweak the server saw
    const mods = snapshotWorld([
      { id: "player", values: { moveSpeed: 300 } },
      { id: "ball", values: { speed: 999 } }, // client-claimed value is ignored for AI mods
      { id: "ghost", values: {} }, // not loaded server-side: dropped
      { id: "player", values: {} }, // duplicate: dropped
    ], manifest, builtins);
    expect(mods).toHaveLength(2);
    expect(mods[0]).toEqual({ builtin: true, id: "player", values: { moveSpeed: 300 } });
    expect(mods[1]).toMatchObject({ id: "ball", values: { speed: 7 } });
  });

  it("a client cannot smuggle code into a saved world", () => {
    const mods = snapshotWorld([{ id: "evil", values: { source: "x" } }], new Map(), builtins);
    expect(mods).toHaveLength(0);
  });

  it("round-trips a world with 3 AI mods through the store", () => {
    const store = new WorldStore(join(tmp(), "w"), join(tmp(), "demo"));
    const manifest = new Map(["a", "b", "c"].map((i) => [i, mod(i)] as const));
    const saved = store.save(snapshotWorld([{ id: "player", values: {} }, ...["a", "b", "c"].map((id) => ({ id, values: {} }))], manifest, builtins));
    if ("error" in saved) throw new Error(saved.error);
    expect(isWorldId(saved.id)).toBe(true);
    const back = store.get(saved.id)!;
    expect(back.mods.map((m) => m.id)).toEqual(["player", "a", "b", "c"]);
    expect(back.mods.filter((m) => !m.builtin)).toHaveLength(3);
    expect(back.mods[1]).toMatchObject({ source: 'export default {id:"a"}', knobs: { speed: { value: 5 } } });
  });

  it("refuses to save an empty world and rejects path-like ids", () => {
    const store = new WorldStore(join(tmp(), "w"), join(tmp(), "demo"));
    expect("error" in store.save([])).toBe(true);
    expect(store.get("../../etc/passwd")).toBeNull();
    expect(store.get("nope")).toBeNull();
    expect(isWorldId("a/b")).toBe(false);
  });

  it("lists curated demo worlds and survives a corrupt file", () => {
    const demo = tmp();
    writeFileSync(join(demo, "demo-one.json"), JSON.stringify({ v: 1, id: "demo-one", title: "One", blurb: "b", createdAt: "", mods: [{ builtin: true, id: "player", values: {} }] }));
    writeFileSync(join(demo, "demo-bad.json"), "{ not json");
    const store = new WorldStore(join(tmp(), "w"), demo);
    expect(store.demos()).toEqual([{ id: "demo-one", title: "One", blurb: "b" }]);
    expect(store.get("demo-one")!.mods).toHaveLength(1);
    expect(store.get("demo-bad")).toBeNull();
  });

  it("sanitizes knob values and parseWorld rejects wrong versions", () => {
    expect(sanitizeValues({ a: 1, b: "x", c: true, d: NaN, e: {}, f: "y".repeat(200) })).toEqual({ a: 1, b: "x", c: true });
    expect(parseWorld(JSON.stringify({ v: 2, id: "abcd", mods: [] }))).toBeNull();
  });
});

describe("static server", () => {
  let server: Server | null = null;
  afterEach(() => { server?.close(); server = null; });

  async function boot() {
    const root = tmp();
    const dist = join(root, "dist");
    const gen = join(root, "gen");
    mkdirSync(join(dist, "assets"), { recursive: true });
    mkdirSync(gen, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>app</title>");
    writeFileSync(join(dist, "assets", "app-abc.js"), "console.log(1)");
    writeFileSync(join(gen, "ball.webp"), "RIFFfake");
    writeFileSync(join(root, "secret.txt"), "top secret");
    server = createServer(createStaticHandler({ distDir: dist, genArtDir: gen }));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { base, root, dist };
  }

  it("serves the app at / and for share links, with SPA fallback", async () => {
    const { base } = await boot();
    expect(await (await fetch(base + "/")).text()).toContain("<title>app</title>");
    expect(await (await fetch(base + "/?w=abc123")).text()).toContain("<title>app</title>");
    expect(await (await fetch(base + "/some/route")).text()).toContain("<title>app</title>");
    expect((await fetch(base + "/missing.js")).status).toBe(404);
  });

  it("caches hashed assets, serves runtime art, and answers /healthz", async () => {
    const { base } = await boot();
    const a = await fetch(base + "/assets/app-abc.js");
    expect(a.headers.get("cache-control")).toMatch(/immutable/);
    expect(a.headers.get("content-type")).toMatch(/javascript/);
    expect((await fetch(base + "/art/gen/ball.webp")).headers.get("content-type")).toBe("image/webp");
    expect(await (await fetch(base + "/healthz")).text()).toBe("ok");
  });

  it("does not escape the served directory", async () => {
    const { base, dist, root } = await boot();
    expect(resolveInside(dist, "/../secret.txt")).toBeNull();
    expect(resolveInside(dist, "/%2e%2e/secret.txt")).toBeNull();
    expect(resolveInside(dist, "/index.html")).toBe(join(dist, "index.html"));
    const res = await fetch(base + "/%2e%2e%2fsecret.txt");
    expect(await res.text()).not.toContain("top secret");
    expect(readFileSync(join(root, "secret.txt"), "utf8")).toBe("top secret");
    expect((await fetch(base + "/", { method: "POST" })).status).toBe(405);
  });
});
