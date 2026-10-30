# ADR 0070: Engine loadout: one active item, switch / drop / reload, vehicle weapons, run-over

- **Status:** Proposed
- **Date:** 2026-10-30
- **Beads:** 4lj, s8r

## Context

A first-time player's session (playtest pt2) built a gun, a grappling hook, a car and a tank by talking to the game. Every generated weapon read `api.input().shoot` on its own, so:

- after adding the grapple the player "could no longer shoot": the grapple and the gun fired on the same press;
- in the tank, the grapple (and the player's gun) fired instead of the cannon, and the tank's own shells went backwards;
- there was no way to switch, drop or put away an item, and guns "vanished";
- cars and tanks drove through zombies;
- the blaster showed `0/60` with no reserve, "add a reload button with R" produced a different key per build ("B to reload", "Use to reload"), and reload worked inconsistently.

Each is the same root cause: held items, ammo and vehicles were conventions inside each generated mod, with nothing in the engine that knew which item the player held.

## Decision

The engine owns a **loadout** (`src/sim/loadout.ts`, held by `World`). Contract changes are additive.

1. **One active item.** The player holds one item at a time. A mod's view of the input (`api.input()`) is now per-mod and live: while the mod has an item that is carried but not the active one, its `shoot`, `use` and `pointerDown` read `false`. A mod with nothing carried, and a mod with no item at all, sees the raw input as before.
2. **Registration, two ways.** `api.gear({ label, icon?, entity?, magSize?, reserve?, reloadTicks?, cooldown? })` (new, optional) registers an item and returns `{ active(), fire(), ammo(), addAmmo(n) }`. A mod that never calls it but **reads `input.shoot`** is registered automatically (named after the mod, body found by the `heldByPlayer / equipped / attachedTo / pickup` flags), so the mods already generated, and any a model writes in the old style, switch and gate correctly without a rebuild. A mod that called `api.gear` is never also auto-registered.
3. **Switching.** Q (next), mouse wheel (next/prev), `1`-`9` (pick), gamepad L1 (next) and d-pad up (previous). A newly picked-up or newly built item becomes the active one (a toast says so). Items not in hand are **stowed on the back** by flipping the body's `data.socket` (ADR 0061), so no client work.
4. **Dropping.** G or d-pad down drops the active item's body at the player's feet (gravity on, `pickup`/`dropped` flags, a 45-tick grace), and walking over it picks it up again. An item with no body (a grapple) says it can't be dropped. Held bodies of removed mods leave the loadout.
5. **Ammo and reload.** `magSize`/`reserve`/`reloadTicks` give an item engine-owned ammo (default reserve is four magazines). R or gamepad L2 reloads; firing on an empty magazine reloads by itself; no spare ammo says so. A mod with its own ammo system reads `input.reload` (true only while its item is active and has no engine ammo) so the key is still R.
6. **HUD.** The engine draws the item line (`gear`: icon, name, `mag/size · spare`, "Q: switch") and, with two or more items, a slot line (`gear-slots`), and a short toast (`gear-toast`) for equip / drop / reload messages. All are `engine`-owned `HudWidget`s: pure data, drawn by the existing HUD.
7. **Vehicles.** An entity with `data.mounted`, `data.driving` or `data.riding` set to `true` is a mounted vehicle (`mounted: false` also marks it as a vehicle). While one is mounted: every other mod's items are stowed and gated, only the **vehicle owner's** items work (its cannon registers with `api.gear` or just reads `shoot`), vehicle items never appear in the Q rotation, and the player's `facing` follows the vehicle's so anything reading it fires the way the vehicle faces. Leaving restores the previous item.
8. **Run-over.** A mounted vehicle faster than 90 px/s damages hostiles it overlaps (`isHostileEnemy`, never friendlies or the player) once per 20 ticks per target: `data.runOver` (a number) or `max(30, 0.4 * speed)`; `data.runOver = false` opts out. The target is shoved, slower than the vehicle, so it can be hit again.
9. **Contract.** `InputState` gains optional `reload`, `drop`, `nextItem`, `prevItem`, `slot` (set only while pressed, so the plain shape is unchanged); `ModApi` gains optional `gear`; new types `GearDef`, `GearHandle`. The Wonder prompt (`server/prompt.ts`) teaches `api.gear`, `fire()`, the mounted flag and the run-over rule, and tells models never to invent their own reload/drop/switch keys.
10. **Talk button.** Pad L1 used to mean "hold to talk"; it is now the item switch. Talk stays on Triangle and R1.

## Alternatives considered

- **Only teach the prompt.** Fixes the next build, not the grapple/gun/tank already in a world, and relies on a model obeying; the engine gate works for old and new mods alike.
- **Detect gear by entity type name.** Cannot see a grapple (no held body) or a tank; reading the fire key is the one thing every weapon does.
- **Several items active, cycling only for display.** The playtest's actual failure; one active item is also what the HUD can honestly show.

## Consequences

- A mod that reads `input.shoot` for something that is not a weapon would become an item; the cost is a HUD line and the Q rotation. Non-weapon mods should read `input.use` or `jump` (the prompt already says gear reads `shoot`).
- `use` is gated for a mod with a stowed item, so "press E to pick up" inside a gun mod only works while its gun is lying in the level (not carried) or active.
- The player's "interact" prompt (ADR 0059) reads the raw `use`; it is unaffected.
- One tick of lag: a mod flips `data.mounted` inside its tick and the engine sees it on the next one.
- Replays and the verifier see the same gating, since it lives in the world; `playtest.ts` input masks are unchanged (the new keys are not part of a scripted run).
