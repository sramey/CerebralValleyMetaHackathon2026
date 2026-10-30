// Cold-start check (bead q2s): the shipped build must serve its page, its main bundle and
// the server's greeting frame — with no usable Meta key in the server process, so the run
// makes zero AI calls. It also runs a negative control: a socket that accepts connections
// and stays silent must fail the same probe, so a broken handshake cannot pass unnoticed.
//
//   npm run cold:check                 # build the client, then check
//   npm run cold:check -- --no-build   # reuse an existing dist/
//   npm run cold:check -- --port 8798  # another port (default: PORT from .env)
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { loadEnv } from "../server/meta";

type Msg = Record<string, unknown>;

/** Give up on the handshake after this: a cold page must be talking to the server in seconds. */
const GREETING_BUDGET_MS = 5000;
/** How long to keep reading after the greeting (the `visitor` frame follows it immediately). */
const LINGER_MS = 400;
/** The server needs to boot, bind and answer /healthz. */
const BOOT_BUDGET_MS = 40000;

const fails: string[] = [];
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails.push(what);
}

/** The greeting every connection gets (server/index.ts): a `say` line, or a world payload. */
export function isGreetingFrame(m: Msg): boolean {
  return m.kind === "say" || m.kind === "world";
}

/** `src` of the entry module script in the built index.html (vite rewrites it to /assets/*.js). */
export function bundleSrcFromHtml(html: string): string | null {
  const m = /<script[^>]*type="module"[^>]*src="([^"]+)"/i.exec(html)
    ?? /<script[^>]*src="([^"]+\.js)"[^>]*>/i.exec(html);
  return m ? m[1] : null;
}

const sleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

interface Probe {
  ok: boolean;
  /** Milliseconds until the greeting frame arrived (the handshake itself). */
  ms: number;
  why: string;
  frames: Msg[];
}

/** Connect, wait for the greeting frame, then linger briefly to collect what follows it. */
function probeGreeting(url: string, timeoutMs: number): Promise<Probe> {
  const t0 = Date.now();
  const frames: Msg[] = [];
  const ws = new WebSocket(url);
  return new Promise<Probe>((settle) => {
    let done = false;
    let greeted = false;
    let greetedIn = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let linger: ReturnType<typeof setTimeout> | null = null;
    const finish = (ok: boolean, why: string): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (linger) clearTimeout(linger);
      try { ws.close(); } catch { /* already gone */ }
      settle({ ok, ms: ok ? greetedIn : Date.now() - t0, why, frames });
    };
    timer = setTimeout(() => finish(false, `no greeting frame within ${timeoutMs} ms`), timeoutMs);
    ws.on("error", (err) => finish(false, `socket error: ${err.message}`));
    ws.on("close", () => { if (!greeted) finish(false, "the server closed the socket without a greeting"); });
    ws.on("message", (data) => {
      let m: Msg;
      try { m = JSON.parse(String(data)) as Msg; } catch { return; }
      frames.push(m);
      if (done || greeted || !isGreetingFrame(m)) return;
      greeted = true;
      greetedIn = Date.now() - t0;
      if (timer) clearTimeout(timer);
      linger = setTimeout(() => finish(true, typeof m.text === "string" ? m.text : String(m.kind)), LINGER_MS);
    });
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const srv = createServer();
    srv.once("error", () => ok(false));
    srv.once("listening", () => srv.close(() => ok(true)));
    srv.listen(port, "127.0.0.1");
  });
}

/** Boot the real server: empty key on purpose (see startServer). Logs stay in memory. */
function startServer(port: number, dataDir: string): { child: ChildProcess; log: string[] } {
  const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const log: string[] = [];
  const child = spawn(process.execPath, [tsxCli, join(process.cwd(), "server", "index.ts")], {
    cwd: process.cwd(),
    // MODEL_API_KEY="" is present but empty, which stops server/meta.ts loadEnv() from
    // filling the key in from .env: this process can never reach a Meta model.
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", MODEL_API_KEY: "", DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (chunk: Buffer): void => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) log.push(line.trim());
    while (log.length > 200) log.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return { child, log };
}

async function waitHealthy(port: number, budgetMs: number): Promise<boolean> {
  const end = Date.now() + budgetMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(800) });
      if (res.ok) return true;
    } catch { /* not listening yet */ }
    await sleep(100);
  }
  return false;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill();
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

/** A socket that accepts and never greets: the probe must call it a failure. */
async function negativeControl(): Promise<void> {
  const mute = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r, j) => { mute.once("listening", () => r()); mute.once("error", j); });
  const addr = mute.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const probe = await probeGreeting(`ws://127.0.0.1:${port}`, 1500);
  await new Promise<void>((r) => mute.close(() => r()));
  check(!probe.ok, `negative control: a socket that never greets fails the probe (${probe.why}, ${probe.ms} ms)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? "") : null;
  };
  const skipBuild = args.includes("--no-build");
  loadEnv(); // .env gives this worktree its own PORT; values are never printed
  const port = Number(flag("--port") ?? process.env.PORT ?? 8787);
  const dataDir = join(process.cwd(), "data", "cold-check");

  // 1. The client bundle the server will serve.
  const distIndex = join(process.cwd(), "dist", "index.html");
  if (skipBuild && !existsSync(distIndex)) {
    check(false, "--no-build was given but dist/index.html is missing (run: npm run build)");
    return;
  }
  if (!skipBuild) {
    console.log("building the client (vite build)…");
    const { build } = await import("vite");
    await build({ logLevel: "warn" });
    check(existsSync(distIndex), "vite build wrote dist/index.html");
  }

  // 2. Our own server, on its own port.
  if (!(await portFree(port))) {
    check(false, `port ${port} is already in use: stop that server, or pass --port <n>`);
    return;
  }
  const { child, log } = startServer(port, dataDir);
  try {
    const up = await waitHealthy(port, BOOT_BUDGET_MS);
    check(up, `server answered /healthz on port ${port}`);
    if (!up) { console.log(log.slice(-15).join("\n")); return; }

    // 3. Page + main bundle over plain HTTP, exactly as a cold visitor fetches them.
    const base = `http://127.0.0.1:${port}`;
    const pageRes = await fetch(`${base}/`);
    const page = await pageRes.text();
    check(pageRes.ok && /text\/html/i.test(pageRes.headers.get("content-type") ?? ""), "GET / serves HTML");
    check(/<title>/i.test(page), "the page has a title");
    const src = bundleSrcFromHtml(page);
    check(!!src, `the page references its entry module script (${src ?? "none found"})`);
    if (src) {
      const jsRes = await fetch(new URL(src, base));
      const js = await jsRes.text();
      check(jsRes.ok, `GET ${src} is served`);
      check(/javascript/i.test(jsRes.headers.get("content-type") ?? ""), "the bundle is served as JavaScript");
      check(js.length > 20_000, `the bundle is a real build (${Math.round(js.length / 1024)} KB)`);
      check(js.includes("Server: offline"), "the bundle is the current client (offline-status string present)");
    }

    // 4. The handshake: the greeting frame must arrive fast, with no key in the process.
    const probe = await probeGreeting(`ws://127.0.0.1:${port}`, GREETING_BUDGET_MS);
    check(probe.ok, `greeting frame arrived in ${probe.ms} ms (budget ${GREETING_BUDGET_MS} ms): ${probe.why}`);
    const visitor = probe.frames.find((m) => m.kind === "visitor");
    check(visitor?.reason === "nokey", `the server booted without a Meta key (visitor frame: ${String(visitor?.reason ?? "none")})`);
    check(Array.isArray(visitor?.demos), "visitor mode still offers the demo worlds");

    // 5. The probe must be able to fail.
    await negativeControl();
  } finally {
    await stopServer(child);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .catch((err) => {
      console.error(`cold:check failed: ${err instanceof Error ? err.message : String(err)}`);
      fails.push("the check itself threw");
    })
    .finally(() => {
      console.log(fails.length ? `\n${fails.length} FAILED` : "\nall checks passed (zero AI calls)");
      process.exit(fails.length ? 1 : 0);
    });
}
