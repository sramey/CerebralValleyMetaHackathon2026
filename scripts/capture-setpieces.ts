import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { generateExportHtml, getRunnerBundle } from "../server/export";
import type { ExportWorldData } from "../server/export";

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

// 1. Volcano
export const volcanoCode = `
export default {
  id: "volcano",
  title: "Volcano",
  setup(api) {
    const h = 170;
    api.spawn({ type: "platform", x: 340, y: 310, w: 180, h: 32, solid: true, gravityScale: 0 });
    const volcano = api.spawn({ type: "volcano", x: 380, y: 400 - h, w: 200, h, solid: false, gravityScale: 0, color: 0x5a4636, data: { visual: "shape", craterX: 480, craterY: 400 - h + 12 } });
    
    api.onTick(() => {
      const tick = api.tick();
      if (tick === 45 || tick === 90) {
        api.burst(volcano.x + volcano.w / 2, volcano.y + 8, 0xffa02a, 20);
        for (let i = 0; i < 5; i++) {
          const size = 14 + api.rand() * 8;
          api.spawn({ type: "magma-rock", x: volcano.x + volcano.w / 2 - size / 2, y: volcano.y - 10, w: size, h: size, vx: (api.rand() - 0.5) * 220, vy: -420 - api.rand() * 180, solid: false, gravityScale: 1, color: api.rand() > 0.5 ? 0xff5a1f : 0xffa02a, data: { visual: "shape", bounce: 0.3 } });
        }
        for (let i = 0; i < 6; i++) {
          const size = 6 + api.rand() * 4;
          api.spawn({ type: "lava-drop", x: volcano.x + volcano.w / 2 - size / 2, y: volcano.y, w: size, h: size, vx: (api.rand() - 0.5) * 160, vy: -320 - api.rand() * 140, solid: false, gravityScale: 1, color: 0xffd23f, data: { visual: "shape" } });
        }
      }
    });
  },
  dispose() {}
};
`;

// 2. Castle
export const castleCode = `
export default {
  id: "castle",
  title: "Castle",
  setup(api) {
    api.spawn({ type: "castle", x: 380, y: 150, w: 280, h: 250, solid: false, gravityScale: 0, color: 0x4f5460, data: { visual: "shape" } });
    api.spawn({ type: "platform", x: 320, y: 330, w: 160, h: 32, solid: true, gravityScale: 0 });
    api.spawn({ type: "platform", x: 520, y: 290, w: 150, h: 32, solid: true, gravityScale: 0 });
  },
  dispose() {}
};
`;

// 3. Waterfall
export const waterfallCode = `
export default {
  id: "waterfall",
  title: "Waterfall",
  setup(api) {
    const wf = api.spawn({ type: "waterfall", x: 380, y: 100, w: 180, h: 300, solid: false, gravityScale: 0, color: 0x38bdf8, data: { visual: "shape" } });
    api.spawn({ type: "platform", x: 330, y: 280, w: 140, h: 32, solid: true, gravityScale: 0 });
    api.onTick(() => {
      const tick = api.tick();
      if (tick % 6 === 0) {
        api.burst(wf.x + wf.w / 2 + (api.rand() - 0.5) * 40, 395, 0xe0f2fe, 8);
      }
    });
  },
  dispose() {}
};
`;

// 4. Meteors
export const meteorsCode = `
export default {
  id: "meteors",
  title: "Meteors",
  setup(api) {
    api.spawn({ type: "platform", x: 340, y: 280, w: 180, h: 32, solid: true, gravityScale: 0 });
    api.onTick(() => {
      const tick = api.tick();
      if (tick % 24 === 0) {
        const x = 250 + api.rand() * 300;
        api.spawn({ type: "meteor", x, y: 20, w: 16, h: 16, vx: -140, vy: 340, solid: false, gravityScale: 0.8, color: 0xff4b1f, data: { visual: "shape" } });
        api.spawn({ type: "space-rock", x: x + 40, y: 10, w: 20, h: 20, vx: -160, vy: 380, solid: false, gravityScale: 0.9, color: 0x8b5a2b, data: { visual: "shape" } });
      }
      for (const e of api.entities()) {
        if ((e.type === "meteor" || e.type === "space-rock") && (e.onGround || e.y + e.h >= 398)) {
          api.burst(e.x + e.w / 2, Math.min(400, e.y + e.h), 0xff8a1f, 16);
          api.despawn(e.id);
        }
      }
    });
  },
  dispose() {}
};
`;

// 5. Fireworks
export const fireworksCode = `
export default {
  id: "fireworks",
  title: "Fireworks",
  setup(api) {
    api.onTick(() => {
      const tick = api.tick();
      if (tick === 30 || tick === 60) {
        const x = tick === 30 ? 360 : 480;
        api.burst(x, 180, tick === 30 ? 0xff4b1f : 0x00e5ff, 24);
      }
    });
  },
  dispose() {}
};
`;

// 6. Campfire
export const campfireCode = `
export default {
  id: "campfire",
  title: "Campfire",
  setup(api) {
    const fire = api.spawn({ type: "campfire", x: 360, y: 366, w: 48, h: 34, solid: false, gravityScale: 0, color: 0x5a3e28, data: { visual: "shape" } });
    api.onTick(() => {
      const tick = api.tick();
      if (tick % 8 === 0) {
        api.burst(fire.x + fire.w / 2 + (api.rand() - 0.5) * 16, fire.y + 12, 0xff7b24, 4);
        api.spawn({ type: "ember", x: fire.x + fire.w / 2, y: fire.y + 14, w: 4, h: 4, vx: (api.rand() - 0.5) * 35, vy: -70 - api.rand() * 40, solid: false, gravityScale: 0.2, color: 0xffd03f, data: { visual: "shape" } });
      }
      for (const e of api.byType("ember")) {
        if (e.y < 300) api.despawn(e.id);
      }
    });
  },
  dispose() {}
};
`;

export function buildWorld(modId: string, title: string, code: string): ExportWorldData {
  return {
    title,
    mods: [
      { builtin: true, id: "player", values: {} },
      { builtin: true, id: "ground", values: {} },
      {
        builtin: false,
        id: modId,
        title,
        source: code,
        compiled: code,
        knobs: {},
        values: {},
      },
    ],
  };
}

if (process.argv[1] && process.argv[1].includes("capture-setpieces.ts")) {
  console.log("Generating setpiece evidence screenshots (AFTER)...");
  getRunnerBundle(process.cwd(), true);

  const volcanoHtml = generateExportHtml(buildWorld("volcano", "Volcano", volcanoCode), process.cwd());
  capture("volcano-after", volcanoHtml, 1800);

  const castleHtml = generateExportHtml(buildWorld("castle", "Castle", castleCode), process.cwd());
  capture("castle-after", castleHtml, 1800);

  const waterfallHtml = generateExportHtml(buildWorld("waterfall", "Waterfall", waterfallCode), process.cwd());
  capture("waterfall-after", waterfallHtml, 1800);

  const meteorsHtml = generateExportHtml(buildWorld("meteors", "Meteors", meteorsCode), process.cwd());
  capture("meteors-after", meteorsHtml, 1800);

  const fireworksHtml = generateExportHtml(buildWorld("fireworks", "Fireworks", fireworksCode), process.cwd());
  capture("fireworks-after", fireworksHtml, 1150);

  const campfireHtml = generateExportHtml(buildWorld("campfire", "Campfire", campfireCode), process.cwd());
  capture("campfire-after", campfireHtml, 1800);

  console.log("Done generating 'after' screenshots.");
}
