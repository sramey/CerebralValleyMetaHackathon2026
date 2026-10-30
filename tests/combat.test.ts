import { visualBox } from "../src/sim/sockets";
import { touches } from "../src/sim/reach";
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import { isDamageableTarget, checkProjectileHitAndDamage, overlap, isFriendly, isHostileEnemy } from "../src/sim/combat";
import { Fx } from "../src/client/fx";
import { Container } from "pixi.js";
import { packInput, unpackInput } from "../src/sim/playtest";
import { resolveItemMod, isItemUseKey } from "../src/client/items";
import { gunMod } from "../src/mods/gun";
import { fireArrowMod } from "../src/mods/fire-arrow";
import playerMod from "../src/mods/player";
import groundMod from "../src/mods/ground";
import enemyMod from "../src/mods/enemy";
import type { Entity } from "../src/contract";

describe("reusable enemy-damage pattern & combat (ADR 0023)", () => {
  it("input state pack and unpack round-trips the 'use' item key", () => {
    const input = { left: true, right: false, jump: true, shoot: false, use: true };
    const mask = packInput(input);
    const decoded = unpackInput(mask);
    expect(decoded.use).toBe(true);
    expect(decoded.left).toBe(true);
    expect(decoded.jump).toBe(true);
    expect(decoded.right).toBe(false);
    expect(decoded.shoot).toBe(false);
  });

  it("isDamageableTarget correctly discriminates between hostiles, friendly player, and terrain", () => {
    const player: Entity = {
      id: 1, type: "player", x: 100, y: 300, w: 26, h: 34,
      vx: 0, vy: 0, color: 0xffffff, solid: false, gravityScale: 1,
      facing: 1, onGround: true, health: 100, owner: "player", data: {},
    };
    const gun: Entity = {
      id: 2, type: "gun", x: 120, y: 310, w: 16, h: 8,
      vx: 0, vy: 0, color: 0x555555, solid: false, gravityScale: 0,
      facing: 1, onGround: false, health: 100, owner: "gun", data: { heldByPlayer: true },
    };
    const playerBullet: Entity = {
      id: 3, type: "player-bullet", x: 130, y: 310, w: 8, h: 4,
      vx: 600, vy: 0, color: 0xffd700, solid: false, gravityScale: 0,
      facing: 1, onGround: false, health: 100, owner: "gun", data: { fromPlayer: true },
    };
    const enemy: Entity = {
      id: 4, type: "enemy", x: 250, y: 300, w: 28, h: 28,
      vx: 50, vy: 0, color: 0xe2483d, solid: false, gravityScale: 1,
      facing: -1, onGround: true, health: 100, owner: "enemies", data: { hostile: true },
    };
    const boss: Entity = {
      id: 5, type: "boss-dragon", x: 500, y: 250, w: 80, h: 80,
      vx: 0, vy: 0, color: 0x990000, solid: false, gravityScale: 0,
      facing: -1, onGround: true, health: 500, owner: "boss", data: {},
    };
    const ground: Entity = {
      id: 6, type: "ground", x: 0, y: 400, w: 1000, h: 40,
      vx: 0, vy: 0, color: 0x228833, solid: true, gravityScale: 0,
      facing: 1, onGround: false, health: 100, owner: "ground", data: {},
    };
    const coin: Entity = {
      id: 7, type: "coin", x: 180, y: 320, w: 12, h: 12,
      vx: 0, vy: 0, color: 0xffcc00, solid: false, gravityScale: 0,
      facing: 1, onGround: false, health: 100, owner: "coins", data: {},
    };
    const cloud: Entity = {
      id: 8, type: "cloud", x: 200, y: 50, w: 80, h: 30,
      vx: 10, vy: 0, color: 0xffffff, solid: false, gravityScale: 0,
      facing: 1, onGround: false, health: 100, owner: "weather", data: {},
    };

    // Player bullet vs targets
    expect(isDamageableTarget(player, playerBullet)).toBe(false);
    expect(isDamageableTarget(gun, playerBullet)).toBe(false);
    expect(isDamageableTarget(ground, playerBullet)).toBe(false);
    expect(isDamageableTarget(coin, playerBullet)).toBe(false);
    expect(isDamageableTarget(cloud, playerBullet)).toBe(false);
    expect(isDamageableTarget(enemy, playerBullet)).toBe(true);
    expect(isDamageableTarget(boss, playerBullet)).toBe(true);
  });

  it("checkProjectileHitAndDamage damages enemy and despawns bullet", () => {
    const world = new World(42);
    const loader = new ModLoader(world);

    const enemy = world.spawn({
      type: "enemy", x: 200, y: 300, w: 30, h: 30,
      health: 100, solid: false,
    }, "enemyMod");

    const bullet = world.spawn({
      type: "player-bullet", x: 205, y: 305, w: 8, h: 4,
      data: { fromPlayer: true, damage: 45 },
    }, "weaponMod");

    // Reusable damage helper check
    const hit = checkProjectileHitAndDamage(
      {
        spawn: (d) => world.spawn(d, "weaponMod"),
        despawn: (id) => world.despawn(id),
        damage: (id, amt) => world.damage(id, amt),
        entities: () => world.entities,
        byType: (t) => world.entities.filter((e) => e.type === t),
        touches: (a, b) => touches(a, b),
        player: () => world.entities.find((e) => e.type === "player"),
        input: () => world.input,
        onTick: (fn) => world.addHandler("weaponMod", fn),
        burst: (x, y, c, n) => world.burst(x, y, c, n),
        rand: () => world.rand(),
        tick: () => world.tickCount,
        setHud: (id, def) => world.setHud("weaponMod", id, def),
        removeHud: (id) => world.removeHud("weaponMod", id),
        hud: (id) => world.hud.get(id),
        hudList: () => world.hudList(),
      },
      bullet,
      { damage: 45, burstColor: 0xffd700 },
    );

    expect(hit?.id).toBe(enemy.id);
    expect(enemy.health).toBe(55);
    // Bullet should be despawned
    expect(world.entities.some((e) => e.id === bullet.id)).toBe(false);
    // Impact particles should have spawned
    expect(world.particles.length).toBeGreaterThan(0);
  });

  it("checkProjectileHitAndDamage despawns on solid obstacle impact", () => {
    const world = new World(42);

    const wall = world.spawn({
      type: "wall", x: 300, y: 0, w: 40, h: 600,
      solid: true, gravityScale: 0,
    }, "map");

    const bullet = world.spawn({
      type: "player-bullet", x: 305, y: 300, w: 8, h: 4,
      data: { fromPlayer: true },
    }, "weapon");

    const hit = checkProjectileHitAndDamage(
      {
        spawn: (d) => world.spawn(d, "weapon"),
        despawn: (id) => world.despawn(id),
        damage: (id, amt) => world.damage(id, amt),
        entities: () => world.entities,
        byType: (t) => world.entities.filter((e) => e.type === t),
        touches: (a, b) => touches(a, b),
        player: () => world.entities.find((e) => e.type === "player"),
        input: () => world.input,
        onTick: (fn) => world.addHandler("weapon", fn),
        burst: (x, y, c, n) => world.burst(x, y, c, n),
        rand: () => world.rand(),
        tick: () => world.tickCount,
        setHud: (id, def) => world.setHud("weapon", id, def),
        removeHud: (id) => world.removeHud("weapon", id),
        hud: (id) => world.hud.get(id),
        hudList: () => world.hudList(),
      },
      bullet,
      { despawnOnSolid: true },
    );

    expect(hit).toBeUndefined();
    // Bullet despawned on solid
    expect(world.entities.some((e) => e.id === bullet.id)).toBe(false);
    expect(world.particles.length).toBeGreaterThan(0);
  });
});

describe("hand cannon weapon mod (gunMod)", () => {
  it("passes its built-in self test", () => {
    const r = runModTest(gunMod);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("sets weapon HUD widget with keybinding info", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    loader.load(gunMod);

    const widget = world.hud.get("weapon");
    expect(widget).toBeDefined();
    expect(widget?.icon).toBe("🔫");
    expect(widget?.label).toBe("Gun");
    expect(String(widget?.value)).toMatch(/shoot/i);
  });

  it("held gun entity tracks player position and facing", () => {
    const world = new World(10);
    const loader = new ModLoader(world);
    loader.load(groundMod);
    loader.load(playerMod);
    loader.load(gunMod);

    world.step();
    const player = world.entities.find((e) => e.type === "player")!;
    const gun = world.entities.find((e) => e.type === "gun")!;
    expect(gun).toBeDefined();
    expect(gun.data.heldByPlayer).toBe(true);

    // Player faces right
    player.facing = 1;
    world.step();
    expect(gun.x).toBeGreaterThan(player.x);
    expect(gun.facing).toBe(1);

    // Player faces left
    player.facing = -1;
    world.step();
    expect(gun.facing).toBe(-1);
    expect(gun.x).toBeLessThan(player.x + player.w / 2);
  });

  it("fires bullet with use key (e.g. F key) and damages hostile enemy", () => {
    const world = new World(20);
    const loader = new ModLoader(world);
    loader.load(groundMod);
    loader.load(playerMod);
    loader.load(gunMod);

    const enemy = world.spawn({
      type: "enemy", x: 260, y: 360, w: 28, h: 28,
      health: 100, solid: false, gravityScale: 0,
    }, "enemyMod");

    const player = world.entities.find((e) => e.type === "player")!;
    player.x = 100;
    player.y = 360;
    player.facing = 1;

    // Press use key
    world.input.use = true;
    world.step();
    world.input.use = false;

    const bullets = world.entities.filter((e) => e.type === "player-bullet");
    expect(bullets.length).toBe(1);
    expect(bullets[0].vx).toBeGreaterThan(0);

    // Step until bullet reaches enemy
    for (let i = 0; i < 30; i++) world.step();

    expect(enemy.health).toBeLessThan(100);
    expect(world.entities.filter((e) => e.type === "player-bullet")).toHaveLength(0);
  });

  it("unloading gunMod cleans up gun entity, bullets, and HUD widget", () => {
    const world = new World(30);
    const loader = new ModLoader(world);
    loader.load(playerMod);
    loader.load(gunMod);

    world.input.shoot = true;
    world.step();
    world.input.shoot = false;

    expect(world.entities.some((e) => e.type === "gun")).toBe(true);
    expect(world.entities.some((e) => e.type === "player-bullet")).toBe(true);
    expect(world.hud.has("weapon")).toBe(true);

    loader.unload("gun");

    expect(world.entities.some((e) => e.type === "gun")).toBe(false);
    expect(world.entities.some((e) => e.type === "player-bullet")).toBe(false);
    expect(world.hud.has("weapon")).toBe(false);
  });

  it("fireArrowMod damages enemies on hit and passes runModTest", () => {
    const r = runModTest(fireArrowMod);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);

    const world = new World(40);
    const loader = new ModLoader(world);
    loader.load(groundMod);
    loader.load(playerMod);
    loader.load(fireArrowMod);

    const enemy = world.spawn({
      type: "enemy", x: 250, y: 360, w: 28, h: 28,
      health: 100, solid: false, gravityScale: 0,
    }, "enemyMod");

    const player = world.entities.find((e) => e.type === "player")!;
    player.x = 100;
    player.y = 360;
    player.facing = 1;

    // Shoot arrow using use key
    world.input.use = true;
    world.step();
    world.input.use = false;

    expect(world.entities.some((e) => e.type === "fire-arrow")).toBe(true);

    for (let i = 0; i < 30; i++) world.step();

    expect(enemy.health).toBeLessThan(100);
    expect(world.entities.filter((e) => e.type === "fire-arrow")).toHaveLength(0);
  });

  it("client item helpers route commands and recognize weapon keybindings", () => {
    expect(isItemUseKey("KeyF")).toBe(true);
    expect(isItemUseKey("KeyE")).toBe(true);
    expect(isItemUseKey("KeyX")).toBe(true);
    expect(isItemUseKey("KeyJ")).toBe(true);
    expect(isItemUseKey("KeyQ")).toBe(false);

    expect(resolveItemMod("give me a gun")?.id).toBe("gun");
    expect(resolveItemMod("gun")?.id).toBe("gun");
    expect(resolveItemMod("hand cannon")?.id).toBe("gun");
    expect(resolveItemMod("spawn a weapon")?.id).toBe("gun");
    expect(resolveItemMod("blaster")?.id).toBe("gun");
    expect(resolveItemMod("add some ground")).toBeUndefined();
  });

  it("rigidly locks equipment to player, updates facing, and mirrors coordinates when turning (bead qwc)", () => {
    const world = new World(11);
    const p = world.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, solid: false, gravityScale: 1, color: 0xffffff }, "player");
    p.facing = 1;
    const jetpack = world.spawn({ type: "jetpack", x: 90, y: 310, w: 20, h: 26, solid: false, gravityScale: 0 }, "jetpack");
    const gun = world.spawn({ type: "gun", x: 120, y: 315, w: 16, h: 8, solid: false, gravityScale: 0 }, "gun");

    world.step();
    expect(jetpack.facing).toBe(1);
    expect(gun.facing).toBe(1);
    const box = visualBox(p);
    expect(gun.y + gun.h / 2).toBeCloseTo(box.bottom - box.h * 0.55, 5); // hand height of the DRAWN body, not leg (ADR 0061)

    // Turn player left:
    p.facing = -1;
    world.step();
    expect(jetpack.facing).toBe(-1);
    expect(gun.facing).toBe(-1);
    // Gun mirrors to front-left of player:
    expect(gun.x).toBeLessThan(p.x);
  });

  it("automatically collides any projectile against hostile enemy without custom weapon code (bead 578)", () => {
    const world = new World(12);
    const enemy = world.spawn({ type: "goblin", x: 200, y: 300, w: 30, h: 30, solid: false, gravityScale: 0, health: 100, data: { hostile: true } }, "enemy");
    const bullet = world.spawn({ type: "bullet", x: 195, y: 305, w: 10, h: 6, vx: 400, vy: 0, solid: false, gravityScale: 0, data: { visual: "projectile", fromPlayer: true } }, "weapon");

    world.step();
    expect(enemy.health).toBeLessThan(100);
    expect(world.entities.filter(e => e.id === bullet.id)).toHaveLength(0); // projectile despawned on hit
  });
  it("protects friendlies from player bullet damage and friendly fire", () => {
    const playerBullet: Entity = {
      id: 1, type: "player-bullet", x: 100, y: 300, w: 8, h: 4,
      vx: 600, vy: 0, color: 0xffd700, solid: false, gravityScale: 0,
      facing: 1, onGround: false, health: 100, owner: "gun", data: { fromPlayer: true },
    };

    const chicken: Entity = {
      id: 2, type: "chicken", x: 150, y: 300, w: 24, h: 24,
      vx: 0, vy: 0, color: 0xffffff, solid: false, gravityScale: 1,
      facing: 1, onGround: true, health: 100, owner: "chicken", data: { casual: true },
    };

    const friendlyDragon: Entity = {
      id: 3, type: "dragon", x: 160, y: 300, w: 40, h: 40,
      vx: 0, vy: 0, color: 0x00ff00, solid: false, gravityScale: 0,
      facing: 1, onGround: false, health: 100, owner: "pet", data: { friendly: true },
    };

    const heroAlly: Entity = {
      id: 4, type: "knight", x: 170, y: 300, w: 30, h: 30,
      vx: 0, vy: 0, color: 0x3366ff, solid: false, gravityScale: 1,
      facing: 1, onGround: true, health: 100, owner: "hero", data: { hero: true },
    };

    const enemy: Entity = {
      id: 5, type: "slime", x: 200, y: 300, w: 30, h: 30,
      vx: 0, vy: 0, color: 0xff0000, solid: false, gravityScale: 1,
      facing: -1, onGround: true, health: 100, owner: "enemy", data: { hostile: true },
    };

    expect(isFriendly(chicken)).toBe(true);
    expect(isFriendly(friendlyDragon)).toBe(true);
    expect(isFriendly(heroAlly)).toBe(true);
    expect(isFriendly(enemy)).toBe(false);

    expect(isHostileEnemy(enemy)).toBe(true);
    expect(isHostileEnemy(chicken)).toBe(false);
    expect(isHostileEnemy(friendlyDragon)).toBe(false);

    // Player bullet cannot harm friendlies
    expect(isDamageableTarget(chicken, playerBullet)).toBe(false);
    expect(isDamageableTarget(friendlyDragon, playerBullet)).toBe(false);
    expect(isDamageableTarget(heroAlly, playerBullet)).toBe(false);

    // Player bullet can harm hostile enemy
    expect(isDamageableTarget(enemy, playerBullet)).toBe(true);
  });

  it("player bullet passes through friendlies without exploding or harming them in world simulation", () => {
    const world = new World(101);
    const chicken = world.spawn({
      type: "chicken", x: 200, y: 300, w: 30, h: 30,
      solid: false, gravityScale: 0, health: 100, data: { casual: true },
    }, "chickenMod");

    const enemy = world.spawn({
      type: "slime", x: 350, y: 300, w: 30, h: 30,
      solid: false, gravityScale: 0, health: 100, data: { hostile: true },
    }, "enemyMod");

    // Bullet spawned overlapping the chicken
    const bullet = world.spawn({
      type: "player-bullet", x: 205, y: 305, w: 8, h: 4,
      vx: 600, vy: 0, solid: false, gravityScale: 0,
      data: { fromPlayer: true, visual: "projectile", damage: 40 },
    }, "gunMod");

    // Step world: bullet should pass through chicken unharmed
    world.step();
    expect(chicken.health).toBe(100); // chicken untouched
    expect(world.entities.some(e => e.id === bullet.id)).toBe(true); // bullet did NOT despawn on chicken

    // Step until bullet reaches enemy at x=350
    for (let i = 0; i < 20; i++) world.step();

    expect(enemy.health).toBe(60); // enemy took damage
    expect(world.entities.some(e => e.id === bullet.id)).toBe(false); // bullet despawned on enemy
    expect(chicken.health).toBe(100); // chicken still fully healthy
  });

  it("Fx.detectBursts only creates explosion blasts for spatially clustered particles, not distant bullets", () => {
    const fx = new Fx(new Container());
    const world = new World(102);

    // Scenario 1: 3 muzzle particles at x=100 and 3 trail particles at x=400 (distance = 300px > 48px)
    for (let i = 0; i < 3; i++) {
      world.particles.push({ x: 100, y: 200, vx: 0, vy: 0, size: 3, color: 0xffd700, life: 0, maxLife: 20 });
    }
    for (let i = 0; i < 3; i++) {
      world.particles.push({ x: 400, y: 200, vx: 0, vy: 0, size: 3, color: 0xffd700, life: 0, maxLife: 20 });
    }

    // Render frame
    fx.render(world, 0, 0, 960, 540, 1 / 60, () => false);
    // Neither cluster has >= 6 particles, so no blast and no screen shake!
    expect(fx.shakeX).toBe(0);
    expect(fx.shakeY).toBe(0);

    // Scenario 2: 8 particles clustered at one impact location x=300, y=300 (actual hit)
    for (let i = 0; i < 8; i++) {
      world.particles.push({ x: 300 + (i % 2), y: 300 + (i % 2), vx: 10, vy: 10, size: 3, color: 0xffaa00, life: 0, maxLife: 20 });
    }

    fx.render(world, 0, 0, 960, 540, 1 / 60, () => false);
    // Cluster has 8 particles at the hit location -> explosion blast triggers screen shake
    expect(Math.abs(fx.shakeX) + Math.abs(fx.shakeY)).toBeGreaterThan(0);
  });
});
