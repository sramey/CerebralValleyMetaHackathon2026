# 0050. Grappling hook: pointer aim, engine-drawn rope, winch helper

Status: Draft

## Context
A kid asked for "a grappling hook" and got a hook that shot out of the player's body at a fixed angle and did nothing. It also rendered as a miniature adventurer: the type `grapple-hook` matched no ontology token, fell back to `creature`, and art.ts generated a character sheet for it. There was no mouse input, no rope, and a tap on the fire key made the hook vanish on contact.

## Decision
- `InputState` gains optional `pointerX`, `pointerY` (world coordinates) and `pointerDown`. They are absent for keyboard-only players, so replays, the timeline, the verifier bot and old mods are unaffected. The client sets them each frame from the canvas pointer plus the smoothed camera.
- `ModApi` gains optional helpers, all pure: `aim(from)` (pointer direction, else facing, tilted up while jump is held), `raycast(x, y, dx, dy, max, ignore?)` (first solid hit) and `winch(e, ax, ay, speed)` (eased pull toward a point that cancels gravity). They live in `src/sim/tether.ts`.
- The rope is data, not a mod-drawn shape: any entity with `data.tetherTo` (an entity id or `"player"`) is drawn by the client as a rope to that entity plus a steel claw. Entities whose type contains hook, grappl or tether are always code-drawn, never sprites.
- Ontology: hook, grapple, grappling, tether, cable are `projectile` tokens, so `artPlanFor` is `none` and no sheet is generated.
- The sim's universal projectile pass (bead 578) skips tether gear, which latches instead of despawning on solids.
- Wonder gets one prompt paragraph describing the fire/latch/winch/vault pattern.

## Alternatives
- A dedicated built-in grapple mod: rejected; "everything visible is a mod", and generated hooks should be good every time instead.
- Mods drawing the rope with many tiny entities: rejected; slow, hits the entity cap, and the rope would be a sprite candidate.

## Consequences
Clicking the canvas still opens the radial menu on entities, so the guidance fires on the action key and aims with the mouse. Older worlds are unchanged.
