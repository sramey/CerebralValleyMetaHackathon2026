# ADR 0010: Camera object prototype — SAM box + client flood-fill cutout, template mod

- **Status:** Draft
- **Date:** 2026-10-28

## Context

DESIGN's webcam stretch goal is "hold an object up to the camera, it enters the game". SAM 3.1 was probed live: `POST /v1/responses` with `model: sam-3.1` answers in ~1.2s with a box (`x1,y1,x2,y2` in a 1600 coordinate space) plus a mask body of `<h>,<w>,` followed by a base94-range RLE string we have not decoded. Arbitrary photo backgrounds defeat chroma-key, which only works on the flat magenta of generated sheets (ADR 0007).

## Decision

Prototype: SAM gives the box, and the client does a border flood-fill cutout inside that box. The photo becomes a template mod — not Wonder-written — spawning one physics prop whose sprite is the client-cut photo texture. Decoding the SAM mask is deferred.

## Consequences

- Cutout quality depends on background contrast: flood-fill leaks where the object touches the border or matches the background.
- SAM gives one object per prompt, so one photo yields one prop.
- The photo texture lives client-side only, so the mod is decorative without its capturing client — other clients see the placeholder color, not the object.

## Alternatives considered

- **Decode the mask first:** unknown effort, blocks the loop; the box is already proven live.
- **Rectangular photo sprite with no cutout:** ugly — the whole photo rectangle, background included, floats in the world.
- **Wonder writes a custom mod per photo:** slow and unnecessary for a prop; the template already covers size, physics, and the hop.

## Amendment 2026-10-28 (still Draft): find-then-bring, click fallback, pixel-art imports

Live use showed the blind one-shot flow failing ("couldn't spot that") with no feedback. The flow is now: capture → `photoFind` (SAM, with prompt retries: full label → last word → "object") → the client draws a GREEN BOX on the preview showing exactly what will enter → `photoBring` builds the mod. If SAM misses, clicking the object in the preview cuts locally around the click (`photoBringLocal`, no SAM). Imports are pixel-art converted by default (56-row grid, posterized palette, nearest-neighbor; checkbox to disable) so photos match the game's art and flood-fill fringe is less visible.

Mask research status: the body after `<h>,<w>,` uses an ~87-char alphabet that excludes the wire format's own delimiters (`";<>\,|`). Tested and rejected: Python base85/a85, base-94 numeric (charcode and rank alphabets), zlib/raw-deflate on all candidates, single/pair RLE count sums (land ~1.8–2× mask area). Likely a proprietary varint+compression scheme; decoding remains the path to exact cutouts and is deferred, not abandoned.
