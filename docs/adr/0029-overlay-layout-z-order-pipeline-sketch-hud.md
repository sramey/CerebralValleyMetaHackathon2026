# 0029 — Overlay layout, z-order, and responsive scaling across sketch, pipeline, and HUD

- **Status:** Draft
- **Date:** 2026-10-29

## Context

Following UI QA #1 (bead 3u0), several new overlays landed in the app:
- Draw-to-build level sketcher with side palette and paused sim (ADRs 0026, 0028)
- In-app impact numbers panel inside the pipeline architecture view (ADR 0027)
- Usable weapon HUD indicators (`🔫 Gun: F / X to shoot`) and auto-step-up stairs indicators (`🪜 Stairs: Auto step-up`) alongside health and coin counters (ADRs 0019, 0024, 0025)

Testing all overlays together at 1920x1080 and 1280x720 surfaced several layout and z-order fights:
1. When sketch mode opened, the `#pipeline-btn` (`z-index: 45`) floated on top of the drawing canvas in the bottom-right corner. Clicking it set `.on` but did not show `#pipeline` because `#pipeline` had `z-index: 40`, below `#sketch-overlay`.
2. Inside `#pipeline` at 720p, `#pipeline` had `padding: clamp(74px, 8.5vh, 92px) ... clamp(12px, 2vh, 28px)`. The 74–92px top padding was legacy spacing intended to clear the orb bar, but `#pipeline` has a solid background that covers the orb bar. Meanwhile, the bottom padding was only 14px, causing `#pipeline-btn` at `bottom: 14px` to sit directly over the active flight lanes, lane outputs (`building · 1.1 s`), lanes vertical scrollbar, and the footer text.
3. In the new `.st-panel` inside `#pipeline`, the 5-column impact grid at 720p (stage width ~940px with rail open) clipped longer subtitle text (`waiting for the first landing`, `no fix round needed yet`) with ellipsis truncation due to fixed gaps and letter spacing.
4. On short viewports, `#feedback-modal` lacked `max-height` and `overflow-y: auto`, risking vertical clipping on low-resolution displays.

## Decision

Pure CSS layout and z-order adjustments with zero runtime behavior changes:

1. **Sketch canvas isolation:** Hide `#pipeline-btn` whenever `#sketch-overlay` is active (`#stage-wrap:has(#sketch-overlay:not([hidden])) #pipeline-btn { display: none; }`). The drawing surface is completely clean and unoccluded.
2. **Pipeline overlay z-index & clearance:** Elevate `#pipeline` to `z-index: 50` and `#pipeline-btn` to `z-index: 55`. Inside `#pipeline`, reduce top padding to `clamp(16px, 2.8vh, 32px)`, recovering ~50–60px of vertical space at 720p. Increase bottom padding to `clamp(50px, 6.5vh, 60px)` and add `padding-right: 90px` to `.pl-foot`, completely clearing `#pipeline-btn` from all flight lanes, scrollbars, and footer text.
3. **Stats panel fluid sizing:** In `.st-panel`, adjust tile gaps to `clamp(4px, 0.8vw, 14px)`, number sizes to `clamp(17px, 2.6vh, 28px)`, subtitle font size to `clamp(8.5px, 1vh, 10px)`, and responsive letter-spacing on uppercase labels so all 5 impact tiles display their full labels and subtitles without clipping at 720p.
4. **Modal safety:** Add `max-height: 90vh` and `overflow-y: auto` to `.feedback-card` and `clamp(12px, 2vh, 20px)` padding to `#feedback-modal`.

## Consequences

- All overlays (HUD stack with health/coins/weapon/stairs, sketch palette, pipeline with impact panel and flight lanes, radial menu, feedback modal) co-exist seamlessly at both 1080p and 720p.
- No clipping or overlapping between buttons and content in any state.
- Gates (`npx tsc --noEmit`, `npm test`, `npm run build`) stay green.
