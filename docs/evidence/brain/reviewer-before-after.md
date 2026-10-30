# Reviewer replay: before and after the checklist prompt (bead 4t7)

`npx tsx scripts/replay-review.ts --which before|after --n 30` replays the last 30 distinct mods
from the build log through Muse Spark Open, then runs each patch through the same compile,
verify and playtest gates as `server/reviewer.ts`. Same mods, same token budget (5000).

| prompt | mods | fixes found | passed all gates | notes |
|---|---|---|---|---|
| before (ADR 0068 list) | 30 | 8 | 7 | mostly "x off-screen" false alarms (the world scrolls) |
| after (checklist + 3 worked pairs + engine facts) | 30 | 11 | 10 | volcano and space-flight drawn as shapes, solid landmark, dispose leaking or deleting generic types, hostiles with no health |

A first draft of the checklist told the model to look for knob-object NaN; it found 19 "fixes" of which
about 8 were false (setup receives plain numbers), so the prompt now states that as an engine fact.
Results vary a little run to run. Live builds with the new prompt produced two accepted fixes
(`brain-real-fix-cards.jpg`).
