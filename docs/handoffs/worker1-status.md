# worker1 status

## Changed (slice: src/sim, src/mods, tests only)

- `src/sim/world.ts` (hardening, 2 fixes):
  - `spawn()` now enforces `SIM.maxEntities`: evicts oldest non-player entity
    instead of growing unbounded.
  - AABB resolution now handles zero-velocity overlap (minimal push-out on both
    axes). Previously an entity teleported into a solid (e.g. by a kinematic
    moving platform) could stick. Landing / wall behavior for moving entities
    is unchanged.
- `src/mods/coins.ts` (new): N coin pickups; player overlap collects with a
  gold burst and `player.data.score += 1`. Safe no-op with no player.
  Distinct `coin` entity type so dispose never touches other mods' entities.
- `src/mods/platform-moving.ts` (new): solid `moving-platform` oscillating
  horizontally via `sin(tick/60)` — deterministic, no wall clock. Knobs:
  range, period.
- `src/mods/fire-arrow.ts` (new): `shoot` input fires a `fire-arrow`
  projectile (cooldown knob) with a particle trail; bursts + despawns on solid
  impact (overlap OR velocity stalled by physics contact) or after 180 ticks.
  Safe no-op with no player.
- `tests/sim.test.ts`: kept all 7 original tests; `it.each` now covers all 7
  mods' `test()`; added coin-score sweep, platform oscillation/solidity,
  fire-arrow no-player + impact, and a 600-frame full-stack finite+bounded run.

Fixed 60 Hz, seeded RNG only, relative extensionless imports kept. No
DOM / Math.random / Date in sim or mods. No changes outside the slice.

## Test output

- `npx vitest run tests`: 14/14 green.
- `npx tsc --noEmit`: clean, zero errors.

## Blocked / needs

- Nothing blocked. No contract change needed.
- Note: `ground` dispose removes every `platform` entity, which would also
  catch other mods' platforms. New mods use unique types
  (`coin`, `moving-platform`, `fire-arrow`) to avoid this; renaming ground's
  platforms is left alone to avoid touching shared behavior.
