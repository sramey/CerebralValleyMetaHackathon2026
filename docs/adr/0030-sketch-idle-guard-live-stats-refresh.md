# 0030 — Sketch mode lets go after 3 minutes idle, and the impact tiles move when a build lands

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** Two follow-ups from ADR 0027/0028, both about state the player cannot see.
  1. ADR 0028 froze the sim while the sketch overlay is up, but nothing releases that freeze
     except the player coming back. A sketch abandoned mid-demo leaves the game paused forever
     with no explanation on screen — the only cue is the orb status line, which is easy to miss
     over a full-stage overlay.
  2. The stats panel (ADR 0027) reads the build log when the overlay opens and then every 20 s.
     A judge watches a build land, opens `P`, and the tiles still describe the previous build:
     the number on screen contradicts the thing that just happened. The endpoint is cheap, but
     one GET per stage message would be pointless — the log cannot grow twice in a millisecond,
     and `stage: done` is sent *before* `logBuild` writes the line, so a single immediate read
     can legitimately miss the build it was triggered by.
- **Decision:**
  - Sketch mode keeps an idle clock (`src/client/sketch-idle.ts`, pure): any brush pick, stroke,
    hint key, undo/clear or retry resets it; three minutes untouched in the *drawing* state
    closes the overlay, drops the strokes, says so in the orb and resumes the world. While the
    builder is reading the sketch the clock does not run — that wait has its own 60 s watchdog.
  - The overlay shows a `Paused — drawing` chip (top-left, above the status line) that counts
    the guard down and turns red in the last 20 s, so the freeze is stated rather than implied.
  - The pipeline feeds every server message to `statsPanel.refreshSoon()`, which reads the log
    when `isLiveBuildMsg` holds (`stage: done|failed`, or the command's `timing`) subject to a
    1.5 s settle gap (`src/client/stats-refresh.ts`, pure). Bursts coalesce into at most one
    queued follow-up read, and nothing is fetched while the panel is off screen; the 20 s poll
    stays as the backstop.
- **Consequences:**
  - The tiles lag a landed build by at most ~1.5 s instead of 20 s, and the `done`-before-log
    ordering is handled by that same gap rather than by a second ad-hoc delay elsewhere.
  - An abandoned sketch can no longer strand the game in a paused state, and the reason the
    player is not moving is on screen.
  - Auto-cancel discards up to 80 strokes without asking. That is deliberate (a sketch nobody is
    drawing is worth less than a running world), but it means the guard must never fire while
    the pointer is down or the builder is thinking — it only runs in the drawing state.
  - Two small pure modules now own the numbers a UI depends on: idle limits and refresh policy
    are tested without a DOM, a timer or a socket.
- **Alternatives considered:**
  - **Ask before cancelling** ("Still drawing?"): another modal over a modal, and the demo has
    nobody at the keyboard when the guard matters.
  - **Keep the sketch and resume the sim** when idle: the drawing was made against a camera
    snapshot (ADR 0028); resuming under it silently misaligns every stroke.
  - **Refresh on every stage message, no gap:** 6–10 GETs per build for a log that changes at
    most twice.
  - **Have the server push the numbers in each `timing` frame:** changes the wire contract for a
    cosmetic number, and the standalone endpoint (`npm run stats -- --json`, `curl`) would lose
    its only real workout.
