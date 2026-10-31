# ADR 0080: A landmark's art is one picture of the whole subject

- **Status:** Proposed
- **Date:** 2026-10-31

## Context

"Add a mountain" produced three visible faults:
1. The art order was the creature-style 4-pose sheet (or the 4-variant scenery sheet), so Muse Image drew four different mountains side by side.
2. The client cut that sheet into 4 frames, kept one small frame (about 230 of 1600 px) and stretched it to the 560x320 entity box: huge pixels, a thick outline, and the "walk" frames cycled between different mountains.
3. The parallax pass (`parallaxFactorOf`) treats any type containing "mountain" or "volcano" as a distant background layer, so it also drew a smooth grey silhouette, scrolling at 0.22x, next to the real art.

## Decision

- **One picture.** `isLandmarkSubject` (`src/ontology.ts`, whole words: mountain, volcano, castle, pyramid, tower, ...) marks landmark subjects. `planArtOrders` gives them `frames: 1` (creatures keep 4) and `scenery: true` (never flying). `spritePrompt` has a landmark form that asks for exactly one subject, no sheet, no variants.
- **Single frame on the client.** `loadSpriteSheet(url, key)` slices a landmark key with a target of one subject and keeps only the largest (`pickLandmarkBounds`), so an older cached multi-subject sheet shows its biggest, most complete subject, not animated.
- **Draw it right.** `fitSetPieceSprite` scales the picture uniformly into the entity box (no stretch), centered and standing on the box bottom. The code-drawn placeholder shows only while there are no frames (`showsPlaceholder`) and returns if the art is lost.
- **No double draw.** A set-piece entity is excluded from the parallax pass unless its type is explicitly a backdrop layer (`parallax`, `bg-`, `far-`, `distant-`, `-bg`) or it sets `data.parallax` / `data.depth`.

## Consequences

- `ArtOrder` gains a `frames` field; no wire-protocol change. Cached creature and prop sheets are unaffected.
- Static scenery props that are not landmarks (a chest, a tree) still get the 4-variant scenery sheet; moving them to one picture is a separate decision.
- A landmark whose cached sheet holds four mountains is regenerated only when someone clears that key; until then it shows the largest one.
