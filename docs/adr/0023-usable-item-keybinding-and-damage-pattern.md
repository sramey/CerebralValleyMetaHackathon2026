# 0023 — Usable Item Keybinding & Reusable Combat Damage Pattern

**Status:** Draft

**Date:** 2026-10-29

## Context

When players requested weapons or usable equipment ("give me a gun", "give me a sword", "let me shoot lasers"), two functional gaps occurred:
1. **Control mapping & affordance UX:** Player weapons lacked a first-class, standardized keybinding and HUD indicator. Players had to guess whether to press X, J, or another key, and mods had no standard way to surface their activation binding to the player.
2. **Enemy collision & damage wiring:** Projectiles spawned by weapons (such as `player-bullet` in AI-generated hand cannons, or `fire-arrow`) only checked collision against solid terrain (walls/ground) or were left unwired, passing through hostile creatures, bosses, and enemies without dealing damage.

The sim must remain pure, headless, and deterministic (no DOM, no Math.random, running identically in headless playtests and browser).

## Decision

1. **Item / Use Keybinding:**
   - Extended `InputState` with an optional `use?: boolean` field (defaulting to `false` in `emptyInput()`).
   - Mapped client keyboard listeners: `KeyF` and `KeyE` set `world.input.use = true` (and include `KeyX` and `KeyJ`), while `world.input.shoot` also maps `KeyF`. This ensures both `api.input().use` and `api.input().shoot` respond to F or X.
   - Packed into playtest recording with bitmask `U = 16` in `packInput` and `unpackInput`.

2. **Reusable Combat Damage Pattern (`src/sim/combat.ts` & `ModApi.damageHit`):**
   - Implemented pure, deterministic target discrimination (`isDamageableTarget`) and collision/damage processing (`checkProjectileHitAndDamage`).
   - Discriminates between hostile creatures/bosses and non-damageable targets (player, held items, scenery, parallax, coins, weather).
   - Exposed optional `api.damageHit(projectile, options)` helper on `ModApi` so mods can check hits, apply damage (`api.damage(target.id, dmg)`), spawn burst particles at impact, and despawn projectiles on hit or solid wall impact with a single call.
   - Updated `HudDef.value` to support string text so stat HUD widgets can display key badges (e.g. `api.setHud("weapon", { kind: "stat", icon: "🔫", label: "Gun", value: "F / X to shoot" })`).

3. **Hand Cannon Mod & Fire Arrow:**
   - Shipped `src/mods/gun.ts` featuring held entity tracking, HUD keybinding badge, projectile firing, and combat damage.
   - Updated `src/mods/fire-arrow.ts` to utilize `api.damageHit` to damage enemies on contact.
   - Added `src/client/items.ts` command resolution (`resolveItemMod`) to route "give me a gun", "gun", "hand cannon", etc.

## Consequences

- "Give me a gun" or weapon commands immediately provide working weaponry that damages hostile enemies, shows on-screen keybinding guidance, and cleans up cleanly on undo.
- Mod authors and AI agents have a standard, one-line reusable projectile combat pattern (`api.damageHit`).
- Deterministic sim testing covers input packing, projectile impacts, enemy destruction, and terrain collisions.

## Alternatives considered

- **Hardcode weapon firing inside Player entity:** Violates engine principle ("Everything visible in the game is a mod"). Rejected.
- **Require each mod to write bespoke AABB collision loops against all entities:** Highly error-prone for AI agents (leading to bugs where projectiles ignore hostiles). Standard helper on `ModApi` provides reliable behavior with zero boiler-plate.
- **Mouse click for weapons:** Requires screen-to-world raycasting and mouse input synchronization across headless sim and client; keyboard keys (F/E/X/J) fit the retro platformer architecture and headless playtester bot cleanly.
