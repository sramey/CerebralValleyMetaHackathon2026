// Live spend-guard check: start the server with a tiny budget / kill-switch / no key, then run this.
//   PORT=8791 npx tsx scripts/spend-check.ts "add a glowing orb" "add a spinning star"
import { WebSocket } from "ws";
import { loadEnv } from "../server/meta";

loadEnv();
const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT ?? 8787}`);
const log: Record<string, unknown>[] = [];
ws.on("message", (d) => log.push(JSON.parse(String(d))));
await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await wait(500);
console.log("on connect:", JSON.stringify(log.filter((m) => m.kind === "visitor").map((m) => ({ reason: m.reason, demos: (m.demos as unknown[]).length }))));
for (const text of process.argv.slice(2)) {
  log.length = 0;
  ws.send(JSON.stringify({ kind: "command", text }));
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !log.some((m) => m.kind === "mod" || m.kind === "timing")) await wait(100);
  console.log(`"${text}" ->`, log.some((m) => m.kind === "mod") ? "BUILT" : "no mod", "|", log.filter((m) => m.kind === "say" || m.kind === "visitor").map((m) => (m.kind === "say" ? `say: ${m.text}` : `visitor(${m.reason})`)).join(" | "));
}
ws.close();
process.exit(0);
