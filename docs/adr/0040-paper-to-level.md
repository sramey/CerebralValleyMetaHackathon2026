# 0040 — Paper-to-level: draw a level on paper, photograph it, it gets built

- **Status:** Draft
- **Date:** 2026-10-29

## Context

The "draw a level and it builds itself" beat (ADR 0026) let players sketch directly on top of the
running game canvas with digital brushes. But the most intuitive creative canvas for kids is
physical paper: a pen, marker, or pencil sketch on a real sheet of notebook or printer paper,
held up to the camera or uploaded as a photo.

Building a level from a physical paper photograph introduces distinct challenges:
- **Perspective and framing:** Photographs of paper held up to a camera or lying on a desk
  are rarely square or centered. They feature perspective tilt, drop shadows, background table
  surfaces, and varying camera distances.
- **Coordinate mapping:** On-screen sketches directly cover world coordinates via camera offset.
  A paper drawing has no intrinsic world coordinates; its coordinate space must be discovered,
  bounded, and mapped to the side-scroller stage (sky above, ground line at `y = 400`, player start
  on the left).
- **Stroke-free retake fallback:** Unlike a digital sketch canvas that has discrete vector stroke
  events, a photo is pure pixels. When a player uploads a photo of an arbitrary object, blank paper,
  or an unreadable scribble, the feature must gracefully ask the player to draw clearer lines or
  retake the photo instead of inventing an unrelated level.
- **Model efficiency and spend limits:** Live AI vision calls must be strictly bounded.

## Decision

We reuse the existing camera capture path (`server/photo.ts`) and the deterministic level compiler
(`server/sketch.ts`), implementing paper-to-level in a dedicated module (`server/paper.ts`):

1. **Dual Entry Points:**
   - In the Camera Modal ("Bring an object in"): a toggle checkbox labeled `"It's a level drawing"`.
     When checked, the modal switches from foreground object cutout to paper level mode.
   - Voice/Typed Commands: phrases matching `"build my drawing"` (e.g. "build my drawing",
     "build this drawing", "scan my drawing", "build my paper level") route locally to open the
     modal with the level drawing toggle active.
2. **Perspective-Tolerant Paper Detection & Coordinate Mapping:**
   - `detectPaperBounds()` locates the paper sheet within the photograph (detecting the high-luminance,
     low-saturation paper region against the darker background desk/environment), or defaults to
     the full camera view with safe margins.
   - `mapBoxToStage()` maps paper-relative coordinates (`0..1000` or percentages) to the game stage:
     horizontal span (`x = 40..1480`), vertical sky (`y = -150`), and ground line (`y = 400`).
     Platforms receive playable thickness (18–40 px), coins are sized to 16x16, and enemies to 28x28.
3. **Multimodal Wonder Vision:**
   - The photo is passed to Meta's `muse-wonder-1.0` with `PAPER_SYSTEM`, returning the level-spec
     JSON (`name`, `platforms`, `coins`, `enemies`).
   - If the model returns no usable elements, the stroke-free fallback asks the user to draw with
     a darker pen or hold the page steady and retake.
4. **Deterministic Level Compilation & Replaced Level Undo:**
   - Once the level spec is parsed, `levelToModSource()` (from `server/sketch.ts`) compiles the
     mod deterministically with full test suites, collision handling, and HUD score counter.
   - The paper level replaces the starter ground or previous level in `sess(ws).levelStash`, ensuring
     undo cleanly restores whatever was replaced.

## Consequences

- **Physical to digital gameplay loop:** Kids can draw obstacle courses, bouncy trampoline pits,
  and coin gauntlets on real paper with pen and markers and immediately play them in seconds.
- **Verified and deterministic:** No raw code is generated from image pixels; Wonder outputs
  pure level geometry, and `levelToModSource()` deterministically generates verified mod code.
- **Preserved undo:** Replaced world levels are stashed and cleanly restored upon undo.
- **Budget-conscious:** High-accuracy vision with minimal tokens (`~400` tokens per call) and
  automatic retake fallback on non-drawings.

## Alternatives considered

- **Full mod code generation directly from the photo:** Asking a vision model to write entire
  TypeScript mod code from a photo would be nondeterministic, prone to API hallucinations,
  vulnerable to prompt injection, and slower to verify. Compiling a structured JSON level spec
  retains 100% verification safety and identical physics.
- **Separate dedicated paper modal:** We considered adding a new top-level button next to
  "Draw a level", but integrated the toggle into "Bring an object in (camera)" to unify all photo
  workflows under one camera modal while keeping voice "build my drawing" as an instant shortcut.
