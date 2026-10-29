// Wonder as a tool-using agent (ADR 0013, generalized in ADR 0016): one bounded
// loop over Meta's OpenAI-compatible tool calls, used for the first write and
// for the fix round. Tools are plain objects; a tool may return `final` source
// to end the loop at once (a passing playtest needs no further model turn).
import { loadEnv, WONDER } from "./meta";

export interface AgentToolResult {
  /** What the model reads back. */
  message: string;
  ok?: boolean;
  /** If set, the loop ends immediately with this as the answer. */
  final?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<AgentToolResult>;
}

export interface AgentTrace { name: string; ms: number; ok?: boolean }

/** One finished tool call, as the viewer sees it in the pipeline lane (ADR 0033). */
export interface AgentStep { n: number; tool: string; args: string; result: string; ok: boolean; ms: number }

/** One line about a tool call's arguments: the source size for a playtest, nothing for a look. */
export function summarizeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "run_playtest") {
    const lines = String(args.source ?? "").split(String.fromCharCode(10)).filter((l) => l.trim()).length;
    return lines > 0 ? `${lines} lines of mod source` : "no source";
  }
  return Object.keys(args).length === 0 ? "no arguments" : Object.keys(args).join(", ");
}

/** One line about a tool result, short enough for a lane: what Wonder saw, or why the playtest said no. */
export function summarizeResult(name: string, result: AgentToolResult): string {
  if (name === "inspect_world") {
    try {
      const w: any = JSON.parse(result.message);
      const mods = Array.isArray(w?.mods) ? w.mods.length : Object.keys(w?.mods ?? {}).length;
      const ents = Array.isArray(w?.entities) ? w.entities.length : Object.keys(w?.entities ?? {}).length;
      return `${mods} mod${mods === 1 ? "" : "s"}, ${ents} entity type${ents === 1 ? "" : "s"}`;
    } catch { return "saw the world"; }
  }
  if (result.ok) return "passed";
  // run_playtest hands back JSON ({ ok, message }); show just the reason.
  let raw = result.message;
  try { const j: any = JSON.parse(raw); if (typeof j?.message === "string") raw = j.message; } catch { /* plain text */ }
  const why = raw.replace(/^playtest:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim();
  return `rejected: ${why.slice(0, 90)}`;
}

export interface AgentOptions {
  system: string;
  user: string;
  tools: AgentTool[];
  /** Max tool calls in total; the model must answer once they are spent. */
  maxCalls?: number;
  maxTokens?: number;
  model?: string;
  /** Called before each tool runs (for stage updates). */
  onTool?: (name: string) => void;
  /** Called after each tool finishes, with a one-line summary (ADR 0033). */
  onStep?: (step: AgentStep) => void;
  /** If set, the model is streamed (stream: true) and every piece of text or tool-call source is passed here as it arrives (ADR 0022). */
  onText?: (chunk: string) => void;
}

export interface AgentResult { text: string; calls: number; trace: AgentTrace[]; turns: number }

/** The mod source out of a partially received tool-call arguments string, JSON escapes decoded; stops before an incomplete escape. */
export function sourcePreview(rawArgs: string): string {
  const m = /"source"\s*:\s*"/.exec(rawArgs);
  if (!m) return "";
  let out = "";
  const body = rawArgs.slice(m.index + m[0].length);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') break;
    if (c !== "\\") { out += c; continue; }
    const n = body[i + 1];
    if (n === undefined) break;
    if (n === "u") { if (i + 5 >= body.length) break; out += String.fromCharCode(parseInt(body.slice(i + 2, i + 6), 16)); i += 5; continue; }
    out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "" : n;
    i++;
  }
  return out;
}

interface Msg { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string }

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const key = loadEnv();
  if (!key) throw new Error("MODEL_API_KEY is not set (add it to .env)");
  const maxCalls = opts.maxCalls ?? 3;
  const messages: Msg[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.user }];
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const defs = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const trace: AgentTrace[] = [];
  let calls = 0;
  let turns = 0;
  let lastSource = "";
  for (let round = 0; round <= maxCalls; round++) {
    const body: Record<string, unknown> = { model: opts.model ?? WONDER, messages, max_tokens: opts.maxTokens ?? 4096, reasoning_effort: "minimal" };
    if (calls < maxCalls) body.tools = defs;
    if (opts.onText && round > 0) opts.onText("\n");
    const msg = await complete(key, body, opts.onText);
    turns++;
    const toolCalls: any[] = msg?.tool_calls ?? [];
    if (toolCalls.length === 0 || calls >= maxCalls) {
      const text: string = msg?.content ?? "";
      return { text: lastSource && !/export\s+default/.test(text) ? lastSource : text, calls, trace, turns };
    }
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const tool = byName.get(tc.function?.name);
      calls++;
      const t0 = performance.now();
      let result: AgentToolResult;
      let lastArgsLine = "";
      try {
        if (!tool) throw new Error(`unknown tool ${tc.function?.name}`);
        const args = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
        if (typeof args.source === "string") lastSource = args.source;
        lastArgsLine = summarizeArgs(tool.name, args);
        opts.onTool?.(tool.name);
        result = await tool.run(args);
      } catch (err) {
        result = { ok: false, message: `tool error: ${err instanceof Error ? err.message : String(err)}` };
      }
      const ms = Math.round(performance.now() - t0);
      trace.push({ name: String(tc.function?.name), ms, ok: result.ok });
      if (tool) opts.onStep?.({ n: calls, tool: tool.name, args: lastArgsLine, result: summarizeResult(tool.name, result), ok: result.ok !== false, ms });
      if (result.final !== undefined) return { text: result.final, calls, trace, turns };
      messages.push({ role: "tool", tool_call_id: tc.id, content: result.message });
    }
  }
  return { text: lastSource, calls, trace, turns };
}

const SOURCE_PARAM = { type: "object", properties: { source: { type: "string", description: "The complete mod module source, starting with export default {" } }, required: ["source"] };

/** run_playtest: compile, verify and playtest a full source in the player's world. A pass ends the loop with that source. */
export function playtestTool(run: (source: string) => Promise<{ ok: boolean; message: string }>): AgentTool {
  return {
    name: "run_playtest",
    description: "Compile, verify and playtest a full mod source in the player's current world with a scripted bot. Returns whether it works and the player can still play, and if not, why.",
    parameters: SOURCE_PARAM,
    async run(args) {
      const source = String(args.source ?? "");
      const r = await run(source);
      return { ok: r.ok, message: JSON.stringify(r), ...(r.ok ? { final: source } : {}) };
    },
  };
}

/** inspect_world: what is loaded right now (mods, knob values, entity types and sizes). */
export function inspectTool(inspect: () => Promise<unknown>): AgentTool {
  return {
    name: "inspect_world",
    description: "Look at the player's live world: the loaded mods with their knob values, and the entity types present with their positions, sizes and physics flags. Use it when the request depends on existing mods or entities (e.g. 'a ball that explodes on enemies').",
    parameters: { type: "object", properties: {} },
    async run() {
      return { ok: true, message: JSON.stringify(await inspect()).slice(0, 4000) };
    },
  };
}

const ENDPOINT = "https://api.meta.ai/v1/chat/completions";

/** One model turn. Streams when `onText` is given and falls back to the plain request if the stream cannot start. */
async function complete(key: string, body: Record<string, unknown>, onText?: (chunk: string) => void): Promise<any> {
  const headers = { "content-type": "application/json", authorization: `Bearer ${key}` };
  if (onText) {
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify({ ...body, stream: true }) });
      if (res.ok && res.body) return await readStream(res.body, onText);
    } catch { /* fall through to the plain request */ }
  }
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
  const data: any = await res.json();
  const msg = data?.choices?.[0]?.message;
  const text: string = msg?.content ?? "";
  // Non-streamed fallback: hand the finished text over in one piece so the viewer still sees code appear.
  if (onText) {
    const call = (msg?.tool_calls ?? [])[0];
    const shown = call ? sourcePreview(String(call.function?.arguments ?? "")) : text;
    if (shown) onText(shown);
  }
  return msg;
}

/** Assemble an assistant message from an OpenAI-style SSE stream, reporting text as it arrives. */
async function readStream(stream: ReadableStream<Uint8Array>, onText: (chunk: string) => void): Promise<any> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  const calls: { id?: string; name: string; args: string; shown: number }[] = [];
  const handle = (payload: string): void => {
    if (payload === "[DONE]") return;
    let j: any;
    try { j = JSON.parse(payload); } catch { return; }
    const d = j?.choices?.[0]?.delta;
    if (!d) return;
    if (typeof d.content === "string" && d.content) { content += d.content; onText(d.content); }
    for (const tc of d.tool_calls ?? []) {
      const c = (calls[tc.index ?? 0] ??= { name: "", args: "", shown: 0 });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) {
        c.args += tc.function.arguments;
        const src = sourcePreview(c.args);
        if (src.length > c.shown) { onText(src.slice(c.shown)); c.shown = src.length; }
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split("\n")) if (line.startsWith("data:")) handle(line.slice(5).trim());
    }
  }
  if (buf.trim().startsWith("data:")) handle(buf.trim().slice(5).trim());
  const tool_calls = calls.filter(Boolean).map((c, i) => ({ id: c.id ?? `call_${i}`, type: "function", function: { name: c.name, arguments: c.args } }));
  return { content, ...(tool_calls.length ? { tool_calls } : {}) };
}
