import { describe, expect, it } from "vitest";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  MAX_EXPORT_BYTES,
  REPO_URL,
  collectSprites,
  fileToDataUri,
  generateExportHtml,
  getRunnerBundle,
} from "../server/export";
import type { ExportWorldData } from "../server/export";

describe("single-file HTML export (ADR 0042)", () => {
  it("converts files to data URIs and returns null for missing files", () => {
    const ninjaPath = join(process.cwd(), "public", "art", "ninja-sheet.webp");
    const uri = fileToDataUri(ninjaPath);
    expect(uri).not.toBeNull();
    expect(uri).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);

    const missing = fileToDataUri(join(process.cwd(), "public", "art", "nonexistent.webp"));
    expect(missing).toBeNull();
  });

  it("collects default sprites as data URIs", () => {
    const world: ExportWorldData = {
      mods: [{ builtin: true, id: "player", values: {} }],
    };
    const sprites = collectSprites(world, process.cwd());
    expect(sprites["ninja"]).toBeDefined();
    expect(sprites["ninja"]).toMatch(/^data:image\/webp;base64,/);
    expect(sprites["chicken"]).toBeDefined();
  });

  it("collects custom mod art and restyled sheets when present", () => {
    const world: ExportWorldData = {
      mods: [
        {
          builtin: false,
          id: "custom-airplane",
          title: "Airplane",
          source: 'export default { id: "custom-airplane" }',
          compiled: 'export default { id: "custom-airplane" }',
          knobs: {},
          values: {},
          art: { key: "airplane", url: "/art/gen/airplane.webp" },
        },
      ],
      restyled: {
        ninja: "/art/ninja-sheet.webp",
      },
    };
    const sprites = collectSprites(world, process.cwd());
    expect(sprites["airplane"]).toBeDefined();
    expect(sprites["airplane"]).toMatch(/^data:image\/webp;base64,/);
    expect(sprites["ninja"]).toBeDefined();
  });

  it("bundles the standalone runner into cached IIFE code", () => {
    const code1 = getRunnerBundle(process.cwd());
    expect(typeof code1).toBe("string");
    expect(code1.length).toBeGreaterThan(100_000);
    // Must be cached
    const code2 = getRunnerBundle(process.cwd());
    expect(code2).toBe(code1);
  });

  it("generates a self-contained HTML file within the 5 MB budget", () => {
    const world: ExportWorldData = {
      title: "My Super Platformer",
      mods: [
        { builtin: true, id: "player", values: {} },
        { builtin: true, id: "ground", values: {} },
        { builtin: true, id: "enemies", values: {} },
        { builtin: true, id: "coins", values: {} },
      ],
    };

    const html = generateExportHtml(world, process.cwd());

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>My Super Platformer — Talk-to-Build</title>");
    expect(html).toContain("window.__EXPORTED_WORLD__ =");
    expect(html).toContain("window.__EXPORTED_SPRITES__ =");
    expect(html).toContain(REPO_URL);
    expect(html).toContain("Made with");
    expect(html).toContain("Offline Playable");

    // Building must be disabled in the export
    expect(html).not.toContain('id="orb-form"');
    expect(html).not.toContain('id="command"');
    expect(html).not.toContain("ws://");

    // Size check: must be under 5 MB
    expect(html.length).toBeLessThan(MAX_EXPORT_BYTES);
    // Typical export is under 1.5 MB
    expect(html.length).toBeLessThan(2_500_000);
    expect(html.length).toBeGreaterThan(300_000);
  });

  it("includes compiled code of custom AI mods", () => {
    const customModCode = 'export default { id: "magic-star", setup(api) { api.spawn({ type: "star", x: 10, y: 10, w: 20, h: 20 }); }, dispose() {} };';
    const world: ExportWorldData = {
      title: "Custom AI World",
      mods: [
        { builtin: true, id: "player", values: {} },
        {
          builtin: false,
          id: "magic-star",
          title: "Magic Star",
          source: customModCode,
          compiled: customModCode,
          knobs: {},
          values: {},
        },
      ],
    };

    const html = generateExportHtml(world, process.cwd());
    expect(html).toContain("magic-star");
    expect(html).toContain("Custom AI World");
  });

  it("enforces the 5 MB cap when content is oversized", () => {
    const world: ExportWorldData = {
      title: "Huge World",
      mods: [
        {
          builtin: false,
          id: "huge-mod",
          title: "Huge Mod",
          source: "",
          compiled: `// ${"x".repeat(5_200_000)}`,
          knobs: {},
          values: {},
        },
      ],
    };

    expect(() => generateExportHtml(world, process.cwd())).toThrow(/exceeds the 5 MB size budget/i);
  });

  it("runs offline in headless Edge when available", () => {
    const edgePaths = [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    const edge = edgePaths.find((p) => existsSync(p));
    if (!edge) return;

    const world: ExportWorldData = {
      title: "Headless Browser Test",
      mods: [
        { builtin: true, id: "player", values: {} },
        { builtin: true, id: "ground", values: {} },
      ],
    };

    const html = generateExportHtml(world, process.cwd());
    const tempFile = join(process.cwd(), "output", "test-export.html");
    writeFileSync(tempFile, html, "utf8");

    try {
      const fileUrl = `file:///${tempFile.replace(/\\/g, "/")}`;
      const cmd = `"${edge}" --headless=new --disable-gpu --virtual-time-budget=1500 --dump-dom "${fileUrl}"`;
      const out = execSync(cmd, { encoding: "utf8", timeout: 15000 });

      expect(out).toContain("<canvas");
      expect(out).toContain("Headless Browser Test");
      expect(out).toContain("Talk-to-Build");
      expect(out).toContain("Offline Playable");
    } finally {
      try { unlinkSync(tempFile); } catch { /* ignore */ }
    }
  });
});
