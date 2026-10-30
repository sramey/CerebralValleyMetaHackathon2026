# ADR 0067: Themed parallax backdrops ("change the background to medieval")

- **Status:** Accepted
- **Date:** 2026-10-30
- **Amends:** ADR 0017 (a mood can carry a backdrop and be scoped to the background)
- **Related:** ADR 0066 (a genre scene's own backdrop, such as space, outranks this one: while it is on, the themed backdrop is hidden with the rest of the scenery)

## Context
"Change the background to medieval parallax background" or "change the background to be in an Indiana farm" did nothing useful. No mood regex matched ("to" was not in the pattern), so Spark routed it as a `mood` or a `new` build. As a mood it only recoloured the same starter scenery (pines, oak trees, lamp posts and one castle). As a build Wonder spawned `parallax-*` entities, but the parallax renderer only knows mountains, hills, pine treelines and clouds, so a "parallax-castle" was drawn as a hill. As a mood it also sent every AI sprite to Muse Image for a restyle, which costs images the player never asked for. The parallax mod's own silhouettes clashed with whatever the theme was.

## Decision
A backdrop is part of a mood. `MoodSpec` gains an optional `backdrop` (type `ThemedBackdrop`, separate from ADR 0066's `SceneState.backdrop` sky name) (skyline `mountains | hills | flat`, a `landmark`, and motif lists for the far, mid and near bands) and `scope: "background"`.

- **Vocabulary, not free drawing.** The client paints the backdrop from a fixed list of 27 code-drawn motifs (`BACKDROP_MOTIFS`: castle, village, church, windmill, barn, silo, corn, haybale, city, pyramid, torch, banner and so on). Each motif sits in the same fogged band style as the starter scenery and is rim-lit at night. The landmark stands every 12 far cells, and the first one is just right of the spawn.
- **Presets first, then Spark.** `medieval`, `farm`, `desert` and `city` are hand-tuned. Aliases include misspellings ("medevil") and Midwest states ("indiana farm" → farm). A mood word plus a place ("spooky castle") uses the mood's palette with the place's scenery. Any other place goes to the Spark call that already designs mood palettes. Its prompt now asks for an optional `backdrop` using only the listed motifs, and `parseBackdrop` drops anything unknown, both from Spark and from saved worlds.
- **Routing.** `detectBackdropCommand` recognizes "change/set/make the background|scenery|setting … X" and "X (parallax) background". `detectMoodCommand` returns its words, so the compound and mood safety nets see it. A backdrop ask is answered in `handleSingle` before the router call. A route rule also forces it to `mood` if Spark sees it (for example, through a compound). "Add a castle in the background" stays a build.
- **Background scope.** When the ask names only the background, sprites are not restyled (no Muse Image spend; the server refuses restyle requests too). The colour wash is capped at 0.1, so characters keep their colours. Undo, time travel, share links and HTML export carry the backdrop because they already carry the mood.
- While a backdrop is on, it replaces the starter scenery and a parallax mod's silhouettes. The mod's clouds still drift. A `flat` skyline hides the distant mountains and flattens the ridges.

## Consequences
- The two sample sentences work offline and in under a second. Unknown places cost one Spark call, the same as an unknown mood today.
- The look is limited to the motif vocabulary. A theme with no fitting motif gets its palette with the default scenery. New motifs are a few lines each in `src/client/scenery.ts` plus one name in the list.
- A background ask replaces a whole-world mood that is already on (one mood at a time), and the restyled sprites go back to their originals.
- Painted panoramas are a possible next step: Muse Image could draw each band as a wide magenta-keyed strip, swapped in over the code-drawn one like a sprite restyle. That would use more of Meta's stack, at about three images per background.

## Alternatives considered
- **Muse Image panoramas only.** These would be the most general and the richest, but each background would take 15–20 s and three images. Seamless tiling and chroma-keying a landscape are unproven here, and nothing would show until they arrived. Code-drawn first leaves room to add panoramas later.
- **Let Wonder write a backdrop mod.** That path exists today and fails: the renderer can't draw the entity types Wonder invents, and a build takes 10–20 s for something that has no gameplay.
- **Free-form Spark drawing instructions (shapes and coordinates).** Too easy to produce mush or overdraw, and hard to validate. A closed vocabulary is safe and always looks finished.
