# ADR 0052: Wave spawner & swarm archetype

- **Status:** Draft
- **Date:** 2026-10-29

## Context

During kid playtests (transcript [00:06:27], [00:07:24], [00:08:13], [00:08:37]), players asked for swarm waves with continuous leveling ("Tell it to add swarms and continuously level up... start at level 1 and get harder as I level up"). This revealed three root issues:
1. **Clumped single-origin spawns**: Swarm mods spawned 10–20 entities at a single static coordinate, creating an overlapping cluster that walked in lockstep.
2. **Missing multi-angle approach**: Enemies only spawned from one side on the ground rather than flanking from left, right, and swooping from above.
3. **Runaway level-up timer**: Mod logic incremented levels every second (or frame) instead of checking actual combat progress, leveling up before the player could even play or while code was still streaming.

## Decision

1. **Engine-side wave spawner & anti-clumping helper (`src/sim/waves.ts`)**:
   - **Multi-angle offscreen spawning**: Units spawn beyond camera edges according to a deterministic distribution:
     - 40% from left (`camera.x - 60`) moving rightward into the viewport.
     - 40% from right (`camera.x + screen.w + 60`) moving leftward into the viewport.
     - 20% airborne flyers/swoopers from top sky (`camera.y - 60`) with `gravityScale: 0` swooping downwards.
   - **Anti-clumping boid separation**: A pure separation velocity step (`applySwarmSeparation`) applies repulsive velocity to overlapping or closely clustered swarm entities within a 40 px radius, preventing stacking or lockstep movement.
   - **Paced progression milestones**: Progression is strictly kill-based. Advancing from Level 1 to Level 2 requires defeating 5 swarm enemies. Each subsequent level increases wave size or enemy speed by 10–15% (default 12%). Timers never advance levels without combat kills.
   - **Non-spam HUD banners**: Wave and level milestones announce through `api.setHud("wave", { kind: "banner", duration: 2, position: "top-center" })`. Ongoing status uses `{ kind: "stat", label: "Level" }` rather than per-tick banner spam.
   - **`WaveController`**: A stateful controller managing spawning pace, anti-clumping, kill-tracking, stomp bounce interactions, and HUD lifecycle.
2. **Contract additions (`src/contract.ts`)**:
   - Added optional helper signatures to `ModApi`: `camera()`, `spawnWaveUnit(opts?)`, `applySeparation(entities?, opts?)`, and `createWaveController(opts?)`.
3. **Wonder prompt guidance (`server/prompt.ts`)**:
   - Added a dedicated Swarms, Waves & Continuous Level-Ups section guiding Wonder on multi-angle flanking, boid anti-clumping, kill-based level milestones, and HUD etiquette.
4. **Archetype mod (`src/mods/swarm.ts`)**:
   - Shipped a reference `swarmMod` built atop `WaveController` with deterministic tests passing `runModTest`.

## Consequences

- Swarm enemies flank dynamically from left, right, and above, delivering the challenging, multi-directional combat requested in playtests.
- Anti-clumping separation keeps enemy swarms visually distinct and organically dispersed.
- Progression feels earned; the runaway level-up bug observed during kid playtests is completely resolved.
- Wonder can call `api.createWaveController` or compose the primitives directly in self-contained TypeScript.

## Alternatives considered

- **Inline loop in `World.step()`**: Modifying `World.step()` directly risked merge conflicts with parallel worker leases touching creature locomotion and unstick recovery. Exposing engine helpers on `ModApi` and in `src/sim/waves.ts` keeps the sim core clean while empowering mods.
- **Pure prompt guidance without engine helpers**: LLMs often struggle with deterministic multi-angle camera trigonometry and boid repulsion in single-shot mod generation. Providing deterministic engine helpers guarantees solid physics and consistent gameplay feel.
