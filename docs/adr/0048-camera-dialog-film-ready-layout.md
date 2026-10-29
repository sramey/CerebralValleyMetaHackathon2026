# ADR 0048: A film-ready camera dialog, and upload as the default door

- **Status:** Draft
- **Date:** 2026-10-29

## Context
The camera-import beat ("hold a mug up, it walks into the game") was built for the spike and never survived a take. Three faults showed up the moment a real webcam started:
1. `#camera-video` was sized by its content (`max-height: 46vh`, no reserved box), so a `<video>` with no stream was 0 px tall. The stream starting added ~300 px to a `92vh` scrolling card: everything below the video — the label field, the buttons — slid down mid-take, and clicks landed where a control had been a moment earlier.
2. The captured still appeared in a second box (`#camera-preview-wrap`, `max-height: 40vh`) *below* the video, growing the card again, and only then did the green cut box, the status line and the "Bring it into the game" button appear, each adding another row.
3. Opening the dialog called `navigator.mediaDevices.getUserMedia` immediately. That made the beat impossible to test without a webcam (and untestable for a headless worker: a person's face on screen is not something a worker may do), so nothing ever checked the layout above.

## Decision
1. **The dialog is a fixed grid of seven rows.** Stage, label, options, actions, status, confirm have explicit px heights; status and the bring button are always in the flow (a status message can never push the button down, a button that is not ready is `disabled`, not `hidden`). The numbers live in `src/client/camera-dialog.ts` and reach the CSS as custom properties, so the stylesheet and the model cannot drift; `tests/camera-dialog.test.ts` asserts the card fits 1920x854 and 1280x720 in all three phases and that the label lands on the same y in each.
2. **The stage box is reserved before any stream exists.** It is `44%` of the viewport height, clamped to 168–340 px, with the video `object-fit: contain` inside it, so the live stream, the placeholder and the captured still all occupy the same box. The still is sized to the exact fit (`fitInside`) so the green cut box, positioned in percentages of the picture, still lines up with the pointer.
3. **Upload is the default door.** Opening the dialog never touches a camera; "Upload a photo" is the primary button and the label field takes focus. `getUserMedia` is reachable from exactly one control ("Use camera") and `wantsCameraStream()` is the only place that decides. The capture/upload still travels as `photoFind` → `photoBring`/`photoBringLocal`, unchanged: no wire change.
4. **A committed prop photo** (`tests/fixtures/mug-photo.png`, a drawn mug on a plain table, no people) is the upload the layout, cutout and live-path checks use. `scripts/make-mug-fixture.ts` regenerates it byte-for-byte from a seeded LCG, so it is reproducible and reviewable without touching a camera.

## Consequences
- The take is safe: the card is provably shorter than both demo viewports, and nothing below the stage moves when the stream starts, when a photo lands, or when a status line appears. Measured in Chrome: 613 px tall at 1280x720, 636 px at 1920x854, identical in every phase.
- The beat costs one extra click for the live webcam moment ("Use camera"), which is also the consent moment: nothing turns a camera on unasked.
- The stage is a *reserved* area, so the dialog is as tall with nothing in it as with a running stream: a little black on open, in exchange for never shifting.
- Row heights are constants tied to the shipped font sizes. A larger type scale needs `DIALOG_METRICS` updated with the CSS, and the test then says so.
- The upload path is the one a worker can exercise: one SAM call on the mug fixture builds and verifies a prop end to end.

## Alternatives considered
- **Keep the video in the normal flow with a CSS aspect ratio.** `aspect-ratio` on `<video>` still resolves from the loaded metadata; before the stream there is nothing to reserve, which is the bug itself.
- **Let the card scroll instead of fitting it.** `overflow-y: auto` on a `92vh` card hides the growth instead of fixing it: the take still moves under the pointer, and a scrollbar changes the card's width mid-click.
- **Keep auto-starting the camera and pass a `?upload` flag for tests.** Two code paths, and the one the demo uses stays unchecked. Making upload the default means the checked path *is* the demo path.
- **Hide the status line and the bring button until they are relevant** (the old behaviour): that is what grew the card. Reserving both is one row of black in exchange for a still layout.
- **Photograph a real mug for the fixture.** The repo is public and workers must not capture a real scene; a drawn PNG is reproducible, tiny, and has a background flat enough to exercise the cut.
