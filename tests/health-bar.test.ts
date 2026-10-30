import { describe, it, expect } from "vitest";
import { BAR_GAP, BAR_HEIGHT, healthBarColor, healthBarRect, rectBody, spriteBody } from "../src/client/health-bar";

describe("healthBarRect", () => {
  it("sits a fixed gap above the drawn top, whatever the size", () => {
    for (const drawnH of [20, 56, 300]) {
      const r = healthBarRect(spriteBody(100, 500, 40, drawnH), 50)!;
      expect(r.y + r.h + BAR_GAP).toBe(500 - drawnH);
      expect(r.h).toBe(BAR_HEIGHT);
    }
  });

  it("follows a size change: a bigger sprite lifts the bar and widens it, within bounds", () => {
    const small = healthBarRect(spriteBody(100, 500, 10, 14), 50)!;
    const normal = healthBarRect(spriteBody(100, 500, 32, 56), 50)!;
    const huge = healthBarRect(spriteBody(100, 500, 400, 300), 50)!;
    expect(small.y).toBeGreaterThan(normal.y);
    expect(normal.y).toBeGreaterThan(huge.y);
    expect(small.w).toBe(24);
    expect(normal.w).toBe(32);
    expect(huge.w).toBe(120);
  });

  it("is centred on the body, and a flipped sprite (negative scale) gives the same bar", () => {
    const r = healthBarRect(spriteBody(100, 500, 40, 56), 50)!;
    expect(r.x + r.w / 2).toBe(100);
    expect(healthBarRect(spriteBody(100, 500, -40, -56), 50)).toEqual(r);
  });

  it("fills in proportion to health and uses the rect body's hitbox top", () => {
    const r = healthBarRect(rectBody(10, 200, 50), 25)!;
    expect(r.x).toBe(10);
    expect(r.y).toBe(200 - BAR_GAP - BAR_HEIGHT);
    expect(r.fill).toBe(12.5);
  });

  it("draws nothing at full health, at zero, or without a number", () => {
    const b = rectBody(0, 0, 30);
    expect(healthBarRect(b, 100)).toBeNull();
    expect(healthBarRect(b, 0)).toBeNull();
    expect(healthBarRect(b, undefined)).toBeNull();
  });

  it("colours by band", () => {
    expect(healthBarColor(80)).toBe(0x3fd06a);
    expect(healthBarColor(40)).toBe(0xffc94d);
    expect(healthBarColor(10)).toBe(0xff5a4d);
  });
});
