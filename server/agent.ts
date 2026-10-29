// Wonder as a tool-using agent (ADR 0013): the fix step can call run_playtest
// on its own candidate source, read the verdict, and revise before answering.
import { loadEnv, WONDER } from "./meta";

export interface PlaytestToolResult { ok: boolean; message: string }

const TOOLS = [{
  type: "function",
  function: {
    name: "run_playtest",
    description: "Compile, verify and playtest a full mod source in the player's current world with a scripted bot. Returns whether the player can still play, and if not, why.",
    parameters: { type: "object", properties: { source: { type: "string", description: "The complete mod module source, starting with export default {" } }, required: ["source"] },
  },
}];

interface Msg { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string }

/** Tool loop: Wonder may call run_playtest up to maxCalls times, then must answer with the final source. */
export async function fixWithAgent(
  system: string,
  user: string,
  runPlaytest: (source: string) => Promise<PlaytestToolResult>,
  maxCalls = 2,
): Promise<{ text: string; calls: number }> {
  const key = loadEnv();
  if (!key) throw new Error("MODEL_API_KEY is not set (add it to .env)");
  const messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: user }];
  let calls = 0;
  for (let round = 0; round <= maxCalls; round++) {
    const body: Record<string, unknown> = { model: WONDER, messages, max_tokens: 4096, reasoning_effort: "minimal" };
    if (round < maxCalls) body.tools = TOOLS;
    const res = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
    const toolCalls: any[] = msg?.tool_calls ?? [];
    if (toolCalls.length === 0) return { text: msg?.content ?? "", calls };
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
    for (const tc of toolCalls) {
      calls++;
      let result: PlaytestToolResult;
      try {
        const args = JSON.parse(tc.function?.arguments ?? "{}") as { source?: string };
        result = await runPlaytest(String(args.source ?? ""));
      } catch (err) {
        result = { ok: false, message: `tool error: ${err instanceof Error ? err.message : String(err)}` };
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return { text: "", calls };
}
