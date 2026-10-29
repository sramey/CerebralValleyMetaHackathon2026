# ADR 0018: One-way platforms, engine stuck recovery, casual hop

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-29

## Context

Tall creatures wedged under or onto the low floating platforms (a dragon pinned at x=570, y=300), and mods that patrol between fixed x values ground into walls forever. Friendly creatures walked straight through the player's sprite.

## Decision

1. **One-way platforms** via `data.oneWay` on a solid (no contract change). They never block sideways, and block vertically only a falling entity whose bottom was at or above the platform top the tick before. The starter's two floating platforms set it; the rock overhang stays fully solid because the verifier depends on it (ADR 0013).
2. **Stuck recovery in the engine** (`World.unstick`): a non-player mover whose intended `vx` is zeroed by a solid for 6 consecutive ticks hops (vy -380 if grounded); at 24 ticks it flips `facing`. Mods that set `vx = facing * speed` each tick recover without any code of their own.
3. **Casual hop** (`World.casualHop`): an entity with `data.casual === true`, grounded and walking toward a player within ~24 px of touching, hops over them (vy -340, 45-tick cooldown). Opt-in so hostile hunters still collide with the player. The chicken sets it; `MOD_API_REFERENCE` tells Wonder to set it on friendly creatures and not to hand-code unstick logic.

## Consequences

- The sim's per-entity cost rises by two map lookups; well inside 2 ms/frame.
- Players now jump up through the floating platforms (standard platformer feel) and the bot playtest still passes.
- A creature blocked while not meaning to move (vx 0) is unaffected; a mod that sets vx only on some ticks may see the counter reset.
- Behavior depends on `facing` being the mod's turn variable; mods that steer another way only get the hop.

## Alternatives considered

- **Engine-wide one-way for every `platform` type:** would have made the overhang passable and broken the verifier.
- **Teach it only in the prompt:** Wonder output is variable; the engine fix covers existing and future mods.
- **Casual hop for all non-hostile entities automatically:** guessing hostility from type names is unreliable; an explicit flag is clearer.
