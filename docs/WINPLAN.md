# Win plan (set 2026-10-29)

**Deadline:** Wed Nov 4, 9:00 PM ET. We submit by **3 PM**. Recording is **Tue Nov 3**. Feature freeze **Mon Nov 2, 10 PM**.

## What wins
Rubric: Impact 30 · Meta tooling 25 · Depth 20 · Demo 25. Category risk: "AI makes a game" is crowded. We win on what others won't have:
1. **You talk, it builds while you play.** Voice is the core claim and isn't built yet.
2. **It can't break.** Every change is playtested by agents before it goes live, and *you can see it happen* (ghost playtest, rejected-then-fixed). This is the differentiator.
3. **Your real stuff walks in.** Camera import (SAM 3.1). Already works; this is the viral clip.
4. **Five Meta models doing real jobs, live:** Spark routes, Wonder writes and fixes, Image draws, SAM cuts out, Transcribe listens.
5. **Impact evidence:** non-coders building games in minutes, with numbers (build success rate, time to first game).

## Must ship (in order)
| # | Item | Moves | Owner / day |
|---|---|---|---|
| 1 | Voice hold-to-talk (Muse Voice Transcribe, live partials under the orb) (**done**) | Demo, Meta tooling | done |
| 2 | Visible verifier: ghost playtest window + "can you still play?" bot + rejected→auto-fixed beat with the orb explaining | Depth, Demo | bottom · Thu–Fri |
| 3 | Deploy-ready server, share links, spend guard, visitor mode (**done**). Public hosting is **optional** per CV (10-29); only if time allows for the X post / Community vote | Impact | done |
| 3b | Judge-ready repo: README quickstart with your own Meta key, built-during-event section (kickoff ended Oct 26 12:24 PM ET), sanitized live-demo evidence, fresh-clone test | Required | Sun–Mon |
| 4 | Non-coder test: 3–5 people, 15 min each; capture clips and numbers | Impact | Sun |
| 5 | "Make it spooky" world restyle | Demo | Sun if time |
| 6 | Rehearse the 8 demo commands 20× each; fix flakiness only | Demo | Mon–Tue |

**Meta everywhere (owner, 2026-10-29):** every in-game AI call is a Meta model or agent. Look for real jobs for more of the stack: Wonder as a true agent (tool calls into the verifier/playtest, sub-agents for parallel builds) targets Best Agentic; Muse Image edit-from-anchor for restyle targets Best Creative.

**Cut:** endless generator, art verifier, wake word, parallel-build visuals beyond what exists.

## Viral (bonus clock runs to Nov 8)
Post a camera-import clip on X **now**, a voice clip when voice lands, the "it can't break" clip Fri/Sat, and the final video Wed.

## Numbers we already have (logs/builds.jsonl, through 10-28)
78 AI builds → 74 landed (95%), median 9.4 s, p90 26.5 s, 9 saved by auto-fix. The 4 failures were all big asks (boss arena, card upgrades).

## Judging facts (CV office hours, 2026-10-29)
Judges review the repo, the 3-minute video and the live product; a hosted version is optional. They run the integration with their own key, so the README setup must work cold. Building started when kickoff ended, Oct 26 12:24 PM ET. Keep keys out of the repo.
