# ADR 0020: Self-improving rules and skills from player feedback and verifier auto-fixes

- **Status:** Draft
- **Date:** 2026-10-29

## Context

Each AI build previously started with only the static system prompts in `server/prompt.ts` and `server/art.ts`. When a player disliked a generated mod (for example, a "ball" routed as a creature sprite sheet instead of a code-drawn circle shape, or an entity with awkward physics), or when a build failed attempt-1 verification and needed an auto-fix, the engine fixed at most that one turn and forgot the lesson on the next request.

## Decision

1. **In-game 👍 / 👎 feedback UI.** Both the entity radial menu (`#radial-menu`, re-spaced across 7 buttons) and the mod cards in `#mods` expose `thumbs-up` and `thumbs-down` actions that open `#feedback-modal` (`src/client/feedback.ts`). Submitting sends `{ kind: "feedback", modId, entityType, vote, note, fixNow }` over the WebSocket (`src/contract.ts`).
2. **Distilling rules & skills with Muse Spark.** `server/learn.ts` calls `muse-spark-1.2` (`reasoning_effort: "minimal"`):
   - On 👎, Spark distills a 1-line imperative rule tagged by subsystem (`"router" | "wonder" | "art"`), deduplicates by token overlap, caps the list at 24 rules, and writes `server/learned/rules.json` plus human-readable `server/learned/RULES.md`. When `fixNow` is checked, the server clears any offending cached sprite sheet and immediately re-runs the edit path for that mod.
   - On 👍, Spark distills the mod's mechanics and a compact source excerpt into `server/learned/skills/<slug>.md`.
   - After any build that requires an attempt-2 verifier auto-fix, `learnFromFix` runs asynchronously in the background to record a 1-line `wonder` pitfall rule without delaying build delivery.
3. **Live prompt injection.** `buildRouterPrompt`, `buildWonderPrompt`, `buildEditPrompt` (`server/prompt.ts`) and `generateSubjectArt` (`server/art.ts`) append active subsystem rules and keyword-matched skills from `server/learned/`.

## Consequences

- Mistakes corrected once by the player or caught by the verifier persist on disk (`server/learned/`) and immediately guide subsequent Router, Wonder, and Muse Image calls.
- Prompt growth is bounded: rules are deduplicated and capped at 24 total (at most 12 injected per prompt), and at most 2 keyword-matched skills are injected per Wonder call.
- `learnFromFix` adds one background Spark call when attempt-1 verification fails; it is fire-and-forget and never blocks mod delivery.

## Alternatives considered

- **Session-only memory in RAM:** lost on server restart and invisible to a cold viewer inspecting the repo.
- **Injecting every learned skill into every prompt:** bloats token counts and dilutes unrelated builds; keyword matching keeps prompts small and relevant.
- **Using Wonder (`muse-wonder-1.0`) to distill rules:** Spark with `reasoning_effort: "minimal"` is faster and cheaper for single-JSON classification and 1-line distillation.
