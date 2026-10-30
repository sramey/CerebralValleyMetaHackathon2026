// Bead 852: a build orders a sprite sheet for every new creature or prop type it spawns,
// cached sheets are reused, and all missing sheets are drawn in parallel. No per-build cap.
import { describe, expect, it } from "vitest";
import { planArtOrders } from "../server/art";
import { drawPendingArt, planBuildArt } from "../server/art-orders";

const SOURCE = `
export default {
  id: "menagerie",
  title: "Menagerie",
  setup(api) {
    api.spawn({ type: "dragon", x: 520, y: 240, w: 64, h: 48, data: { hostile: true } });
    api.spawn({ type: "knight", x: 300, y: 340, w: 26, h: 40 });
    api.spawn({ type: "treasure-chest", x: 180, y: 356, w: 28, h: 22 });
  },
  dispose(api) { for (const t of ["dragon", "knight", "treasure-chest"]) for (const e of api.byType(t)) api.despawn(e.id); },
  test(t) { t.expect(t.api.entities().length >= 0, "ok"); },
}`;

const COMMAND = "add a dragon, a knight and a treasure chest";

describe("art orders for a multi-subject build (bead 852)", () => {
  it("plans one sheet per new creature or prop, each with its own subject", () => {
    const orders = planArtOrders(SOURCE, COMMAND);
    expect(orders.map((o) => o.type)).toEqual(["dragon", "knight", "treasure-chest"]);
    expect(orders.map((o) => o.key)).toEqual(["dragon-fly", "knight", "chest"]);
    expect(orders.map((o) => o.subject)).toEqual(["dragon", "knight", "treasure chest"]);
    // The chest is scenery art; the creatures get pose sheets, and the dragon flies (ADR 0053).
    expect(orders[2]!.scenery).toBe(true);
    expect(orders[0]!.flying).toBe(true);
  });

  it("collapses two spawned types that share an art key into one order", () => {
    const source = 'api.spawn({ type: "dragon", x: 0 }); api.spawn({ type: "fire-dragon", x: 9 }); api.spawn({ type: "chest", x: 3 });';
    expect(planArtOrders(source, "add a fire dragon and a chest").map((o) => o.key)).toEqual(["dragon-fly", "chest"]);
  });

  it("never orders terrain, effects, projectiles or shapes", () => {
    const source = [
      'api.spawn({ type: "ground", x: 0, w: 1600, h: 40, solid: true, gravityScale: 0 })',
      'api.spawn({ type: "boss-bullet", x: 0, w: 8, h: 8, vx: 300, solid: false, gravityScale: 0 })',
      'api.spawn({ type: "rain-drop", x: 0, w: 2, h: 8, solid: false, gravityScale: 0 })',
      'api.spawn({ type: "dragon", x: 0, w: 40, h: 30 })',
    ].join("; ");
    expect(planArtOrders(source, "make it rain on a dragon").map((o) => o.type)).toEqual(["dragon"]);
  });

  it("draws every missing sheet in parallel and reports each as it lands", async () => {
    const drawn: string[] = [];
    const landed: string[] = [];
    const plan = planBuildArt(planArtOrders(SOURCE, COMMAND), { cached: () => null, spend: () => true });
    expect(plan.pending).toHaveLength(3);
    expect(plan.artPending).toBe("dragon-fly");
    await new Promise<void>((resolve) => {
      drawPendingArt(
        plan.pending,
        async (order) => { drawn.push(order.key); return `/art/gen/${order.key}.webp`; },
        (order, url) => {
          if (url) landed.push(`${order.key}=${url}`);
          if (landed.length === 3) resolve();
        },
      );
    });
    expect(drawn.sort()).toEqual(["chest", "dragon-fly", "knight"]);
    expect(landed.sort()).toEqual(["chest=/art/gen/chest.webp", "dragon-fly=/art/gen/dragon-fly.webp", "knight=/art/gen/knight.webp"]);
  });

  it("reuses cached sheets and never re-orders them", async () => {
    const asked: string[] = [];
    const plan = planBuildArt(planArtOrders(SOURCE, COMMAND), {
      cached: (key) => (key === "knight" ? "/art/gen/knight.webp" : null),
      spend: () => true,
    });
    expect(plan.art).toEqual({ key: "knight", url: "/art/gen/knight.webp" });
    expect(plan.extra).toEqual([]);
    expect(plan.pending.map((o) => o.key)).toEqual(["dragon-fly", "chest"]);
    await new Promise<void>((resolve) => {
      drawPendingArt(plan.pending, async (order) => { asked.push(order.key); return null; }, () => { if (asked.length === 2) resolve(); });
    });
    expect(asked.sort()).toEqual(["chest", "dragon-fly"]);
  });

  it("carries further cached sheets as extra art and stops ordering when spend refuses", () => {
    const both = planBuildArt(planArtOrders(SOURCE, COMMAND), { cached: (key) => `/art/gen/${key}.webp`, spend: () => true });
    expect(both.pending).toEqual([]);
    expect(both.art).toEqual({ key: "dragon-fly", url: "/art/gen/dragon-fly.webp" });
    expect(both.extra.map((a) => a.key)).toEqual(["knight", "chest"]);
    expect(both.extra.find((a) => a.key === "chest")?.scenery).toBe(true);

    const spent: number[] = [];
    const capped = planBuildArt(planArtOrders(SOURCE, COMMAND), { cached: () => null, spend: () => { spent.push(1); return spent.length < 2; } });
    expect(capped.pending.map((o) => o.key)).toEqual(["dragon-fly"]);
    expect(spent).toHaveLength(2); // the second refusal stops the rest
  });
  it("orders character art (not scenery, not shapes) for basketball rival and player", () => {
    const src1 = 'api.spawn({ type: "basketball-rival", x: 280, y: 366, w: 26, h: 34, color: 0x3a7bd5, solid: false, gravityScale: 1 });';
    const orders1 = planArtOrders(src1, "add a basketball rival");
    expect(orders1).toHaveLength(1);
    expect(orders1[0]).toMatchObject({
      type: "basketball-rival",
      key: "rival",
      subject: "basketball rival",
      scenery: false,
      flying: false,
    });

    const src2 = 'api.spawn({ type: "basketball-player", x: 280, y: 366, w: 26, h: 34, color: 0x3a7bd5, solid: false, gravityScale: 1 });';
    const orders2 = planArtOrders(src2, "add a basketball player");
    expect(orders2).toHaveLength(1);
    expect(orders2[0]).toMatchObject({
      type: "basketball-player",
      key: "basketball-player",
      subject: "basketball player",
      scenery: false,
      flying: false,
    });
  });
});
