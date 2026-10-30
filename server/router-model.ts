// Command-router model selection (ADR 0032). Muse Spark Open (open weights) on Baseten's
// OpenAI-compatible endpoint answers the router when BASETEN_API_KEY is set; anything else
// (unset, slow, erroring, or an empty reply) runs on hosted Muse Spark exactly as before.
import { chat, loadEnv, SPARK, type ChatMessage } from "./meta";

export const OPEN_MODEL_DEFAULT = "meta-models/muse-spark-open-1026";
export const BASETEN_URL_DEFAULT = "https://inference.baseten.co/v1";
export const TIMEOUT_MS_DEFAULT = 4000;

/** Which model answered, for the orb and the pipeline view. */
export interface Routed { text: string; ms: number; model: string; open: boolean; fellBack: boolean }

export interface OpenConfig { key: string; url: string; model: string; timeoutMs: number }

/** The open-weights config, or null when BASETEN_API_KEY is unset (the default: hosted Spark only). */
export function openConfig(): OpenConfig | null {
  loadEnv();
  const key = (process.env.BASETEN_API_KEY ?? "").trim();
  if (!key) return null;
  const t = Number(process.env.BASETEN_TIMEOUT_MS);
  return {
    key,
    url: (process.env.BASETEN_BASE_URL ?? BASETEN_URL_DEFAULT).replace(/\/+$/, ""),
    model: (process.env.BASETEN_MODEL ?? OPEN_MODEL_DEFAULT).trim() || OPEN_MODEL_DEFAULT,
    timeoutMs: Number.isFinite(t) && t > 0 ? t : TIMEOUT_MS_DEFAULT,
  };
}

/** One chat completion on the open-weights endpoint. Throws on HTTP error, timeout, or an empty reply. */
export async function openChat(cfg: OpenConfig, messages: ChatMessage[], maxTokens: number): Promise<{ text: string; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${cfg.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, messages, max_tokens: Math.max(512, maxTokens), reasoning_effort: "minimal" }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`Baseten ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data: any = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("Baseten returned an empty reply");
  return { text, ms };
}

/** Route a command: open weights first when enabled, hosted Spark on any failure.
 *  `signal` (a cancelled build, ADR 0060) is carried by the hosted call; an already-cancelled
 *  build must not spend an open-weights call either, so that path is skipped. */
export async function routerChat(messages: ChatMessage[], maxTokens = 1024, signal?: AbortSignal): Promise<Routed> {
  const cfg = openConfig();
  let fellBack = false;
  if (cfg && !signal?.aborted) {
    try {
      const r = await openChat(cfg, messages, maxTokens);
      return { ...r, model: cfg.model.split("/").pop() ?? cfg.model, open: true, fellBack: false };
    } catch (err) {
      fellBack = true;
      console.log(`[route] open weights failed, using hosted Spark: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const r = await chat(SPARK, messages, maxTokens, "minimal", signal);
  return { ...r, model: SPARK, open: false, fellBack };
}
