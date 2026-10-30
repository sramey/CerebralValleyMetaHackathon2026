# ADR 0074: Generated levels (`api.buildLevel`) and place themes

- **Status:** Proposed
- **Date:** 2026-10-30
- **Related:** ADR 0066 (`api.setScene` hides the starter terrain), ADR 0067 (themed backdrops and motifs)

## Context
The 2026-10-30 playtest said "it's just a basic level, it doesn't really change." "Make a harder level" added a few ground obstacles, "extend the level and add obstacles" added rocks but left the ground the same length, and "make this look like England / India" recoloured the same starter scenery. Wonder writes each answer from scratch in 10-20 s, and the result was a flat strip with props.

## Decision
- **A deterministic generator in the sim.** `src/sim/levelgen.ts` is pure: `generateLevel({seed, difficulty 1-5, length, startX})` returns pieces (floor sections with pits, one-way platforms at several heights, blocks, spikes, walkers on platforms, flyers, coins, checkpoints, a goal flag). A seeded tour guarantees pits, stairs and a high road, plus spikes, stepping stones and an ambush as difficulty rises. Gaps stay within a jump (max 190 px of the ~250 px jump; steps within 120 px of the ~172 px jump height).
- **One engine call.** `api.buildLevel(options)` (`src/sim/level.ts`, an addition to `ModApi`) hides the starter terrain via `setScene`, spawns the pieces, and owns the rules: pits send the player to the last checkpoint, spikes and walkers hurt, a stomp kills a walker, and touching the flag clears the level (`level-clear` signal) with a progress bar.
- **Requests skip the router.** `detectLevelCommand` (`src/ontology.ts`) recognizes "make a harder level", "extend the level and add obstacles", "make the level longer/easier", "build a real platformer level"; with a level already present, "add obstacles" and "make it harder" mean the level. The server answers from a tiny mod template (`server/levelmod.ts`) with knobs `difficulty`, `length`, `seed`. A later request tweaks knobs on the running `level` mod, so harder means a structurally harder layout and extend means a longer floor. No model call, no spend, sub-second.
- **Wonder can use it too.** The prompt lists `api.buildLevel` and tells Wonder not to hand-place level obstacles.
- **Place themes.** `PLACE_WORDS` makes "make this look like England" a deterministic backdrop command. New presets: england, india, japan, france, arctic, coast, wild west, with 8 new `BACKDROP_MOTIFS` (clocktower, dome, pagoda, eiffel, lighthouse, igloo, phonebox, mesa) drawn in `src/client/scenery.ts`, plus a `flag` shape for the goal.

## Consequences
- Levels are reproducible from three numbers, so they save, share and export like any mod.
- Walkers use the level's own patrol, not the hostile-AI worker's logic.
- `hideTerrain` hides all terrain, including a hand-drawn level, while a generated level is on.
- The runtime path uses no AI. Spark could map free-form words ("a scary mountain level") to parameters later.
- Entity count is bounded (coins are thinned to about 420 pieces; the cap is 500).

## Alternatives considered
- **Wonder hand-writes every level.** This is what failed in the playtest: slow, varied in quality, and it tends to produce one flat strip.
- **A Muse Image panorama as the level.** It would look rich but has no collision, so it is only a backdrop, not a level.
- **Extending the starter ground mod's width knob.** That belongs to the feel/UI lane and does not create structure.
