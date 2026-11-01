# ADR 0081: Bring an object in = SAM finds it, the client cuts it at full resolution, one button

- **Status:** Proposed
- **Date:** 2026-10-31
- **Supersedes:** the client colour-key / flood-fill cut-out choice in ADR 0007, for the "Bring an object in" path only.

## Context

The owner's live retest of the object importer still failed: the green selection spilled over the wall and
the keyboard behind the object, "too much (over 60%)" disabled the button, and the dialog had too many
buttons (Capture, Upload, Empty background, Find object, Sensitivity, ...). The expected flow is: hold
something up, press Capture, the AI snaps it out, it appears in the game.

Two causes: the cut was made from a 384 px colour clustering or a border flood-fill (both leak when the object
and wall are alike), and the 768 px work copy was upscaled to the sprite.

SAM 3.1 documents a per-instance mask (`metadata.mask_encoding: "one_bit"`, decoded by Meta's
`@meta-sam/parser`). The owner approved installing it as a server dependency after its licence was read (Meta's
SAM License: royalty-free use, copy and redistribution under the same licence; no reverse-engineering of the
materials, so the package internals are not read or reimplemented here).

## Decision

- **SAM's mask is primary.** The server requests `metadata: { mask_encoding: "one_bit" }`, parses the reply
  with `@meta-sam/parser` and decodes each mask with `decodeMaskToRaster`; of the plausible-size instances the
  most confident (`c=`) wins. `photoFind`'s `segment` message gains two additive optional fields: `name` (the
  Spark noun that found the box) and `mask` (`SamMask`: the raster's size, its origin and the source photo
  size, as run lengths). Nothing is removed or retyped; old clients ignore both. `@meta-sam/parser@0.1.0` is
  pinned exactly.
- **The client finishes the edge at the photo's own resolution.** It keeps the photo at up to 2048 px beside
  the 768 px copy that travels to SAM. SAM's mask (at 768 px) is only the coarse answer: `src/client/cutout.ts`
  (pure, no DOM, unit-tested) places it at the box origin and decides only a thin band around its boundary
  again, from the full-resolution pixels, so the edge is never an upscaled work-size edge. When SAM sends no
  mask (or it fails to decode) the same module falls back to a GrabCut-style min-cut inside SAM's box.
- **Edge pipeline, in order:** cut at full res -> fill holes, drop stray islands (largest blob) -> 1 px erode
  -> crop to the object -> downscale in halving steps -> Pixel-art style: alpha thresholded at 50%;
  otherwise a 1 px feather. No chroma key, no colour flood-fill, no outline or dilation hides the edge.
- **The sprite is that cut.** The game texture is built from the same cut that the preview shows; there is no
  second cut at build time. The built object's title is the Spark name (or what the player typed), not
  "Object (photo)".
- **One button.** After Capture or Upload the finder runs at once, the preview shows the cut-out, and the one
  primary "Bring it into the game" button is enabled. No auto-bring countdown: the player sees the cut first.
  Empty background, Find object (AI) and Sensitivity move into an "Adjust" disclosure; clicking the photo
  there (hand selection, flood fill) replaces the AI cut. They are the fallback when SAM finds nothing.

## Consequences

- No new wire message. `segment` is additive.
- `cutInBox` (box-only GrabCut) stays as the fallback. Measured on the committed fixtures it loses a thin
  light rim on the mug at a large photo size where SAM's mask keeps it, which is why the mask is primary.
- A hole inside the mask is kept open only when it looks like the background around the object (a handle);
  an enclosed region of another colour (coffee in the mug) is filled.
- One new runtime dependency (Meta's own package) and one extra server-side parse per SAM call.
- A tan object on a beige wall still has a soft spot where the two colours truly match; see
  `docs/evidence/samask/`.
- Every runtime AI call remains Meta: SAM 3.1 finds, Spark names. The cut itself is local compute.
