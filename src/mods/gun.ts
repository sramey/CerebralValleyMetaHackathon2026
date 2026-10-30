import type { ModDefinition } from "../contract";

export const gunMod: ModDefinition = {
  id: "gun",
  title: "Hand cannon",
  knobs: {
    damage: { value: 50, min: 10, max: 200, label: "Damage" },
    cooldown: { value: 12, min: 2, max: 60, label: "Cooldown (ticks)" },
    speed: { value: 650, min: 200, max: 1200, label: "Bullet speed" },
    magSize: { value: 12, min: 4, max: 60, label: "Magazine size" },
  },
  setup(api, knobs) {
    const damage = Number(knobs.damage);
    const cooldown = Math.max(1, Math.floor(Number(knobs.cooldown)));
    const speed = Number(knobs.speed);

    // Spawn the held weapon; the engine mounts it on the hand (ADR 0057) and the loadout owns
    // switching, dropping, ammo and the HUD line (ADR 0074).
    const p = api.player();
    const gun = api.spawn({
      type: "gun",
      x: p ? p.x : 100,
      y: p ? p.y : 300,
      w: 16,
      h: 8,
      color: 0x5a5a66,
      solid: false,
      gravityScale: 0,
      data: { heldByPlayer: true, item: "gun" },
    });
    const gear = api.gear!({ label: "Gun", icon: "🔫", entity: gun, magSize: Math.max(1, Math.floor(Number(knobs.magSize))), cooldown, reloadTicks: 45 });
    api.setHud("weapon", { kind: "banner", text: "Gun: F / X to shoot, R to reload, G to drop", duration: 3, position: "top-center" });

    api.onTick(() => {
      const player = api.player();
      const input = api.input();
      if ((input.use || input.shoot) && gear.fire()) {
        const dir = player ? player.facing : 1;
        // Shots leave from the player, not the drawn gun: the engine mounts the gun after the step.
        const bx = player ? (dir > 0 ? player.x + player.w - 2 + gun.w : player.x - 14 - 8) : gun.x;
        const by = (player ? player.y + player.h / 2 - 3 : gun.y) + 2;
        api.spawn({
          type: "player-bullet",
          x: bx,
          y: by,
          w: 8,
          h: 4,
          vx: dir * speed,
          vy: 0,
          color: 0xffd700,
          solid: false,
          gravityScale: 0,
          data: { age: 0, damage, fromPlayer: true },
        });
        api.burst(bx, by + 2, 0xffd700, 3);
      }

      // Update projectiles: enemy damage, solid collision, and despawn
      for (const b of api.byType("player-bullet")) {
        b.data.age = Number(b.data.age ?? 0) + 1;
        if (Number(b.data.age) % 3 === 0) {
          api.burst(b.x + b.w / 2, b.y + b.h / 2, 0xffaa00, 1);
        }

        let hit = false;
        if (api.damageHit) {
          hit = Boolean(api.damageHit(b, { damage, burstColor: 0xffaa00, burstCount: 8 }));
        }
        if (!hit && Number(b.data.age) > 180) {
          api.despawn(b.id);
        }
      }
    });
  },
  dispose(api) {
    for (const g of api.byType("gun")) api.despawn(g.id);
    for (const b of api.byType("player-bullet")) api.despawn(b.id);
    api.removeHud("weapon");
  },
  test(t) {
    // 1. Without player, firing input is a safe no-op
    t.step(5, { use: true });

    // 2. Spawn player and hostile enemy
    const p = t.api.spawn({
      type: "player",
      x: 100,
      y: 300,
      w: 26,
      h: 34,
      color: 0xffffff,
      gravityScale: 0,
    });
    p.facing = 1;

    const enemy = t.api.spawn({
      type: "enemy",
      x: 240,
      y: 300,
      w: 28,
      h: 28,
      color: 0xe2483d,
      gravityScale: 0,
      health: 100,
    });

    // 3. Fire using `use: true` keybinding
    t.step(1, { use: true });
    t.expect(t.api.byType("player-bullet").length >= 1, "bullet spawns on use input");

    // 4. Bullet reaches enemy, applies damage, and despawns
    t.step(30);
    t.expect(enemy.health < 100, "enemy takes damage from player bullet");
    t.expect(t.api.byType("player-bullet").length === 0, "bullet despawns on hit");

    // 5. Fire again with `shoot: true` to destroy enemy
    t.step(1, { shoot: true });
    t.step(30);
    t.expect(t.api.byType("enemy").length === 0, "enemy destroyed when health reaches zero");
  },
};

export default gunMod;
