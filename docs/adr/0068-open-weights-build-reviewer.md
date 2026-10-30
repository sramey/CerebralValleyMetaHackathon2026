# ADR 0068: Open-weights build reviewer on Muse Spark Open via Baseten

- **Status:** Proposed
- **Date:** 2026-10-30

## Context

The Meta Global AI Developer Hackathon rewards using Meta's open-weights models served by an ecosystem partner for real, measurable work. Muse Spark Open (`meta-models/muse-spark-open`) is served on Baseten's OpenAI-compatible endpoint. While ADR 0032 activated the command router path on open weights, Wonder writes the mods.

To improve mod quality and showcase open-weights capabilities, we need an autonomous code reviewer that inspects Wonder's creations for subtle bugs that basic automated tests might pass:
- Unbounded spawns or missing despawn cleanup on `dispose()`
- Entities spawned off-screen or outside the bounds
- Usable items/weapons lacking user input handlers
- Erroneous `visual: "shape"` classifications on characters that should have sprites (or vice versa)
- Runtime physics traps or performance regressions

## Decision

1. **Async, non-blocking execution:** `server/reviewer.ts` hooks into `handleSingle` immediately after a full Wonder generation passes initial verification and is loaded in the player's world. The reviewer runs completely in the background via `queueBuildReview` and never delays or blocks build delivery.
2. **Reviewer prompt & strict JSON:** The command, live mod source, and verification/playtest results are sent to Muse Spark Open on Baseten (`reasoning_effort: "minimal"`). The model returns strict JSON:
   `{"verdict":"ok"|"fix","issues":[...],"patchedSource":"..."}`.
3. **Triple verification gate for patches:** When Muse Spark Open proposes a fix, the patched mod must pass the exact same compile, headless simulation verify (600 frames at 60 Hz), and bot playtest (`playtestMod`) gates. If any gate fails, the patch is dropped immediately and the original mod remains live and untouched.
4. **Live hot-swapping:** If all gates pass, the patched mod is hot-swapped in place using the same mod ID (preserving undo capability) and a notice is sent to the client side panel:
   `"Reviewed by Muse Spark Open (open weights): fixed <issue>"`.
5. **Self-healing loop via learned rules:** Accepted fixes are sent to `server/learn.ts` (`learnRuleFromReview`, `source: "review"`) to persist generalizable pitfall rules in `server/learned/rules.json` and `RULES.md`, teaching future Wonder generations to avoid the same mistake.
6. **Receipt and audit trail:** Every review is logged to `logs/builds.jsonl` (`kind: "review"` with timings, model slug, verdict, issues, and whether the fix was accepted) and stamped onto the mod's `BuildReceipt` (ADR 0065). The in-game "How was this made?" receipt displays the review as an open-weights proof step.
7. **Kill switch & bounds:** Environment variable `REVIEWER=off` disables the reviewer immediately without making API calls. Timeouts or invalid JSON safely resolve to no-ops. Capped at exactly one review per build. Git is never touched at runtime.

## Consequences

- Real, high-value open-weights utilization: Muse Spark Open actively analyzes and improves generated game code in production.
- Resilient self-healing: Mod code self-heals after landing and persists rules to improve all subsequent generations.
- Zero player latency overhead: The initial build hot-loads instantly; enhancements arrive asynchronously.
- Safety guarantees: Any failing patch is rejected by the verifier gates, preventing regressions.
