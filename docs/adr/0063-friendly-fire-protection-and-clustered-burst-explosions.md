# ADR 0063: Friendly fire protection and clustered burst explosions

- **Status:** Draft
- **Date:** 2026-10-30
- **Amends:** ADR 0015 (fx bursts), ADR 0025 (combat targeting)

## Context

Two gameplay bugs were reported during combat and weapon testing:
1. **Phantom explosions in mid-air:** Shooting bullets caused random explosion blasts and screen shakes in empty air while bullets were traveling, rather than only exploding on impact.
2. **Friendly fire damage:** Player bullets damaged and destroyed friendly creatures (e.g. chickens, companion pets, friendly dragons, and hero allies) when shot, instead of only damaging hostile enemies.

Root causes:
- In `src/client/fx.ts`, `detectBursts` summed all newly spawned simulation particles across the entire world in a frame. When `n >= 6` (e.g. 3 muzzle flash particles at the player and trailing particles behind bullets), it triggered a full blast explosion and screen shake at their arithmetic mean position in empty space.
- In `src/sim/combat.ts`, `isDamageableTarget` treated any non-solid entity with `health > 0` as a damageable target. Because all entities receive `health: 100` by default, player projectiles exploded on and killed friendly animals, companion pets, and allies.

## Decision

1. **Spatial Proximity Clustering in `Fx.detectBursts`:**
   - Group fresh particles by spatial distance (`distSq < 48 * 48 px`).
   - Only particle clusters with at least 6 particles originating at the same location trigger an explosion blast.
   - Isolated particles (such as trail sparks or muzzle flashes) never aggregate across empty space to create phantom mid-air explosions.
2. **Explicit Enemy Targeting & Friendly Fire Protection:**
   - Add `isFriendly(entity)` in `src/sim/combat.ts` checking player identity, explicit friendly tags (`data.friendly`, `data.hostile === false`, `data.casual`, `data.hero`, `data.pet`, `data.companion`, `data.ally`), and friendly creature naming.
   - Add `isHostileEnemy(entity)` checking explicit hostile flags (`data.hostile`, `data.enemy`) or hostile creature classifications.
   - In `isDamageableTarget`, player projectiles strictly return `false` for any friendly entity, and only damage hostile enemies. Player bullets pass harmlessly through friendlies without dealing damage, bursting, or despawning.

## Consequences

- Bullets only produce explosion blasts upon actual impact with solid terrain or hostile targets.
- Friendlies (chickens, pets, companions, allies) are immune to player projectile friendly fire.
- All 771 unit tests in the suite pass.
