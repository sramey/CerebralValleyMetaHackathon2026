# 0028 — Sketch mode: a local phrase opens it, the world freezes, the palette moves to the side

- **Status:** Draft
- **Date:** 2026-10-29

## Context

ADR 0026 shipped the draw-to-build overlay reachable only by the ✏️ button in the rail. Three
things surfaced once it was in front of people:

- The demo beat is voice-first ("let me draw a level"), and a spoken phrase went to the server,
  spent a build slot, and came back as a *generated* level instead of opening the overlay.
- The palette sat across the bottom ~150 px of the stage: the ground strip, and the most natural
  place to draw a ledge.
- The sim kept running while the player drew. `createSketch` snapshots the camera at open
  (`cameraAtOpen`) and converts screen strokes to world boxes with it, so a player walking while
  the overlay was up left the drawing misaligned with the world it was drawn over.

## Decision

Three narrow rules, no model involved:

1. A pure matcher (`src/client/phrases.ts`) runs before any AI call in the command path. It opens
   the overlay for a draw verb aimed at the level itself or at nothing ("let me draw a level",
   "draw the level", "sketch", "open sketch", "paint this world"), closes it on request
   ("cancel sketch"), and returns null for everything else — so "draw a dragon" still builds a
   dragon.
2. The frame loop skips `world.step()` while the overlay is active and drops its accumulator, so
   the player draws on a still frame and resuming does not fast-forward.
3. The palette is a right-hand side strip, a compact top strip on narrow stages; the bottom
   ~150 px of the stage stays uncovered.

## Consequences

- Sketch phrases cost nothing: no Meta call, no build slot, instant.
- Pausing also fixes the alignment bug: the camera cannot move between the frame the player draws
  on and the world boxes computed when they press Done.
- The matcher is a word list, not a classifier. New phrasings need a row in
  `tests/phrases.test.ts`; if the list starts growing beyond level synonyms, revisit with Spark.
- While sketching, enemies, timers and the player are frozen; that is the point, but any mod that
  assumes a step every frame simply does not run. Headless playtests and `advanceTime` step the
  sim directly, so they are unaffected.
- The overlay still paints over the orb bar; the rail shows the same status line, unchanged.

## Alternatives considered

- **Ask Spark/Wonder to classify the phrase:** a model call and a second of latency to open a
  purely local overlay. Rejected; kept as the fallback if the phrase list has to grow.
- **Pause flag inside `World`:** the sim is pure and must not know the UI exists. Rejected.
- **Keep the palette at the bottom, but translucent or collapsible:** still covers the strip you
  draw a ledge on, and a collapsed palette hides the brushes mid-sketch. Rejected.
- **Letterbox or zoom the stage while sketching:** would change the camera and the screen-to-world
  mapping that the sketch payload depends on. Rejected for now.
