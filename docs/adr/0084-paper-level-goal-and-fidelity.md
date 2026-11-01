# 0084 — Paper level fidelity: platform enemy patrol, segment merging, goal mark, and single coin HUD

- **Status:** Draft
- **Date:** 2026-11-01
- **Context:** A physical paper drawing tested through "Draw a level" revealed four fidelity gaps:
  1. Drawn enemies spawned on platforms walked off the ledge and dropped down to the ground due to `gravityScale: 1` and unrestricted chase/patrol velocity (`vx: 42`).
  2. Adjacent strokes meant to form a single continuous platform were output as multiple touching platform segments.
  3. A distinct goal mark (e.g. a solid blue rectangle or end flag) was ignored because neither the vision system prompt legend (`PAPER_SYSTEM`, `SKETCH_SYSTEM`) nor the reply schema recognized goal elements.
  4. The HUD displayed two competing coin counters ("COINS 15" from cumulative/engine-owned score HUD and "COINS 0/5" from level coin progress).
- **Decision:**
  1. **Goal mark and level clear contract:**
     - Add optional `"goal"` to `SketchTag` in `src/contract.ts` and `SKETCH_TAGS` in `server/validate.ts`.
     - Add optional `goal?: SketchBox` to `SketchLevel` in `server/sketch.ts`.
     - Update vision prompts (`PAPER_SYSTEM`, `SKETCH_SYSTEM`, `sketchPrompt`, `paperPrompt`) to recognize flags, doors, stars-at-end, or solid end blocks as `"goal"`.
     - Reuse the finish-flag behavior from `src/sim/level.ts`: export `clearLevel(api, flag, difficulty)` to trigger the golden particle burst, `LEVEL CLEAR!` banner on `level-note`, and `level-clear` signal. Expose `api.clearLevel` on `ModApi` so level mods reuse engine clear logic without duplication.
     - Spawns `finish-flag` when a goal box is present.
  2. **Platform segment merging:**
     - In both sketch and paper normalization pipelines (`normalizeLevel` and `normalizePaperLevel`), merge platforms of the same kind that overlap or touch horizontally (`right.x <= left.x + left.w + 12`) at about the same height (`|a.y - b.y| <= 16`).
     - Expand `WORLD.maxY` from 420 to 1200 in `server/sketch.ts` so normalized paper space coordinates (0..1000) are preserved accurately prior to stage coordinate projection.
  3. **Platform enemy snapping and patrol:**
     - Drawn enemies detect the nearest elevated platform top under their drawn bounding box (`findPlatformUnder`).
     - Snapped directly to `y = plat.y - enemy.h` and clamped horizontally to `[plat.x, plat.x + plat.w - enemy.w]`.
     - Elevated platform enemies receive `minX` and `maxX` in `data`. On tick, patrollers turn around at platform edges and chasing is constrained within the platform bounds, ensuring enemies never walk off. Enemies drawn on the ground continue unconstrained ground patrol as before.
  4. **Single coin HUD reconciliation:**
     - In `src/client/hud.ts`, `filterVisibleHud` reconciles active HUD widgets. When a level defines its own bounded coin count (such as `sketch-score` or any `stat` with label "Coins" and a defined `max`), the unbounded cumulative `score` counter is suppressed.
- **Consequences:**
  - Hand-drawn and photographed levels faithfully preserve platform enemies in place for hundreds of frames.
  - Multi-stroke drawn platforms become single solid playable platforms.
  - Clear flags and goals can be drawn on paper or canvas and clear the level with unified celebration effects.
  - The HUD maintains clean information hierarchy: levels with coin goals show one progress counter rather than overlapping duplicates.
  - Contract changes are strictly additive: old level JSON replies without a `goal` continue to parse and verify identically.
- **Alternatives considered:**
  - Forking level clear banner/burst logic into `server/sketch.ts` (rejected: duplicates sound/particle constants and drifts from `level.ts`).
  - Hiding score widgets globally in sim state (rejected: client DOM overlay is responsible for presentation reconciliation and allows seamless restoration when level mods unload).
