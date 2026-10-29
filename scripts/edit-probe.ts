// Probe: Muse Image edit endpoint (multipart, OpenAI-style). Usage: npx tsx scripts/edit-probe.ts <sheet> <out> "<prompt>"
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../server/meta";
const [src, out, prompt] = process.argv.slice(2);
const key = loadEnv();
const fd = new FormData();
fd.append("model", "muse-image-1.0");
fd.append("prompt", prompt);
fd.append("image", new Blob([readFileSync(src)], { type: "image/webp" }), "sheet.webp");
fd.append("size", "1024x1024");
const t0 = performance.now();
const res = await fetch("https://api.meta.ai/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
const text = await res.text();
console.log(res.status, Math.round(performance.now() - t0), "ms", text.slice(0, 300));
if (res.ok) {
  const b64 = (JSON.parse(text) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
  if (b64) { writeFileSync(out, Buffer.from(b64, "base64")); console.log("wrote", out); }
}
