// Set-piece rendering and override decision (bead metabuild-ideation-bex).
// Big nameable subjects (volcano, castle, waterfall, giant tree, pyramid, ship, tower)
// must get their generated art even if the mod/router specified visual:"shape".
// Drawn behind the play layer, anchored to the ground (y=400), at a fitting scale.
// Pure math & classifier helpers are exported for unit testing.

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Entity } from "../contract";

export const SETPIECE_PATTERN = /(volcano|volcanic|castle|fortress|palace|citadel|keep|waterfall|cascade|pyramid|ship|galleon|vessel|tower|spire|lighthouse|windmill|mountain|temple|monument|ruins|cathedral|pagoda|colosseum)/i;

/** True if the subject name represents a landmark or large architectural/geographic set-piece. */
export function isSetPieceSubject(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;
  if (SETPIECE_PATTERN.test(lower)) return true;
  if (/\btree\b/i.test(lower) && /\b(giant|huge|massive|ancient|world|tall|great|big)\b/i.test(lower)) return true;
  return false;
}

/**
 * True if an entity represents a set-piece that belongs behind the play layer
 * and should use generated art even if visual:"shape" was specified.
 */
export function isSetPiece(e: Pick<Entity, "type"> & Partial<Pick<Entity, "w" | "h" | "data">>): boolean {
  if (e.data?.setpiece === true || e.data?.landmark === true) return true;
  const t = e.type.toLowerCase();
  if (SETPIECE_PATTERN.test(t)) return true;
  // A tree is a set-piece if explicitly giant/big or sized at landmark scale (w >= 70 or h >= 90)
  if (/\btree\b/i.test(t)) {
    if (/\b(giant|huge|massive|ancient|world|tall|great|big)\b/i.test(t)) return true;
    if ((e.w ?? 0) >= 70 || (e.h ?? 0) >= 90) return true;
  }
  return false;
}

/**
 * Returns true when an entity must bypass code-drawn shape fallbacks and use
 * generated sprite art instead.
 */
export function shouldOverrideShapeWithArt(e: Pick<Entity, "type"> & Partial<Pick<Entity, "data">>): boolean {
  return isSetPiece(e);
}

export interface SetPieceBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute the display bounding box for a set-piece:
 * - Anchored to the ground (y = 400 or e.y + e.h)
 * - Centered horizontally at e.x + e.w / 2
 * - Scaled to fit landmark proportions and texture aspect ratio
 */
export function computeSetPieceLayout(
  e: { x: number; y: number; w: number; h: number },
  textureW = 0,
  textureH = 0,
  groundY = 400,
): SetPieceBounds {
  // Height: respect entity height, but set-pieces should be at least 150 px high to read as landmarks
  const targetH = Math.max(e.h, 150);
  let targetW = Math.max(e.w, 180);

  if (textureW > 0 && textureH > 0) {
    const aspect = textureW / textureH;
    targetW = Math.max(targetW, targetH * aspect);
  }

  // Anchor bottom to ground (default world y 400) or entity bottom if placed below ground
  const bottomY = Math.max(groundY, e.y + e.h);
  const topY = bottomY - targetH;
  const centerX = e.x + e.w * 0.5;
  const leftX = centerX - targetW * 0.5;

  return { x: leftX, y: topY, w: targetW, h: targetH };
}

function scaleRgb(color: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Stylized atmospheric placeholder drawn while art is loading (or if no image exists yet).
 * Beautiful layered silhouettes with ground anchoring and subtle details.
 */
export function drawSetPiecePlaceholder(
  g: Graphics,
  e: Entity,
  camX: number,
  camY: number,
  groundY = 400,
): void {
  const bounds = computeSetPieceLayout(e, 0, 0, groundY);
  const x = bounds.x - camX;
  const y = bounds.y - camY;
  const w = bounds.w;
  const h = bounds.h;
  const bottom = y + h;
  const cx = x + w * 0.5;
  const t = e.type.toLowerCase();

  if (t.includes("volcano")) {
    // Volcanic Mountain Silhouette with glowing caldera & basalt facets
    const baseCol = e.color || 0x423226;
    const craterW = Math.max(28, w * 0.22);
    const craterY = y + 14;

    // Mountain body
    const pts = [
      x, bottom,
      x + w * 0.14, bottom - h * 0.42,
      cx - craterW * 0.5, craterY,
      cx + craterW * 0.5, craterY,
      x + w * 0.86, bottom - h * 0.42,
      x + w, bottom,
    ];
    g.poly(pts).fill(scaleRgb(baseCol, 0.72));

    // Sunlit left slope & crag ridges
    g.poly([
      x, bottom,
      x + w * 0.14, bottom - h * 0.42,
      cx - craterW * 0.5, craterY,
      cx - craterW * 0.1, bottom,
    ]).fill({ color: scaleRgb(baseCol, 1.25), alpha: 0.65 });

    // Deep shadowed right fissure
    g.poly([
      cx + craterW * 0.1, craterY,
      cx + craterW * 0.5, craterY,
      x + w * 0.86, bottom - h * 0.42,
      x + w, bottom,
      cx + craterW * 0.25, bottom,
    ]).fill({ color: scaleRgb(baseCol, 0.45), alpha: 0.75 });

    // Lava fissures running down the mountain face
    const fissures = [
      [cx - craterW * 0.2, craterY + 4, cx - craterW * 0.5, y + h * 0.45, cx - w * 0.22, bottom],
      [cx + craterW * 0.15, craterY + 4, cx + craterW * 0.35, y + h * 0.55, cx + w * 0.25, bottom],
    ];
    for (const f of fissures) {
      g.moveTo(f[0], f[1]).lineTo(f[2], f[3]).lineTo(f[4], f[5]).stroke({ width: 3, color: 0xff4b1f, alpha: 0.75 });
      g.moveTo(f[0], f[1]).lineTo(f[2], f[3]).lineTo(f[4], f[5]).stroke({ width: 1.2, color: 0xffd03f, alpha: 0.95 });
    }

    // Glowing Magma Caldera at the crater rim
    g.ellipse(cx, craterY, craterW * 0.6, 7).fill(0xff3300);
    g.ellipse(cx, craterY, craterW * 0.45, 4.5).fill(0xff8811);
    g.ellipse(cx, craterY, craterW * 0.25, 2.5).fill(0xffea55);
    // Atmospheric crater heat glow
    g.ellipse(cx, craterY - 4, craterW * 1.1, 14).fill({ color: 0xff5a1f, alpha: 0.22 });
    return;
  }

  if (t.includes("castle") || t.includes("fortress") || t.includes("palace") || t.includes("citadel")) {
    const stone = e.color || 0x4f5460;
    const wallH = h * 0.45;
    const wallY = bottom - wallH;

    // Main curtain wall
    g.rect(x + w * 0.15, wallY, w * 0.7, wallH).fill(stone);
    // Battlements on wall
    const crenels = 7;
    const crenelW = (w * 0.7) / (crenels * 2 - 1);
    for (let i = 0; i < crenels; i++) {
      g.rect(x + w * 0.15 + i * crenelW * 2, wallY - 8, crenelW, 8).fill(scaleRgb(stone, 1.1));
    }

    // Left and Right flank towers with conical spires
    const towerW = w * 0.22;
    const towerH = h * 0.75;
    const towerY = bottom - towerH;
    for (const tx of [x + w * 0.04, x + w * 0.74]) {
      g.rect(tx, towerY, towerW, towerH).fill(scaleRgb(stone, 0.9));
      g.poly([tx - 4, towerY, tx + towerW + 4, towerY, tx + towerW * 0.5, towerY - h * 0.24]).fill(0x2a2e38);
      // Arrow slits
      g.rect(tx + towerW * 0.45, towerY + towerH * 0.35, 3, 14).fill(0xffd560);
      g.rect(tx + towerW * 0.45, towerY + towerH * 0.6, 3, 14).fill(0xffd560);
    }

    // Center grand keep tower
    const keepW = w * 0.28;
    const keepH = h * 0.88;
    const keepY = bottom - keepH;
    const kx = cx - keepW * 0.5;
    g.rect(kx, keepY, keepW, keepH).fill(scaleRgb(stone, 1.15));
    g.poly([kx - 5, keepY, kx + keepW + 5, keepY, cx, keepY - h * 0.22]).fill(0x1e222b);
    g.rect(cx - 3, keepY + 16, 6, 12).fill(0xffeb88);

    // Arched portcullis gate
    const gateW = w * 0.16;
    const gateH = wallH * 0.55;
    g.roundRect(cx - gateW * 0.5, bottom - gateH, gateW, gateH + 2, gateW * 0.5).fill(0x1a1612);
    return;
  }

  if (t.includes("waterfall") || t.includes("cascade")) {
    const cliff = 0x3d352e;
    const water = 0x38bdf8;
    // Rock cliff backdrop
    g.rect(x + w * 0.1, y, w * 0.8, h).fill(cliff);
    g.rect(x + w * 0.1, y, w * 0.2, h).fill(scaleRgb(cliff, 1.2));
    g.rect(x + w * 0.7, y, w * 0.2, h).fill(scaleRgb(cliff, 0.7));

    // Rushing water chute
    const chuteW = w * 0.38;
    const chuteX = cx - chuteW * 0.5;
    g.rect(chuteX, y, chuteW, h).fill(water);
    // Foam streaks
    for (let i = 0; i < 4; i++) {
      g.rect(chuteX + 4 + i * (chuteW / 4), y, 2.5, h).fill({ color: 0xffffff, alpha: 0.75 });
    }
    // Billowing splash mist pool at base
    g.ellipse(cx, bottom - 6, chuteW * 1.4, 18).fill({ color: 0xe0f2fe, alpha: 0.65 });
    g.ellipse(cx, bottom - 12, chuteW * 1.1, 14).fill({ color: 0xffffff, alpha: 0.45 });
    return;
  }

  if (t.includes("tree")) {
    const trunk = 0x5a3e28;
    const foliage = e.color || 0x2e7d32;
    const trunkW = Math.max(22, w * 0.18);
    // Ancient trunk
    g.rect(cx - trunkW * 0.5, y + h * 0.35, trunkW, h * 0.65).fill(trunk);
    // Roots spreading onto ground
    g.poly([
      cx - trunkW * 0.5, bottom - 24,
      cx - trunkW * 1.2, bottom,
      cx + trunkW * 1.2, bottom,
      cx + trunkW * 0.5, bottom - 24,
    ]).fill(scaleRgb(trunk, 0.85));

    // Tiered lush canopy
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const ty = y + i * (h * 0.22);
      const tw = w * (0.65 + i * 0.16);
      const th = h * 0.32;
      g.ellipse(cx, ty + th * 0.5, tw * 0.5, th * 0.5).fill(scaleRgb(foliage, 0.85 + i * 0.15));
      g.ellipse(cx - tw * 0.1, ty + th * 0.4, tw * 0.35, th * 0.3).fill({ color: scaleRgb(foliage, 1.3), alpha: 0.45 });
    }
    return;
  }

  if (t.includes("tower") || t.includes("spire") || t.includes("lighthouse") || t.includes("windmill")) {
    const stone = e.color || 0x565c68;
    const towerW = w * 0.45;
    const tx = cx - towerW * 0.5;

    // Tapered tower shaft
    g.poly([
      tx + towerW * 0.12, y + h * 0.2,
      tx + towerW * 0.88, y + h * 0.2,
      tx + towerW, bottom,
      tx, bottom,
    ]).fill(stone);

    // Spire / Observation deck
    g.rect(tx - 4, y + h * 0.18, towerW + 8, 8).fill(scaleRgb(stone, 1.25));
    g.poly([tx - 2, y + h * 0.18, tx + towerW + 2, y + h * 0.18, cx, y]).fill(0x272b34);
    // Beacon window
    g.rect(cx - 5, y + h * 0.24, 10, 14).fill(0xffe270);
    g.circle(cx, y + h * 0.3, 18).fill({ color: 0xffe270, alpha: 0.2 });
    return;
  }

  // General monumental landmark fallback
  const col = e.color || 0x475569;
  g.rect(x + w * 0.1, y + h * 0.15, w * 0.8, h * 0.85).fill(col);
  g.rect(x + w * 0.1, y + h * 0.15, w * 0.25, h * 0.85).fill({ color: scaleRgb(col, 1.3), alpha: 0.6 });
  g.poly([x + w * 0.05, y + h * 0.15, x + w * 0.95, y + h * 0.15, cx, y]).fill(scaleRgb(col, 0.8));
}

/**
 * Manages the background set-piece rendering layer.
 * Placed behind the play layer (at zIndex -150).
 */
export class SetPieceLayer {
  readonly container = new Container();
  private placeholderGfx = new Graphics();
  private sprites = new Map<number, Sprite>();

  constructor() {
    this.container.zIndex = -150;
    this.container.sortableChildren = true;
    this.placeholderGfx.zIndex = -10;
    this.container.addChild(this.placeholderGfx);
  }

  /**
   * Render all live set-piece entities in the world:
   * - If texture frames exist in `framesBySubject`, render the sprite anchored to ground.
   * - If no texture exists yet (art pending or code look), render the atmospheric placeholder.
   */
  render(
    entities: readonly Entity[],
    camX: number,
    camY: number,
    framesBySubject: Record<string, Texture[]>,
  ): void {
    this.placeholderGfx.clear();
    const seenIds = new Set<number>();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!isSetPiece(e)) continue;
      seenIds.add(e.id);

      // Find if we have loaded textures for this setpiece type or subject
      const frames = this.findFrames(e.type, framesBySubject);

      if (frames && frames.length > 0) {
        // Sprite Art Available: render sprite
        let s = this.sprites.get(e.id);
        if (!s) {
          s = new Sprite();
          s.anchor.set(0.5, 1.0); // Anchor at bottom-center
          this.container.addChild(s);
          this.sprites.set(e.id, s);
        }

        const tex = frames[0];
        s.texture = tex;
        const bounds = computeSetPieceLayout(e, tex.width, tex.height, 400);

        s.width = bounds.w;
        s.height = bounds.h;
        // Position at bottom-center in screen space
        s.position.set(bounds.x + bounds.w * 0.5 - camX, bounds.y + bounds.h - camY);
        s.visible = true;
      } else {
        // No texture yet: draw stylized landmark placeholder
        const existingSprite = this.sprites.get(e.id);
        if (existingSprite) existingSprite.visible = false;
        drawSetPiecePlaceholder(this.placeholderGfx, e, camX, camY, 400);
      }
    }

    // Hide any sprites for despawned set-pieces
    for (const [id, s] of this.sprites) {
      if (!seenIds.has(id)) {
        s.visible = false;
      }
    }
  }

  private findFrames(type: string, framesBySubject: Record<string, Texture[]>): Texture[] | undefined {
    const lower = type.toLowerCase();
    if (framesBySubject[lower]?.length) return framesBySubject[lower];
    for (const [key, frames] of Object.entries(framesBySubject)) {
      if (!frames || frames.length === 0) continue;
      const k = key.toLowerCase();
      if (lower.includes(k) || k.includes(lower)) return frames;
    }
    return undefined;
  }
}
