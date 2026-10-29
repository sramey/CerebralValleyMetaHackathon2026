// Live share-link check against a running server (one port): builds 3 AI mods in session A, saves the
// world, opens the link in a fresh session B and compares, then fetches / and /?w= over plain HTTP.
//   npx tsx scripts/deploy-check.ts [--demo <name> "<Title>" "<blurb>"]
// --demo copies the saved world to worlds/demo-<name>.json (a curated visitor-mode world).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { loadEnv } from "../server/meta";

loadEnv();
const port = process.env.PORT ?? "8787";
const http = `http://127.0.0.1:${port}`;
const COMMANDS = ["add a bouncing ball", "add a patrolling robot", "add a swarm of glowing fireflies"];

type Msg = Record<string, unknown>;
async function connect(): Promise<{ ws: WebSocket; next: (pred: (m: Msg) => boolean, ms: number) => Promise<Msg | null> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox: Msg[] = [];
  let wake: (() => void) | null = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(String(d))); wake?.(); });
  await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
  const next = async (pred: (m: Msg) => boolean, ms: number) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(i, 1)[0];
      const left = end - Date.now();
      if (left <= 0) return null;
      await new Promise<void>((r) => { wake = r; setTimeout(r, left); });
    }
  };
  return { ws, next };
}

const fails: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) fails.push(what); };

const a = await connect();
const built: { id: string; compiled: string }[] = [];
for (const c of COMMANDS) {
  a.ws.send(JSON.stringify({ kind: "command", text: c }));
  const mod = await a.next((m) => m.kind === "mod" || (m.kind === "say" && /budget|used up|switched off|isn't connected/i.test(String(m.text))), 120000);
  if (mod?.kind === "mod") { const m = mod.mod as { id: string; compiled: string }; built.push({ id: m.id, compiled: m.compiled }); console.log(`built ${m.id}`); }
  else console.log(`no mod for "${c}": ${JSON.stringify(mod)}`);
}
check(built.length === 3, `3 AI mods built in session A (${built.map((b) => b.id).join(", ")})`);

a.ws.send(JSON.stringify({ kind: "worldSave", mods: [{ id: "player", values: {} }, { id: "ground", values: {} }, ...built.map((b) => ({ id: b.id, values: {} }))] }));
const saved = await a.next((m) => m.kind === "worldSaved", 10000);
const id = String(saved?.id ?? "");
check(!!id, `world saved, id ${id}`);

const b = await connect();
b.ws.send(JSON.stringify({ kind: "worldLoad", id }));
const w = await b.next((m) => m.kind === "world", 10000);
const mods = (w?.mods ?? []) as { id: string; builtin?: boolean; compiled?: string }[];
check(mods.length === 5, `session B opened the link with ${mods.length} mods (2 built-in + 3 AI)`);
check(built.every((x) => mods.find((m) => m.id === x.id)?.compiled === x.compiled), "AI mod code is byte-identical after the round trip");

// Remix: the loaded world is editable server-side (undo works on a loaded AI mod).
b.ws.send(JSON.stringify({ kind: "undo", modId: built[0].id }));
check(!!(await b.next((m) => m.kind === "removed" && m.modId === built[0].id, 5000)), "remix: undo works on a mod from the shared world");

// A third visitor must not see session A's mods (per-session worlds).
const c = await connect();
c.ws.send(JSON.stringify({ kind: "undo", modId: built[1].id }));
const stray = await c.next((m) => m.kind === "removed", 1500);
check(stray === null, "a different visitor's session does not share A's mods");

const root = await fetch(`${http}/`);
const link = await fetch(`${http}/?w=${id}`);
check(root.ok && (await root.text()).includes("<title>"), "GET / serves the client");
check(link.ok && (await link.text()).includes("<title>"), "GET /?w=<id> serves the client");

const demo = process.argv.indexOf("--demo");
if (demo > 0 && id) {
  const [name, title, blurb] = process.argv.slice(demo + 1);
  const src = join(process.cwd(), process.env.DATA_DIR ?? "data", "worlds", `${id}.json`);
  const w2 = JSON.parse(readFileSync(src, "utf8"));
  w2.id = `demo-${name}`; w2.title = title; w2.blurb = blurb;
  writeFileSync(join(process.cwd(), "worlds", `demo-${name}.json`), JSON.stringify(w2, null, 1));
  console.log(`wrote worlds/demo-${name}.json`);
}
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
