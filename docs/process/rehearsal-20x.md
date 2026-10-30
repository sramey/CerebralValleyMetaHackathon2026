# Rehearsal: the 8 demo commands, 20 runs each

Bead `metabuild-ideation-iqx`. The demo plan (`docs/DEMO.md`) says to rehearse its
commands 20× and fix flakiness only. This page is that measurement, the causes of every
failure, and what changed because of it.

## What ran

- Server: this worktree's own server (`PORT` from `.env`, 8789), started with `npm start`.
- Command set: `scripts/rehearse-demo.json`, 8 commands — the six in `scripts/rehearse.json`
  plus the two typed beats `docs/DEMO.md` has and the set was missing (`let me shoot fireballs`,
  beat 4's fallback; `undo`, the end of beat 6).
- Harness: `npm run rehearse -- --port 8789 --runs 20 --file rehearse-demo.json`, once.
  Every command is a real Meta call through `server/meta.ts` (Spark routes, Wonder writes,
  Muse Image draws); nothing is mocked.
- Camera, upload and voice beats are out of scope here (beats 1, 7, 8, 9).
- p50/p90 are nearest-rank over the 20 runs, from the server's own end-of-command timing,
  so they exclude harness overhead and match `logs/builds.jsonl`.
- `fixes rescued` = runs the verifier turned away and the platform's own fix round then
  landed (beat 5's intended path).

## Results (20 runs per command, before the fix below)

| # | Command | Pass | Expect | p50 ms | p90 ms | fixes | rescued |
|---|---|---|---|---|---|---|---|
| 1 | add a bouncing green slime | 20/20 (100.0%) | 20/20 landed | 8350 | 11134 | 2 | 0 |
| 2 | make them faster | 20/20 (100.0%) | - | 1558 | 2202 | 0 | 0 |
| 3 | add a dragon, some coins, and make it rain | 20/20 (100.0%) | - | 8411 | 12413 | 0 | 0 |
| 4 | make it so my character can double jump | 20/20 (100.0%) | 20/20 landed | 12938 | 20004 | 2 | 0 |
| 5 | let me shoot fireballs | 20/20 (100.0%) | 20/20 landed | 8324 | 10963 | 0 | 0 |
| 6 | make me huge | 20/20 (100.0%) | 20/20 rejected-then-fixed | 13450 | 19832 | 2 | 20 |
| 7 | make it spooky | 20/20 (100.0%) | 20/20 landed | 762 | 1009 | 0 | 0 |
| 8 | undo | **0/20** (0.0%) | - | 3195 | 5097 | 0 | 0 |
| | **ALL** | 140/160 (87.5%) | 140/160 | 7799 | 14703 | 6 | 20 |

Beat 6's two halves are the fastest and the slowest parts of the plan: the palette change
lands in 0.5–1.1 s, while three parallel builds (beat 3) land in 6.5–14.4 s wall time and
beat 5 always rejects first, then fixes (16.7–25.4 s, 20/20).

## Failures, with cause

**`undo`, 0/20 — the harness, not the game.** A bare `undo` with a mood on is answered by
the server with `{kind:"mood", mood:null}` ("Back to normal"). The harness only counted a
mood message as a landing when it carried a mood, so every correct revert was scored
`failed`. The server had in fact reverted the world in 19 of 20 runs. Fixed (below).

**`undo`, the 1 run in 20 that the server itself missed.** At 15:35:53 that run's bare
`undo` came back from the router with no route, so the orb answered "I didn't quite get
that". This cannot happen in the demo: typed and spoken text both go through
`handleLocal` in `src/client/main.ts`, which answers `undo` itself before the socket is
used, so this is a server-path-only flake. No routing change was made: forcing every bare
`undo` to the `undo` action on the server would change what "undo" does when no mood is on
(the browser removes the last mod, the server would ask "Tell me which mod to remove").

**`make it so my character can double jump`, p90 20.0 s (the only command over 20 s).**
Not a flake: 20/20 landed and 20/20 met the expectation. The cause is visible in
`logs/builds.jsonl`: 16 of 20 builds spent a second Wonder turn because their *own*
`test()` failed on the first draft with "player is airborne after first jump, y=366 vy=0".
In the verifier each mod runs alone in an empty world (ADR 0003), so the engine's
player-behaviour mod is not loaded and `t.step(1, { jump: true })` does not make the player
jump; the draft has to launch the player itself (`p.vy = -600`) to test an air jump. Two of
the 20 also needed the platform's fix round on top (25.2 s and 30.7 s). Both are model-side
behaviour: the repair is one sentence in the mod API doc that Wonder reads
(`server/prompt.ts`, owned by another worker — see Follow-ups). A 4-run re-check after the
harness fix reproduced the cheaper version of this (one run at 25.7 s whose two drafts both
tripped the same assertion).

**Nothing else failed.** Every aware check held 20/20: the slime source for beat 2, a
player-API source for beats 4 and 5, no sprite sheet on the projectile ability, and the
spooky mood with no mod built alongside it. `make them faster` changed speed through
four different target/knob choices across runs (`bouncing-green-slime.speed`,
`bouncing-slime.speed`, `.hopSpeed`) and landed every time.

## What was fixed

1. `scripts/rehearse.ts`: server messages now fold through a pure `applyServerMsg`
   reducer. A mood message lands whether it applies a mood or clears one, so `undo`'s
   revert counts; only `timing`/`stage` messages for the command itself can close or
   reject it, so a compound command's sub-build timing cannot end the whole command.
   `tests/rehearse.test.ts` pins both, plus the demo set itself (8 commands, in order,
   with `undo` last and after the mood beat).
2. `scripts/rehearse-demo.json`: the 8-command demo set, so `npm run rehearse` measures
   the beats that are actually in the shot list.

## After the fix (3 runs, all 8 commands, same server)

| Command | Pass | Expect | p50 ms | p90 ms | fixes | rescued |
|---|---|---|---|---|---|---|
| add a bouncing green slime | 3/3 | 3/3 landed | 7777 | 8613 | 0 | 0 |
| make them faster | 3/3 | - | 1610 | 1775 | 0 | 0 |
| add a dragon, some coins, and make it rain | 3/3 | - | 10656 | 11934 | 0 | 0 |
| make it so my character can double jump | 3/3 | 3/3 landed | 16741 | 17000 | 0 | 0 |
| let me shoot fireballs | 3/3 | 3/3 landed | 9429 | 9492 | 0 | 0 |
| make me huge | 3/3 | 3/3 rejected-then-fixed | 12421 | 20954 | 1 | 3 |
| make it spooky | 3/3 | 3/3 landed | 704 | 974 | 0 | 0 |
| undo | **3/3** | - | 2629 | 3889 | 0 | 0 |
| **ALL** | **24/24** | 24/24 | 7223 | 16741 | 1 | 3 |

## Left, and how to re-run

- `make it so my character can double jump` is the only beat whose p90 sits at the 20 s
  line, and the reason is model write time, not the pipeline: the fix belongs in
  `server/prompt.ts` (one sentence: in a `test()` the player-behaviour mod is not loaded,
  so launch the player yourself instead of pressing jump). It is not this lease's file.
- One server-path `undo` in 20 depended on the router; the browser answers `undo` locally,
  so it does not affect the recording. Worth a local route rule only if a future client
  path sends bare `undo` to the server.
- Re-run with the server on this worktree's port and then re-read this page:
  `npm run rehearse -- --port 8789 --runs 20 --file rehearse-demo.json`.
  To re-check one command after a fix, use `--runs 3 --only "<command>"` — except `undo`,
  which needs the mood beat before it, so re-run the whole file with `--runs 3`.
- `server/learned/` was reset to its committed state after these runs: the learner writes
  rules while it plays, and none of that belongs in the demo evidence (see `demo:prep`).
