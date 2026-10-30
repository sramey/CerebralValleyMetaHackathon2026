// Real mods Wonder wrote in a first-time-player session (2026-10-30), trimmed, as regression fixtures for the loadout
// (ADR 0070). They are LEGACY on purpose: none calls api.gear; each just reads input.shoot / input.use.
// @ts-nocheck
import type { ModDefinition } from "../../src/contract";

export const tankMod: ModDefinition = {
  id: "driveable-tank",
  title: "Driveable Tank",
  knobs: {
    speed: { value: 200, min: 60, max: 400, label: "Tank speed" },
    size: { value: 110, min: 70, max: 180, label: "Tank width" },
    shellSpeed: { value: 640, min: 300, max: 1000, label: "Shell speed" }
  },
  setup(api, knobs) {
    const size = Math.max(70, Math.min(180, Number(knobs.size) || 110));
    const speed = Number(knobs.speed) || 200;
    const shellSpeed = Number(knobs.shellSpeed) || 640;
    const h = Math.round(size * 0.42);
    const p = api.player();
    const sx = p ? p.x - size - 30 : -160;
    const tank = api.spawn({ type: "tank", x: sx, y: 400 - h, w: size, h, solid: false, gravityScale: 1, color: 0x4a5d3a, data: { casual: false, interact: "Drive Tank", orders: false } });
    let driving = false;
    let prevShoot = false;
    let shells = [];
    api.setHud("tank-status", { kind: "stat", label: "Tank", icon: "🛡", value: 0, unit: "%", position: "bottom-left" });
    api.on("interact", (ev) => {
      if (ev.entity.id !== tank.id) return;
      driving = !driving;
      api.say(tank, driving ? "Rolling out!" : "Parked.", 2);
    });
    api.onTick(() => {
      const pl = api.player();
      if (!pl) return;
      // Board automatically by stepping onto / into the tank (also via interact prompt)
      if (!driving && api.touches(pl, tank)) driving = true;
      const inp = api.input();
      const shootNow = !!(inp.shoot || inp.use);
      const shootFresh = shootNow && !prevShoot;
      prevShoot = shootNow;
      if (driving) {
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        tank.vx = dir * speed;
        if (dir !== 0) tank.facing = dir;
        tank.vy = Math.min(tank.vy, 300);
        // Player rides in the turret, never trapped inside the hull
        pl.x = tank.x + tank.w / 2 - pl.w / 2;
        pl.y = tank.y - pl.h + 6;
        pl.vx = 0; pl.vy = 0;
        if (inp.jump) { driving = false; pl.vy = -520; pl.y = tank.y - pl.h - 4; api.burst(pl.x + pl.w / 2, pl.y + pl.h, 0x9fb86a, 8); }
        else if (shootFresh) {
          const s = api.spawn({ type: "tank-shell", x: tank.x + tank.w / 2 + tank.facing * (tank.w / 2), y: tank.y + 8, w: 14, h: 10, vx: tank.facing * shellSpeed, vy: -40, solid: false, gravityScale: 0, color: 0xffcc55, data: { fromPlayer: true, life: 90 } });
          shells.push(s);
          api.burst(s.x, s.y + 5, 0xffaa33, 6);
        }
        if (api.tick() % 12 === 0 && dir !== 0) api.burst(tank.x + tank.w / 2 - tank.facing * tank.w / 2, tank.y + tank.h, 0x777777, 3);
      } else {
        tank.vx = 0;
      }
      shells = shells.filter((s) => {
        s.data.life = (s.data.life ?? 90) - 1;
        if (s.data.life <= 0 || s.y > 420) { api.burst(s.x + 7, s.y + 5, 0xff7733, 10); api.despawn(s.id); return false; }
        return true;
      });
      tank.data.driving = driving;
      api.setHud("tank-status", { kind: "stat", label: driving ? "Tank DRIVING" : "Tank parked", icon: "🛡", value: driving ? 100 : 0, unit: "%", position: "bottom-left" });
    });
  },
  dispose(api) {
    for (const e of api.byType("tank")) api.despawn(e.id);
    for (const e of api.byType("tank-shell")) api.despawn(e.id);
    api.removeHud("tank-status");
  },
  test(t) {
    t.api.spawn({ type: "ground", x: -400, y: 400, w: 1600, h: 48, solid: true, gravityScale: 0 });
    const pl = t.api.spawn({ type: "player", x: 120, y: 360, w: 26, h: 34, solid: false, gravityScale: 1, color: 0x3366ff });
    t.step(5);
    const tanks = t.api.byType("tank");
    t.expect(tanks.length === 1, "one tank spawned");
    const tank = tanks[0];
    t.expect(tank.solid === false, "tank non-solid so player is not trapped");
    // Move player into the tank to board it, then drive right
    pl.x = tank.x + 20; pl.y = tank.y - 10; pl.vx = 0; pl.vy = 0;
    const startX = tank.x;
    t.step(30, { right: true });
    t.expect(tank.x > startX + 20, "tank drives right when boarded, got " + tank.x + " vs " + startX);
    // Fire a shell
    t.step(1, { shoot: true });
    t.step(2);
    t.expect(t.api.byType("tank-shell").length >= 1, "tank fires a shell");
  }
};

export const grappleMod: ModDefinition = {
  id: "grapple-hook",
  title: "Grapple Hook",
  knobs: {
    hookSpeed: { value: 900, min: 300, max: 1400, label: "Hook speed" },
    reelSpeed: { value: 620, min: 200, max: 1000, label: "Reel speed" },
    maxRange: { value: 520, min: 200, max: 900, label: "Max range" }
  },
  setup(api, knobs) {
    let hook = null;
    let anchored = false;
    let travelled = 0;
    let prevPressed = false;
    let prevJump = false;
    const speed = Number(knobs.hookSpeed) || 900;
    const reel = Number(knobs.reelSpeed) || 620;
    const maxRange = Number(knobs.maxRange) || 520;
    api.setHud("grapple-tip", { kind: "stat", label: "Grapple", icon: "🪝", value: 0, unit: "B: fire / again: release" });
    function release() {
      if (hook) api.despawn(hook.id);
      hook = null; anchored = false; travelled = 0;
    }
    api.onTick((dt) => {
      const p = api.player();
      if (!p) return;
      const input = api.input();
      const pressed = !!(input.shoot || input.use);
      const fresh = pressed && !prevPressed;
      prevPressed = pressed;
      const jumpFresh = !!input.jump && !prevJump;
      prevJump = !!input.jump;
      if (fresh) {
        if (hook) { release(); }
        else {
          const a = api.aim(p);
          hook = api.spawn({ type: "grapple-hook", x: p.x + p.w / 2 - 6, y: p.y + p.h / 2 - 6, w: 12, h: 12, vx: a.x * speed, vy: a.y * speed, color: 0xb8c4cc, solid: false, gravityScale: 0, data: { tetherTo: "player" } });
          anchored = false; travelled = 0;
          api.setHud("grapple-tip", { kind: "stat", label: "Grapple", icon: "🪝", value: 1, unit: "fired" });
        }
      }
      if (!hook) return;
      // hook may have been despawned externally
      const alive = api.entities().some((e) => e.id === hook.id);
      if (!alive) { hook = null; anchored = false; return; }
      if (!anchored) {
        travelled += speed * dt;
        const cx = hook.x + hook.w / 2, cy = hook.y + hook.h / 2;
        const len = Math.hypot(hook.vx, hook.vy) || 1;
        const hit = api.raycast(cx, cy, hook.vx / len, hook.vy / len, 24, hook);
        if (hit) {
          hook.x = hit.x - hook.w / 2; hook.y = hit.y - hook.h / 2;
          hook.vx = 0; hook.vy = 0; anchored = true;
          api.burst(hit.x, hit.y, 0xffcc44, 8);
          api.setHud("grapple-tip", { kind: "stat", label: "Grapple", icon: "🪝", value: 2, unit: "anchored" });
        } else if (travelled > maxRange) { release(); api.setHud("grapple-tip", { kind: "stat", label: "Grapple", icon: "🪝", value: 0, unit: "B: fire / again: release" }); return; }
      } else {
        if (jumpFresh) {
          const a = api.aim(p);
          p.vy = -640; p.vx += a.x * 200;
          release();
          api.setHud("grapple-tip", { kind: "stat", label: "Grapple", icon: "🪝", value: 0, unit: "B: fire / again: release" });
          return;
        }
        const d = api.winch(p, hook.x + hook.w / 2, hook.y + hook.h / 2, reel);
        if (d < 28) { release(); api.setHud("grapple-tip", { kind: "stat", label: "Grapple", icon: "🪝", value: 0, unit: "B: fire / again: release" }); }
      }
    });
    api.setHud("grapple-banner", { kind: "banner", text: "🪝 Grapple Hook — press B to fire!", duration: 2, position: "top-center" });
  },
  dispose(api) {
    for (const e of api.byType("grapple-hook")) api.despawn(e.id);
    api.removeHud("grapple-tip");
    api.removeHud("grapple-banner");
  },
  test(t) {
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 2000, h: 48, solid: true, gravityScale: 0 });
    t.api.spawn({ type: "wall", x: 500, y: 200, w: 40, h: 200, solid: true, gravityScale: 0 });
    const p = t.api.spawn({ type: "player", x: 100, y: 340, w: 32, h: 60, solid: false, gravityScale: 1, color: 0x3366ff });
    const startX = p.x;
    t.step(1, { shoot: true });
    t.step(60, { shoot: false });
    const hooks = t.api.byType("grapple-hook");
    t.expect(hooks.length >= 1, "grapple hook exists after firing");
    t.expect(p.x > startX + 10, "player reeled toward wall, moved from " + startX + " to " + p.x);
  }
};

export const blasterMod: ModDefinition = {
  id: "blaster-rifle",
  title: "Blaster Rifle",
  knobs: {
    damageCooldown: { value: 14, min: 4, max: 40, label: "Fire cooldown (ticks)" },
    bulletSpeed: { value: 720, min: 300, max: 1200, label: "Bullet speed" },
    ammo: { value: 60, min: 10, max: 200, label: "Starting reserve ammo" },
    magSize: { value: 12, min: 4, max: 60, label: "Magazine size" },
    reloadTicks: { value: 75, min: 20, max: 240, label: "Reload time (ticks)" }
  },
  setup(api, knobs) {
    const magSize = Math.max(1, Number(knobs.magSize) || 12);
    const reloadTicks = Math.max(1, Number(knobs.reloadTicks) || 75);
    const p = api.player();
    const gun = api.spawn({ type: "gun", x: p ? p.x + 70 : 120, y: p ? 400 - 14 : 386, w: 26, h: 14, solid: false, gravityScale: 0, color: 0x8a93a6, data: { pickup: true, heldByPlayer: false } });
    let mag = magSize;
    let reserve = Math.max(0, Number(knobs.ammo) || 60);
    let lastShot = -999;
    let reloadEnd = -1;
    let prevUse = false;
    let prevShoot = false;
    const hud = () => {
      api.setHud("blaster-ammo", { kind: "stat", label: "Blaster", icon: "🔫", value: mag, max: magSize, position: "top-right" });
      api.setHud("blaster-reserve", { kind: "stat", label: "Reserve (B when empty / Use to reload)", icon: "🧰", value: reserve, position: "top-right" });
      if (reloadEnd >= 0) api.setHud("blaster-reload", { kind: "bar", label: "Reloading", icon: "🔄", value: Math.max(0, reloadTicks - (reloadEnd - api.tick())), max: reloadTicks, position: "bottom-center", color: 0xffd34d });
    };
    hud();
    api.setHud("blaster-banner", { kind: "banner", text: "Blaster: B fires, reload with Use or B when empty", duration: 2, position: "top-center" });
    api.say(gun, "Pick me up!", 3);
    api.onTick(() => {
      const player = api.player();
      if (!player) return;
      const input = api.input();
      const usePressed = !!input.use && !prevUse;
      const shootPressed = !!input.shoot && !prevShoot;
      prevUse = !!input.use; prevShoot = !!input.shoot;
      const held = !!gun.data.heldByPlayer;
      if (!held && api.touches(player, gun)) {
        gun.data.pickup = false; gun.data.heldByPlayer = true; gun.data.socket = "hand"; gun.data.attachedTo = "player";
        api.burst(gun.x + 13, gun.y + 7, 0xffd34d, 10);
        api.setHud("blaster-banner", { kind: "banner", text: "Blaster equipped — B to fire, Use to reload!", duration: 2, position: "top-center" });
      }
      if (!held) return;
      // Reload completion
      if (reloadEnd >= 0) {
        if (api.tick() >= reloadEnd) {
          const take = Math.min(magSize - mag, reserve);
          mag += take; reserve -= take; reloadEnd = -1;
          api.removeHud("blaster-reload");
          api.burst(player.x + player.w / 2, player.y + 10, 0x3fd06a, 10);
          api.setHud("blaster-banner", { kind: "banner", text: "Reloaded!", duration: 1, position: "top-center" });
          hud();
        } else { hud(); return; }
      }
      const startReload = () => {
        if (reloadEnd >= 0 || mag >= magSize || reserve <= 0) {
          if (reserve <= 0 && mag < magSize) api.setHud("blaster-banner", { kind: "banner", text: "No reserve ammo!", duration: 2, position: "top-center" });
          return false;
        }
        reloadEnd = api.tick() + reloadTicks;
        api.setHud("blaster-banner", { kind: "banner", text: "Reloading...", duration: 1, position: "top-center" });
        hud(); return true;
      };
      // Reload button: Use key edge (distinct in input state), or pressing fire on an empty mag.
      if (usePressed && !input.shoot) { startReload(); return; }
      if (input.shoot && mag === 0) { if (shootPressed) startReload(); return; }
      if (held && input.shoot && mag > 0 && api.tick() - lastShot >= (Number(knobs.damageCooldown) || 14)) {
        lastShot = api.tick(); mag--;
        const dir = player.facing || 1;
        const bx = dir > 0 ? player.x + player.w + 4 : player.x - 20;
        const by = player.y + player.h * 0.45;
        api.spawn({ type: "laser-bolt", x: bx, y: by, w: 18, h: 6, vx: dir * (Number(knobs.bulletSpeed) || 720), vy: 0, solid: false, gravityScale: 0, color: 0xffe066, data: { fromPlayer: true, life: 55, visual: "projectile" } });
        api.burst(bx, by + 3, 0xff7733, 4);
        if (mag === 0) api.setHud("blaster-banner", { kind: "banner", text: reserve > 0 ? "Empty — press B to reload!" : "Blaster empty!", duration: 2, position: "top-center" });
        hud();
      }
      for (const b of api.byType("laser-bolt")) {
        if (b.data && b.data.fromPlayer) {
          b.data.life = (b.data.life ?? 55) - 1;
          if (b.data.life <= 0 || b.x < -600 || b.x > 2600) api.despawn(b.id);
        }
      }
    });
  },
  dispose(api) {
    for (const e of api.byType("laser-bolt")) api.despawn(e.id);
    for (const e of api.byType("gun")) api.despawn(e.id);
    api.removeHud("blaster-ammo"); api.removeHud("blaster-reserve"); api.removeHud("blaster-reload"); api.removeHud("blaster-banner");
  },
  test(t) {
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 });
    const p = t.api.player() || t.api.spawn({ type: "player", x: 120, y: 340, w: 36, h: 52, solid: false, gravityScale: 1, color: 0x3366ff });
    const gun = t.api.byType("gun")[0];
    t.expect(!!gun, "gun spawned in world");
    if (gun) { gun.x = p.x; gun.y = p.y; }
    t.step(3);
    t.expect(!!gun && gun.data.heldByPlayer === true, "touching gun equips it");
    t.step(5, { shoot: true });
    t.expect(t.api.byType("laser-bolt").length > 0, "pressing B fires a laser bolt");
    const before = t.api.hud("blaster-ammo");
    t.expect(!!before && (before.value ?? 999) < 12, "mag ammo decreases after firing");
    t.step(2, {});
    t.step(1, { use: true });
    t.step(90, {});
    const after = t.api.hud("blaster-ammo");
    t.expect(!!after && after.value === 12, "reload button refills magazine to full");
    const res = t.api.hud("blaster-reserve");
    t.expect(!!res && (res.value ?? 999) < 60, "reload consumes reserve ammo");
  }
};

export const carMod: ModDefinition = {
  id: "driveable-car",
  title: "Driveable Car",
  knobs: {
    speed: { value: 260, min: 80, max: 500, label: "Top speed" },
    size: { value: 92, min: 60, max: 140, label: "Car width" }
  },
  setup(api, knobs) {
    const w = Number(knobs.speed ? knobs.size : 92) || 92;
    const topSpeed = Number(knobs.speed) || 260;
    const p = api.player();
    const startX = p ? p.x - 170 : -170;
    const car = api.spawn({ type: "car", x: startX, y: 400 - 36, w: w, h: 36, vx: 0, vy: 0, color: 0xd43a2f, solid: false, gravityScale: 1, data: { interact: "Drive", riding: false } });
    api.setHud("car", { kind: "stat", label: "Car speed", icon: "🚗", value: 0, unit: "px/s", position: "bottom-right" });
    api.on("interact", (ev) => {
      if (ev.entity.id !== car.id) return;
      car.data.riding = !car.data.riding;
      api.say(car, car.data.riding ? "Vroom! Steer with ◀ ▶" : "Parked!", 2);
    });
    api.onTick(() => {
      if (car.y + car.h > 400) { car.y = 400 - car.h; car.vy = 0; }
      const player = api.player();
      // Auto-enter when player steps onto/into the car (also works via interact toggle)
      if (player && !car.data.riding && api.touches(player, car)) car.data.riding = true;
      if (car.data.riding && player) {
        const inp = api.input();
        if (inp.use && api.tick() % 30 === 0) { /* use is drive toggle context; driving handled below */ }
        if (inp.left) { car.vx = Math.max(car.vx - 18, -topSpeed); car.facing = -1; }
        else if (inp.right) { car.vx = Math.min(car.vx + 18, topSpeed); car.facing = 1; }
        else car.vx *= 0.9;
        if (Math.abs(car.vx) > 20 && api.tick() % 12 === 0) api.burst(car.x + (car.facing === 1 ? 4 : car.w - 4), car.y + car.h - 4, 0xaaaaaa, 2);
        // Carry the player seated on the car
        player.x = car.x + car.w / 2 - player.w / 2;
        player.y = car.y - player.h + 10;
        player.vx = car.vx; player.vy = 0;
        if (inp.jump) { car.data.riding = false; player.vy = -520; player.y = car.y - player.h - 4; api.say(car, "Bye!", 1); }
      } else {
        car.vx *= 0.85;
      }
      if (car.vx !== 0 && Math.abs(car.vx) < 1) car.vx = 0;
      api.setHud("car", { kind: "stat", label: "Car speed", icon: "🚗", value: Math.round(Math.abs(car.vx)), unit: "px/s", position: "bottom-right" });
    });
  },
  dispose(api) {
    for (const e of api.byType("car")) api.despawn(e.id);
    api.removeHud("car");
  },
  test(t) {
    t.api.spawn({ type: "ground", x: -400, y: 400, w: 1600, h: 48, solid: true, gravityScale: 0 });
    const p = t.api.spawn({ type: "player", x: 0, y: 320, w: 28, h: 48, solid: false, gravityScale: 1, color: 0x3366ff });
    t.step(30);
    const cars = t.api.byType("car");
    t.expect(cars.length === 1, "one car spawned");
    const car = cars[0];
    t.expect(car.x < p.x, "car spawns behind/beside player, not ahead blocking path");
    t.expect(car.y + car.h <= 402, "car rests near ground");
    // Place player on car to mount, then drive right
    p.x = car.x + 10; p.y = car.y - p.h;
    t.step(5);
    const x0 = car.x;
    t.step(40, { right: true });
    t.expect(car.x > x0 + 20, "car drives right while player rides, dx=" + Math.round(car.x - x0));
    t.expect(Math.abs(car.vx) > 20, "car has driving speed");
  }
};
