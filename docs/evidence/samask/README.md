# samask evidence (ADR 0081)

Person-free inputs only: the committed drawn fixtures `tests/fixtures/mug-photo.png` and `toy-desk-photo.png`
(the toy photo has an illustrated hand, not a real person), plus one synthetic recolour of the mug (tan on beige).
SAM boxes and Spark names are the live server's real answers; "before" is the border flood fill from main's
`cutoutTexture` (run on the 768 px work copy), "after" is `src/client/cutout.ts` at the photo's own size.

- `*-edge-3x-*`: 3x zoom of the left edge, before | after.
- `*-whole-photo-before-vs-after.png`: the whole cut, before | after.
- `*-game-sprite-6x-*`: the 56-row pixel-art sprite as the game builds it, before (left) | after (right).
- `live-*.jpg`: the real dialog and game on the worktree server (Upload a photo, no webcam).

Where it is still imperfect: the fixtures are 480x360, so the full-resolution advantage is not exercised here;
the tan-on-beige mug is synthetic and the cut keeps the lit rim but the box-guided min-cut can still clip a
sliver where object and wall are the same colour; the mask comes from a classical cut guided by SAM's box, not
SAM's own mask (its encoding needs Meta's parser, not yet approved).
