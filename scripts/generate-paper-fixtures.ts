// Generate 3 hand-drawn level drawing fixtures photographed on paper (ADR 0040).
// Pure TypeScript + node:zlib (no external dependencies).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
    }
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const out = new Uint8Array(4 + 4 + len + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, len);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  const toCrc = out.subarray(4, 8 + len);
  view.setUint32(8 + len, crc32(toCrc));
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw);

  const ihdr = new Uint8Array(13);
  const iview = new DataView(ihdr.buffer);
  iview.setUint32(0, width);
  iview.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

class Canvas2D {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    const alpha = a / 255;
    if (alpha >= 1) {
      this.data[idx] = r;
      this.data[idx + 1] = g;
      this.data[idx + 2] = b;
      this.data[idx + 3] = 255;
    } else {
      const bgR = this.data[idx];
      const bgG = this.data[idx + 1];
      const bgB = this.data[idx + 2];
      this.data[idx] = Math.round(r * alpha + bgR * (1 - alpha));
      this.data[idx + 1] = Math.round(g * alpha + bgG * (1 - alpha));
      this.data[idx + 2] = Math.round(b * alpha + bgB * (1 - alpha));
      this.data[idx + 3] = 255;
    }
  }

  fill(r: number, g: number, b: number): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = 255;
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, thickness = 2, a = 255): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist * 2));
    const rad = thickness / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      for (let oy = -Math.ceil(rad); oy <= Math.ceil(rad); oy++) {
        for (let ox = -Math.ceil(rad); ox <= Math.ceil(rad); ox++) {
          if (ox * ox + oy * oy <= rad * rad) {
            this.setPixel(cx + ox, cy + oy, r, g, b, a);
          }
        }
      }
    }
  }

  fillPolygon(points: Array<{ x: number; y: number }>, r: number, g: number, b: number, a = 255): void {
    if (points.length < 3) return;
    let minY = this.height, maxY = 0;
    for (const p of points) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.height - 1, Math.ceil(maxY));

    for (let y = minY; y <= maxY; y++) {
      const nodes: number[] = [];
      let j = points.length - 1;
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[j];
        if ((p1.y < y && p2.y >= y) || (p2.y < y && p1.y >= y)) {
          const x = p1.x + ((y - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x);
          nodes.push(x);
        }
        j = i;
      }
      nodes.sort((n1, n2) => n1 - n2);
      for (let i = 0; i < nodes.length; i += 2) {
        if (i + 1 >= nodes.length) break;
        const xStart = Math.max(0, Math.floor(nodes[i]));
        const xEnd = Math.min(this.width - 1, Math.ceil(nodes[i + 1]));
        for (let x = xStart; x <= xEnd; x++) {
          this.setPixel(x, y, r, g, b, a);
        }
      }
    }
  }

  fillCircle(cx: number, cy: number, radius: number, r: number, g: number, b: number, a = 255): void {
    const rad2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 <= rad2) this.setPixel(x, y, r, g, b, a);
      }
    }
  }

  drawCircle(cx: number, cy: number, radius: number, r: number, g: number, b: number, thickness = 2): void {
    const steps = Math.ceil(2 * Math.PI * radius * 2);
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      this.drawLine(px, py, px, py, r, g, b, thickness);
    }
  }
}

// Transform a point inside normalized paper coordinates [0..1, 0..1] to the tilted/perspective quad on canvas
function paperTransform(
  u: number,
  v: number,
  quad: [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ],
): { x: number; y: number } {
  // Bilinear interpolation between the 4 corners: TL, TR, BR, BL
  const topX = quad[0].x * (1 - u) + quad[1].x * u;
  const topY = quad[0].y * (1 - u) + quad[1].y * u;
  const botX = quad[3].x * (1 - u) + quad[2].x * u;
  const botY = quad[3].y * (1 - u) + quad[2].y * u;
  return {
    x: topX * (1 - v) + botX * v,
    y: topY * (1 - v) + botY * v,
  };
}

function renderPaperScene(
  title: string,
  drawDrawing: (cvs: Canvas2D, pt: (u: number, v: number) => { x: number; y: number }) => void,
): Buffer {
  const W = 640;
  const H = 480;
  const cvs = new Canvas2D(W, H);

  // 1. Desk background (dark wooden texture / slate)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const grain = Math.sin(y * 0.4 + Math.sin(x * 0.05) * 4) * 8;
      const shade = (x / W) * 15;
      const r = Math.max(0, Math.min(255, Math.round(42 + grain + shade)));
      const g = Math.max(0, Math.min(255, Math.round(36 + grain + shade * 0.8)));
      const b = Math.max(0, Math.min(255, Math.round(30 + grain + shade * 0.6)));
      cvs.setPixel(x, y, r, g, b);
    }
  }

  // 2. Paper quad with slight perspective tilt (tilted clockwise ~3 degrees, top narrower than bottom)
  const quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
    { x: 92, y: 52 },   // Top-Left
    { x: 556, y: 44 },  // Top-Right
    { x: 572, y: 432 }, // Bottom-Right
    { x: 76, y: 444 },  // Bottom-Left
  ];

  // 3. Drop shadow under paper
  const shadowQuad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
    { x: 104, y: 64 },
    { x: 574, y: 56 },
    { x: 590, y: 448 },
    { x: 88, y: 460 },
  ];
  for (let s = 12; s >= 0; s--) {
    const alpha = Math.round(18 + (12 - s) * 8);
    const expand = s * 1.5;
    const sq = shadowQuad.map((p, idx) => ({
      x: p.x + (idx === 1 || idx === 2 ? expand : -expand),
      y: p.y + (idx >= 2 ? expand : -expand),
    }));
    cvs.fillPolygon(sq, 15, 12, 10, alpha);
  }

  // 4. Fill paper sheet (warm off-white with subtle top-to-bottom shading)
  cvs.fillPolygon(quad, 248, 245, 236);

  // Soft paper gradient / shading
  const pt = (u: number, v: number) => paperTransform(u, v, quad);

  // Draw faint ruling lines on paper
  for (let row = 1; row <= 10; row++) {
    const v = row / 11;
    const p0 = pt(0.04, v);
    const p1 = pt(0.96, v);
    cvs.drawLine(p0.x, p0.y, p1.x, p1.y, 220, 225, 235, 1, 90);
  }

  // Draw title at top of paper (pen handwritten style)
  const titleP = pt(0.08, 0.08);
  // handwritten lines for title
  cvs.drawLine(titleP.x, titleP.y, titleP.x + 80, titleP.y, 30, 45, 80, 2, 200);

  // 5. Draw the level elements on the paper using normalized coords u: [0..1] (left to right), v: [0..1] (top to bottom)
  drawDrawing(cvs, pt);

  return encodePng(W, H, cvs.data);
}

// Helper to draw a hand-drawn platform
function drawPenLedge(
  cvs: Canvas2D,
  pt: (u: number, v: number) => { x: number; y: number },
  u0: number,
  v: number,
  u1: number,
  thickness = 0.035,
  color = [25, 35, 60],
): void {
  const p0 = pt(u0, v);
  const p1 = pt(u1, v);
  const b0 = pt(u0, v + thickness);
  const b1 = pt(u1, v + thickness);

  // Fill inside platform with hatching or solid dark pen
  cvs.fillPolygon([p0, p1, b1, b0], color[0], color[1], color[2], 230);
  // Outline
  cvs.drawLine(p0.x, p0.y, p1.x, p1.y, color[0] - 10, color[1] - 10, color[2] - 10, 3);
  cvs.drawLine(b0.x, b0.y, b1.x, b1.y, color[0] - 10, color[1] - 10, color[2] - 10, 2);
  cvs.drawLine(p0.x, p0.y, b0.x, b0.y, color[0] - 10, color[1] - 10, color[2] - 10, 2);
  cvs.drawLine(p1.x, p1.y, b1.x, b1.y, color[0] - 10, color[1] - 10, color[2] - 10, 2);
}

// Helper to draw a coin (circle with yellow/gold ink)
function drawPenCoin(
  cvs: Canvas2D,
  pt: (u: number, v: number) => { x: number; y: number },
  u: number,
  v: number,
): void {
  const p = pt(u, v);
  cvs.fillCircle(p.x, p.y, 9, 235, 185, 45, 240);
  cvs.drawCircle(p.x, p.y, 9, 175, 125, 20, 2);
  cvs.fillCircle(p.x, p.y, 2, 175, 125, 20, 255);
}

// Helper to draw a walker enemy (red spiked blob/creature)
function drawPenEnemy(
  cvs: Canvas2D,
  pt: (u: number, v: number) => { x: number; y: number },
  u: number,
  v: number,
): void {
  const p = pt(u, v);
  cvs.fillCircle(p.x, p.y, 12, 215, 55, 45, 240);
  cvs.drawCircle(p.x, p.y, 12, 140, 25, 20, 2);
  // Horns / spikes
  cvs.drawLine(p.x - 7, p.y - 10, p.x - 11, p.y - 18, 140, 25, 20, 2);
  cvs.drawLine(p.x + 7, p.y - 10, p.x + 11, p.y - 18, 140, 25, 20, 2);
  // Eyes
  cvs.fillCircle(p.x - 4, p.y - 2, 2, 255, 255, 255);
  cvs.fillCircle(p.x + 4, p.y - 2, 2, 255, 255, 255);
}

// Helper to draw a trampoline / spring (cyan bouncer)
function drawPenTrampoline(
  cvs: Canvas2D,
  pt: (u: number, v: number) => { x: number; y: number },
  u0: number,
  v: number,
  u1: number,
): void {
  const p0 = pt(u0, v);
  const p1 = pt(u1, v);
  const b0 = pt(u0, v + 0.025);
  const b1 = pt(u1, v + 0.025);
  cvs.fillPolygon([p0, p1, b1, b0], 50, 180, 235, 240);
  cvs.drawLine(p0.x, p0.y, p1.x, p1.y, 20, 110, 180, 3);
  // Springs underneath
  const mid = (u0 + u1) / 2;
  const pm = pt(mid, v + 0.025);
  const pb = pt(mid, v + 0.055);
  cvs.drawLine(pm.x, pm.y, pb.x, pb.y, 40, 40, 50, 2);
}

// Fixture 1: Ascending Step Ledges
// Ground line at bottom, 3 stepped ledges, 2 coins, 1 enemy
function generateFixture1(): Buffer {
  return renderPaperScene("Level 1: Steps", (cvs, pt) => {
    // Ground platform at bottom
    drawPenLedge(cvs, pt, 0.05, 0.88, 0.95, 0.05, [30, 40, 60]);
    // Step 1
    drawPenLedge(cvs, pt, 0.22, 0.70, 0.45, 0.04, [30, 40, 60]);
    // Step 2
    drawPenLedge(cvs, pt, 0.50, 0.52, 0.75, 0.04, [30, 40, 60]);
    // Step 3 (High summit)
    drawPenLedge(cvs, pt, 0.25, 0.34, 0.55, 0.04, [30, 40, 60]);

    // Coins
    drawPenCoin(cvs, pt, 0.33, 0.62);
    drawPenCoin(cvs, pt, 0.62, 0.44);
    drawPenCoin(cvs, pt, 0.40, 0.26);

    // Enemy on high summit
    drawPenEnemy(cvs, pt, 0.48, 0.28);
  });
}

// Fixture 2: Bounce Tower
// Ground, trampoline, high moving ledge with arrows, top ledge, coins
function generateFixture2(): Buffer {
  return renderPaperScene("Level 2: Bounce Tower", (cvs, pt) => {
    // Ground floor
    drawPenLedge(cvs, pt, 0.05, 0.88, 0.95, 0.05, [30, 40, 60]);
    // Trampoline on ground
    drawPenTrampoline(cvs, pt, 0.22, 0.85, 0.38);

    // High slider platform
    drawPenLedge(cvs, pt, 0.48, 0.58, 0.78, 0.04, [110, 75, 200]);
    // Motion arrows for mover
    const arrL = pt(0.44, 0.60);
    const arrR = pt(0.82, 0.60);
    cvs.drawLine(arrL.x, arrL.y, arrL.x + 8, arrL.y - 4, 110, 75, 200, 2);
    cvs.drawLine(arrL.x, arrL.y, arrL.x + 8, arrL.y + 4, 110, 75, 200, 2);
    cvs.drawLine(arrR.x, arrR.y, arrR.x - 8, arrR.y - 4, 110, 75, 200, 2);
    cvs.drawLine(arrR.x, arrR.y, arrR.x - 8, arrR.y + 4, 110, 75, 200, 2);

    // Tower ledge near top
    drawPenLedge(cvs, pt, 0.18, 0.28, 0.48, 0.04, [30, 40, 60]);

    // Coins floating along the bounce path
    drawPenCoin(cvs, pt, 0.30, 0.68);
    drawPenCoin(cvs, pt, 0.30, 0.50);
    drawPenCoin(cvs, pt, 0.63, 0.48);
    drawPenCoin(cvs, pt, 0.28, 0.20);

    // Enemy patrolling bottom right
    drawPenEnemy(cvs, pt, 0.75, 0.82);
  });
}

// Fixture 3: Chasm Crossing
// Left cliff, right fortress tower, floating bridge ledges in between, coins, enemy
function generateFixture3(): Buffer {
  return renderPaperScene("Level 3: Castle Chasm", (cvs, pt) => {
    // Left cliff
    drawPenLedge(cvs, pt, 0.05, 0.72, 0.32, 0.20, [30, 40, 60]);
    // Right high tower/wall
    drawPenLedge(cvs, pt, 0.74, 0.45, 0.95, 0.47, [30, 40, 60]);

    // Floating stepping stones bridging the gap
    drawPenLedge(cvs, pt, 0.38, 0.65, 0.52, 0.04, [30, 40, 60]);
    drawPenLedge(cvs, pt, 0.56, 0.54, 0.70, 0.04, [30, 40, 60]);

    // Coins along the bridge
    drawPenCoin(cvs, pt, 0.45, 0.57);
    drawPenCoin(cvs, pt, 0.63, 0.46);
    drawPenCoin(cvs, pt, 0.85, 0.36);

    // Walker enemy on the castle rampart
    drawPenEnemy(cvs, pt, 0.88, 0.39);
  });
}

export function generateAllFixtures(): void {
  const dir = resolve(process.cwd(), "tests/fixtures/paper");
  const f1 = generateFixture1();
  const f2 = generateFixture2();
  const f3 = generateFixture3();

  writeFileSync(resolve(dir, "paper-level-1.png"), f1);
  writeFileSync(resolve(dir, "paper-level-2.png"), f2);
  writeFileSync(resolve(dir, "paper-level-3.png"), f3);

  console.log(`Generated 3 paper fixtures under ${dir}:`);
  console.log(` - paper-level-1.png (${f1.length} bytes)`);
  console.log(` - paper-level-2.png (${f2.length} bytes)`);
  console.log(` - paper-level-3.png (${f3.length} bytes)`);
}

// Run directly when executed
if (process.argv[1]?.includes("generate-paper-fixtures")) {
  generateAllFixtures();
}
