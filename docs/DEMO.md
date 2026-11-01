# Demo video: recording plan (11-01, current)

The video is a ~1-minute technology intro over the scroll deck ([docs/talk/index.html](talk/index.html)), then ~2 minutes of the live product doing the work. Judges stop at 3:00, so aim for **2:50**.

## Before every take
1. `npm run demo:prep` (resets `server/learned/`, warms spooky art, preflights a Meta call). **Do this before each take:** a rehearsal or take that auto-fixes "make me huge" teaches a size rule, and from then on it builds right first time, so the rejection beat disappears (seen 11-01: runs 1-2 rejected-then-fixed, runs 3-5 landed first try).
2. Leave `DEMO_FREEZE_LEARNING` unset: freezing stops the "+1 rule" pulse on the second-opinion card. The reset in step 1 is enough.
3. `npm run build`, restart the server, open the game with `?nocoach`, **Ctrl+Shift+R**, then **New world**.
4. Deck: open `docs/talk/index.html?clean` full screen (H hides chrome). Space or the down arrow advances.

## Live order (rehearsed 11-01, 5 runs on a frozen stage server at 28c0c1d)
| # | Say | Result | p50 | p90 | Notes |
|---|---|---|---|---|---|
| 1 | "add a bouncing green slime" | 5/5 | 9.2 s | 9.9 s | |
| 2 | "make me huge" | 5/5 landed; **rejected then fixed 2/2 on a fresh world** | 9.2 s | 24.7 s | Needs the reset above. Proof of the claim: show the red card and the reason |
| 3 | "make a harder level" | 5/5 | instant | | level generator, no model call |
| 4 | "make this look like England" | 5/5 | instant | | place theme, no model call |
| 5 | "add a tank that shoots shells" | 5/5 | 13.9 s | 14.8 s | |
| 6 | "add a zombie that chases me" | 5/5 | 7.8 s | 8.7 s | |
| 7 | "double-check my world" | works | ~7-8 s per build | | Muse Spark Open (open weights) reviews each build in turn; with 4-5 builds expect ~30-40 s, so cut or speed it up. Probe 11-01: one run "fixed 1" (zombie had no health), one "fixed 0". The rehearse harness shows 180 s here because the sweep sends no end marker; that is the harness, not the product |
| 8 | "make it spooky" | 5/5 | 1.1 s repaint | 1.6 s | sprite redraw follows |
| 9 | Bring an object in (camera icon) | not rehearsed on a real photo | | | New 10-31: SAM 3.1's own mask is the cut (ADR 0081). Type the name (e.g. "calculator") for the most reliable take; plain background helps |
| 10 | Press **P** | | | | pipeline view, close |

The open-weights router (Baseten) timed out 3 times in 40 commands on 11-01; each time it fell back to hosted Spark after 4 s, so that command is ~4 s slower. Nothing breaks.

Rehearse this order yourself: `npm run rehearse -- --runs 3 --port 8796 --file rehearse-record.json` against a frozen stage server.

---

# Earlier plan: 3:00 live-only shot list (10-30, kept for reference)

Built from what the game does today. No slides: every beat is the live product, and the closing architecture beat is the in-app pipeline view (**P**). Judges stop watching at 3:00 exactly, so the plan ends at **2:50** and leaves 10 s of slack for one speed-up or one retake.

**Rules (from WINPLAN):** use real uncut runs; label any speed-up on screen ("⏩ 3×"); English; every model on screen is Meta. Upload to YouTube **unlisted** and set audience to **"No, it's not made for kids"** (a made-for-kids video can't be opened from the judges' link); record a backup take. Record Tue Nov 3. The commands below are in the rehearsed sets: `scripts/rehearse-demo.json` (the 8 demo commands, measured in [process/rehearsal-20x.md](process/rehearsal-20x.md)) and `scripts/rehearse-genre.json` (beat 8); run them with `npm run rehearse -- --runs 20 --file rehearse-demo.json`. The world-awareness set (unseen phrasings) is `scripts/rehearse-aware.json`, run with `--file rehearse-aware.json`. The owner's must-pass weapon lines (flamethrower, gun, stabbing sword, exploding boss) are `scripts/rehearse-weapons.json`, and the kid-safe screen is checked over all three sets with `npm run safety:rehearse`.

**Setup before recording:** fresh browser tab on the starter world (ninja + ground), orb bar visible, side panel collapsed (default), quick-action bar visible, microphone allowed, spend guard raised for the session (builds, images, voice), pipeline view closed. Beats run in order in one world. Set `BASETEN_API_KEY` in `.env` so beat 6 has an open-weights review to show (without it the game works, but that row is absent).

| # | Time | Beat | Say / do | Expected on screen | Meta model visible | Fallback / cut |
|---|---|---|---|---|---|---|
| 1 | 0:00–0:06 (6 s) | **Hook** | Voice-over only, over the starter world: "Every change you ask for becomes code, a test and art, and an agent proves it works before it goes live." | Ninja stands on ground, orb idle | none | none needed |
| 2 | 0:06–0:24 (18 s) | **Talk to build** | Hold **Shift**, say "add a bouncing green slime", release | Live partials under the orb, then the pipeline strip (route, forge, compile, playtest, live); a slime appears with the screen-rip portal and bounces while you keep moving | **Muse Voice Transcribe** (partials), **Spark** routes (Spark Open if the Baseten key is set), **Wonder** writes | If the mic misfires, type it, but do one short Shift voice turn before beat 10 so the Voice/text node is lit. **⏩ 2×** on the build wait if it passes 12 s (measured p50 8 s, p90 11 s) |
| 3 | 0:24–0:40 (16 s) | **Parallel builds** | Say "add a dragon, some coins, and make it rain" | Three cards build side by side; dragon sprite digitizes in then resolves; coins and rain land | **Wonder** (parallel agents), **Muse Image** (dragon art) | Spark splits it into three builds (batch wall time 6.5–14 s over 20 runs). **⏩ 2×** on the dragon art wait. Or load `?w=demo-bouncy` and narrate over it |
| 4 | 0:40–0:50 (10 s) | **It understands your world** | Say "make it so my character can double jump", then jump twice | A standalone ability mod loads (no NPC gets edited); ninja jumps again in mid-air with a cyan burst | **Spark**, **Wonder** | **SLOW (13–20 s live, p90 20 s): a cut point.** Hard cut from "building" to "live"; if shown, **⏩ 3×**. Fallback: "let me shoot fireballs" (p50 8 s). Never "give me a gun": it resolves locally |
| 5 | 0:50–1:22 (32 s) | **It can't break** | Say "make me huge" | Ghost playtest window appears; the bot cannot fit through a gap; card turns red with the reason; orb explains; Wonder fixes it as a tool-using agent; it lands and works | **Wonder agent** (`inspect_world`, `run_playtest`), verifier | 20/20 rejected-then-fixed in rehearsal (p50 13 s, p90 20 s). Cut the fix wait to the green landing with a **⏩ 2×** label. If a take lands first try, redo it |
| 6 | 1:22–1:34 (12 s) | **How was this made? + open weights** | Click the ninja, choose **How was this made?** (gold icon); scroll to the review row | One receipt: your words, Spark's route, Wonder's draft, *Rejected: too big to fit*, *Fixed itself*, proof rows ticking green, and the **Reviewed by Muse Spark Open (open weights)** step. Say: "An open-weights model reviews every finished build, and its fix only goes live if it passes the same checks." | **Muse Spark Open** (open weights, Baseten), no live call | Needs `BASETEN_API_KEY` set and the review finished (it runs in the background after the build lands; allow ~15 s after beat 5). The same line shows in the side panel as "Reviewed by Muse Spark Open". If no review row exists, show the orb line naming the router model instead, or skip to beat 7 |
| 7 | 1:34–1:52 (18 s) | **One sentence restyles the world** | Say "make it spooky" | Palette, fog, vignette change in ~1 s; sprites then redraw (**⏩ 3×** on the redraw wait); say "undo" at the end | **Spark** (designs the mood), **Muse Image** edit-from-anchor | Palette alone still reads; cut after 8 s. `demo:prep` pre-warms the art |
| 8 | 1:52–2:12 (20 s) | **Genre change** | Say "turn this into a 2d space shooter", fly and shoot a target, then "undo" | The terrain, tower and trees vanish, a space sky fills the screen, the ninja becomes a generated ship, targets appear and take hits; "undo" restores the platformer exactly ([ADR 0066](adr/0066-genre-change-set-scene.md)) | **Wonder** (calls `api.setScene`), **Muse Image** (ship skin) | **SLOW (build plus ship art): a cut point.** Hard cut or **⏩ 3×** over the ship-art wait. Not yet timed in the 20× set: rehearse with `npm run rehearse -- --runs 5 --file rehearse-genre.json`. If the ship art is late, the ninja flies first and the ship lands after; narrate over it |
| 9 | 2:12–2:30 (18 s) | **Your real stuff walks in** | Quick-action bar: **Bring an object in** (camera icon), type "coffee mug", hold a real mug to the webcam | Green box finds the mug, it is cut out, pixelated and drops in as a physics prop you can push | **SAM 3.1** | Click **Upload a photo instead** with a prepared mug photo |
| 10 | 2:30–2:42 (12 s) | **Architecture, live** | Press **P** | Pipeline view: Spark, Wonder agent with its tools, esbuild, verifier, SAM 3.1, with live telemetry and the stats panel (success rate, median time) | **Spark, Wonder, Muse Image, SAM 3.1, Voice Transcribe, Spark Open** | Narrate from `docs/evidence/build-stats.md` numbers over the pipeline view |
| 11 | 2:42–2:50 (8 s) | **Close** | Click **Share this world (copy link)**; voice-over: "Software that rewrites itself while you use it, and every change is playtested by agents before it goes live." | Link copied toast, world still running | none | none needed |

Total planned: 170 s (2:50). Slack: 10 s. Every command above is in a rehearsed set; type nothing that was not rehearsed.

**Speed-up and cut plan.** Only waits get compressed, and each speed-up carries a visible "⏩ N×" label: beat 2 (build wait), beat 3 (dragon art), beat 5 (fix wait), beat 7 (sprite redraw), beat 8 (ship art). Hard cuts are fine at the two slow builds: beat 4 (double jump, 13–20 s live) and beat 8. If the edit runs long, drop beat 9 (camera, 18 s) first, then beat 3.

## Optional beats (new 10-30/31)

Two candidate swaps built 10-30/31 that demonstrate the deterministic generator and place backdrops ([ADR 0073](adr/0073-generated-levels.md)). Note: these are not yet in a rehearsed set.

- **"make a harder level"** (level generator): Replaces flat starter ground with a multi-height obstacle course containing pits, ledges, spikes, patrolling walkers, coins, checkpoints, and a goal flag in under a second (`api.buildLevel`). Candidate swap for beat 4 or beat 8.
- **"make this look like England"** (place theme): Deterministic themed parallax backdrop swapping sky, hills, architecture (clocktower, phonebox), and flag with no model call. Candidate swap for beat 7 or alongside mood restyling.

## Measured on the live server (bead ki5, 3 runs each)
| Beat | Command | Pass | p50 | p90 | Notes |
|---|---|---|---|---|---|
| 2 | add a bouncing green slime | 3/3 | 10.9 s | 25.1 s | text path; voice not measured here |
| 3 | add a dragon, some coins, and make it rain | 3/3 | batch 10 s (10, 10, 20) | 20 s | 3 parallel builds each time |
| 4 | make it so my character can double jump | 3/3 | 14.7 s | 16.6 s | |
| 5 | make me huge | 3/3 rejected then fixed | 22.6 s | 33.2 s | rejection seen every run |
| 6 | make it spooky | 3/3 | 0.9 s to repaint | 1.1 s | palette only; the Muse Image redraw of sprites is separate, 20-30 s |

The harness reported 180 s for the old beat 3 because the server sent no end marker for the whole compound command. `server/index.ts` now sends one (not re-run live, the build cap was reached). The camera, architecture and close beats are not covered by the rehearse set.

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
- **The receipt beat (ADR 0065) is beat 6.** Right after beat 5 lands, click the ninja and choose **How was this made?** (gold icon). One panel shows "make me huge" → Spark → Wonder's draft → *Rejected: too big to fit through the gap* → *Fixed itself* → the proof rows ticking green → the Muse Image sheet beside its cut-out → the time bar. It is the "technology, not a game" argument in about 8 s, with no model call and nothing that can fail live. It doubles as the open-weights beat.
- **Impact numbers:** the claim "non-coders build games in minutes" needs the non-coder test (WINPLAN item 4) clips and numbers; none are in this draft. Beat 10 is the place to cut to them if you have them (cost: about 10 s of the slack).
- **Open-weights beat:** beat 6 shows the Muse Spark Open review on the receipt (ADR 0068). It is the only place the draft claims it on screen; the router use (ADR 0032) shows in the orb's model line.
- **Risk ranking (rehearse most):** beat 5 (needs a real rejection on camera), beat 8 (genre change, not yet timed), beat 6 (the review must have finished), beat 3 (three parallel builds), beat 9 (webcam lighting).
- **Not in the cut (cut for time):** radial menu and 👍/👎 teaching, camera-free demos, stairs, snow, daytime, themed backdrops, "build a volcano".
- **Check before recording:** run `npm run safety:rehearse` first (SAFETY on; one Spark call per sentence, about 23, and it exits 1 if any demo line would be declined), then `npm run rehearse -- --runs 20` (demo set) and `npm run rehearse -- --runs 5 --file rehearse-aware.json` against the live server; fix flakiness only.

**Recording tip:** open the game with `?nocoach` so the first-run coach does not cover the stage (or show it on purpose for the non-coder beat).
