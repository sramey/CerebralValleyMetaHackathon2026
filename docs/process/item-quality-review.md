# Item and Object Creation Quality Review

**Bead:** `metabuild-ideation-cec`  
**Date:** October 30, 2026  
**Scope:** Review object and game-item creation quality (art, sizing, slicing, item behaviour) across the pipeline from Wonder output down to PixiJS rendering, deliver ranked findings, implement safe fixes with unit tests, and document findings for files owned by other workers.

---

## 1. Executive Summary

This review examined the end-to-end lifecycle of objects, items, and creatures created by the AI engine:
1. **Model Intent:** Wonder generating code, types, sockets, and metadata (`data.visual`, `data.socket`, `data.attachedTo`).
2. **Visual Routing:** `server/visual.ts` (`lookFor`) and `server/route-rules.ts` classifying requested visuals into shapes, effects, props, or creatures.
3. **Ontology Classification:** `src/ontology.ts` resolving entity kinds (`prop`, `creature`, `terrain`, `projectile`, `shape`, `effect`) and determining `ArtPlan` (`none`, `held-item`, `scenery`, `sheet`).
4. **Sprite Art Generation:** `server/art.ts` crafting prompts for Muse Image and managing cached sheets.
5. **Sheet Slicing:** `src/client/sprites.ts` parsing raw images into distinct animation frames.
6. **Client Rendering & Walk Dynamics:** `src/client/main.ts`, `src/sim/sockets.ts`, `src/client/walk-frame.ts`, and `src/client/shapes.ts` handling physical rendering, gear attachment sockets, and step bob animation.

---

## 2. Live Exercise Baseline

The creation pipeline was exercised via automated browser sessions using the live game server and Vite dev server across 6 representative prompts:

| # | Prompt | Generated Mod | Visual Result & Observed Issue | Screenshot |
|---|--------|---------------|--------------------------------|------------|
| 1 | `"add a bouncing green slime"` | `logs/mods/20261030-152804-bouncing-green-slime-v1.ts` | Uses `public/art/gen/slime.webp`. Poses in sheet have non-uniform widths (306px to 421px) spanning across 400px column splits. | `docs/evidence/item-review/01-slime.png` |
| 2 | `"add a sword I can pick up"` | `logs/mods/20261030-152816-pickup-sword-v1.ts` | Spawns `type: "sword", w: 22, h: 8`. Clamped by old `visualHeight` (min 34px), rendering at ~34px tall—disproportionately large for a one-handed sword. | `docs/evidence/item-review/02-sword.png` |
| 3 | `"add a treasure chest"` | `logs/mods/20261030-152836-treasure-chest-v1.ts` | Spawns `type: "treasure-chest", w: 32, h: 26`. Solid ground container with coin drop on interaction. | `docs/evidence/item-review/03-chest.png` |
| 4 | `"add a jetpack"` | `logs/mods/20261030-152902-jetpack-gear-v1.ts` | Spawns `type: "jetpack", w: 18, h: 22, data: { socket: "back" }`. Socket logic correctly mounts to player's back. | `docs/evidence/item-review/04-jetpack.png` |
| 5 | `"add a dragon"` | `logs/mods/20261030-152912-sky-dragon-v1.ts` | Spawns `type: "dragon", w: 72, h: 48, flying: true`. Flying request detected, airborne flight poses applied. | `docs/evidence/item-review/05-dragon.png` |
| 6 | `"add some asteroids I can shoot"` | `logs/mods/20261030-152932-shootable-asteroids-v1.ts` | Spawns `type: "asteroid", data: { visual: "shape" }`. Client had no procedural handler for `asteroid` with `data.visual: 'shape'`, falling through to flat unlit grey squares. | `docs/evidence/item-review/06-asteroids.png` |

---

## 3. Ranked Findings

### Rank 1: Shootable Targets & Asteroids Rendered as Flat Squares
- **Problem:** When Wonder creates shootable targets, target dummies, or asteroids, it frequently specifies `data: { visual: "shape" }`. In `src/client/main.ts`, `kindOf(e.type)` only parsed predefined shape primitives (`circle`, `ring`, `spikes`, `triangle`, `pill`, `diamond`, `star`). Unhandled types with `data.visual: 'shape'` bypassed sprite generation, bypassed shape routines, and fell through to `gfx.rect(x, y, e.w, e.h).fill(e.color)` at line 479, rendering literal flat grey squares with no shading or geometry.
- **Impact:** High. Breaks visual immersion immediately when players ask for shooting ranges, targets, or asteroid fields.
- **Fix:** 
  - Added dedicated procedural drawers `drawAsteroidRock` and `drawBullseyeTarget` in `src/client/shapes.ts`.
  - Added regex matchers `ASTEROID_RE` (`/asteroid|meteor|comet|boulder|crag/i`) and `TARGET_RE` (`/target|bullseye|archery|shooting-dummy/i`).
  - Added explicit handler for `e.data?.visual === "shape"` in `src/client/main.ts` routing to `drawShape`, and added procedural fallbacks before the flat rect fill.

### Rank 2: Uneven Sheet Slicing & Pose Clipping (`slime.webp`)
- **Problem:** In `public/art/gen/slime.webp` (1600x1600), the 4 poses have horizontal pixel spans:
  - Pose 0: `[12 .. 370]` (width 358px)
  - Pose 1: `[384 .. 805]` (width 421px) — crosses the 400px boundary and reaches into the next 400px band
  - Pose 2: `[826 .. 1225]` (width 399px) — crosses the 1200px boundary
  - Pose 3: `[1270 .. 1576]` (width 306px)
  A naive split into 4 equal 400px columns splits Pose 1 across multiple textures and cuts off the right edge of Pose 2. Furthermore, hardcoded assumptions (such as `widestW = 520` which was 50% of 1024 but only 32% of 1600) caused premature column splitting, and unpadded column boxes left large, asymmetric magenta gutters.
- **Impact:** High. Slime and larger 1600px sprite sheets clipped during bounce and jump animations.
- **Fix:**
  - Implemented pure `findPoseBounds(w, h, px, targetFrames = 4)` in `src/client/sprites.ts`.
  - Evaluates column pixel occupancy histograms, splits poses at local occupancy valleys, dynamically scales maximum pose widths (`w * 0.28`), and tightly trims the bounding box around non-background pixels.
  - Slices `slime.webp` cleanly into all 4 distinct poses without clipping.

### Rank 3: Small Props and Held Items Scaled to Creature Minimum
- **Problem:** `visualHeight` in `src/sim/sockets.ts` applied `Math.min(630, Math.max(34, e.h * 1.5))` to all entities with art other than `player`. Clamping to `Math.max(34, ...)` was designed for characters/creatures whose collision box is ~34px. When applied to held items (e.g. a dagger with `h: 8`, sword with `h: 12`, key with `h: 8`, jetpack with `h: 22`), their visual rendered height was forced to at least 34px (3x to 4x their intended size), making held weapons dwarf the player.
- **Impact:** Medium-High. Gear looked oversized when held or displayed on the ground.
- **Fix:**
  - In `src/sim/sockets.ts`, integrated `entityKind` and `isHeldItemType`.
  - Props and held items now scale by `1.2x` with a minimum of `10px` (`Math.min(630, Math.max(10, Math.round(e.h * 1.2)))`), while creatures maintain their `1.5x` scale with `34px` minimum.

### Rank 4: Indistinguishable Stride Frames & Uniform Step Dynamics
- **Problem:** Muse Image often drew subtle or near-identical leg positions for the two running strides. In `src/client/walk-frame.ts`, both stride 1 and stride 2 had an identical step lift (`bob: 2`), making the animation cycle `idle -> stride1 -> idle -> stride2` appear as an unvarying, repetitive bounce.
- **Impact:** Medium. Walking and running gaits felt flat and mechanical.
- **Fix:**
  - Differentiated step heights in `src/client/walk-frame.ts`: contact stride bobs lower (`1.5px`) while passing stride lifts higher (`3.0px`), creating a natural weight-shift gait.
  - Sharpened `spritePrompt` in `server/art.ts`: explicitly instructed opposite leading limbs (left leg reaching forward contact step vs right knee driving up passing step) and dramatic silhouette contrast.

### Rank 5: Router Hallucinating Shape Looks on Ontological Props
- **Problem:** `server/visual.ts` (`lookFor`) accepted `visual: "shape"` suggestions even when the target entity had an explicit ontological art plan (e.g. `asteroid` which is a prop). When router rules or models emitted `visual: "shape"`, it would prevent art generation and route into code shapes.
- **Impact:** Medium. Inconsistent art pipeline behavior.
- **Fix:**
  - In `server/visual.ts`, `lookFor()` returns `undefined` if all entities have an ontological art plan (`artPlanFor(t) !== "none"`).
  - In `server/route-rules.ts`, added `visual-ontology` rule that coerces `visual: "shape"` to `"creature"` or `"prop"` when the ontology has a sprite plan.
  - In `src/ontology.ts`, added `"asteroids"`, `"target"`, `"targets"`, `"dummy"`, and `"bullseye"` to `PROP_TOKENS`.

---

## 4. Summary of Code Changes

| File | Lines | Description |
|------|-------|-------------|
| `src/ontology.ts` | 37, 72 | Added `"asteroids"`, `"target"`, `"targets"`, `"dummy"`, `"bullseye"` to `PROP_TOKENS` and updated `isScenerySubject`. |
| `server/visual.ts` | 84–88 | Prevented `lookFor()` from returning a shape look when entities have an ontological art plan. |
| `server/route-rules.ts` | 105–115 | Added `visual-ontology` routing rule coercing `shape` to `creature`/`prop` when ontological art plan exists. |
| `src/client/sprites.ts` | 17–74, 150–165 | Implemented pure `findPoseBounds` with histogram valley detection, dynamic width thresholds, and tight trimming; updated `loadSpriteSheet`. |
| `src/sim/sockets.ts` | 6, 24–32 | Updated `visualHeight`: props/held items scale at 1.2x (min 10px), characters at 1.5x (min 34px). |
| `src/client/shapes.ts` | 35–36, 68–70, 150–225 | Added `ASTEROID_RE`, `TARGET_RE`, `drawAsteroidRock`, and `drawBullseyeTarget`. |
| `src/client/main.ts` | 13, 23, 455–459, 484–489 | Added support for `data.visual === "shape"`, asteroid/target fallback dispatch, and beveled fallback rects. |
| `src/client/walk-frame.ts` | 27–28 | Differentiated walk cycle bobs: 1.5px (contact stride) vs 3.0px (passing stride). |
| `server/art.ts` | 159, 166 | Updated sprite prompts to demand opposite leading limbs and distinct silhouettes between strides. |

---

## 5. Verification & Test Evidence

- **Unit Tests Added / Updated:**
  - `tests/slice-bounds.test.ts`: 4 test suites verifying well-separated frames, uneven spacing matching `slime.webp`, touching pose valley splitting, and alpha noise thresholding.
  - `tests/route-rules.test.ts`: verified `visual-ontology` rule overrides.
  - `tests/visual.test.ts`: verified ontological props/creatures keep art, and verified `ASTEROID_RE`/`TARGET_RE`.
  - `tests/sockets.test.ts`: verified prop/item scale (12px sword -> 14px, 8px key -> 10px) vs creature scale (60px dragon -> 90px, 16px slime -> 34px).
  - `tests/walk-frame.test.ts`: verified differentiated bobs (1.5px vs 3.0px).
- **Test Gate Status:**
  - `npx tsc --noEmit`: 0 errors.
  - `npm test`: 86 test files passed, 828 tests passed.
  - `npm run build`: built production client bundle in 2.21s with zero warnings or errors.
- **Visual Evidence:**
  - `docs/evidence/item-review/01-slime.png` (bouncing green slime)
  - `docs/evidence/item-review/02-sword.png` (held sword item)
  - `docs/evidence/item-review/03-chest.png` (treasure chest prop)
  - `docs/evidence/item-review/04-jetpack.png` (wearable jetpack gear)
  - `docs/evidence/item-review/05-dragon.png` (flying dragon creature)
  - `docs/evidence/item-review/06-asteroids.png` (baseline flat squares before procedural shape fix)
  - `docs/evidence/item-review/06-asteroids-after.png` (craggy faceted procedural asteroids with craters)

---

## 6. Findings for Uneditable Files (Owned by Other Workers)

The prompt strictly forbade editing `server/prompt.ts` and `server/index.ts` because another worker is actively modifying them. Below are the key findings and concrete recommendations for the orchestrator / owners of those files:

### `server/prompt.ts`
1. **Item Size Conventions in Mod Examples:**
   - In several prompt examples, items are given collision boxes larger than necessary (e.g. `w: 24, h: 24` for rings or keys). Wonder should be encouraged in system instructions to size handheld items naturally: swords `w: 8..14, h: 16..24`, guns `w: 14..20, h: 8..12`, small props (keys/gems) `w: 8..12, h: 8..12`.
2. **Explicit `data.visual` Usage:**
   - Wonder currently outputs `data: { visual: "shape" }` for shootable targets and projectiles. While `src/client/main.ts` now handles this gracefully, Wonder should be guided to also provide `data: { shape: "circle" | "spikes" | ... }` or use semantically descriptive entity types (e.g. `target`, `asteroid`, `crystal`) so procedural geometry can render appropriate thematic shapes.
3. **Item Pickup and Interaction Verbs:**
   - Wonder occasionally writes custom collision loops for picking up items instead of relying on standard `data: { collectible: true }` or `data: { socket: "hand" }`. Reinforce in prompt few-shots that setting `data: { socket: "hand" }` or `collectible: true` allows the engine's built-in physics and inventory systems to handle attachment seamlessly.

### `server/index.ts`
1. **Art Generation Concurrency for Multi-Item Spawns:**
   - When a mod spawns multiple new entity types at once (e.g. `"add an archery range with bows, arrows, and targets"`), `server/index.ts` triggers art requests sequentially or skips secondary items if `pickArtType` only extracts the first match. Ensuring `extractSpawnedEntities` returns all candidate types and dispatches them efficiently improves visual fidelity for complex items.
