// Headless hold-to-talk check: acts as the browser (binary PCM over our WebSocket) against a
// running server, N runs, and reports press→first partial and release→final.
//   powershell scripts/voice-synth.ps1; npx tsx scripts/voice-check.ts [runs] [--build]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { loadEnv } from "../server/meta";

loadEnv();
const dir = process.env.VOICE_DIR ?? join(process.env.TEMP ?? ".", "voice");
const url = process.env.VITE_WS_URL ?? `ws://127.0.0.1:${process.env.PORT ?? 8787}`;
const runs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 10);
const build = process.argv.includes("--build");
const phrases: [string, string][] = [["ninja", "add a ninja"], ["rain", "make it rain"]];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();

const ws = new WebSocket(url);
const inbox: Record<string, unknown>[] = [];
let wake: (() => void) | null = null;
ws.on("message", (d) => { inbox.push(JSON.parse(String(d))); wake?.(); });
const next = async (pred: (m: Record<string, unknown>) => boolean, ms: number): Promise<Record<string, unknown> | null> => {
  const end = Date.now() + ms;
  for (;;) {
    const i = inbox.findIndex(pred);
    if (i >= 0) return inbox.splice(i, 1)[0];
    const left = end - Date.now();
    if (left <= 0) return null;
    await new Promise<void>((r) => { wake = r; setTimeout(r, left); });
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
ws.send(JSON.stringify({ kind: "voiceWarm" }));
const ready = await next((m) => m.kind === "voiceState", 5000);
console.log("warm:", ready ? JSON.stringify(ready) : "no voiceState (cold)");

const firstPartial: number[] = [], finalMs: number[] = [], fromOnset: number[] = [];
let correct = 0, built = 0;
for (let i = 0; i < runs; i++) {
  const [name, expect] = phrases[i % phrases.length];
  const pcm = readFileSync(join(dir, `${name}.wav`)).subarray(44);
  let onsetMs = 0; // first audible sample (SAPI audio has lead-in silence a live mic user would not)
  while (onsetMs < pcm.length / 32 && Math.abs(pcm.readInt16LE(onsetMs * 32)) < 800) onsetMs++;
  await sleep(1500); // let the next warm session finish its handshake, like a real pause between commands
  const t0 = performance.now();
  ws.send(JSON.stringify({ kind: "voiceStart" }));
  let sent = 0;
  const begin = Date.now();
  while (sent < pcm.length) { // mic pacing: 20 ms frames in real time
    ws.send(pcm.subarray(sent, sent + 640));
    sent += 640;
    await sleep(Math.max(0, begin + (sent / 640) * 20 - Date.now()));
  }
  ws.send(JSON.stringify({ kind: "voiceEnd" }));
  const t1 = performance.now();
  const fin = await next((m) => m.kind === "transcript" && m.final === true, 8000);
  const text = String(fin?.text ?? "");
  const ms = fin?.ms as { firstPartial: number; final: number } | undefined;
  const ok = norm(text) === norm(expect);
  if (ok) correct++;
  if (ms) { firstPartial.push(ms.firstPartial); finalMs.push(ms.final); fromOnset.push(ms.firstPartial - onsetMs); }
  let buildNote = "";
  if (ok && build) {
    ws.send(JSON.stringify({ kind: "command", text }));
    const mod = await next((m) => m.kind === "mod", 90000);
    if (mod) built++;
    buildNote = mod ? ` built ${(mod.mod as { id: string }).id}` : " BUILD TIMEOUT";
  }
  console.log(`run ${i + 1}: "${text}" ${ok ? "OK" : "MISMATCH (expected " + expect + ")"} first partial ${ms?.firstPartial}ms after press (speech onset at ${onsetMs}ms), release→final ${ms?.final}ms, wall ${Math.round(performance.now() - t1)}ms after release${buildNote}`);
  void t0;
}
console.log(`\n${correct}/${runs} transcribed correctly${build ? `, ${built} built` : ""}`);
if (firstPartial.length) {
  console.log(`press→first partial ms: p50 ${pct(firstPartial, 0.5)}  p95 ${pct(firstPartial, 0.95)}  min ${Math.min(...firstPartial)}  max ${Math.max(...firstPartial)}`);
  console.log(`speech onset→first partial ms: p50 ${pct(fromOnset, 0.5)}  p95 ${pct(fromOnset, 0.95)}  min ${Math.min(...fromOnset)}  max ${Math.max(...fromOnset)}`);
  console.log(`release→final ms:       p50 ${pct(finalMs, 0.5)}  p95 ${pct(finalMs, 0.95)}  min ${Math.min(...finalMs)}  max ${Math.max(...finalMs)}`);
}
ws.close();
process.exit(0);
