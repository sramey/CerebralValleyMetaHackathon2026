// Pure, deterministic projectile collision and damage helper.
// Mods call this to check projectile hits against hostile enemies or solids,
// dealing damage, emitting impact particles, and cleaning up projectiles cleanly.
import type { Entity, ModApi, ProjectileDamageOptions } from "../contract";

export { ProjectileDamageOptions };

export function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const NON_TARGET_TYPES = new Set([
  "ground", "platform", "moving-platform",
  "coin", "star", "cloud", "sun", "moon",
  "raindrop", "rain", "background", "sky",
]);

const HOSTILE_NAME_RE = /^(enemy|walker|turtle|boss|monster|zombie|goblin|creature|slime|spider|bat|skeleton|ghost|drone|robot|demon|orc|beast|minion|bug|critter|dragon|alien)/i;

/**
 * Determines whether candidate `target` is a valid creature/hostile target for `projectile`.
 */
export function isDamageableTarget(
  target: Entity,
  projectile: Entity,
  customFilter?: (target: Entity) => boolean,
): boolean {
  if (target.id === projectile.id) return false;
  if (customFilter) return customFilter(target);

  // Scenery & weather check
  if (typeof target.data.parallax === "number") return false;
  const tLow = target.type.toLowerCase();
  if (NON_TARGET_TYPES.has(tLow)) return false;
  if (/^(cloud|sky|day-sky|night-sky|background|parallax|raindrop)/i.test(tLow)) return false;

  const isPlayerProj = projectile.data.fromPlayer === true || projectile.type.includes("player");

  if (isPlayerProj) {
    if (target.type === "player") return false;
    if (target.data.heldByPlayer === true) return false;
    if (target.data.fromPlayer === true) return false;
  } else {
    // Projectile from enemy: can hit player
    if (target.type === "player") return true;
    if (target.data.fromPlayer === true) return false;
  }

  // Explicit hostile or creature tags
  if (target.data.hostile === true || target.data.enemy === true || target.data.creature === true) return true;

  // Name matches known hostile creatures
  if (HOSTILE_NAME_RE.test(tLow)) return true;

  // Has health, not solid terrain, not a projectile/item
  if (target.health > 0 && !target.solid && !target.data.heldByPlayer) {
    return true;
  }

  return false;
}

/**
 * Checks if `projectile` collides with any hostile target or solid obstacle,
 * applying damage, impact burst, and despawning on hit.
 * Returns the damaged Entity if a target was hit, or undefined.
 */
export function checkProjectileHitAndDamage(
  api: ModApi,
  projectile: Entity,
  options: ProjectileDamageOptions = {},
): Entity | undefined {
  const damage = options.damage ?? (typeof projectile.data.damage === "number" ? projectile.data.damage : 50);
  const despawnOnHit = options.despawnOnHit !== false;
  const despawnOnSolid = options.despawnOnSolid !== false;
  const burstColor = options.burstColor ?? projectile.color ?? 0xffd700;
  const burstCount = options.burstCount ?? 10;

  const entities = api.entities();

  // 1. Check damageable creature targets
  for (const target of entities) {
    if (isDamageableTarget(target, projectile, options.filter) && overlap(projectile, target)) {
      api.burst(
        projectile.x + projectile.w / 2,
        projectile.y + projectile.h / 2,
        burstColor,
        burstCount,
      );
      api.damage(target.id, damage);
      if (despawnOnHit) {
        api.despawn(projectile.id);
      }
      return target;
    }
  }

  // 2. Check solid obstacle collision (walls, ground)
  if (despawnOnSolid) {
    for (const solid of entities) {
      if (solid.solid && !solid.data.oneWay && solid.id !== projectile.id && overlap(projectile, solid)) {
        api.burst(
          projectile.x + projectile.w / 2,
          projectile.y + projectile.h / 2,
          burstColor,
          Math.max(4, Math.floor(burstCount / 2)),
        );
        api.despawn(projectile.id);
        return undefined;
      }
    }
  }

  return undefined;
}
