// Pure, deterministic projectile collision and damage helper.
// Mods call this to check projectile hits against hostile enemies or solids,
// dealing damage, emitting impact particles, and cleaning up projectiles cleanly.
import type { Entity, ModApi, ProjectileDamageOptions } from "../contract";

export { ProjectileDamageOptions };

/** Damage a projectile deals when it does not say (data.damage), for the engine and api.damageHit alike. */
export const DEFAULT_PROJECTILE_DAMAGE = 50;

/** Enemy fire: a projectile flagged as a hostile's. It hits the player and heroes, never other hostiles. */
function isEnemyFire(projectile: Entity): boolean {
  return projectile.data.fromPlayer !== true
    && (projectile.data.hostile === true || projectile.data.enemy === true || projectile.data.fromEnemy === true);
}

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

/** Types that are a companion by name alone (a pet that the mod forgot to flag). */
const PET_NAME_RE = /^(pet|pets|companion|ally|friend|friendly|buddy|pal|puppy|kitten|dog|cat|chicken|mount|steed|npc)\b/i;

/**
 * A companion / pet / hero the player brought to life (ADR 0070). Pets are identified even when
 * the mod also marked them hostile (a T-Rex pet that stomps zombies), because a companion that
 * hurts its owner is never what anyone asked for.
 */
export function isPet(e: Entity): boolean {
  if (e.type === "player") return false;
  if (e.data.pet === true || e.data.companion === true || e.data.ally === true) return true;
  if (typeof e.data.interact === "string" && /^pet$/i.test(e.data.interact.trim())) return true;
  return PET_NAME_RE.test(e.type.toLowerCase());
}

/**
 * True when an entity is explicitly or nominally a friendly / ally / companion,
 * never harmed by player projectiles or friendly fire.
 */
export function isFriendly(e: Entity): boolean {
  if (e.type === "player") return true;
  // An explicit hostile flag wins over a casual/hero tag: a "casual" hunter is still a hunter.
  if (e.data.hostile === true || e.data.enemy === true) return false;
  if (e.data.friendly === true || e.data.hostile === false || e.data.casual === true || e.data.hero === true) return true;
  if (e.data.pet === true || e.data.companion === true || e.data.ally === true || e.data.fromPlayer === true) return true;
  const tLow = e.type.toLowerCase();
  if (/^(chicken|pet|companion|ally|friend|friendly|hero|npc|buddy|pal|dog|cat|bird|puppy|kitten)\b/i.test(tLow)) return true;
  return false;
}

/**
 * True when an entity is a hostile enemy target that player attacks and weapons should damage.
 */
export function isHostileEnemy(e: Entity): boolean {
  if (isFriendly(e)) return false;
  if (e.data.hostile === true || e.data.enemy === true) return true;
  const tLow = e.type.toLowerCase();
  if (HOSTILE_NAME_RE.test(tLow)) return true;
  return false;
}

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

  // Non-combat kinds: pickups, collectibles, gear, held items, solid terrain
  if (target.data.collectible === true || target.data.pickup === true) return false;
  if (target.data.heldByPlayer === true || target.data.equipped === true) return false;
  const tagged = target.data.hostile === true || target.data.enemy === true || target.data.creature === true;
  if (target.solid && !tagged) return false; // untagged solids are terrain; a tagged solid boss still takes hits

  const isPlayerProj = projectile.data.fromPlayer === true || projectile.type.includes("player");

  if (isPlayerProj) {
    // Player projectile cannot harm player, friendlies or the player's own companions - ONLY enemies!
    if (isFriendly(target) || isPet(target)) return false;
    if (isHostileEnemy(target)) return true;
  } else if (isEnemyFire(projectile)) {
    // Projectile from enemy: can hit player or friendlies/heroes, never other hostiles
    if (target.type === "player") return true;
    if (target.data.fromPlayer === true) return false;
    if (isHostileEnemy(target)) return false;
    return isFriendly(target) || isPet(target);
  } else {
    // Any other shot — a pet's, an ally's, a turret the player built, or a hazard that forgot
    // its flag — is on the player's side (ADR 0070): it may finish hostiles, never the player
    // or an ally. Friendly fire from a companion is not a thing a request can produce.
    if (target.type === "player") return false;
    if (isFriendly(target) || isPet(target)) return false;
  }

  // Anything else that is a creature by tag or has health is fair game, so a Wonder-built
  // "pirate" or "snowman" whose name is not in HOSTILE_NAME_RE can still be shot.
  if (tagged) return true;
  return target.health > 0 && !target.solid;
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
  // The mod resolves this projectile itself, so the engine's universal pass leaves it alone (ADR 0057).
  projectile.data.modCombat = true;
  const damage = options.damage ?? (typeof projectile.data.damage === "number" ? projectile.data.damage : DEFAULT_PROJECTILE_DAMAGE);
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
