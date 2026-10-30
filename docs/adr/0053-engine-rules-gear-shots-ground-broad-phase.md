# 0053 — Engine rules for gear, shots and the ground slab; a broad phase for collision

- **Status:** Draft
- **Date:** 2026-10-30

## Context

The 2026-10-30 engine review found rules in `World.step()` that misfire in play:

- Post-step 1 (bead qwc) mounted every entity *named* like gear (`sword`, `hat`, `gun`…) on the
  player, including a sword still lying in the level as a pickup, or an enemy's weapon.
- Two projectile systems disagreed. The engine's universal pass (bead 578) used 25 damage and
  always despawned on hit; `api.damageHit` used 50 and supports `despawnOnHit: false` and a
  `filter`. The engine ran after the mods, so it overrode them. A shot without `fromPlayer`
  could hit the player on the frame it spawned, and enemy fire damaged other hostiles.
- Collision treated any solid whose top was exactly `y === 400` as the ground slab, so a
  platform placed there let movers snap through it from below.
- Contact damage hit from casual and hero creatures with an enemy-sounding name.
- The `blocked`, `hopCooldown` and `turning` maps never forgot despawned ids.
- Collision was O(movers × solids) with regex tests per entity per tick: 1.3 ms/step for a
  500-entity level, 2.1 ms at the cap in a dense scene, over the 2 ms budget.

## Decision

1. **Gear:** flagged gear (`heldByPlayer`, `equipped`, `attachedTo: "player"`) always mounts.
   Gear matched only by name mounts unless it opts out: `data.pickup`, `heldByPlayer: false`,
   `equipped: false`, `attachedTo` someone else, or `hostile`/`enemy`.
2. **Shots:** one default, `DEFAULT_PROJECTILE_DAMAGE = 50`. A projectile passed to
   `api.damageHit` is marked `data.modCombat` and the engine pass skips it. Enemy fire
   (`hostile`/`enemy`/`fromEnemy` on the projectile) hits only the player and heroes. A shot that
   isn't the player's must be clear of the player once before it can hit the player.
3. **Ground:** the ground rules apply to `type === "ground"` (the slab the ground mod and the
   prompt's test recipe spawn), not to any solid at y = 400.
4. **Contact damage:** explicit `hostile`/`enemy` always hurts; `hostile: false`, `casual` or
   `hero` opt an enemy-named type out.
5. **Bookkeeping:** despawn and unload clear the per-entity maps. `Entity` gains optional
   `dead`/`despawned` (already set at runtime by bead dbj).
6. **Broad phase:** `SolidGrid` (`src/sim/grid.ts`), a 128 px uniform grid over solids, rebuilt
   each step and updated as moving solids move. Queries return solid indices in scan order and
   re-query if a resolution pushes a mover out of the queried area, so results are identical to
   the full scan (checked by a position hash on two benchmark scenes). Type-name regexes are
   cached per type.

## Consequences

- Measured on the review's scenes: 500-entity level 1.32 → 0.37 ms/step; dense 500-cap scene
  2.11 → 1.02 ms/step. A vitest guard keeps the level under 4 ms on slow CI.
- Wonder's prompt gains one bullet (GEAR & SHOTS) describing `pickup`, enemy-fire flags and
  `damageHit` ownership.
- AI mods that relied on the engine's 25 default now deal 50 unless they set `data.damage`.

## Alternatives considered

- **Require explicit flags for all gear:** cleaner, but bead qwc deliberately mounts
  name-only gear because Wonder often forgets the flag.
- **Lazy mark-and-sweep despawn:** faster, but mods iterate `api.entities()` and expect a
  despawned entity gone at once; changing that is riskier than it is worth now.
