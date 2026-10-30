// Single-file HTML game export (ADR 0042).
// Bundles the sim, renderer, built-in and AI mods, sound, and sprites as data URIs
// into a standalone HTML file that plays 100% offline in any modern browser.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { sheetsOf } from "../src/contract";
import type { MoodSpec, WorldMod } from "../src/contract";

export const MAX_EXPORT_BYTES = 5_000_000;
export const REPO_URL = "https://github.com/sramey/CerebralValleyMetaHackathon2026";

export interface ExportWorldData {
  title?: string;
  mods: WorldMod[];
  mood?: MoodSpec;
  restyled?: Record<string, string>;
}

let cachedRunnerCode: string | null = null;

/** Bundle src/export/runner.ts into a self-contained IIFE. Cached in memory. */
export function getRunnerBundle(root = process.cwd(), forceRebuild = false): string {
  if (cachedRunnerCode && !forceRebuild) return cachedRunnerCode;
  const entryPoint = join(root, "src", "export", "runner.ts");
  const result = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    write: false,
    format: "iife",
    target: "es2022",
  });
  if (!result.outputFiles?.[0]?.text) {
    throw new Error("Failed to bundle standalone export runner.");
  }
  cachedRunnerCode = result.outputFiles[0].text;
  return cachedRunnerCode;
}

/** Read an image file from disk and return a base64 data URI, or null if missing. */
export function fileToDataUri(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const buf = readFileSync(filePath);
    const ext = filePath.endsWith(".png") ? "png" : filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") ? "jpeg" : "webp";
    return `data:image/${ext};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Collect sprite sheets as base64 data URIs for this world. */
export function collectSprites(world: ExportWorldData, root = process.cwd()): Record<string, string> {
  const sprites: Record<string, string> = {};

  // Standard character sprites
  const ninjaPath = join(root, "public", "art", "ninja-sheet.webp");
  const ninjaUri = fileToDataUri(ninjaPath);
  if (ninjaUri) sprites["ninja"] = ninjaUri;

  const chickenPath = join(root, "public", "art", "chicken.webp");
  const chickenUri = fileToDataUri(chickenPath);
  if (chickenUri) sprites["chicken"] = chickenUri;

  // Custom mod art
  for (const m of world.mods) {
    if (!m.builtin) {
      // Every sheet the mod carries (a build can add several subjects); old worlds only have `art`.
      for (const sheet of sheetsOf(m)) {
        const uri = fileToDataUri(join(root, "public", sheet.url.replace(/^\/?/, "")));
        if (uri) sprites[sheet.key] = uri;
      }
    }
    if (!m.builtin && m.skinArt?.key && m.skinArt.url) {
      const uri = fileToDataUri(join(root, "public", m.skinArt.url.replace(/^\/?/, "")));
      if (uri) sprites[m.skinArt.key] = uri;
    }
  }

  // Restyled sprites (mood)
  if (world.restyled) {
    for (const [key, url] of Object.entries(world.restyled)) {
      const cleanUrl = url.replace(/^\/?/, "");
      const fullPath = join(root, "public", cleanUrl);
      const uri = fileToDataUri(fullPath);
      if (uri) sprites[key] = uri;
    }
  }

  return sprites;
}

/** Escape script contents so closing tags cannot break HTML parsing. */
function safeJson(val: unknown): string {
  return JSON.stringify(val).replace(/<\/script/gi, "<\\/script");
}

function safeScript(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

/**
 * Generate a single self-contained HTML file for a world.
 * Enforces the 5 MB size budget.
 */
export function generateExportHtml(world: ExportWorldData, root = process.cwd(), forceRebuild = false): string {
  const runner = getRunnerBundle(root, forceRebuild);
  const sprites = collectSprites(world, root);

  const title = world.title?.trim() || "Talk-to-Build Game";
  const modCount = world.mods.length;
  const modNames = world.mods.map((m) => (m.builtin ? m.id : m.title || m.id)).join(", ");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Talk-to-Build</title>
  <style>
    :root {
      --bg: #05070a;
      --card-bg: #10141b;
      --border: #2a3342;
      --accent: #ffc94d;
      --green: #3fd06a;
      --text: #e8e4d8;
      --muted: #9aa3ad;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #game-container {
      display: flex;
      flex-direction: column;
      height: 100dvh;
      width: 100vw;
    }
    #game-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 18px;
      background: var(--card-bg);
      border-bottom: 2px solid var(--accent);
      flex: none;
      z-index: 10;
    }
    .header-left {
      display: flex;
      align-items: baseline;
      gap: 12px;
    }
    .game-title {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: .03em;
      color: var(--accent);
    }
    .made-with {
      font-size: 13px;
      color: var(--muted);
    }
    .made-with a {
      color: var(--green);
      text-decoration: none;
      font-weight: 600;
    }
    .made-with a:hover {
      text-decoration: underline;
    }
    .controls-hint {
      font-family: Consolas, monospace;
      font-size: 12px;
      color: var(--muted);
      background: rgba(0,0,0,0.3);
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #sound-btn {
      background: #171d28;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: background .15s;
    }
    #sound-btn:hover {
      background: #232c3d;
      border-color: var(--accent);
    }
    #stage-wrap {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: var(--bg);
      min-width: 0;
      min-height: 0;
    }
    #stage {
      width: 100%;
      height: 100%;
    }
    #stage canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
    #hud {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 50;
    }
    #game-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 18px;
      background: var(--card-bg);
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted);
      flex: none;
    }
    .badge-offline {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--green);
      font-weight: 600;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 6px var(--green);
    }
    .mods-summary {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 70%;
    }
  </style>
</head>
<body>
  <div id="game-container">
    <header id="game-header">
      <div class="header-left">
        <h1 class="game-title">${title}</h1>
        <span class="made-with">Made with <a href="${REPO_URL}" target="_blank" rel="noopener">Talk-to-Build</a></span>
      </div>
      <div class="controls-hint">Move: A/D/Arrows · Jump: W/Space · Shoot: X · Use: F · Sound: M</div>
      <div class="header-right">
        <button id="sound-btn" type="button">🔊 Sound: On (M)</button>
      </div>
    </header>
    <main id="stage-wrap">
      <div id="stage"></div>
      <div id="hud"></div>
    </main>
    <footer id="game-footer">
      <div class="mods-summary" title="${modNames}">Mods (${modCount}): ${modNames}</div>
      <div class="badge-offline"><span class="badge-dot"></span> Offline Playable</div>
    </footer>
  </div>
  <script>
    window.__EXPORTED_WORLD__ = ${safeJson(world)};
    window.__EXPORTED_SPRITES__ = ${safeJson(sprites)};
  </script>
  <script>
    ${safeScript(runner)}
  </script>
</body>
</html>`;

  if (html.length > MAX_EXPORT_BYTES) {
    throw new Error(`Exported HTML size (${(html.length / 1024 / 1024).toFixed(2)} MB) exceeds the 5 MB size budget.`);
  }

  return html;
}
