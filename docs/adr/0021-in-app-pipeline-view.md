# ADR 0021: In-app pipeline view

- **Status:** Draft
- **Date:** 2026-10-29

## Context

The video's closing beat showed an architecture slide. The product should show itself: the real pipeline, lit by real builds, with real timings.

## Decision

1. **Overlay over the stage**, toggled by the Pipeline button or `P` (`Esc` closes), in `src/client/pipeline.ts` + `pipeline.css`. main.ts only creates it and passes every server message to `pipeline.onMsg` (three lines).
2. **No contract change.** Stage messages already carry `command`, so a build is a lane keyed by its command. A `stage` places the build on a node (routing = Muse Spark, writing/fixing = Wonder agent, compiling = esbuild, verifying/rejected = Verifier, done = Hot-load); time between events is attributed client-side while it runs, then the server's `timing` message replaces it with the measured route/write/compile/verify milliseconds.
3. **Parallel builds are parallel lanes**, one row per in-flight command (last five shown), and a node shows "N builds" when several are in it. Wonder's tool chips flash from the stage detail (`inspect_world`, `run_playtest`). Muse Image, SAM 3.1 and Voice Transcribe light on `art`, `segment` and `transcript` messages.
4. **Counters** (builds, landed %, auto-fixed = landed after a rejection) accumulate per day in `localStorage`; a viewer-only convenience, not game state.

## Consequences

- The view is accurate to what the server reports: a stage it does not emit cannot light up. Builtin routes (rain) skip write and show it empty.
- Counters are per browser, not global.
- Node names and models are hardcoded in the client and must be updated with the stack.

## Alternatives considered

- **Static diagram:** the slide we are replacing; says nothing about the live system.
- **Server-sent trace events:** more precise per-tool timing, but a new message type for a view-only need; stage and timing messages already suffice.
