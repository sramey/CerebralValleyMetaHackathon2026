# ADR 0009: Intent classification: scenery vs creature art

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-28

## Context

"add trees" produced running tree-people with faces and boots — every subject got the creature sheet (idle/run/jump poses) and animation cycling; "add a giant sun in the sky" got legs. A level/environment request is not a character.

## Decision

`isScenerySubject` keyword classification (vegetation, rocks, props, structures, and celestial/sky objects) in `server/art.ts`. Scenery gets a sheet of exactly 4 static variants of ONLY that object (no face/eyes/limbs, no other objects), art subjects strip trailing locative phrases ("in the sky"), and the client renders scenery as a static per-entity variant (`frames[id % frames.length]`) with no animation cycling. Creatures keep pose sheets + state-driven animation.

## Consequences

- Trees/suns render as environment.
- The keyword list is heuristic and will miss subjects (found misses get added, e.g. sun/moon took one round).
- The image model still occasionally composes landscapes, mitigated by the ONLY-subject prompt and by the slicer cropping each frame to its dominant vertical band.

## Alternatives considered

- **Ask the Spark router to classify every build:** more general, but adds latency/cost and a failure mode to every command; keywords cover the observed cases.
- **One art style for everything:** the status quo that produced legged trees.
