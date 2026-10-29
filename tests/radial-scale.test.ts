import { describe, expect, it } from "vitest";
import type { Entity } from "../src/contract";

// Unit test replicating the visualHeightOf and radial menu positioning formulas from src/client/main.ts
function computeVisualHeight(e: Entity, hasFrames: boolean, isKindOf: boolean): number {
  if (hasFrames && !isKindOf) {
    return e.type === "player" ? 56 * (e.h / 34) : Math.min(630, Math.max(34, e.h * 1.5));
  }
  return e.h;
}

function computeRadialRawCenter(e: Entity, visH: number, camX = 0, camY = 0): { rawX: number; rawY: number } {
  return {
    rawX: e.x - camX + e.w / 2,
    rawY: e.y - camY + e.h - visH / 2,
  };
}

describe("metabuild-ideation-5y6: radial scaling and menu anchor", () => {
  it("scales player visual height proportionally with e.h", () => {
    const player: Entity = {
      id: 1,
      type: "player",
      x: 100,
      y: 366,
      w: 26,
      h: 34,
      vx: 0,
      vy: 0,
      color: 0xffc94d,
      solid: true,
      gravityScale: 1,
      facing: 1,
      onGround: true,
      health: 100,
      owner: "player",
      data: {},
    };

    // Default player height
    expect(computeVisualHeight(player, true, false)).toBe(56);

    // "make me huge" / radial bigger grows e.h
    player.h = 68; // 2x
    expect(computeVisualHeight(player, true, false)).toBe(112);

    // radial smaller shrinks e.h
    player.h = 17; // 0.5x
    expect(computeVisualHeight(player, true, false)).toBe(28);
  });

  it("uncaps tree and creature sprite height past the old 240px clamp up to 630px", () => {
    const tree: Entity = {
      id: 10,
      type: "tree",
      x: 200,
      y: 250,
      w: 100,
      h: 150,
      vx: 0,
      vy: 0,
      color: 0x228822,
      solid: false,
      gravityScale: 0,
      facing: 1,
      onGround: true,
      health: 100,
      owner: "tree-mod",
      data: {},
    };

    // Initial tree visual height: 150 * 1.5 = 225
    expect(computeVisualHeight(tree, true, false)).toBe(225);

    // Bigger click 1: h = 172.5 -> targetH = 258.75 (previously clamped at 240!)
    tree.h = 172.5;
    const h1 = computeVisualHeight(tree, true, false);
    expect(h1).toBe(258.75);
    expect(h1).toBeGreaterThan(240);

    // Bigger click 2: h = 198.375 -> targetH = 297.5625
    tree.h = 198.375;
    const h2 = computeVisualHeight(tree, true, false);
    expect(h2).toBe(297.5625);
    expect(h2).toBeGreaterThan(h1);

    // Max scale up to 420px max h -> 630px
    tree.h = 420;
    expect(computeVisualHeight(tree, true, false)).toBe(630);
  });

  it("anchors radial menu to actual rendered sprite visual bounds from the feet", () => {
    // Tree standing on ground at y=400 (feet = 400). When h=150, y=250.
    const tree: Entity = {
      id: 10,
      type: "tree",
      x: 200,
      y: 250,
      w: 100,
      h: 150,
      vx: 0,
      vy: 0,
      color: 0x228822,
      solid: false,
      gravityScale: 0,
      facing: 1,
      onGround: true,
      health: 100,
      owner: "tree-mod",
      data: {},
    };

    const visH0 = computeVisualHeight(tree, true, false); // 225
    const pos0 = computeRadialRawCenter(tree, visH0);
    // Feet = tree.y + tree.h = 250 + 150 = 400.
    // Visual top = 400 - 225 = 175.
    // Visual center = 400 - 112.5 = 287.5.
    expect(pos0.rawY).toBe(287.5);

    // Now scale tree bigger: factor = 1.15
    // nh = 172.5, ny = 400 - 172.5 = 227.5 (feet stay at 400).
    tree.y -= (172.5 - tree.h);
    tree.h = 172.5;
    const visH1 = computeVisualHeight(tree, true, false); // 258.75
    const pos1 = computeRadialRawCenter(tree, visH1);
    // Feet = 227.5 + 172.5 = 400.
    // Visual center = 400 - 258.75 / 2 = 270.625.
    expect(pos1.rawY).toBe(400 - 258.75 / 2);

    // For a code-drawn shape (no sprite), visH is e.h, and visual center is e.y + e.h / 2
    const block: Entity = { ...tree, type: "block" };
    const visBlock = computeVisualHeight(block, false, true);
    expect(visBlock).toBe(tree.h);
    const posBlock = computeRadialRawCenter(block, visBlock);
    expect(posBlock.rawY).toBe(tree.y + tree.h / 2);
  });
});
