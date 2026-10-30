# 0063 - A creature that falls out of the world goes back on the ground

- **Status:** Draft
- **Date:** 2026-10-30

## Context

The main ground slab is 2400 px wide and there is no kill floor. The sim already has a ledge
guard (`ledgeAhead`), but it only runs for a walker that is `onGround` that tick. A hopper, such
as the bouncing slime, is airborne at the slab's end, so it carried straight past the edge and
fell forever. Rehearsal pass 2 (10-30) ended with the slime gone from the final frame
(bead 5yy). Generated mods steer their own `vx` every tick, so teaching the ledge guard about
airborne creatures would fight the mod's own movement.

## Decision

After the movement pass, `World.rescueFallen` looks for a creature (kind `creature`, not the
player, not solid, `gravityScale > 0`, not tethered, not scenery) whose top is more than 900 px
below the main ground slab's top (the widest `ground` solid). It stands it on the slab beside
the player (220 px, on the side that faces the slab's middle, kept 80 px inside the slab's
ends) with `vy = 0` and its own `vx`. A world with no ground slab never rescues anything.

Considered and not chosen: turning airborne creatures at the edge. It would change the movement
of generated mods that already work, and a creature that is not near an edge (a pit, a gap in
the level) would still be lost.

## Consequences

- No mod, knob or API changes: only creatures that were already lost are touched.
- A creature may reappear next to the player instead of staying lost; a boss meant to be
  dropped into a pit more than 900 px deep would be put back. None exists today.
- Flyers (`gravityScale 0`), props, projectiles and effects are never moved.
- Pinned in `tests/edges.test.ts`, together with the entity-cap order (`World.spawn` takes the
  spawner's own oldest entity first, so rain evicts its own drops before a creature).
