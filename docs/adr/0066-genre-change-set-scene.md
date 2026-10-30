# ADR 0066: Genre change: `api.setScene` reshapes the whole world, and undo puts it all back

- **Status:** Proposed
- **Date:** 2026-10-30
- **Amends:** ADR 0017 (a backdrop is a second, lighter way to repaint the sky), ADR 0062 (the player can wear a generated skin), ADR 0053 (art orders are no longer one per build)

## Context
The owner typed "turn this into a 2d space flight game, where my character is a 2d space ship, and there are things i can shoot". Wonder's mod only layered flight on the platformer: the ground, brick tower, platforms, trees and forest backdrop stayed, the ship clamped at the ground and the tower blocked it, the player was still the ninja sprite, targets were flat squares (`data.visual: "shape"`), and shots ran a hand-written overlap loop. A mod could not do better on its own: terrain belongs to other mods, the sky belongs to the client, and the player's art is the engine's.

## Decision
1. **`api.setScene({ hideTerrain?, hideScenery?, backdrop?, playerSkin? })`** is one optional ModApi call. Hiding **moves the entities out of `world.entities`** into the scene claim, so nothing can see them: collision, combat targeting, raycast and grapple, pickups, camera and drawing all read `world.entities`. Terrain is the ontology's terrain kind (ground, platforms, towers, stairs); scenery is non-solid props and sky/parallax layers. The player, creatures, gear, pickups and anything collectible are never hidden.
2. **Claims form a stack, undone by the engine.** Unloading the mod (undo, reload, quarantine) returns its entities in spawn order, drops the backdrop and skin, and puts the player's gravity back as it was before the first claim (handed up the stack, so undoing out of order still ends exactly as before). An entity whose own mod unloads while hidden is dropped for good. Mods do not restore anything in `dispose()`.
3. **The scene is pure data** (`world.scene`: backdrop, playerSkin). The client paints it: `backdrop: "space"` swaps the sky and skips ridges, hills, mist and the starter scenery. It is render-only and costs no image. A mood always wins over a backdrop and the existing mood palette and undo flow are untouched.
4. **Player skin.** `framesFor` takes the skin: the player draws `<skin>-skin` frames when they exist and the ninja until then. The server reads `playerSkin: "..."` from the source (`pickSkin`) and orders one sheet, with its own flight-pose prompt (`spritePrompt` `skin`), cached as `<skin>-skin.webp`, delivered as `skinArt` on the mod message or a later `art` message, and kept on the manifest, worlds and export.
5. **Art orders per build are capped** by one constant, `MAX_ART_PER_BUILD = 2` (`server/art.ts`): the skin plus one creature. Each order still goes through `spend()`. The owner decides any increase.
6. **Prompt teaching** (`server/prompt.ts`): a GENRE CHANGE rule (call `setScene` first, free-flight player, one plain-typed creature target, shots through `api.damageHit`, no manual restore) and a rule that Wonder never sets `data.visual`. The router's `shape` rule now covers only literal primitives and level geometry; any nameable thing (volcano, rock, asteroid, ship) is prop or creature. The learned-rule distiller (`server/learn.ts`) no longer teaches "simple shapes route as shape".
7. **The verifier only warns** (`server/genre.ts`): a genre-change request whose mod skips `setScene`, or a mod that sets `visual: "shape"`, gets a note on the build's done stage. Nothing is rejected, so "make this a snow level" is not forced into terrain removal.

## Consequences
- One sentence can change the genre and one undo restores the platformer exactly (`tests/scene.test.ts`: load/unload round trip, two stacked scenes undone in either order, a shot passing through a hidden tower).
- Hidden entities are held by the claim, so they are not in saved snapshots; a restore rebuilds them by reloading their mods.
- Only one backdrop ("space") exists. Others are an addition to the palette table, not a contract change.
- A mod loaded after the scene (for example "add a platform") is not hidden: it is a new request, not part of the old world.
- The skin sheet is not restyled by a mood yet (the restyle only lists sheets entities use by type).

## Alternatives considered
- **A `data.hidden` flag on entities.** Every consumer (collision, targeting, raycast, pickups, camera, drawing) would have to learn it, and one missed reader leaves an invisible wall.
- **Mods move terrain away and restore it in `dispose()`.** Fragile: a crash, an out-of-order undo or a second scene mod leaves the world broken, and it gives no skin or backdrop.
- **A new router action "genre".** Routing is not the failure; Wonder already got the request as a build. The missing piece was an engine contract and teaching.
