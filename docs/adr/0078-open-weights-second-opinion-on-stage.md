# ADR 0078: The open-weights second opinion is shown on stage, and can be asked for

- **Status:** Proposed
- **Date:** 2026-10-31

## Context

Muse Spark Open (open weights, via Baseten) reviews every finished build in the background (ADR 0068), swaps in a fix only if it passes the compile, verify and playtest gates, and teaches the game a rule (ADR 0069). In the owner's log it fixed 4 of 19 builds. On screen, though, the only sign was one grey line in the side panel, so nobody watching the video could see what the open-weights model does. A fix also depends on timing: a background review lands whenever it lands, so a recording cannot count on one.

## Decision

1. **A `review` server message (additive).** `{ kind: "review", modId, title, phase: "running" | "ok" | "fixed" | "held", model, issue?, rule?, ms?, sweep? }`, sent by the reviewer itself: `running` when it starts, `ok` for a clean verdict, `fixed` after the verified patch has been hot-swapped (with the first issue and the learned rule), `held` when a fix failed a gate or the call failed. Nothing existing changes; the old `say` line still goes out.
2. **The stage shows it.** A fix is a card (top-left under the orb row, about 5 s) saying Muse Spark Open caught a bug, the issue in plain words, "Fixed · re-verified · live", with a ring on the fixed entity. A clean review is only a 2 s chip, never a card. A fix that taught a rule pulses the 🧠 button with "+1 rule"; the 🧠 panel tags that rule "learned from open-weights review". The pipeline view gets a "Second opinion" node, lit while a review runs.
3. **"Double-check my world" is a local command.** "double-check my world", "review my world", "check everything for bugs" and close phrasings are matched on the server before the router, so they are instant and deterministic. It runs the reviewer over every live AI-built mod, two at a time, and the orb ends with "Muse Spark Open reviewed N builds, fixed M". An explicit request skips only the one-review-per-build cap (`force`); the `REVIEWER=off` switch and the key still apply. Spend guard: at most `REVIEW_SWEEP_MAX` (6) builds per sweep, newest first, and `REVIEW_SWEEPS_PER_SESSION` (5) sweeps per connection. With no key the orb says the reviewer is off and how to turn it on.

## Consequences

- The open-weights model's work is visible in the video on demand, with no new model and no new provider: it is the same Meta-hosted open model doing the same job.
- A sweep costs one open-weights call per build (bounded by the guard above); the verify and playtest gates are unchanged, so a bad patch still never reaches the world.
- The wire grew one message kind. An old client ignores it; an old server never sends it.
- A held-back fix shows nothing on stage by design; it stays in the 🧠 panel.

## Alternatives considered

- **Reuse the `say` line and parse it on the client:** no contract change, but brittle and carries no issue, rule or model name.
- **Route the command through the router:** costs a router call, a second of latency and a chance of being read as a build request.
- **Skip the force flag and only review new builds:** a sweep right after the background reviews would find "already reviewed" for everything and show nothing.
