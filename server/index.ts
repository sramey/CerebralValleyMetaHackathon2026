// WebSocket game server on port 8787. Route (Spark) -> write (Wonder) ->
// compile -> verify -> one auto-fix -> hot-load message. Never crashes on a
// bad mod or a missing MODEL_API_KEY (answers with say in that case).
import { WebSocketServer, WebSocket } from "ws";
import { SIM } from "../src/contract";
import type { ClientMsg, KnobDefs, KnobValue, ServerMsg } from "../src/contract";
import { chat, hasApiKey, SPARK, WONDER } from "./meta";
import { compileMod } from "./compile";
import { verifyMod } from "./verify";
import { buildEditPrompt, buildFixPrompt, buildRouterPrompt, buildWonderPrompt, formatManifest, ROUTER_SYSTEM, WONDER_SYSTEM } from "./prompt";

const PORT = 8787;

interface ManifestRec {
  id: string;
  title: string;
  source: string;
  compiled: string;
  knobs: KnobDefs;
}

const manifest = new Map<string, ManifestRec>();

type RouteAction = "new" | "tweak" | "edit" | "undo" | "question";
interface Route {
  action: RouteAction;
  target?: string;
  knob?: string;
  value?: KnobValue;
  answer?: string;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function stage(ws: WebSocket, s: ServerMsg & { kind: "stage" }): void {
  send(ws, s);
}

function knobValues(rec: ManifestRec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(rec.knobs)) out[k] = d.value;
  return out;
}

function manifestText(): string {
  return formatManifest([...manifest.values()].map((m) => ({ id: m.id, title: m.title, knobs: knobValues(m) })));
}

function parseRoute(text: string): Route | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const action = obj.action as RouteAction;
    if (!["new", "tweak", "edit", "undo", "question"].includes(action)) return null;
    const r: Route = { action };
    if (typeof obj.target === "string") r.target = obj.target;
    if (typeof obj.knob === "string") r.knob = obj.knob;
    if (typeof obj.value === "number" || typeof obj.value === "string" || typeof obj.value === "boolean") {
      r.value = obj.value as KnobValue;
    }
    if (typeof obj.answer === "string") r.answer = obj.answer;
    return r;
  } catch {
    return null;
  }
}

function stripFences(src: string): string {
  let s = src.trim();
  const m = s.match(/^```(?:ts|typescript|javascript|js)?\s*\n([\s\S]*?)\n```\s*$/);
  if (m) s = m[1].trim();
  return s;
}

async function handleCommand(ws: WebSocket, text: string): Promise<void> {
  const t0 = performance.now();
  let routeMs = 0;
  let writeMs = 0;
  let compileMs = 0;
  let verifyMs = 0;
  const command = text;

  stage(ws, { kind: "stage", stage: "routing", detail: "routing your command", command });

  if (!hasApiKey()) {
    send(ws, {
      kind: "say",
      text: "No MODEL_API_KEY is set, so I can't write mods right now — but I'm online. Add the key and try again!",
    });
    send(ws, { kind: "timing", command, ms: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }

  // 1. Route with Spark.
  let route: Route | null = null;
  try {
    const r0 = performance.now();
    const res = await chat(SPARK, [
      { role: "system", content: ROUTER_SYSTEM },
      { role: "user", content: buildRouterPrompt(command, manifestText()) },
    ], 1024);
    routeMs = Math.round(performance.now() - r0);
    void res.ms;
    route = parseRoute(res.text);
    // Fallback: a build-shaped command never dead-ends on a router miss.
    if (!route && /^(add|make|create|spawn|give|put|build)\b/i.test(command.trim())) {
      console.log(`[route] fallback to new for: ${command}`);
      route = { action: "new" };
    }
    // Guard: "add/make/create ..." is always a build, never a tweak/question.
    if (route && /^(add|make|create|spawn|build)\b/i.test(command.trim()) && route.action !== "new" && route.action !== "edit" && route.action !== "undo") {
      console.log(`[route] coerced ${route.action} -> new for: ${command}`);
      route = { action: "new" };
    }
  } catch (err) {
    send(ws, { kind: "say", text: `Router hiccup: ${err instanceof Error ? err.message : String(err)}. Try again?` });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }
  if (!route) {
    send(ws, { kind: "say", text: "I didn't quite get that — try something like 'add a player' or 'make it rain'." });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }

  // 2. Non-generation routes.
  if (route.action === "question") {
    send(ws, { kind: "say", text: route.answer ?? "Hello! Tell me what to build — e.g. 'add a player', 'make it rain'." });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }
  if (route.action === "undo") {
    const id = route.target ?? "";
    if (id && manifest.has(id)) {
      manifest.delete(id);
      send(ws, { kind: "removed", modId: id });
    } else {
      send(ws, { kind: "say", text: id ? `Nothing loaded with id "${id}".` : "Tell me which mod to remove." });
    }
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }
  if (route.action === "tweak") {
    const rec = route.target ? manifest.get(route.target) : undefined;
    if (rec && route.knob && route.value !== undefined && route.knob in rec.knobs) {
      rec.knobs[route.knob] = { ...rec.knobs[route.knob], value: route.value };
      send(ws, { kind: "tweak", modId: rec.id, knob: route.knob, value: route.value });
      send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
      return;
    }
    // Tweak that names no loaded target/knob never fails: an unknown target
    // is built fresh, while a known target with an inapplicable knob is a
    // behavior change — rewrite that mod in place (edit).
    if (rec) {
      console.log(`[route] tweak -> edit ${rec.id} for: ${command}`);
      route = { action: "edit", target: rec.id };
    } else {
      console.log(`[route] tweak -> new for: ${command}`);
      route = { action: "new" };
    }
  }

  // 3. new / edit: Wonder writes one mod. An edit whose target is gone falls
  // back to new.
  let editRec: ManifestRec | undefined;
  if (route.action === "edit") {
    editRec = route.target ? manifest.get(route.target) : undefined;
    if (!editRec) {
      console.log(`[route] edit -> new (missing target) for: ${command}`);
      route = { action: "new" };
    }
  }
  stage(ws, { kind: "stage", stage: "writing", detail: "writing the mod", command });
  let source = "";
  try {
    const w0 = performance.now();
    const res = await chat(WONDER, [
      { role: "system", content: WONDER_SYSTEM },
      { role: "user", content: editRec ? buildEditPrompt(command, editRec.source, manifestText()) : buildWonderPrompt(command, manifestText()) },
    ], 4096);
    writeMs = Math.round(performance.now() - w0);
    source = stripFences(res.text);
  } catch (err) {
    send(ws, { kind: "say", text: `The writer failed: ${err instanceof Error ? err.message : String(err)}` });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }

  const attempt = async (src: string) => {
    const c0 = performance.now();
    const compiled = compileMod(src);
    compileMs += Math.round(performance.now() - c0);
    if (!compiled.ok) return { ok: false as const, errors: compiled.errors, js: "" };
    stage(ws, { kind: "stage", stage: "verifying", detail: "verifying the mod", command });
    const v0 = performance.now();
    const res = await verifyMod(src, compiled.js);
    verifyMs += Math.round(performance.now() - v0);
    if (!res.ok) return { ok: false as const, errors: res.errors, js: compiled.js };
    return { ok: true as const, errors: [] as string[], js: compiled.js, res };
  };

  stage(ws, { kind: "stage", stage: "compiling", detail: "compiling the mod", command });
  let first = await attempt(source);
  if (!first.ok) {
    // ONE auto-fix round.
    stage(ws, { kind: "stage", stage: "fixing", detail: "fixing the mod", command });
    try {
      const w0 = performance.now();
      const fix = await chat(WONDER, [
        { role: "system", content: WONDER_SYSTEM },
        { role: "user", content: buildFixPrompt(command, source, first.errors) },
      ], 4096);
      writeMs += Math.round(performance.now() - w0);
      source = stripFences(fix.text);
      stage(ws, { kind: "stage", stage: "compiling", detail: "recompiling the fix", command });
      first = await attempt(source);
    } catch (err) {
      send(ws, { kind: "say", text: `Fix attempt failed: ${err instanceof Error ? err.message : String(err)}` });
      send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) } });
      return;
    }
  }

  if (first.ok) {
    const def = first.res.def!;
    const rec: ManifestRec = { id: def.id, title: def.title, source, compiled: first.js, knobs: def.knobs ?? {} };
    // Edit keeps the same id so the client loader replaces it; if Wonder
    // renamed it anyway, drop the stale entry instead of duplicating.
    if (editRec && def.id !== editRec.id) manifest.delete(editRec.id);
    manifest.set(def.id, rec);
    stage(ws, { kind: "stage", stage: "done", detail: `loaded ${def.id} (${SIM.healthFrames} frames OK)`, command });
    send(ws, { kind: "mod", mod: { id: def.id, title: def.title, source, compiled: first.js, knobs: rec.knobs } });
  } else {
    stage(ws, { kind: "stage", stage: "failed", detail: first.errors.join("; ").slice(0, 500), command });
    send(ws, { kind: "say", text: `That didn't verify: ${first.errors.join("; ").slice(0, 500)}` });
  }
  send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) } });
}

function handleMessage(ws: WebSocket, raw: string): void {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    send(ws, { kind: "say", text: "I only speak JSON — try the text box again." });
    return;
  }
  if (msg.kind === "command") {
    handleCommand(ws, msg.text).catch((err) => {
      send(ws, { kind: "say", text: `Command failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  } else if (msg.kind === "undo") {
    if (manifest.has(msg.modId)) {
      manifest.delete(msg.modId);
      send(ws, { kind: "removed", modId: msg.modId });
    } else {
      send(ws, { kind: "say", text: `Nothing loaded with id "${msg.modId}".` });
    }
  } else if (msg.kind === "knob") {
    const rec = manifest.get(msg.modId);
    if (rec && msg.knob in rec.knobs) {
      rec.knobs[msg.knob] = { ...rec.knobs[msg.knob], value: msg.value };
      send(ws, { kind: "tweak", modId: msg.modId, knob: msg.knob, value: msg.value });
    } else {
      send(ws, { kind: "say", text: "Unknown mod or knob." });
    }
  }
}

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1" });
wss.on("connection", (ws: WebSocket) => {
  send(ws, { kind: "say", text: "hello! Tell me what to build — e.g. 'add a player'." });
  ws.on("message", (data) => {
    try {
      handleMessage(ws, String(data));
    } catch (err) {
      try {
        send(ws, { kind: "say", text: `Oops: ${err instanceof Error ? err.message : String(err)}` });
      } catch { /* ignore */ }
    }
  });
});
wss.on("listening", () => {
  console.log(`meta server listening on ws://127.0.0.1:${PORT}`);
});
