# ADR 0022: Streamed code and the build theater

- **Status:** Draft
- **Date:** 2026-10-29

## Context

A Wonder build takes 5-12 s and the player saw a static status line. The product's story is that code is being written while you play, so that should be visible, and it should not block the game.

## Decision

1. **Stream Wonder, still a Meta call.** `runAgent` takes an optional `onText`; when set, each model turn is requested with `stream: true` on the Meta chat completions endpoint (probed: streaming and `tool_calls` work together). Content deltas and the `source` argument of a `run_playtest` call (decoded from partial JSON by `sourcePreview`) are reported as they arrive. If the stream cannot start, the plain request runs and the finished code is reported in one piece, so the view still shows it. Tool-loop semantics are unchanged.
2. **One additive wire message:** `{ kind: "codeStream"; command; text }`, sent for the write and fix rounds. Old clients ignore it.
3. **Build theater** (`src/client/build-theater.ts`): a translucent code stream behind the stage (top/bottom alpha mask, `pointer-events: none`) and a five-step stepper (Route, Forge, Compile, Playtest, Live) whose steps pop with a small particle burst. Received text is paced at a steady rate that speeds up with backlog and flushes when the build ends, because Wonder tends to deliver the code late and in bursts. The same paced text feeds the pipeline overlay's Wonder node. Parallel builds share one stream with a `// command` separator.
4. **Preview hook:** `window.preview_idle_fx()` replays a canned 6 s build through the same handlers with no server and no API calls.
5. The pipeline overlay's header now clears the orb bar.

## Consequences

- No extra Meta calls; a streamed turn costs the same tokens.
- Wonder often emits the code in a few large chunks late in the turn, so the stream looks like typing on the client rather than token-by-token arrival.
- The pacing buffer can lag the real stream by up to about a second; it is flushed when the build ends.

## Alternatives considered

- **Fake ticker over the finished code:** simpler but dishonest; kept only as the fallback.
- **Stream through a new endpoint:** unnecessary; the existing WebSocket carries it.
