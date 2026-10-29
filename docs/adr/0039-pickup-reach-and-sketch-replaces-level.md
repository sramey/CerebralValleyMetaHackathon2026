# 0039: Pickup reach matches the drawn player; a sketched level replaces the level

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** Two live-play bugs exposed contracts nobody had written down. (1) The player
  is a 26x34 physics box drawn as a 56 px sprite, so a coin touching the visible head was
  not collected (bead cxl). Every collecting mod did its own raw box overlap. (2) A sketched
  level (ADR 0026) was just one more additive mod, so the drawn platforms stacked on the
  starter ground and on every earlier sketch (bead j2t).
- **Decision:** (1) `ModApi.touches(collector, item)` (`src/sim/reach.ts`) is the pickup test:
  the collector's box padded by 8 px, and for the player extended up to the drawn head. Pure
  and deterministic (boxes in, boolean out). The coins mod and sketch coins use it, and the
  Wonder prompt tells new collecting mods to. (2) Delivering a sketch level removes the
  `ground` mod and any earlier `sketch-*` mod from the session manifest, stashes them under
  the new level's id, and puts them back when that level is undone. A level with no ground
  drawn lays its own floor (`needsFloor` in `server/sketch.ts`) so the player is never left
  without somewhere to stand.
- **Consequences:**
  - One new required `ModApi` method; test mocks of `ModApi` must add it.
  - Reach is deliberately more generous than the physics box for pickups only; collisions,
    damage and the verifier's playtest still use the real box.
  - The stash lives in the session, not on disk: reloading the page forgets what a sketch
    replaced (the world itself still saves what is loaded).
  - Only the starter `ground` and `sketch-*` mods count as "the level"; other mods (rain,
    enemies, coins) stay.
- **Alternatives considered:** Growing the player's physics box to 56 px (changes gaps and
  the "make me huge" clearance, ADR 0023). A client-only fix (the sim and verifier would
  disagree with what the player sees).
