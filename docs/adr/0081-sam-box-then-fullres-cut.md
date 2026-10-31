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
`@meta-sam/parser`). Reading that payload needs the vendor decoder, whose licence and install the owner has
not yet approved, so this change does not decode it (see Consequences).

## Decision

- **The server stays the finder.** `photoFind` still returns SAM's box (and Spark's name when the player left
  the name blank). The `segment` message gains one additive optional field, `name` (the Spark noun that found
  the box). No field is removed or retyped; old clients ignore it.
- **The client cuts at the photo's own resolution.** It keeps the photo at up to 2048 px beside the 768 px
  copy that travels to SAM. `src/client/cutout.ts` (pure, no DOM, unit-tested) cuts inside the SAM box:
  GrabCut-style two-colour-model min-cut on a small working copy, then a band refinement against the full-res
  pixels, so the edge is decided at full resolution and never upscaled from the work size.
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

- No new wire message and no new dependency. `segment` is additive.
- `cutInBox` is a deterministic classical cut guided by SAM's box; it is the fallback while SAM's own mask is
  not decoded. When `@meta-sam/parser` is approved, the decoded mask drops in through `placeMask` in
  `cutout.ts` (it exists for that) and replaces `cutInBox`; the finishing pipeline, preview and build are unchanged.
- A tan object on a beige wall still has a soft spot where the two colours truly match; see
  `docs/evidence/samask/`.
- Every runtime AI call remains Meta: SAM 3.1 finds, Spark names. The cut itself is local compute.
