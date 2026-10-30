// Generate a sprite sheet with Muse Image, probe SAM 3.1 segmentation, and
// save the sheet for the client art pipeline (public/art/<name>.webp).
// Usage: npx tsx scripts/art-sheet.ts "small ninja" ninja
// Pipeline proven 2026-10-27: Image returns WebP b64_json in ~8s; SAM returns
// box + encoded mask in ~1s (mask encoding not yet decoded — client currently
// chroma-keys the flat magenta background and slices frames by columns).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { logArt } from "../server/createlog";
import { spritePrompt } from "../server/art";

const key = readFileSync(".env", "utf8").match(/^MODEL_API_KEY=(.*)$/m)![1].trim();
const subject = process.argv[2] ?? "small ninja";
const name = process.argv[3] ?? "sheet";
const H = { "Content-Type": "application/json", Authorization: "Bearer " + key };
const prompt = spritePrompt(subject, { held: false, scenery: false });

const t = Date.now();
const gen = await fetch("https://api.meta.ai/v1/images/generations", {
  method: "POST", headers: H,
  body: JSON.stringify({ model: "muse-image-1.0", prompt, size: "1024x1024" }),
});
if (!gen.ok) throw new Error(`image ${gen.status}: ${(await gen.text()).slice(0, 300)}`);
const gj = await gen.json() as { data: { b64_json: string }[] };
const webp = Buffer.from(gj.data[0].b64_json, "base64");
mkdirSync("public/art", { recursive: true });
writeFileSync(`public/art/${name}.webp`, webp);
console.log(`image: ${Date.now() - t}ms, ${webp.length} bytes -> public/art/${name}.webp`);

const t2 = Date.now();
const sam = await fetch("https://api.meta.ai/v1/responses", {
  method: "POST", headers: H,
  body: JSON.stringify({
    model: "sam-3.1",
    input: [{ role: "user", content: [{ type: "input_text", text: subject.split(" ").pop() }, { type: "input_image", image_url: `data:image/webp;base64,${webp.toString("base64")}` }] }],
  }),
});
const sj = await sam.json() as { output?: { content?: { text?: string }[] }[] };
const samText = sj.output?.[0]?.content?.[0]?.text ?? "";
console.log(`sam: ${Date.now() - t2}ms, status ${sam.status}, ${samText.slice(0, 160).replace(/\n/g, "\\n")}...`);
try {
  logArt({ subject, file: `public/art/${name}.webp`, ms: Date.now() - t, samOk: sam.status === 200 });
} catch { /* logging must not break the script */ }
