// ADR 0070 / beads 4lj + s8r: the engine loadout. One active item, switch / drop / reload, a vehicle that
// takes over the weapon slot and runs hostiles over. The playtest sequence (gun + grapple + tank) uses the
// mods Wonder really wrote that session (tests/fixtures/playtest-gear-mods.ts): none of them knows the loadout.
import { describe, expect, it } from "vitest";
import type { Entity, GearHandle, InputState, ModDefinition } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import groundMod from "../src/mods/ground";
import playerMod from "../src/mods/player";
import { GAME_KEYS, HOTKEY_CODES, inputFromKeys } from "../src/client/keys";
import { PAD, PadTracker, TALK_BUTTONS, inputFromPad, mergeInputs, type PadLike } from "../src/client/gamepad";
import { MOD_API_REFERENCE } from "../server/prompt";
import { runModTest } from "../src/sim/loader";
import { blasterMod, carMod, grappleMod, tankMod } from "./fixtures/playtest-gear-mods";

function setup(...mods: ModDefinition[]) {
  const w = new World(7);
  const loader = new ModLoader(w);
  loader.load(groundMod);
  loader.load(playerMod);
  for (const m of mods) loader.load(m);
  const step = (n = 1, input: Partial<InputState> = {}) => {
    for (let i = 0; i < n; i++) { w.input = { left: false, right: false, jump: false, shoot: false, use: false, ...input }; w.step(); }
  };
  /** One tick with a key held, then released: an edge. */
  const tap = (key: keyof InputState) => { step(1, { [key]: true } as Partial<InputState>); step(1); };
  const player = () => w.entities.find((e) => e.type === "player")!;
  const hud = (id: string) => w.hud.get(id);
  return { w, loader, step, tap, player, hud };
}

/** A pistol that registers with api.gear: 6 per magazine, 12 spare, fires on shoot. */
const pistol = (over: Partial<{ magSize: number; reserve: number; cooldown: number; reloadTicks: number }> = {}): ModDefinition => ({
  id: "pistol", title: "Pistol",
  setup(api) {
    const p = api.player();
    const body = api.spawn({ type: "pistol", x: p ? p.x : 0, y: p ? p.y : 0, w: 18, h: 10, solid: false, gravityScale: 0, data: { heldByPlayer: true } });
    const gear: GearHandle = api.gear!({ label: "Pistol", icon: "🔫", entity: body, magSize: 6, reserve: 12, cooldown: 5, reloadTicks: 30, ...over });
    api.onTick(() => {
      const pl = api.player();
      if (pl && api.input().shoot && gear.fire()) {
        api.spawn({ type: "pistol-bullet", x: pl.x + pl.w / 2, y: pl.y + 14, w: 6, h: 4, vx: pl.facing * 600, solid: false, gravityScale: 0, data: { fromPlayer: true, life: 60 } });
      }
    });
  },
  dispose(api) { for (const e of [...api.byType("pistol"), ...api.byType("pistol-bullet")]) api.despawn(e.id); },
});

const bullets = (w: World, type: string) => w.entities.filter((e) => e.type === type).length;

describe("gun + grapple + tank (legacy mods, regression)", () => {
  const build = () => {
    const s = setup(blasterMod);
    const gun = s.w.entities.find((e) => e.type === "gun")!;
    gun.x = s.player().x; gun.y = s.player().y;
    s.step(3);
    s.loader.load(grappleMod);
    s.loader.load(tankMod);
    s.w.entities.push({ id: 9001, type: "wall", x: 700, y: 200, w: 40, h: 200, vx: 0, vy: 0, color: 0x888888, solid: true, gravityScale: 0, facing: 1, onGround: false, health: 100, owner: "test", data: {} } as Entity);
    s.step(2);
    return { ...s, gun };
  };

  it("after adding a grapple the gun is stowed, the grapple fires, and Q brings the gun back", () => {
    const { w, step, tap, hud, gun } = build();
    expect(hud("gear")?.label).toBe("Grapple Hook"); // newest item is in hand
    const before = bullets(w, "laser-bolt");
    step(3, { shoot: true });
    expect(bullets(w, "grapple-hook")).toBe(1);
    expect(bullets(w, "laser-bolt")).toBe(before); // the gun did NOT fire with the grapple
    expect(gun.data.socket).toBe("back");

    step(2); // release shoot
    tap("nextItem");
    expect(hud("gear")?.label).toBe("Blaster Rifle");
    expect(gun.data.socket).not.toBe("back");
    for (const h of w.entities.filter((e) => e.type === "grapple-hook")) w.despawn(h.id);
    const hooks = bullets(w, "grapple-hook");
    step(20, { shoot: true });
    expect(bullets(w, "laser-bolt")).toBeGreaterThan(before); // the gun shoots again
    expect(bullets(w, "grapple-hook")).toBe(hooks); // and the grapple stayed quiet
  });

  it("boarding the tank stows both: shoot fires the cannon, forward, and the grapple stays quiet", () => {
    const { w, step, player } = build();
    const tank = w.entities.find((e) => e.type === "tank")!;
    const p = player();
    for (const h of w.entities.filter((e) => e.type === "grapple-hook")) w.despawn(h.id);
    // Walk into the tank: it boards automatically.
    p.x = tank.x + 10; p.y = tank.y - 10;
    step(4);
    expect(tank.data.driving).toBe(true);
    const bolts = bullets(w, "laser-bolt");
    step(1, { right: true });
    step(1, { right: true, shoot: true });
    step(3, { right: true });
    expect(tank.facing).toBe(1);
    const shells = w.entities.filter((e) => e.type === "tank-shell");
    expect(shells.length).toBe(1);
    expect(shells[0].vx).toBeGreaterThan(0); // out the front, not backwards
    expect(bullets(w, "grapple-hook")).toBe(0); // the grapple did not fire while driving
    expect(bullets(w, "laser-bolt")).toBe(bolts); // nor the player's gun
    expect(p.facing).toBe(tank.facing); // whatever else reads the player's facing fires the vehicle's way
  });

  it("driving left fires left; getting out hands the weapon back to the last item in hand", () => {
    const { w, step, player, hud } = build();
    const tank = w.entities.find((e) => e.type === "tank")!;
    const p = player();
    for (const h of w.entities.filter((e) => e.type === "grapple-hook")) w.despawn(h.id);
    p.x = tank.x + 10; p.y = tank.y - 10;
    step(3);
    step(10, { left: true });
    step(1, { left: true, shoot: true });
    step(2, { left: true });
    const shell = w.entities.find((e) => e.type === "tank-shell")!;
    expect(shell.vx).toBeLessThan(0);
    expect(hud("gear")?.label).toBe("Driveable Tank");
    // Jump out.
    step(1, { jump: true });
    step(3);
    expect(tank.data.driving).toBe(false);
    expect(hud("gear")?.label).toBe("Grapple Hook");
  });
});

describe("switching and slots", () => {
  it("Q cycles, prevItem goes back, a slot number picks, one item just says so", () => {
    const { step, tap, hud } = setup(grappleMod, blasterMod);
    step(1);
    // The blaster is still lying in the level, so only the grapple is in hand.
    expect(hud("gear")?.label).toBe("Grapple Hook");
    expect(hud("gear-slots")).toBeUndefined();
    tap("nextItem");
    expect(hud("gear-toast")?.text).toContain("all you have");
  });

  it("with three pistols-in-hand items the cycle wraps and slots pick directly", () => {
    const mk = (id: string, title: string): ModDefinition => ({
      id, title,
      setup(api) { api.gear!({ label: title }); },
      dispose() {},
    });
    const { w, tap, step, hud } = setup(mk("a", "Alpha"), mk("b", "Bravo"), mk("c", "Charlie"));
    expect(hud("gear")?.label).toBe("Charlie");
    tap("nextItem");
    expect(hud("gear")?.label).toBe("Alpha");
    tap("prevItem");
    expect(hud("gear")?.label).toBe("Charlie");
    step(1, { slot: 2 });
    expect(hud("gear")?.label).toBe("Bravo");
    expect(String(hud("gear-slots")?.value)).toBe("1 Alpha  [2 Bravo]  3 Charlie");
    expect(w.hudList().some((h) => h.id === "gear-toast")).toBe(true);
  });

  it("a mod only sees its fire keys while its item is in hand", () => {
    let seen = false;
    const probe: ModDefinition = { id: "probe", title: "Probe", setup(api) { api.gear!({ label: "Probe" }); api.onTick(() => { seen = !!api.input().shoot; }); }, dispose() {} };
    const other: ModDefinition = { id: "other", title: "Other", setup(api) { api.gear!({ label: "Other" }); }, dispose() {} };
    const { tap, step } = setup(probe, other);
    step(1, { shoot: true });
    expect(seen).toBe(false); // Other is in hand
    tap("prevItem");
    step(1, { shoot: true });
    expect(seen).toBe(true);
  });
});

describe("dropping and picking up", () => {
  it("G drops the held gun at the player's feet; walking off and back picks it up", () => {
    const { w, step, tap, player, hud } = setup(pistol());
    const body = w.entities.find((e) => e.type === "pistol")!;
    step(30);
    expect(body.data.heldByPlayer).toBe(true);
    tap("drop");
    expect(body.data.heldByPlayer).toBe(false);
    expect(body.data.pickup).toBe(true);
    expect(body.gravityScale).toBe(1);
    expect(hud("gear")).toBeUndefined(); // nothing in hand any more
    step(1, { shoot: true });
    expect(bullets(w, "pistol-bullet")).toBe(0);
    // It falls to the ground and stays put while the player stands on it for under the delay, then walks away and back.
    step(20);
    const x = body.x;
    expect(body.y + body.h).toBeLessThanOrEqual(401);
    step(60, { right: true });
    expect(body.x).toBe(x);
    expect(body.data.heldByPlayer).toBe(false);
    step(80, { left: true });
    expect(player().x).toBeLessThan(x + 40);
    expect(body.data.heldByPlayer).toBe(true);
    expect(body.gravityScale).toBe(0);
    expect(hud("gear")?.label).toBe("Pistol");
  });

  it("an ability with no body says it can't be dropped instead of failing silently", () => {
    const { tap, hud } = setup(grappleMod);
    tap("shoot");
    tap("drop");
    expect(hud("gear-toast")?.text).toContain("can't be dropped");
    expect(hud("gear")?.label).toBe("Grapple Hook"); // still in hand
  });

  it("nothing in hand: G says so", () => {
    const { tap, hud } = setup();
    tap("drop");
    expect(hud("gear-toast")?.text).toContain("Nothing");
  });
});

describe("ammo and reload", () => {
  it("shows mag / spare on the HUD, spends a round per shot, and honours the cooldown", () => {
    const { w, step, hud } = setup(pistol());
    expect(hud("gear")?.value).toBe("6/6  ·  12 spare");
    step(1, { shoot: true });
    step(1, { shoot: true }); // inside the 5-tick cooldown
    expect(bullets(w, "pistol-bullet")).toBe(1);
    step(1);
    expect(hud("gear")?.value).toBe("5/6  ·  12 spare");
  });

  it("R reloads from the reserve after the reload time, and the mag never exceeds its size", () => {
    const { w, step, tap, hud } = setup(pistol());
    for (let i = 0; i < 3; i++) { step(1, { shoot: true }); step(5); }
    expect(hud("gear")?.value).toBe("3/6  ·  12 spare");
    tap("reload");
    expect(hud("gear")?.value).toBe("reloading...");
    step(1, { shoot: true });
    expect(bullets(w, "pistol-bullet")).toBe(3); // cannot fire mid-reload
    step(30);
    expect(hud("gear")?.value).toBe("6/6  ·  9 spare");
    tap("reload");
    expect(hud("gear")?.value).toBe("6/6  ·  9 spare"); // full already: nothing happens
  });

  it("an empty magazine reloads when you press fire, and no spare ammo says so", () => {
    const { w, step, hud } = setup(pistol({ magSize: 2, reserve: 2, cooldown: 0 }));
    step(1, { shoot: true }); step(1); step(1, { shoot: true }); step(1);
    expect(hud("gear")?.value).toBe("0/2  ·  2 spare");
    step(1, { shoot: true }); // empty: auto-reload
    step(1);
    expect(hud("gear")?.value).toBe("reloading...");
    step(30);
    expect(hud("gear")?.value).toBe("2/2  ·  0 spare");
    step(1, { shoot: true }); step(1); step(1, { shoot: true }); step(1);
    step(1, { shoot: true }); step(1);
    expect(hud("gear-toast")?.text).toContain("out of ammo");
    expect(bullets(w, "pistol-bullet")).toBe(4);
  });

  it("gear without ammo shows ready and R is not swallowed from a mod that handles its own", () => {
    let sawReload = false;
    const own: ModDefinition = { id: "own", title: "Own ammo", setup(api) { api.gear!({ label: "Own" }); api.onTick(() => { if (api.input().reload) sawReload = true; }); }, dispose() {} };
    const { tap, hud } = setup(own);
    expect(hud("gear")?.value).toBe("ready");
    tap("reload");
    expect(sawReload).toBe(true);
  });

  it("the default reserve is four magazines", () => {
    const m: ModDefinition = { id: "m", title: "M", setup(api) { api.gear!({ label: "M", magSize: 10 }); }, dispose() {} };
    expect(setup(m).hud("gear")?.value).toBe("10/10  ·  40 spare");
  });
});

describe("vehicles run hostiles over", () => {
  const zombie = (w: World, x: number, extra: Record<string, number | string | boolean> = {}) =>
    w.spawn({ type: "zombie", x, y: 360, w: 28, h: 40, solid: false, gravityScale: 1, health: 100, data: { hostile: true, ...extra } }, "test");

  it("a tank at speed damages and eventually kills a zombie it drives through", () => {
    const { w, step, player } = setup(tankMod);
    const tank = w.entities.find((e) => e.type === "tank")!;
    const p = player();
    p.x = tank.x + 10; p.y = tank.y - 10;
    step(4);
    expect(tank.data.driving).toBe(true);
    const z = zombie(w, tank.x + 260);
    step(120, { right: true });
    expect(z.dead || z.health < 100).toBe(true);
    step(60, { right: true });
    expect(w.entities.includes(z)).toBe(false);
  });

  it("a car does the same, and a parked or slow vehicle hurts nobody", () => {
    const { w, step, player } = setup(carMod);
    const car = w.entities.find((e) => e.type === "car")!;
    const z = zombie(w, car.x + car.w + 4);
    step(30); // car is parked beside it: overlapping would be needed, and it is not driving
    expect(z.health).toBe(100);
    const p = player();
    p.x = car.x + 10; p.y = car.y - 10;
    step(2);
    expect(car.data.riding).toBe(true);
    z.x = car.x + 10; // inside the hull but the car is still
    step(1);
    expect(z.health).toBe(100);
    step(60, { right: true });
    expect(w.entities.includes(z) ? z.health : 0).toBeLessThan(100);
  });

  it("friendlies and the player are never run over, and data.runOver = false opts a vehicle out", () => {
    const { w, step, player } = setup(tankMod);
    const tank = w.entities.find((e) => e.type === "tank")!;
    const p = player();
    p.x = tank.x + 10; p.y = tank.y - 10;
    step(4);
    const cat = w.spawn({ type: "cat", x: tank.x + 200, y: 360, w: 28, h: 30, solid: false, gravityScale: 1, health: 100, data: { friendly: true } }, "test");
    step(100, { right: true });
    expect(cat.health).toBe(100);
    expect(p.health).toBe(100);
    tank.data.runOver = false;
    const z = zombie(w, tank.x + 150);
    step(100, { right: true });
    expect(z.health).toBe(100);
  });
});

describe("unloading", () => {
  it("removing a mod takes its item out of the loadout and the HUD", () => {
    const { loader, hud, step } = setup(pistol());
    expect(hud("gear")?.label).toBe("Pistol");
    loader.unload("pistol");
    step(1);
    expect(hud("gear")).toBeUndefined();
  });

  it("a gun whose body is despawned leaves the loadout instead of lingering", () => {
    const { w, hud, step } = setup(pistol());
    w.despawn(w.entities.find((e) => e.type === "pistol")!.id);
    step(2);
    expect(hud("gear")).toBeUndefined();
  });
});

describe("controls (ADR 0070)", () => {
  const pad = (...pressed: number[]): PadLike => ({
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  });

  it("keyboard: Q next, R reload, G drop, 1-9 pick a slot; a plain press has none of them", () => {
    expect(inputFromKeys(new Set(["KeyQ"])).nextItem).toBe(true);
    expect(inputFromKeys(new Set(["KeyR"])).reload).toBe(true);
    expect(inputFromKeys(new Set(["KeyG"])).drop).toBe(true);
    expect(inputFromKeys(new Set(["Digit3"])).slot).toBe(3);
    const idle = inputFromKeys(new Set(["KeyD", "KeyX"]));
    expect(idle.nextItem).toBeUndefined();
    expect(idle.reload).toBeUndefined();
    expect(idle.drop).toBeUndefined();
    expect(idle.slot).toBeUndefined();
  });

  it("no loadout key clashes with movement, the action keys or the hotkeys", () => {
    const loadout = ["KeyQ", "KeyR", "KeyG", "Digit1", "Digit9"];
    const others = ["ArrowLeft", "KeyA", "ArrowRight", "KeyD", "ArrowUp", "KeyW", "Space", "KeyB", "KeyX", "KeyJ", "KeyF", "KeyE", ...HOTKEY_CODES];
    for (const k of loadout) { expect(GAME_KEYS).toContain(k); expect(others).not.toContain(k); }
  });

  it("gamepad: L1 next, d-pad up previous, d-pad down drop, L2 reload; L1 no longer talks, R1 and Triangle still do", () => {
    expect(inputFromPad(pad(PAD.L1)).nextItem).toBe(true);
    expect(inputFromPad(pad(PAD.UP)).prevItem).toBe(true);
    expect(inputFromPad(pad(PAD.DOWN)).drop).toBe(true);
    expect(inputFromPad(pad(PAD.L2)).reload).toBe(true);
    expect(TALK_BUTTONS).not.toContain(PAD.L1);
    expect(TALK_BUTTONS).toEqual(expect.arrayContaining([PAD.R1, PAD.TRIANGLE]));
    const f = new PadTracker().poll([pad(PAD.L1)]);
    expect(f.talk).toBe(false);
    expect(f.input.nextItem).toBe(true);
    const talk = new PadTracker().poll([pad(PAD.R1)]);
    expect(talk.talk).toBe(true);
    expect(talk.input.nextItem).toBeUndefined();
  });

  it("keyboard and pad merge: any source holding a loadout control holds it", () => {
    const m = mergeInputs(inputFromKeys(new Set(["KeyR"])), inputFromPad(pad(PAD.DOWN)));
    expect(m.reload).toBe(true);
    expect(m.drop).toBe(true);
  });
});

describe("a tank written the way the prompt teaches", () => {
  const cannonTank: ModDefinition = {
    id: "cannon-tank", title: "Cannon tank",
    setup(api) {
      const p = api.player();
      const tank = api.spawn({ type: "tank", x: (p ? p.x : 100) - 140, y: 360, w: 110, h: 46, solid: false, gravityScale: 1, color: 0x4a5d3a, data: { interact: "Drive", mounted: false } });
      const cannon = api.gear!({ label: "Cannon", icon: "💥", magSize: 2, reserve: 4, reloadTicks: 30, cooldown: 10 });
      api.onTick(() => {
        const pl = api.player();
        const inp = api.input();
        if (pl && !tank.data.mounted && api.touches(pl, tank)) tank.data.mounted = true;
        if (!tank.data.mounted || !pl) { tank.vx = 0; return; }
        tank.vx = (inp.right ? 1 : 0) * 200 - (inp.left ? 1 : 0) * 200;
        if (tank.vx !== 0) tank.facing = tank.vx > 0 ? 1 : -1;
        pl.x = tank.x + tank.w / 2 - pl.w / 2; pl.y = tank.y - pl.h + 6;
        if (inp.shoot && cannon.fire()) api.spawn({ type: "shell", x: tank.x + tank.w / 2 + tank.facing * 60, y: tank.y + 8, w: 14, h: 10, vx: tank.facing * 640, solid: false, gravityScale: 0, data: { fromPlayer: true, life: 60 } });
      });
    },
    dispose(api) { for (const e of [...api.byType("tank"), ...api.byType("shell")]) api.despawn(e.id); },
  };

  it("while driving, the cannon has its own ammo, R reloads it, and the player's gun stays stowed", () => {
    const { w, step, tap, player, hud } = setup(pistol(), cannonTank);
    const tank = w.entities.find((e) => e.type === "tank")!;
    player().x = tank.x + 10; player().y = tank.y - 10;
    step(3);
    expect(tank.data.mounted).toBe(true);
    expect(hud("gear")?.label).toBe("Cannon");
    expect(hud("gear")?.value).toBe("2/2  ·  4 spare");
    step(1, { shoot: true }); step(11); step(1, { shoot: true }); step(11);
    expect(bullets(w, "shell")).toBe(2);
    expect(bullets(w, "pistol-bullet")).toBe(0);
    step(1, { shoot: true });
    step(1);
    expect(hud("gear")?.value).toBe("reloading..."); // empty: pressing fire reloads
    step(40);
    expect(hud("gear")?.value).toBe("2/2  ·  2 spare");
    // Out of the tank: the player's own pistol is back in hand, and the cannon is nowhere in the rotation.
    tank.data.mounted = false;
    player().x = tank.x + 400;
    step(2);
    expect(hud("gear")?.label).toBe("Pistol");
    step(1, { shoot: true });
    expect(bullets(w, "pistol-bullet")).toBe(1);
    expect(bullets(w, "shell")).toBe(2);
    tap("nextItem");
    expect(hud("gear")?.label).toBe("Pistol"); // Q never selects a parked vehicle's cannon
  });

  it("the verifier test of a lone vehicle mod still passes", () => {
    expect(runModTest(cannonTank).errors).toEqual([]);
  });

  it("the Wonder prompt teaches api.gear, R / G / Q, the mounted flag and run-over", () => {
    for (const needle of ["api.gear", "gear.fire()", "LOADOUT", "data.mounted = true", "run over", "input.reload", "vehicle.facing"]) {
      expect(MOD_API_REFERENCE).toContain(needle);
    }
  });
});
