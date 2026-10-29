# ADR 0023: Keep the "make me huge" rejection real and repeatable

- **Status:** Draft
- **Date:** 2026-10-29

## Context

The "it can't break" beat needs the verifier to reject a huge player and Wonder to fix it. In rehearsal it was caught 1 time in 10. Two causes, both honest, neither a hidden pre-check (every playtest, including the agent's own `run_playtest`, already sends its `playtest` and `rejected` messages):

1. Wonder's "huge" is about 100 px (3x the 34 px player), and the overhang's clearance was exactly 100 px, so it fit.
2. The self-improving rules (ADR 0020) learned from the first rejection: "keep height <=68px (scale <=2x) so the player remains traversable". From then on Wonder shrank "huge" to 68 px up front, nothing was rejected, and the player was not huge.

## Decision

1. The rock overhang's clearance is 72 px (it was 100): the player and anything up to about 2x fit, a 100 px player does not. Ordinary mods and the bot are unaffected.
2. `learnFromFix` no longer distills a rule from a "too big / fit through / headroom" playtest rejection. That rejection is the level doing its job on what the player asked for; teaching Wonder to avoid it hides the verifier and overrides the request. Other playtest and compile failures still teach rules.

## Consequences

- Rehearsal: "make me huge" 10/10 rejected-then-fixed (was 1/10); "make me giant" 5/5 landed, all through a fix round.
- A learned size cap already present in `server/learned/` from earlier runs would still apply; the committed files hold none.
- Players asking for a "big" (about 2x) character still pass without a rejection, by design.

## Alternatives considered

- **Faking or forcing the rejection:** dishonest, rejected.
- **Showing the agent's internal failed run_playtest:** already shown; not the cause.
- **Deleting the learner:** it is useful for other failures; only this class of lesson is poisonous.
