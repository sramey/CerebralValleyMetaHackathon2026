# Creature Animation & Spawning Evidence (bead metabuild-ideation-5cu)

Playtest pt2 evidence for creature animation glitches, walker hostile grounding, and art sheet key persistence on modify.

## 1. Zombie Sprite Sheet Slicing Fix
- **File**: `docs/evidence/anim/01-zombie-slicing-before-after.png`
- **Issue**: In `zombie.webp`, wide stride pose 1 (width 491 px) was previously over-split when `runs.length >= 4`, creating a detached leg frame (width 111, height 119) at frame 2. When rendered with `scale = targetH / frame.height`, the leg frame scaled up > 5x, causing zombies to flash giant legs on stride 2.
- **Fix**: Slicer halts splitting once `targetFrames` (4) is reached. `alignPoseBounds` aligns all frames to a uniform height and baseline.
- **Verification**: Exactly 4 complete frames extracted with consistent height and scale.

## 2. Rideable Dragon Flight Slicing Fix
- **File**: `docs/evidence/anim/02-dragon-slicing-before-after.png`
- **Issue**: In `dragon-fly.webp`, the connected sheet was previously sliced into 5 frames, cutting pose 1 into a body frame and a partial 110 px tall tail sliver. As the dragon flew, it cycled through the tail sliver and jittered in size and altitude.
- **Fix**: Exactly 4 full flight poses extracted (hover, glide, flap, dive). Common vertical height and baseline eliminate size pops during wing flaps.

## 3. Walker Hostiles Grounding & Gravity Fix
- **File**: `docs/evidence/anim/03-zombie-wave-grounding-before-after.png`
- **Issue**: Zombie waves spawned flying zombies in the sky (`gravityScale: 0`, altitude y=140).
- **Fix**: In `server/prompt.ts`, `src/sim/waves.ts`, and `src/ontology.ts`, walker hostiles are strictly grounded (`gravityScale: 1`, y = 400 - h, flanking 50% left, 50% right) unless explicitly requested as flyers.
- **Verification**: 50/50 ground flanking verified in `tests/waves.test.ts`.

## 4. Dragon Art Persistence on Modify ("make it shoot fire")
- **File**: `docs/evidence/anim/04-dragon-shoot-fire-art-before-after.png`
- **Issue**: Saying "make it shoot fire" (a modify of `rideable-dragon`) caused the dragon's sprite to disappear because Spark assigned `visual: "effect"`, turning the dragon into a code-drawn effect look and dropping the `dragon-fly` art.
- **Fix**: In `server/visual.ts`, creatures and props with sprite art (`artPlanFor !== "none"`) are protected from becoming `effect` looks. In `server/art.ts` and `server/index.ts`, mod edits preserve existing art sheet keys (`editRec.art` / `editRec.arts`) unless an art change is requested.
