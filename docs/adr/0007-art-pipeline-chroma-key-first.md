# ADR 0007: Art pipeline — Image sheet, chroma-key slicing first, SAM as validator

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-27

## Context

DESIGN §4 prescribes: Muse Image generates one sprite sheet per character on flat magenta, SAM 3.1 segments it, frames are normalized, an art verifier checks them, and they hot-load. Probed live on 2026-10-27 (`scripts/art-sheet.ts`):

- `POST /v1/images/generations` with `model: muse-image-1.0` returns WebP as `b64_json` in ~8s. Quality is high: one consistent ninja, 4 poses (idle/run/run/jump), clean dark outlines, pure magenta background.
- `POST /v1/responses` with `model: sam-3.1` + image returns in ~1.2s: output text contains a box (`x1,y1,x2,y2` in a 1600px space) and a **mask in a custom encoded string format we have not yet decoded**.
- The flat magenta background makes SAM unnecessary for cutout on generated sheets: chroma-keying + column-projection slicing in the browser reliably extracts frames (required a >5-column gap threshold; at >12 two run poses merged into one frame).

## Decision

Ship the path that is proven: the client loads the sheet, chroma-keys magenta to alpha, slices frames by empty columns, trims, and builds Pixi textures (`src/client/sprites.ts`). The player renders as an animated sprite (idle/run-cycle/jump by entity state, flipped by facing) with the code-drawn character as fallback. SAM's role for now is subject localization/validation during sheet generation (`scripts/art-sheet.ts` probes it), not pixel cutout.

## Consequences

- A real AI-generated, animated character is in-game today; the art go/no-go passes.
- Sheets must be requested on flat magenta — that constraint is baked into the generation prompt.
- SAM mask decoding remains an open research item. It becomes load-bearing for the webcam stretch goal (arbitrary backgrounds), where chroma-key cannot work; budget time to decode the mask format or consume boxes only before attempting that feature.
- The shipped ninja sheet is a pre-generated static asset (`public/art/ninja-sheet.webp`) produced by this pipeline during the event. Runtime per-request generation belongs in the server when mods learn to request sprites.

## Alternatives considered

- **Block on decoding SAM masks before any art:** delays the visual payoff by an unknown research task when a simpler, reliable cutout exists for generated sheets.
- **Server-side image processing (add a native image lib):** more moving parts; the browser already decodes WebP and Canvas2D does the keying in milliseconds.
- **Skip generated art, keep improving code-drawn shapes:** rejected by the probe evidence — generated quality is far beyond code-drawn at equal effort, and it carries the Best Creative rubric surface.
