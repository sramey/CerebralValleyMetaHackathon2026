# ADR 0013: Visible verifier: bot playtest, input-replay ghost, agentic fix

- **Status:** Draft
- **Date:** 2026-10-29

## Context

The verifier (ADR 0003) ran each mod alone in an empty world in ~2 ms, so it could not catch a change that breaks the *player's* game (a huge player that cannot pass a gap), and nobody could see it work. "It can't break" is our differentiator (WINPLAN), so the check must be real and watchable. The starter level also had no gap: a huge player simply hopped the platforms, so an honest playtest had nothing to reject.

## Decision

1. **Playtest in a copy of the player's world.** After the health check, `server/playtest.ts` loads the world's mods (the client sends a `world` message before each command; starter mods are adopted into the server manifest) with and without the candidate, and runs a deterministic scripted bot (`src/sim/playtest.ts`: run right, jump at walls and ledges) for 360 frames over 3 seeds. Fail if the player is gone or dies on spawn, falls out, covers under half the baseline distance, the sim throws, or ms/frame exceeds budget. Comparing against the baseline keeps pre-existing level quirks from blaming the new mod. An edit that renames its mod replaces the old one in the copy.
2. **Ghost = input replay, not a frame trace.** The server sends the bot's inputs (run-length encoded, a few dozen numbers) as a new `playtest` message; `src/client/ghost.ts` rebuilds the same world (client's mods + the candidate) and replays them at 8 steps per frame in a small canvas. Because the sim is deterministic this is the real run that passed or failed, and the message stays tiny. The client holds the `mod` landing until the replay ends (~0.75 s); server-side playtest cost is 1-6 ms.
3. **Rejected -> fixed, with Wonder as an agent.** A failed playtest sends a new `rejected` stage with a plain one-line reason (orb turns red, text held ~2 s), and the failure detail (with measured headroom) goes to the existing single fix round. That round is now a tool loop (`server/agent.ts`): Wonder may call `run_playtest(source)` on its own candidate (each call is compiled, verified, playtested and shown in the ghost) and the loop returns as soon as one passes; the server's final check is cached by source so nothing re-runs.
4. **Starter level change.** `src/mods/ground.ts` gains an `overhang` knob (default on): a rock overhang at x=950 with 100 px of headroom. Normal players, the bot and every built-in mod pass under it; a player roughly 3x or taller cannot, which is what makes "make me huge" an honest rejection.

## Consequences

- The demo beat is real and repeatable, and costs no extra Meta call on the happy path; the fix round costs one to a few Wonder calls.
- Wonder's own variance remains: "huge" at ~2x passes outright (honestly), larger sizes get rejected.
- The playtest only judges what the bot can do (go right, jump); it does not prove goals are reachable (DESIGN §7 layer 3 is still ahead).
- Imported mod definitions are cached by compiled source and shared across playtest worlds, so a mod with module-level mutable state could leak between runs.
- The server trusts the client's `world` message for what is loaded.

## Alternatives considered

- **Frame trace to the client:** simpler client, but ~360 frames x entities of JSON per run and it can drift from the real sim. Rejected.
- **Canned ghost animation:** cheap, but dishonest and could contradict the verdict. Rejected.
- **One-shot fix with errors in the prompt (previous behavior):** kept as the fallback shape, but the agent lets Wonder test its own fix before answering, which also targets Best Agentic.
- **Leave the level alone and accept "huge" passing:** honest but kills the demo beat.
