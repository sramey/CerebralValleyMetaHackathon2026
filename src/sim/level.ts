// api.buildLevel (ADR 0073): turns a generated level (levelgen.ts) into entities and the few rules it needs.
// The rules live here, in the engine, so every level plays the same and a Wonder-written mod only has to
// call one function: pits send the player back to the last checkpoint, spikes and walkers hurt, a stomp
// kills a walker, and touching the flag clears the level.
import type { Entity, LevelBuild, LevelBuildOptions, ModApi } from "../contract";
import { GROUND_Y, generateLevel } from "./levelgen";
import type { LevelPiece, LevelSpec } from "./levelgen";

const PIT_DEPTH = 220; // fall this far below the floor and you are sent back
const HURT_TICKS = 50; // invulnerable this long after a hit
const COLORS = { ground: 0x3f9e4d, platform: 0x8a6b46, block: 0x6b5236, spikes: 0xb8c2cc, walker: 0xe2483d, flyer: 0x8a4fd8, flag: 0xff4d6d };

const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function buildLevel(api: ModApi, options: LevelBuildOptions = {}): LevelBuild {
  const spec: LevelSpec = generateLevel(options);
  const colors = { ...COLORS, ...(options.palette ?? {}) };
  // The starter ground, ledges and tunnel step aside (undone when this mod unloads); the generated floor replaces them.
  api.setScene?.({ hideTerrain: true });

  const made: Entity[] = [];
  const spawnPiece = (p: LevelPiece): Entity | undefined => {
    const base = { x: p.x, y: p.y, w: p.w, h: p.h };
    switch (p.kind) {
      case "ground": return api.spawn({ type: "ground", ...base, color: colors.ground, solid: true, gravityScale: 0 });
      case "platform": return api.spawn({ type: "platform", ...base, color: colors.platform, solid: true, gravityScale: 0, data: { oneWay: true } });
      case "block": return api.spawn({ type: "block", ...base, color: colors.block, solid: true, gravityScale: 0 });
      case "spikes": return api.spawn({ type: "spikes", ...base, color: colors.spikes, solid: false, gravityScale: 0, data: { damage: Number(p.data?.damage ?? 12) } });
      case "walker": return api.spawn({ type: "walker", ...base, color: colors.walker, solid: false, gravityScale: 1, data: { minX: Number(p.data?.minX), maxX: Number(p.data?.maxX) } });
      case "flyer": return api.spawn({ type: "flyer", ...base, color: colors.flyer, solid: false, gravityScale: 0, data: { baseX: Number(p.data?.baseX), baseY: Number(p.data?.baseY), span: Number(p.data?.span), flying: true } });
      case "coin": return api.spawn({ type: "coin", ...base, color: 0xffd94d, solid: false, gravityScale: 0, data: { collectible: true } });
      case "flag": return api.spawn({ type: "finish-flag", ...base, color: colors.flag, solid: false, gravityScale: 0 });
      case "checkpoint": return undefined; // bookkeeping only; no body
    }
  };
  for (const p of spec.pieces) { const e = spawnPiece(p); if (e) made.push(e); }

  const checkpoints = spec.pieces.filter((p) => p.kind === "checkpoint").map((p) => p.x);
  const walkers = made.filter((e) => e.type === "walker");
  const flyers = made.filter((e) => e.type === "flyer");
  const spikes = made.filter((e) => e.type === "spikes");
  const flag = made.find((e) => e.type === "finish-flag");
  const speed = 45 + spec.difficulty * 12;
  walkers.forEach((w, i) => { w.facing = i % 2 === 0 ? 1 : -1; });

  const player = api.player();
  if (player) { player.x = spec.start.x; player.y = spec.start.y; player.vx = 0; player.vy = 0; }

  let safeX = spec.start.x;
  let hurtUntil = 0;
  let cleared = false;
  let falls = 0;
  const total = spec.endX - spec.startX;

  const hurt = (p: Entity, amount: number, knock: number): void => {
    if (api.tick() < hurtUntil) return;
    hurtUntil = api.tick() + HURT_TICKS;
    p.health = Math.max(1, p.health - amount);
    p.vy = -knock;
    api.burst(p.x + p.w / 2, p.y + p.h / 2, 0xff4d4d, 8);
  };

  api.onTick(() => {
    const t = api.tick();
    for (const w of walkers) {
      if (w.dead) continue;
      w.vx = w.facing * speed;
      if (w.x < Number(w.data.minX)) w.facing = 1;
      if (w.x + w.w > Number(w.data.maxX)) w.facing = -1;
    }
    for (const f of flyers) {
      const bx = Number(f.data.baseX), by = Number(f.data.baseY), sp = Number(f.data.span);
      f.x = bx + sp * Math.sin(t / 60 * 1.2);
      f.y = by + 16 * Math.sin(t / 60 * 2.4);
      f.facing = Math.cos(t / 60 * 1.2) >= 0 ? 1 : -1;
    }
    const p = api.player();
    if (!p) return;
    for (const c of checkpoints) if (p.x > c && c > safeX) safeX = c;
    // Pits: fall below the floor and you go back to the last checkpoint, a little hurt.
    if (p.y > GROUND_Y + PIT_DEPTH) {
      falls++;
      p.x = safeX; p.y = GROUND_Y - p.h - 2; p.vx = 0; p.vy = 0;
      p.health = Math.max(1, p.health - 10);
      api.burst(p.x + p.w / 2, p.y + p.h / 2, 0xffc94d, 12);
      api.setHud("level-note", { kind: "banner", text: "Back to the checkpoint", duration: 1.5, position: "top-center" });
    }
    for (const s of spikes) if (hit(p, s)) hurt(p, Number(s.data.damage ?? 12), 380);
    for (const w of walkers) {
      if (w.dead || !hit(p, w)) continue;
      if (p.vy > 0 && p.y + p.h - w.y < 20) {
        api.burst(w.x + w.w / 2, w.y + w.h / 2, colors.walker, 14);
        api.despawn(w.id);
        walkers.splice(walkers.indexOf(w), 1);
        p.vy = -430;
        break;
      }
      hurt(p, 8, 320);
    }
    for (const f of flyers) if (hit(p, f)) hurt(p, 8, 300);
    // Progress, then the flag.
    const pct = Math.max(0, Math.min(100, Math.round(((p.x - spec.startX) / total) * 100)));
    api.setHud("level-progress", { kind: "bar", label: "Level", icon: "🏁", value: cleared ? 100 : pct, max: 100, position: "top-right" });
    if (flag && !cleared && hit(p, flag)) {
      cleared = true;
      api.burst(flag.x + flag.w / 2, flag.y + 20, 0xffd94d, 40);
      api.setHud("level-note", { kind: "banner", text: "LEVEL CLEAR!", duration: 4, position: "center" });
      api.signal?.("level-clear", spec.difficulty);
    }
  });

  return {
    endX: spec.endX,
    startX: spec.startX,
    difficulty: spec.difficulty,
    length: spec.length,
    stats: spec.stats,
    spec,
    get cleared() { return cleared; },
    get falls() { return falls; },
    dispose() {
      for (const e of made) api.despawn(e.id);
      made.length = 0;
      api.removeHud("level-progress");
      api.removeHud("level-note");
    },
  };
}
