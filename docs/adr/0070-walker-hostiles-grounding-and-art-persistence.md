# ADR 0070: Walker hostiles grounding, creature sprite slicing, and art persistence on edit

- **Status:** Proposed
- **Date:** 2026-10-30

## Context

Playtest pt2 (tester 1, 2026-10-30) uncovered three related creature animation and spawning glitches across the game:
1. **Sprite sheet slicing and scaling pops**:
   - In `rideable-dragon` and `zombie`, walk and fly animations cycled through partial slices of the sprite sheet. Specifically, zombies repeatedly flashed giant leg frames on stride 2, and the flying dragon cycled through tail/wing fragments.
   - Root cause: `findPoseBounds` previously continued splitting runs whenever any individual run width exceeded `w * 0.28` (448 px in a 1600x1600 sheet), even when 4 poses had already been identified. Because outstretched stride limbs and dragon wings legitimately measure ~470–490 px wide, the slicer split pose 1 into two pieces: a torso frame and a small 111 px wide (119 px tall) leg frame.
   - Furthermore, each frame was cropped to its individual bounding box and scaled dynamically as `targetH / frame.height`. Frame 1 (height 119) was magnified over 5x into a giant leg, while normal flapping frames fluctuated in scale by nearly 40% with erratic vertical baselines.
2. **Flying walker hostiles in waves**:
   - A zombie in a wave was observed flying in the air.
   - Root cause: `server/prompt.ts` unconditionally instructed Wonder to spawn "20% airborne flyers/swoopers from top (camera.y - 60)" for all swarms and waves, leading the model to write `const flying = r >= 0.8; gravityScale: flying ? 0 : 1;` even for ground zombies. `computeWaveSpawn` in `src/sim/waves.ts` also defaulted to top spawns regardless of enemy type.
3. **Disappearing creature graphics after modify/edit**:
   - After the player said "make it shoot fire" (modifying the existing `rideable-dragon` mod), the dragon's sprite graphic disappeared entirely, though the dragon logic still ran.
   - Root causes:
     - When Spark routed "make it shoot fire", it detected fire/projectiles and assigned `visual: "effect"`. `lookFor("effect", undefined, ["dragon"])` then classified `dragon` as a code-drawn effect look (`{ visual: "effect", types: ["dragon"] }`). On the client, `kindOf("dragon")` returned true, causing `main.ts` to bypass sprite sheet rendering completely.
     - Additionally, mod edits did not carry forward existing art sheet keys (`editRec.art` / `editRec.arts`), dropping cached sprite keys when an edit command omitted creature nouns or flight keywords.

## Decision

1. **Deterministic 4-pose slicing & consistent baseline/scale (`src/client/sprites.ts`)**:
   - `findPoseBounds`: Merged pose splitting runs strictly while `runs.length < targetFrames`. If initial contiguous runs exceed `targetFrames` due to stray noise pixels, narrow runs (`w < 30`) separated by small gaps (`gap <= 24`) are merged. Poses are never split once `targetFrames` (4) is reached.
   - `alignPoseBounds`: Computes the common vertical span `minTop = min(y)` and `maxBaseline = max(y + h)` across all 4 poses. Every frame texture canvas is generated with uniform height `commonH = maxBaseline - minTop`, aligning the creature's baseline to the canvas bottom.
   - Because `frame.height === commonH` across all frames of a sheet, `scale = targetH / frame.height` in `src/client/main.ts` is 100% constant, eliminating flapping size fluctuations. With bottom-center anchor `(0.5, 1)`, grounded strides touch the floor while mid-air jump/dive poses naturally hover above the ground.
2. **Walker hostile gravity and ground spawning (`src/contract.ts`, `src/ontology.ts`, `src/sim/waves.ts`, `server/prompt.ts`)**:
   - Added optional contract field `allowFlyers?: boolean` to `WaveSpawnOptions` and `WaveControllerOptions`.
   - Exported `isFlyerType(type: string): boolean` in `src/ontology.ts` checking against known flight creature types (birds, bats, dragons, drones, etc.).
   - In `computeWaveSpawn`: Unless `allowFlyers === true`, `flyerType` is provided, or `isFlyerType(options.type)` is true, walker hostiles (zombies, goblins, slimes, etc.) are strictly grounded: they flank 50% from left and 50% from right on the ground line (`gravityScale: 1`, `isFlyer: false`, `y = groundY - h`).
   - In `server/prompt.ts`: Clarified wave spawning rules so walker hostiles always have `gravityScale: 1` and stay on the ground unless the user explicitly asks for flying enemies.
3. **Art sheet key persistence and look protection (`server/visual.ts`, `server/art.ts`, `server/index.ts`)**:
   - In `server/visual.ts`: `lookFor` checks `types.every((t) => artPlanFor(t) !== "none")` for `visual === "effect"`, preventing creatures and props that use sprite sheets from being converted into effect looks.
   - In `server/art.ts`: Added `isArtChangeRequest(command)` and updated `planArtOrders` to accept `existingArts`. When editing/modifying a mod without an explicit art change request, existing art sheet keys (such as `"dragon-fly"`) are preserved.
   - In `server/index.ts`: Mod edits preserve `editRec.art` and `editRec.arts` across rebuilds, ensuring that modifying behavior ("make it shoot fire") retains the creature's sprite sheet.

## Consequences

- Real generated sheets (including `zombie.webp` and `dragon-fly.webp`) extract exactly 4 complete creature poses. No partial leg or tail frames are created.
- Walking and flying animations hold steady scale and baseline across all frames.
- Walker hostiles stay firmly on the ground with gravity unless requested as flyers.
- Modifying or adding abilities to an existing creature mod preserves its sprite graphics and sheet keys.
- All existing tests continue to pass (988 tests green), and strict regression tests protect each scenario.
