# ADR 0015: Spark visual kind, procedural shapes, engine effects

- **Status:** Draft
- **Date:** 2026-10-29
- **Amends:** ADR 0009 (scenery vs creature keyword lists)

## Context

"add a bouncing ball" drew a kid with a basketball: the word lists in `server/art.ts` did not know "ball", so Muse Image was asked for a character sheet ("idle, running, jumping") of a ball. Primitives had no code-drawn look anyway (a plain rectangle). Weather and explosions were flat outlined rectangles.

## Decision

1. **Spark classifies in the router call it already makes.** The router JSON gains `visual` (`shape` | `effect` | `prop` | `creature`) and `shape` (`circle`, `ring`, `triangle`, `spikes`, `pill`, `diamond`, `star`, `block`). No extra network call or latency. `prop` takes the static scenery sheet, `creature` the pose sheet (as ADR 0009), and the keyword lists only apply when Spark returned no `visual`.
2. **`shape` and `effect` never go to Muse Image.** The server sends a `look` ({visual, shape, types}) on the `mod` message; it is stored in the manifest and in saved worlds (`WorldMod.look`). `src/client/shapes.ts` draws shapes procedurally (shaded ball with squash and stretch, ring, triangle, spikes, pill, diamond, star, block). A small client word list covers a missed router call.
3. **Effects are render-only (`src/client/fx.ts`).** Rain is slanted streaks with ground splashes and low mist; fog and smoke are soft drifting radial puffs; every burst of new `world.particles` becomes an explosion (flash, fire-ramp puffs, sparks, smoke, shockwave ring, small screen shake). Effect entities skip the dark outline. `src/sim` is untouched, so determinism holds; the fx layer uses its own `Math.random` because it never feeds back into the sim.
4. Weather and effect types are added to `SKIP_TYPES` in `server/art.ts`.

## Consequences

- Balls, orbs, rings and spikes appear instantly with no art wait or image spend, and never grow a person.
- fx cost measured at about 0.1 ms per frame with rain, fog and explosions on screen (`art_state().fxMs`).
- An explosion is any batch of 6+ fresh sim particles, so enemy deaths also explode; a sim-side `explode` primitive could replace this later.
- No hit-stop: it would need the sim loop to pause, which is outside this lease.

## Alternatives considered

- **A separate Spark classification call:** extra latency and cost per build; the router already sees the command.
- **More keyword lists:** the status quo that produced the bug.
- **pixi-filters (bloom, shockwave, blur):** more polish, but a new dependency; additive radial sprites got the look without one.
