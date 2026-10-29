// Generates the prop-photo fixture: a mug on a table, drawn pixel by pixel.
//
// The camera-import beat ("bring your real stuff in") needs an upload stand-in that is
// not a person: workers never turn a webcam on, so every layout and cutout check runs on
// `tests/fixtures/mug-photo.png`. Drawn with plain arithmetic and a seeded LCG so the
// bytes are identical on every machine: no photos, no network, no image library.
//
//   npx tsx scripts/make-mug-fixture.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { encodePng } from "./png";

const W = 480;
const H = 360;

const WALL = [214, 208, 196] as const;
const TABLE = [186, 168, 142] as const;
const MUG = [47, 111, 143] as const;
const MUG_LIGHT = [83, 156, 187] as const;
const MUG_DARK = [32, 78, 102] as const;
const RIM = [151, 205, 224] as const;
const COFFEE = [58, 40, 28] as const;
const TABLE_LINE = 296;

/** Deterministic pseudo-random in [0,1): a seeded LCG, so the fixture never churns. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean => {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
};

/** Rounded rectangle inside-test (corner radius r), matching a mug body's soft edges. */
function inRoundRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export function drawMug(): { width: number; height: number; rgba: Uint8Array } {
  const px = new Uint8Array(W * H * 4);
  const rng = makeRng(0x5eed1);
  const put = (x: number, y: number, rgb: readonly number[], grain = true): void => {
    const o = (y * W + x) * 4;
    const jitter = grain ? Math.round(rng() * 6) - 3 : 0;
    px[o] = Math.max(0, Math.min(255, rgb[0] + jitter));
    px[o + 1] = Math.max(0, Math.min(255, rgb[1] + jitter));
    px[o + 2] = Math.max(0, Math.min(255, rgb[2] + jitter));
    px[o + 3] = 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // A plain wall above a table, gently darker toward the corners: an easy cutout.
      const base = y < TABLE_LINE ? WALL : TABLE;
      const edge = Math.max(0, 1 - Math.min(x, W - 1 - x) / (W * 0.55)) + Math.max(0, 1 - Math.min(y, H - 1 - y) / (H * 0.55));
      put(x, y, mix(base, [base[0] * 0.82, base[1] * 0.82, base[2] * 0.82], Math.min(0.5, edge * 0.22)));
    }
  }
  // Contact shadow, then the handle (so the body covers where it meets), then the body.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inEllipse(x, y, 232, 300, 132, 15)) continue;
      const o = (y * W + x) * 4;
      put(x, y, [px[o] * 0.74, px[o + 1] * 0.74, px[o + 2] * 0.74], false);
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inHandle = inEllipse(x, y, 330, 208, 48, 60) && !inEllipse(x, y, 330, 208, 28, 34);
      if (inHandle) put(x, y, inEllipse(x, y, 330, 208, 44, 56) ? MUG : MUG_DARK);
    }
  }
  for (let y = 130; y <= 300; y++) {
    for (let x = 128; x <= 332; x++) {
      if (!inRoundRect(x, y, 128, 130, 332, 300, 24)) continue;
      let colour: readonly number[] = MUG;
      if (x < 158) colour = mix(MUG, MUG_LIGHT, 0.75);
      else if (x < 178) colour = mix(MUG, MUG_LIGHT, 0.35);
      else if (x > 312) colour = mix(MUG, MUG_DARK, 0.5);
      if (y > 276) colour = mix(colour, MUG_DARK, 0.35);
      put(x, y, colour);
    }
  }
  // Rim and the coffee inside it: the "good morning" read.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inEllipse(x, y, 230, 132, 102, 20)) continue;
      if (inEllipse(x, y, 230, 132, 84, 13)) put(x, y, COFFEE, false);
      else put(x, y, RIM, false);
    }
  }
  return { width: W, height: H, rgba: px };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { width, height, rgba } = drawMug();
  const png = encodePng(width, height, rgba);
  const out = join(process.cwd(), "tests", "fixtures", "mug-photo.png");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`wrote tests/fixtures/mug-photo.png ${width}x${height} ${png.length} bytes`);
  const at = (x: number, y: number): string => {
    const o = (y * width + x) * 4;
    return `#${[rgba[o], rgba[o + 1], rgba[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  };
  console.log(`corner ${at(4, 4)} mug ${at(230, 220)} coffee ${at(230, 132)} table ${at(4, 340)}`);
}
