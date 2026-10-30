# 0054 — Bounded sketch build: compact image, hard vision ceiling, deterministic fallback

- **Status:** Draft
- **Date:** 2026-10-29

## Context

Draw-to-build (ADR 0026) is the one feature in the demo a child cannot retry by talking:
they draw a level by hand, press **Done**, and if the build does not land the drawing is
lost. In a live playtest it was lost. The overlay sat on "Reading your sketch..." until its
60 s watchdog fired, then showed "No answer from the builder".

Three causes stacked up:

1. **The wire payload was a screenshot.** The client sent
   `canvas.toDataURL("image/png")` of the full sketch canvas — 1920x1080 and up, reported at
   2–3.5 MB of base64 in the playtest. Upload and vision time both scale with that.
2. **Nothing in the pipeline was bounded.** `runSketchBuild` asked Wonder up to twice with
   no timeout at all. One slow reply (35 s) plus a retry (35 s) is already past any client
   watchdog, and the second ask was unconditional — it could not help.
3. **The fallback was starved, not missing.** `levelFromStrokes` already compiles the exact
   drawn stroke boxes into a verified level in ~5 ms and needs no model. But it only ran
   after `await deps.ask(...)` settled, so a hung call meant it never ran.
4. **Give-ups were silent.** A build that failed inside `runSketchBuild`, a budget denial,
   or a thrown error updated the orb with text but never sent the `stage: "failed"` message
   the overlay listens for, so the overlay could only learn about it from its watchdog.

## Decision

The sketch build is **bounded and always terminates**, and the deterministic path is a
first-class outcome rather than a last resort.

1. **The image that travels is compact.** `src/client/sketch-image.ts` redraws the sketch
   into an offscreen canvas at most `SKETCH_MAX_EDGE = 720` px on the long edge and encodes
   `image/jpeg` at `0.75`. Both are exported constants. Measured in a real browser with the
   overlay's artwork (1920x1080, 40 strokes): the raw PNG was 306 KB and the compact image is
   20 KB at 720x405, still legible enough for Wonder to return a usable level on the first
   call. The stroke boxes and the world `view` rect still travel unchanged and are still what
   the level is built from, so the pixels never decide geometry — the image only answers
   "what does this mark mean". The server's `sanitizeSketch` cap drops from 4M to
   `MAX_SKETCH_IMAGE_CHARS = 1.5M` base64 characters, which a compact sketch always fits and a
   raw screenshot never does. The wire field stays `image: string` (a data URL), so the
   protocol is unchanged.

2. **Every model call has a hard ceiling.** `askWithin` in `server/sketch.ts` races the call
   against a timer and aborts it with an `AbortSignal`, so a dependency that ignores the
   signal — or a socket that never answers — still cannot hold the build. `SketchDeps.ask`
   gained an optional second argument (the signal); existing stubs and callers stay valid.
   Defaults (`SKETCH_LIMITS`): **15 s per vision call, 18 s for the whole reading phase,
   8 s for the post-verification fix call, 25 s for all model work on one sketch.** A second
   reading try only starts if at least `retryMinMs` (4 s) of the reading phase is left.

3. **The stroke-box fallback runs as soon as the model cannot deliver.** A timeout, an
   error, an unusable reply, or a budget that cannot hold another try all go straight to
   `levelFromStrokes(strokes, hint)` and compile that. No fix call is spent on a fallback
   level: the model never saw the geometry it would be asked to fix, and the boxes are
   already what the player drew.

4. **The pipeline always ends with a terminal message.** `runSketchBuild` emits
   `stage: "failed"` on every give-up (bad payload, unusable sketch, verification failure),
   and `handleSketchMessage` sends the same stage on a budget/key denial and on a thrown
   error instead of returning silently. The overlay therefore leaves "building" the moment
   the server knows, and the player keeps their strokes and can press Done again.

5. **The client watchdog is a dead-server guard only.** `SKETCH_WATCHDOG_MS` drops from
   60 s to 30 s: comfortably above the server's 25 s ceiling, well under the minute a player
   will sit through. It is no longer part of normal failure handling.

## Consequences

- **Normal path:** one vision call over ~20 KB instead of the raw PNG, one verify, hot-load.
  Measured here with the real server: 4.9 s from socket send to hot-loaded mod, where the
  same drawing used to time out at 60 s. The same drawing sent twice replaces itself
  (ADR 0026 ids are geometry hashes).
- **Degraded path:** a hung, erroring or over-budget vision call still builds the player's
  exact boxes, in milliseconds after at most 15 s, and says so ("built from your boxes
  directly"). The feature is never "no build".
- **Worst case for one sketch** is now bounded at ~25 s of model time plus compile/verify,
  which is why the watchdog can be short. Cost is bounded too: at most two reading calls and
  one fix call (the old code allowed the same three, so this is not a new budget).
- **Losses:** a JPEG at 0.75 loses fine pixel detail versus a PNG, so a very thin, very
  light stroke is less legible to the model than the original. That trade is deliberate: the
  stroke tags and boxes carry the geometry, and the alternative was losing the whole build.
  Sketches smaller than 720 px are encoded without a downscale.
- **Owed:** an index row in `docs/adr/README.md` (owned outside this change). The README's
  describe-the-feature line for draw-to-build does not need to change.

## Alternatives considered

- **`AbortSignal.timeout(15_000)` alone, passed to `fetch`.** The smaller change, but it only
  works while every layer honours the signal: the sketch pipeline is also driven by stubs,
  tests, and future transports, and "await something that ignores its signal" is exactly the
  bug. The race-plus-abort pair keeps the guarantee at the pipeline's own boundary.
- **Downscale on the server.** Would keep the client simple, but the megabytes would already
  have crossed the WebSocket, which is the expensive half (upload latency, 413 risk).
- **Fall back only after both tries fail.** The current retry policy, which is what starved
  the fallback: with two 15 s ceilings the second try alone can eat the watchdog. Retry only
  while the budget can hold it.
- **Keep the fallback as the last resort and rely on the watchdog for failures.** Fast to
  write, and it is what shipped: a child watches a spinner for a minute and loses a drawing.
- **Raise the watchdog to cover two full model calls instead.** Treats the symptom; the build
  still ends in "no answer" rather than a level.
