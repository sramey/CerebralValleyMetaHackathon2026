# ADR 0046: One drawn goal, one scoring goal, and B as an action key

- **Status:** Draft
- **Date:** 2026-10-29

## Context
A playtest prompt ("add a basketball, that i can pickup, and shoot with b, and a basketball goal") exposed three separate faults. A goal type matched `/hoop/` and drew the generic ring, so the goal was a glowing ring floating in the air with no post, backboard, rim or net. Every circle on the ground was squashed (sy 0.8, sx 1.25), so a basketball read as an egg. And `syncInput()` mapped only X/J/F to `shoot` and F/E/X/J to `use`, so a prompt that says "shoot with B" produced a game where B did nothing. Separately, nothing told Wonder how a pickup-and-shoot game should be built, so a Wonder-written hoop could never match the engine's drawing.

## Decision
1. **B is an action key.** The keyboard→`InputState` mapping leaves `main.ts` and becomes `inputFromKeys()` in `src/client/keys.ts` (pure, unit-tested): `shoot` is true for B/X/J/F and `use` for B/F/E/X/J. Any prompt naming B now works.
2. **A goal is a structure, not a ring.** `src/sim/hoop.ts` owns the geometry: `isHoopType()` (hoop, backboard, basketball-goal, or a bare "goal" that names no other sport) and `rimOf()/backboardOf()` over the goal entity's box. The client draws one entity from those same ratios (grounded post, backboard with target square, rim in perspective, mesh net), and the mod scores by asking `rimOf()` — the mouth you see is the mouth that scores. The ontology keeps hoops, goals and backboards a *shape*, so no Muse Image art is ever requested for them (a bare "goal" used to classify as a creature).
3. **Balls stay round.** Circle shapes whose type is a ball skip the contact squash and draw pebbled shading plus the iconic seams; everything else keeps the juice.
4. **The engine ships the pattern, not just the look.** A built-in `basketball` mod (ball + goal, pickup within `touches()` reach, carry at the hands, ballistic throw, swish → particles + score HUD + banner) and a SPORTS: PICKUP & SHOOT block in Wonder's mod-API reference that states the goal box, the rim position and the throw math.

## Consequences
- Wonder-written ball games and the built-in mod share one geometry, so a hoop written from the prompt looks and scores the same as the built-in one.
- The rim sits *in front of* the backboard in 2.5D, so the ball never collides with the board (it passes in front of it): the board is scenery, the rim is the only collider that matters.
- Mods still cannot play a sound (no sound API in `ModApi`); swish feedback is particles, the score HUD and a banner. A mod-sound channel would be a separate contract change.
- `src/contract.ts` is untouched: no new fields, no new wire messages.

## Alternatives considered
- Draw the goal as several entities (post, board, rim, net): violates the one-entity-per-object rule, breaks the box used for culling and scoring, and multiplies what a mod must spawn.
- Keep the ring and add parts inside `drawShape("ring")`: the ring look is also used for halos and portals, and a goal needs a ground anchor the ring box does not have.
- Only map B in `syncInput()`: leaves the mapping untestable and every future key change in a 1900-line file.
- Let the mod compute the rim from its own guesses: the drawing and the scoring drift apart silently, which is exactly the class of bug this bead came from.
