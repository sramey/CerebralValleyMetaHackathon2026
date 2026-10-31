# ADR 0079: Startup screen explaining visitor mode when API keys are missing

- **Status:** Proposed
- **Date:** 2026-10-31

## Context

When a judge, evaluator, or fresh clone starts the app without setting `MODEL_API_KEY` in `.env`, the server operates in safe visitor mode (ADR 0014). In visitor mode, all AI generative model calls are paused, but the client previously provided no visible explanation on initial load:
1. The `#demo-worlds` buttons appeared in the rail, but the main stage showed no announcement.
2. If the user tried to speak (holding Shift), voice failed with an orb error.
3. If the user typed a command, the server rejected it with a one-line explanation.
4. Cold visitors had to reverse-engineer why commands were failing, what capabilities actually require Meta models, and what was still fully playable.

## Decision

On initial connection, when the server emits `{ kind: "visitor", reason: "nokey" }`, the client displays a focused, informative startup modal (`#nokey-modal`).

1. **Clear informational breakdown**:
   - **What won't work (and why)**: Specifically names each disabled feature and the corresponding Meta model (Voice Control -> Muse Voice Transcribe; AI Mod Generation & Fixes -> Wonder tool agent; Prompt Routing -> Muse Spark; Custom Sprites & Camera Cutouts -> Muse Image & SAM 3.1; Mood Restyling -> Muse Image EDIT). Explains that hosted Meta Model API endpoints (`api.meta.ai`) require an authorized key.
   - **What you can still play right now**: Highlight the deterministic 60 Hz physics engine, movement/shooting/items, starter and demo worlds, hand-drawn level sketcher, procedural terrain generator, radial menu knob inspector, and offline single-file HTML export.
   - **How to enable AI**: Direct copy-pasteable instructions for setting `MODEL_API_KEY` in `.env` and running `npm start`.
2. **Accept button & dismiss semantics**:
   - An "Accept & Play Demo Worlds" button dismisses the screen and returns focus directly to the game.
   - Dismissal is remembered in `sessionStorage` so soft WebSocket reconnections during a session do not re-interrupt gameplay.
   - A permanent banner button inside `#demo-worlds` ("⚠️ Visitor mode: Why is AI off?") allows the player to reopen the dialog at any time.
3. **Controls isolation**:
   - While the modal is open, game key events (`isGameKeyEvent`) are ignored so pressing Space, WASD, or arrows to interact with the modal does not move the player in the background.
   - Pressing `Escape` or clicking the backdrop dismisses the dialog.

## Consequences

- First-time judges and visitors running without a key immediately understand the game's architecture, what Meta models do, and what they can evaluate in demo mode without frustration.
- Zero extra server load or external API dependencies.
- Fully accessible via keyboard and clickable banner button.

## Alternatives considered

- **Silent toast only:** A temporary toast or status line in the corner was too subtle and disappeared before cold users could read the setup instructions.
- **Block the page completely:** Forbidding all interaction until a key is added would break visitor mode entirely; demo worlds, level sketch, and game physics should always remain playable.
- **Show dialog on every build attempt:** Annoying if repeatedly prompted; showing once on startup with an on-demand re-open button strikes the right balance.
