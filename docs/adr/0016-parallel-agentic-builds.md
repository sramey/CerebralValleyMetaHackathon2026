# ADR 0016: Parallel builds, Wonder as a tool-calling agent, pronoun memory

- **Status:** Draft
- **Date:** 2026-10-29

## Context

A compound command ("add trees, make it rain, and add a bouncing slime") was split by the router and built one item after another, so the player waited for the sum of the Wonder calls. Wonder wrote each mod blind: it could not look at the live world or test a draft, and only the fix round was an agent (ADR 0013). Follow-ups like "make it bigger" lost their referent, and an edit could silently mint a new mod id. Autonomy, effectiveness and practical usefulness are the Best Agentic criteria.

## Decision

1. **Parallel pool.** `handleCommand` runs the items of a compound command through `server/pool.ts` (`runPool`, bounded, errors isolated per item). Concurrency is `MAX_PARALLEL` (default 3; `1` is the sequential baseline). Each build claims a distinct mod id up front (`-2`, `-3` suffixes against the manifest and the session's `reserved` set) and sees the other in-flight builds in its prompt, so parallel mods do not collide. Mods that landed after the client's last `worldState` are added to the playtest world.
2. **One agent loop for write and fix.** `server/agent.ts` `runAgent` is a bounded Meta tool-calling loop (OpenAI-style `tools`/`tool_calls`, `reasoning_effort: "minimal"`, at most 3 tool calls, then the model must answer without tools). Tools: `inspect_world` (loaded mods and knobs, entity types with counts and a sample) and `run_playtest(source)` (compile, verify, bot playtest; a pass ends the loop with that source, so no extra model turn). A tool error becomes a message to the model, not a crash; a failing agent call falls back to the old single `chat()` write. Every build logs its tool calls and timings to `logs/builds.jsonl` (`agent`, `batch`).
3. **Pronoun memory.** `server/context.ts` keeps, per session, the last 5 commands and the 4 most recently touched mod ids. The router prompt receives them; a command containing it/them/that with a tweak/edit/undo (or a router "new") resolves to the newest touched mod, which is also what Wonder is told.
4. **Per-build orb UI.** The client keys builds by their sub-command (carried on every `stage` and `timing` message), shows a chip with a stage trail per build (`src/client/builds.ts`) and keeps the orb on "building" until all in-flight builds settle.
5. **Small fixes in the same lease.** The ground slab starts 3000 px further left so a fresh load never shows its cut-off end. Edits keep their mod id by rewriting the id field server-side (`server/modid.ts`) instead of trusting Wonder, and the fix round prompt is terse, which cut it from 6-14 s to 4-7 s.

## Consequences

- A 3-part compound command finished in 20.3 s parallel vs 34.4 s sequential on the same prompts; the slowest single build now sets the time.
- Up to 3 concurrent Wonder calls per player; spend and rate limits (ADR 0014) apply per call as before.
- The playtest world for parallel builds is approximate: a sibling that has not landed yet is not in it.
- Pronoun resolution is lexical: "it" in a sentence about something else can resolve to the last touched mod.
- Wonder may skip the tools entirely; the server's final check still gates every mod.

## Alternatives considered

- **Sequential items with a better progress UI:** honest but slow; the whole point is time to a working mod.
- **A separate planner agent splitting and ordering builds:** more calls and latency for what the router already extracts.
- **Letting Wonder choose ids:** it duplicated or renamed ids on edits; server-side claiming is deterministic.
- **LLM-resolved pronouns only:** the router sometimes answers "new" for "make it bigger"; the lexical fallback is cheap and predictable.
