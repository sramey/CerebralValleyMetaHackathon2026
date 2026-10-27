# ADR 0004: Solid entities with gravity still get physics

- **Status:** Draft
- **Date:** 2026-10-27

## Context

The original `World.step()` skipped physics entirely for `solid` entities, assuming solids are always static terrain. Wonder routinely writes creatures with `solid: true, gravityScale: 1` (a bouncing slime); those entities froze mid-air and their own tests failed verification. The mod-API reference never stated what `solid` means for a moving body, so AI authors guessed — reasonably.

## Decision

In `World.step()`, only **static** solids (`solid && gravityScale === 0`) skip physics. A solid with gravity integrates, falls, and collides with other solids (excluding self-collision). The API reference now tells Wonder: `solid + gravityScale 0` = static terrain; moving creatures use `solid: false` or solid-with-gravity; `color` is a number, never a CSS string.

## Consequences

- One whole class of plausible AI mods works instead of failing verification for an engine quirk.
- Two solids with gravity can now push against each other via AABB resolution; behavior is simple (positional push-out) and may need refinement if stacking bodies ever matters.
- Guarded by a regression test: a solid-with-gravity slime falls and lands on static ground (`tests/sim.test.ts`).

## Alternatives considered

- **Prompt-only fix ("never write solid creatures"):** brittle; depends on the model obeying a subtle rule forever, and the engine semantics were genuinely ambiguous.
- **Reject solid-with-gravity in the verifier:** turns an engine ambiguity into more failed builds; the forgiving engine is the better default for AI-authored code.
