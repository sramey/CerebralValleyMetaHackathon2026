# 0024. First-class entity ontology and deterministic theme routing

- **Status:** Draft
- **Date:** 2026-10-29

## Context

In live playtesting, prompting `"Make this Christmas themed."` missed the `mood` route because the router safety-net regex required a trailing space and did not match `"this"` or `"<X> themed"`. Wonder then spawned `type: "snow-ground"`, `artKeyForType("snow-ground")` split on `"-"` to produce `"ground"`, and Muse Image generated a 4-pose Christmas Elf character sheet saved to `public/art/gen/ground.webp`—causing the client to replace the entire 6000x80 ground slab with a single elf sprite. Similarly, `"add some stairs"` generated a 4-pose "stair man" creature (`stair.webp`) that animated at 12 fps because static solids have `onGround === false && gravityScale === 0`, `"wall"` became a sprite key, and `"gun"` generated a character holding a gun instead of a held item.

Each subsystem (`server/art.ts`, `server/visual.ts`, `src/client/sprites.ts`, `src/client/main.ts`) was independently guessing what an entity was from incomplete substring lists.

## Decision

Introduce a deterministic, pure entity ontology (`src/ontology.ts` and `EntityKind` in `src/contract.ts`) shared across sim, server, and client that classifies every entity and spawn definition into one of seven canonical roles: `terrain` | `effect` | `projectile` | `shape` | `prop` | `creature` | `player`. Expose entity kinds in the world manifest and `inspect_world`, enforce hard art/rendering invariants per kind (`terrain`, `effect`, `projectile`, and `shape` never generate or bind sprite sheets; `prop` and held items always use static `scenery: true` object prompts and never animate character poses), and route whole-world theme commands (`"<X> themed"`, `"christmas"`, `"daytime"`, `"spooky"`) deterministically to `action: "mood"`.

## Consequences

- Terrain and level geometry (`ground`, `snow-ground`, `ice-platform`, `brick-wall`, `stair`, `step`, `wall`, `block`, and any static solid with `solid: true && gravityScale === 0`) are unconditionally excluded from sprite sheet generation, caching, restyling, and client sprite lookup, and always render as procedural textured geometry that responds to the active world mood.
- Compound entity types (`snow-ground`, `boss-bullet`, `christmas-light`, `christmas-star`, `christmas-gift`, `laser-gun`) are classified by their head noun token so modifiers never corrupt the ontological role or art key.
- Props and held items (`tree`, `snowman`, `christmas-gift`, `gun`, `sword`, `wand`) always request isolated static object sheets (`scenery: true`) and render a stable variant frame without cycling running/jumping poses.
- Theme and atmosphere requests (`"Make this Christmas themed."`, `"make it daytime"`) route to `mood` with hand-tuned presets (`christmas`, `daytime`, `spooky`, `snowy`, `neon`) instead of spawning replacement ground entities.

## Alternatives considered

- **Expanding `SKIP_TYPES` in `server/art.ts` only:** Rejected because `"snow-ground".split("-").pop()` still produced `"ground"` in `artKeyForType`, client `framesFor` had no guard against terrain sprites, and Spark/Wonder still lacked ontological context in the world manifest.
- **Asking Spark to classify every entity at runtime via an extra LLM call:** Rejected because it adds latency and spend to every build and can still misclassify compound types; a deterministic classifier with head-noun token rules and physics invariants (`solid && gravityScale === 0`) runs in microseconds and never drifts.
