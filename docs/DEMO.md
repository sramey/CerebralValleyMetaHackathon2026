# Demo video: 3:00 shot list (DRAFT for the owner to edit)

Built from what the game does today. No slides: every beat is the live product, and the closing architecture beat is the in-app pipeline view (**P**). Judges stop watching at 3:00 exactly, so the plan ends at **2:50** and leaves 10 s of slack for one speed-up or one retake.

**Rules (from WINPLAN):** use real uncut runs; label any speed-up on screen ("⏩ 3×"); English; every model on screen is Meta. Record Tue Nov 3. The commands below are exactly `scripts/rehearse.json`; rehearse them with `npm run rehearse -- --runs 20`. The world-awareness set (unseen phrasings) is `scripts/rehearse-aware.json`, run with `--file rehearse-aware.json`.

**Setup before recording:** fresh browser tab on the starter world (ninja + ground), orb bar visible, side panel open, microphone allowed, spend guard raised for the session (builds, images, voice), pipeline view closed. Beats run in order in one world.

| # | Time | Beat | Say / do | Expected on screen | Meta model visible | Fallback |
|---|---|---|---|---|---|---|
| 1 | 0:00–0:08 (8 s) | **Hook** | Voice-over only, over the starter world: "Game making takes years to learn. What if it took a sentence?" | Ninja stands on ground, orb idle | none | none needed |
| 2 | 0:08–0:28 (20 s) | **Talk to build** | Hold **Shift**, say "add a bouncing green slime", release | Live partials under the orb, then the pipeline strip (route, forge, compile, playtest, live); a slime appears with the screen-rip portal and bounces while you keep moving | **Muse Voice Transcribe** (partials), **Spark** routes, **Wonder** writes | If the mic misfires, type it in the orb bar. If the build is slow (>12 s), cut with "⏩ 2×" label |
| 3 | 0:28–0:46 (18 s) | **Parallel builds** | Say "add a dragon, some coins, and make it rain" | Three cards build side by side; dragon sprite digitizes in then resolves; coins and rain land | **Wonder** (parallel agents), **Muse Image** (dragon art) | Measured 3/3: Spark splits it into three standalone builds that run in parallel (batch wall time 10, 10 and 20 s). Each sub-build has its own lane, keyed by its sub-command text ("add a dragon", "add some coins", "add rain effect"). If a split fails, build the three separately by typing. Or load `?w=demo-bouncy` and narrate over it |
| 4 | 0:46–0:58 (12 s) | **It understands your world** | Say "make it so my character can double jump", then jump twice | A standalone ability mod loads (no NPC gets edited); ninja jumps again in mid-air with a cyan burst | **Spark** (routes a player ability to a new mod), **Wonder** | Say "let me shoot fireballs" instead (also AI-built). Do not use "give me a gun": it resolves locally and shows no Meta call |
| 5 | 0:58–1:33 (35 s) | **It can't break** | Say "make me huge" | Ghost playtest window appears; the bot cannot fit through a gap; card turns red with the reason; orb explains; Wonder fixes it as a tool-using agent; it lands and works | **Wonder agent** (`inspect_world`, `run_playtest` tools), verifier | Measured 3/3: rejected, then fixed, then landed (22, 22 and 33 s). If a take lands first try, redo it; at 3/3 the odds are in your favour but sample size is small. Rehearse this one the most |
| 6 | 1:33–1:55 (22 s) | **One sentence restyles the world** | Say "make it spooky" | Palette, fog, vignette change in ~3 s; sprites then redraw in the new style (speed up the redraw wait, label "⏩ 3×"); say "undo" at the end to show it reverts | **Spark** (designs the mood), **Muse Image** edit-from-anchor | If the sprite restyle stalls, the palette change alone still reads; cut after 8 s |
| 7 | 1:55–2:20 (25 s) | **Your real stuff walks in** | Side panel: **Bring an object in (camera)**, type "coffee mug", hold a real mug to the webcam | Green box finds the mug, it is cut out, pixelated and drops in as a physics prop you can push | **SAM 3.1** | Click **Upload a photo instead** with a prepared mug photo |
| 8 | 2:20–2:42 (22 s) | **Architecture, live** | Press **P** | Pipeline view: Spark, Wonder agent with its tools, esbuild, verifier, SAM 3.1, with live telemetry; stats panel with build success rate and median time (bead d6b, in progress) | All five: **Spark, Wonder, Muse Image, SAM 3.1, Muse Voice Transcribe** | If the stats panel is not ready, narrate from `docs/evidence/build-stats.md` numbers (about 96% of AI builds land, median about 10 s) over the pipeline view |
| 9 | 2:42–2:50 (8 s) | **Close** | Click **Share this world (copy link)**; voice-over: "Software that rewrites itself while you use it, and every change is playtested by agents before it goes live." | Link copied toast, world still running | none | none needed |

Total planned: 170 s (2:50). Slack: 10 s.

## Measured on the live server (bead ki5, 3 runs each)
| Beat | Command | Pass | p50 | p90 | Notes |
|---|---|---|---|---|---|
| 2 | add a bouncing green slime | 3/3 | 10.9 s | 25.1 s | text path; voice not measured here |
| 3 | add a dragon, some coins, and make it rain | 3/3 | batch 10 s (10, 10, 20) | 20 s | 3 parallel builds each time |
| 4 | make it so my character can double jump | 3/3 | 14.7 s | 16.6 s | |
| 5 | make me huge | 3/3 rejected then fixed | 22.6 s | 33.2 s | rejection seen every run |
| 6 | make it spooky | 3/3 | 0.9 s to repaint | 1.1 s | palette only; the Muse Image redraw of sprites is separate, 20-30 s |

The harness reported 180 s for beat 3 because the server sent no end marker for the whole compound command. `server/index.ts` now sends one (not re-run live, the build cap was reached). Beats 7 to 9 are not covered by the rehearse set.

## Recording-day prep (bead 1os)
Run `npm run demo:prep` before every take (add `--dry` to only report, `--skip-art` to skip image calls). It:
1. prints which `BUDGET_*` lines to raise in `.env` (names and suggested numbers only, never keys) and warns if today's local counters are already used up;
2. resets `server/learned/` to its committed state (new files go to `output/`) and warns about any rule that caps the player's size, since that changes beat 5;
3. moves untracked files out of `public/art/gen/` into `output/` (they regenerate on demand, one image each);
4. pre-warms the spooky mood art for at most 6 sprite sheets (ninja, dragon, slime, chicken, bird, cat, whichever exist), so beat 6's redraw is instant;
5. preflights: one cheap Meta call, the server and Vite ports, and a microphone hint.

**Freeze the learner while recording:** set `DEMO_FREEZE_LEARNING=1` in `.env` (and restart the server). The learner still reads rules and skills but writes none, so rehearsals and takes cannot change `server/learned/` (a "make me giant" auto-fix once added a size rule during a rehearsal run).

**Voice limit:** with no `BUDGET_SESSION_VOICE_MIN` set the per-visitor voice allowance was 8 seconds, not the intended 8 minutes (fixed in `server/budget.ts`); for recording, still raise it to 30.

## Notes for the owner
- **Impact numbers:** the claim "non-coders build games in minutes" needs the non-coder test (WINPLAN item 4) clips and numbers; none are in this draft. Beat 8 is the place to cut to them if you have them (cost: about 10 s of the slack).
- **Open-weights bonus:** if Muse Spark Open via Baseten is used in the product, say where in beat 2 or 8; this draft does not claim it.
- **Speed-ups:** only beats 2 and 6 contain waits worth compressing. Every speed-up gets a visible label.
- **Risk ranking (rehearse most):** beat 5 (needs a real rejection on camera), beat 3 (three parallel builds), beat 7 (webcam lighting).
- **Not in the cut (cut for time):** radial menu and 👍/👎 teaching, camera-free demos, stairs, snow, daytime.
- **Check before recording:** run `npm run rehearse -- --runs 20` (demo set) and `npm run rehearse -- --runs 5 --file rehearse-aware.json` against the live server; fix flakiness only.
