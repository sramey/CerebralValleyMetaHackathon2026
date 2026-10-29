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
}

export interface AgentResult { text: string; calls: number; trace: AgentTrace[]; turns: number }

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
    const res = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
    turns++;
    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
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
      try {
        if (!tool) throw new Error(`unknown tool ${tc.function?.name}`);
        const args = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
        if (typeof args.source === "string") lastSource = args.source;
        opts.onTool?.(tool.name);
        result = await tool.run(args);
      } catch (err) {
        result = { ok: false, message: `tool error: ${err instanceof Error ? err.message : String(err)}` };
      }
      trace.push({ name: String(tc.function?.name), ms: Math.round(performance.now() - t0), ok: result.ok });
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
