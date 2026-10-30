# ADR 0076: A drawn crosshair over the stage, hidden for keyboard and gamepad play

- **Status:** Proposed
- **Date:** 2026-10-30

## Context

The game canvas is repainted every frame and kept the operating system's pointer, so the pointer was invisible exactly where it mattered. Aiming is a real input: `api.aim` reads `InputState.pointerX/Y` (ADR 0050) and the grappling hook, the gun and every Wonder-built aimed item use it. A first-time player aiming a hook was guessing, and a click on empty space also fires the hook at that point.

## Decision

The client draws its own crosshair over the stage (`src/client/crosshair.ts`, one `<canvas>` in `#stage-wrap`), follows the pointer with it, and hides the OS cursor only while it is visible.

It is shown only for a live mouse over the stage: `shouldShowCrosshair` requires the pointer to have been seen, the last device not to be a pad, no overlay to own the pointer (sketch overlay, radial menu, camera dialog), and the pointer to have moved within the last 2.6 s. A keyboard player with a parked mouse, a controller player and every modal therefore keep a clean screen, and nothing new ever intercepts a click (`pointer-events: none`).

## Consequences

- Aiming is legible without changing the sim: the pointer still reaches the sim as world coordinates, and the crosshair is a render-only element.
- A mouse that rests still for 2.6 s loses the crosshair until it moves. That is the trade for "pure keyboard play stays clean"; it comes back on the first pixel of movement.
- The hidden OS cursor is tied to the same state, so there are never two cursors and never none.
- Anything that takes over the pointer must call `setBlocked` (as the frame loop does for the sketch overlay, the radial menu and the camera dialog), or the crosshair will sit on top of it.
- Pixi writes `cursor: inherit` into the canvas's inline style, so hiding the OS pointer is one `!important` rule on `#stage canvas`. A live check in headless Edge is what caught it: the stylesheet rule alone computed to `auto`.

## Alternatives considered

- **`cursor: crosshair` in CSS.** No outline, one fixed shape, invisible on a white sky, and no way to hide it for pad play.
- **A Pixi sprite in the stage.** It would inherit camera shake and the stage transform, so the crosshair would drift with the world it is aiming at.
- **Always show it for keyboard players too.** Noise over a world someone is only walking through, and the pointer is not an input they use.
