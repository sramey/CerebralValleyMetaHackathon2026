// Jetpack mod (bead metabuild-ideation-epl).
// Worn on the player's back; holding jump activates vertical thrusters with net upward
// acceleration (> gravity 1500), emitting fiery exhaust and draining a fuel gauge.
// Fuel recharges automatically once the player touches ground again.
import type { ModDefinition } from "../contract";

export const jetpackMod: ModDefinition = {
  id: "jetpack",
  title: "Jetpack",
  knobs: {
    thrust: { value: 2400, min: 1800, max: 3200, label: "Thrust (px/s²)" },
    fuelMax: { value: 100, min: 20, max: 200, label: "Fuel Max" },
    drain: { value: 35, min: 10, max: 80, label: "Drain rate (/s)" },
    regen: { value: 50, min: 10, max: 100, label: "Regen rate (/s)" },
  },
  setup(api, knobs) {
    const thrust = Math.max(1800, Number(knobs.thrust) || 2400);
    const fuelMax = Math.max(20, Number(knobs.fuelMax) || 100);
    const drain = Math.max(10, Number(knobs.drain) || 35);
    const regen = Math.max(10, Number(knobs.regen) || 50);

    let fuel = fuelMax;
    let cooldown = 0;

    const p0 = api.player();
    const jx = p0 ? p0.x - 4 : 100;
    const jy = p0 ? p0.y + 6 : 340;

    api.spawn({
      type: "jetpack",
      x: jx,
      y: jy,
      w: 20,
      h: 26,
      solid: false,
      gravityScale: 0,
      color: 0xff6b35,
      data: { socket: "back", attachedTo: "player", offsetX: -4, offsetY: 2 },
    });

    const updateHud = (active: boolean): void => {
      api.setHud("jetpack-fuel", {
        kind: "bar",
        label: "Jetpack Fuel",
        icon: "🚀",
        value: Math.round(fuel),
        max: fuelMax,
        color: active ? 0xffdd44 : 0xff6b35,
        position: "bottom-left",
      });
    };
    updateHud(false);

    api.onTick((dt) => {
      const p = api.player();
      if (!p) return;

      if (cooldown > 0) cooldown--;

      // Refuel when resting on the ground
      if (p.onGround && cooldown <= 0 && fuel < fuelMax) {
        fuel = Math.min(fuelMax, fuel + regen * dt);
      }

      let active = false;
      const input = api.input();
      // Thrust when holding jump with fuel
      if (input.jump && fuel > 0 && cooldown <= 0) {
        active = true;
        fuel = Math.max(0, fuel - drain * dt);
        if (fuel <= 0) cooldown = 45;

        // Thrust (2400) comfortably exceeds sim gravity (1500) so player climbs
        p.vy -= thrust * dt;
        if (p.vy < -520) p.vy = -520;
        if (p.y < -300) {
          p.y = -300;
          if (p.vy < 0) p.vy = 0;
        }

        if (api.tick() % 3 === 0) {
          const dir = p.facing || 1;
          api.burst(p.x + p.w / 2 - dir * 6, p.y + p.h, 0xff7722, 3);
          api.burst(p.x + p.w / 2 - dir * 6, p.y + p.h + 4, 0xffee55, 2);
        }
      }

      updateHud(active);
    });
  },
  dispose(api) {
    for (const e of api.byType("jetpack")) api.despawn(e.id);
    api.removeHud("jetpack-fuel");
  },
  test(t) {
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 });
    const p = t.api.spawn({ type: "player", x: 100, y: 360, w: 32, h: 40, solid: false, gravityScale: 1, color: 0x3366ff });
    p.facing = 1;
    t.step(5);

    const initialHud = t.api.hud("jetpack-fuel");
    t.expect(!!initialHud && (initialHud.value ?? 0) === 100, "jetpack fuel starts full");
    t.expect(t.api.byType("jetpack").length === 1, "jetpack entity spawned and worn");

    // Hold jump for 30 frames: player lifts off and clearly ascends high into the air
    t.step(30, { jump: true });
    t.expect(p.onGround === false, "player is airborne with held jump");
    t.expect(p.y < 340, "jetpack thrust clearly lifts player above ground");
    t.expect(p.vy < 0, "jetpack maintains upward velocity against gravity");

    const midHud = t.api.hud("jetpack-fuel");
    t.expect(!!midHud && Number(midHud.value ?? 100) < 100, "held jump thrust drains fuel");

    // Release jump: gravity takes over, player falls back down to ground
    t.step(60, { jump: false });
    t.expect(p.onGround === true, "player lands on ground after thrust release");

    // Standing on ground refuels
    t.step(60, { jump: false });
    const refueledHud = t.api.hud("jetpack-fuel");
    t.expect(!!refueledHud && Number(refueledHud.value ?? 0) > Number(midHud?.value ?? 0), "resting on ground refuels jetpack");
  },
};

export default jetpackMod;
