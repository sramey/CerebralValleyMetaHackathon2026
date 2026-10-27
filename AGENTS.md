# AGENTS.md

A voice-controlled pixel-art side scroller that builds itself while you play. The user talks ("add a player, make it a ninja", "make it rain"). AI agents write **mods** against a small engine API, a headless verifier playtests each mod, and it hot-loads into the running game.

This is an entry for the Meta Global AI Developer Hackathon (solo, Indie track). **Deadline: Wed Nov 4 2026, 9:00 PM ET.**

## Read first
- `docs/DESIGN.md`: every product and architecture decision (locked; discuss before changing).
- `docs/SPIKE.md`: the current milestone and its pass bar.
- `docs/META-API.md`: Meta model capabilities, endpoints, realtime details, pricing.
- `docs/adr/`: architecture decision records. Read the index (`docs/adr/README.md`) before changing anything an ADR covers.

## Current milestone
**The spike** (`docs/SPIKE.md`). Rectangles, a text box, Wonder writes mods, a verifier, hot-loading. No art and no voice until the spike passes its go/no-go.

## Stack
- TypeScript everywhere.
- Client: Vite + PixiJS.
- Server: Node or Bun, WebSocket, esbuild, worker threads.
- Models: Meta Model API (`https://api.meta.ai/v1`, OpenAI-SDK compatible). The key comes from the `MODEL_API_KEY` env var. **Never commit keys**; use `.env`, which is gitignored.

## Hard rules
- **The simulation core is pure and deterministic.** Fixed 60 Hz step, no DOM, no wall-clock time, no `Math.random` (use a seeded RNG). It must run headless in a worker or Node exactly as it does in the browser.
- **The engine holds the laws of nature** (loop, physics, collision, input, camera, rendering, particles, lighting, mod loader, verifier, orb). **Everything visible in the game is a mod.**
- **Mods** use only the mod API. No engine internals, DOM, network, `eval` or `Function`. Every mod has `dispose()` (undo must be clean), exposes **knobs**, and ships a `test()`.
- **Performance budget:** the simulation step stays under 2 ms per frame with all mods loaded. Rendering holds 60 fps.
- **Original IP only.** No Mario or Nintendo names, sprites or assets.
- **Only work built during the event** may appear in the demo. Keep commits honest and frequent; the repo will be public.
- Prefer small, verifiable steps: write a test or a headless check for each engine feature.
- **Document decisions as ADRs.** Any change that picks between real alternatives, creates or changes a contract (sim/server/client, mod API, wire protocol), changes runtime semantics another component depends on, or would surprise a future reader ships with an ADR in the same change (format: `docs/adr/README.md`). No ADR, not done. Accepted ADRs are never edited; a changed mind gets a new ADR that supersedes the old one. Bug fixes with one obvious cause, behavior-preserving refactors, and visual-only tweaks need no ADR — if in doubt, write a short one. New ADRs start as Draft; only the project owner marks them Accepted.
- **Keep the repo obvious to a cold viewer.** The README is the entry point and must always answer, without reading code: what this is, the hackathon it's for (event, track, deadline), the full tech stack and which Meta models do which job, how to run it locally, what's already working (with evidence), and what isn't built yet. Any change that makes part of that stale — new component, new model, new run step, new working/broken feature — updates the README (and linked docs) in the same change. A viewer should never have to reverse-engineer the tech or the state of the project from source files.
