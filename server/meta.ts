// Meta Model API client. Loads MODEL_API_KEY from .env + process.env (no dotenv).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SPARK = "muse-spark-1.2";
export const WONDER = "muse-wonder-1.0";

/** One part of a multimodal user message (OpenAI-compatible content array, ADR 0023). */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** Plain text, or text + images. muse-wonder-1.0 / muse-spark-1.2 accept both. */
  content: string | MessagePart[];
}
export interface ChatResult { text: string; ms: number }

let loaded = false;
let cachedKey = "";

function envPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(process.cwd(), ".env"), join(here, "..", ".env"), join(here, ".env")];
}

/** Parse .env files (first found wins per key) without overriding process.env. Idempotent. */
export function loadEnv(): string {
  if (loaded) return cachedKey;
  loaded = true;
  const fromFile: Record<string, string> = {};
  for (const p of envPaths()) {
    if (!existsSync(p)) continue;
    try {
      for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const k = line.slice(0, eq).trim().replace(/^export\s+/, "");
        let v = line.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(k in fromFile)) fromFile[k] = v;
      }
    } catch { /* ignore unreadable .env */ }
    break;
  }
  for (const [k, v] of Object.entries(fromFile)) if (process.env[k] === undefined) process.env[k] = v;
  cachedKey = (process.env.MODEL_API_KEY ?? fromFile.MODEL_API_KEY ?? "").trim();
  return cachedKey;
}

export function apiKey(): string { return loadEnv(); }
export function hasApiKey(): boolean { return loadEnv().length > 0; }

export async function chat(model: string, messages: ChatMessage[], maxTokens = 1024, reasoningEffort = "minimal"): Promise<ChatResult> {
  const key = loadEnv();
  if (!key) throw new Error("MODEL_API_KEY is not set (add it to .env)");
  const t0 = performance.now();
  const res = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    // Default reasoning effort burns the whole token budget on mod prompts
    // (empty content, finish=length). minimal answers in seconds.
    body: JSON.stringify({ model, messages, max_tokens: Math.max(512, maxTokens), reasoning_effort: reasoningEffort }),
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Meta API ${res.status}: ${body.slice(0, 400)}`);
  }
  const data: any = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
  return { text, ms };
}
