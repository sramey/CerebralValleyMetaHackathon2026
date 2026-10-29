# ADR 0017: World mood ("make it spooky") restyles code art and every AI sprite

- **Status:** Draft
- **Date:** 2026-10-29
- **Amends:** ADR 0015 (fx layer gains a mood overlay), ADR 0009 (sprite sheets can be edited after creation)

## Context

Demo beat 2:00-2:20 is one sentence that changes the look of the whole world. Until now every build was a single new thing; nothing restyled what already existed.

## Decision

1. **A mood is an anchor plus a palette (`MoodSpec` in `src/contract.ts`).** The anchor is one plain-words sentence of style; the palette covers sky gradient, ridges, moon, stars, ground edge and soil, a color wash, brightness, fog, vignette and an ambient effect (`fog`, `snow`, `embers`, `sparks`). The same anchor drives everything visible.
2. **Spark routes it as a new `mood` action** in the router call it already makes (no extra hop for routing). `server/mood.ts` has hand-tuned presets for spooky, snowy and neon (with aliases such as scary, winter, cyberpunk); any other word goes to one Spark call that designs the `MoodSpec` as JSON, validated and clamped by `parseMoodSpec`, with the spooky palette as the fallback. A regex safety net turns "make it spooky" mis-routed as a new build into a mood.
3. **Code-drawn things get a palette swap on the client.** `grade()` washes any color toward the mood tint and dims it; the ground, ridges, sky, moon, stars, cliffs and entity colors all go through it. `fx.ts` adds the tint wash, vignette and ambient drift on top. Render-only, so `src/sim` is untouched and determinism holds.
4. **AI sprites are restyled with Muse Image EDIT.** The client sends `{kind:"restyle", mood, keys}` listing only the sprite sheets some entity in the world actually uses. The server edits each one (`POST /v1/images/edits`, `muse-image-1.0`, multipart webp + the anchor prompt) with at most 6 in flight, always from the ORIGINAL sheet so characters stay recognizable and a second mood never compounds on the first. Results cache on disk as `public/art/gen/<key>--<mood>.webp` and are sent back one by one as `restyled`; the client plays the digitize effect for each, then swaps the frames. The keys come from the client, so the server only honors keys that resolve to a real sheet through `sheetPath` (`^[a-z0-9-]{1,64}$`, no photos, no `--`).
5. **Every edit counts against the spend guard as one `image`** (cached files are free). A mood costs about one image per sprite in the world.
6. **Undo restores everything.** The mood card has its own Undo; bare "undo" reverts the mood when it is the latest change (no mod added since), otherwise it removes the last mod as before. The client keeps the original frames and puts them back, and clears the palette and overlay.
7. The mood is session state only: it is not saved into shared worlds.

## Consequences

- Measured live in a world with 4 AI sprites: palette, sky, fog and vignette change about 3 s after the command; all four sheets are swapped in about 27 s (edits take 12-21 s each, run in parallel).
- The default per-IP image allowance (8 per day) fits one mood in a small world and not repeated moods; recommend raising it (about 20) for the demo.
- The chicken sheet's edit returns HTTP 400 intermittently, so a failed edit leaves that sprite as it was (the client is told `url: null` and the mood still completes).
- Sheets edited by the model can drift slightly in frame size or layout; the original is kept so undo is exact.

## Alternatives considered

- **Pure CSS filter on the canvas:** instant and free, but it is a tint, not a restyle; the demo needs the characters themselves to change.
- **Regenerate each sprite from scratch with the mood:** costs the same and loses the characters' identity; edit-from-original keeps them.
- **Chaining each mood from the previous restyle:** drifts away from the original and would make undo inexact.
