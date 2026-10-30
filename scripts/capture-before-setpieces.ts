import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { generateExportHtml, getRunnerBundle } from "../server/export";
import type { ExportWorldData } from "../server/export";
import {
  volcanoCode,
  castleCode,
  waterfallCode,
  meteorsCode,
  fireworksCode,
  campfireCode,
  buildWorld,
} from "./capture-setpieces";

const edgePaths = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edge = edgePaths.find((p) => existsSync(p));
if (!edge) {
  console.error("msedge.exe not found!");
  process.exit(1);
}

const outDir = join(process.cwd(), "docs", "evidence", "setpieces");
mkdirSync(outDir, { recursive: true });

function capture(name: string, html: string, timeMs = 1800): void {
  const tempFile = join(outDir, `${name}-temp.html`);
  const outFile = join(outDir, `${name}.png`);
  try { if (existsSync(outFile)) unlinkSync(outFile); } catch {}
  writeFileSync(tempFile, html, "utf8");

  try {
    const fileUrl = `file:///${tempFile.replace(/\\/g, "/")}`;
    const cmd = `"${edge}" --headless=new --disable-gpu --virtual-time-budget=${timeMs} --screenshot="${outFile}" --window-size=800,600 "${fileUrl}"`;
    execSync(cmd, { stdio: "ignore", timeout: 25000 });
    console.log(`Captured ${name}.png`);
  } catch (err) {
    console.error(`Failed to capture ${name}:`, err);
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

function makeLegacyHtml(world: ExportWorldData): string {
  getRunnerBundle(process.cwd(), true);
  const baseHtml = generateExportHtml(world, process.cwd());
  return baseHtml.replace("window.__EXPORTED_WORLD__", "window.__LEGACY_RENDER__ = true;\n    window.__EXPORTED_WORLD__");
}

console.log("Generating setpiece BEFORE screenshots (with legacy mode)...");

// Note: volcano-before.png already exists from the user's authentic screenshot!
// We capture the others with legacy mode:
const castleHtml = makeLegacyHtml(buildWorld("castle", "Castle", castleCode));
capture("castle-before", castleHtml, 1800);

const waterfallHtml = makeLegacyHtml(buildWorld("waterfall", "Waterfall", waterfallCode));
capture("waterfall-before", waterfallHtml, 1800);

const meteorsHtml = makeLegacyHtml(buildWorld("meteors", "Meteors", meteorsCode));
capture("meteors-before", meteorsHtml, 1800);

const fireworksHtml = makeLegacyHtml(buildWorld("fireworks", "Fireworks", fireworksCode));
capture("fireworks-before", fireworksHtml, 1150);

const campfireHtml = makeLegacyHtml(buildWorld("campfire", "Campfire", campfireCode));
capture("campfire-before", campfireHtml, 1800);

console.log("Done generating 'before' screenshots.");
