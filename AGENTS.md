# AGENTS.md

A voice-controlled pixel-art side scroller that builds itself while you play. The user talks ("add a player, make it a ninja", "make it rain"). AI agents write **mods** against a small engine API, a headless verifier playtests each mod, and it hot-loads into the running game.

This is an entry for the Meta Global AI Developer Hackathon (solo, Indie track). **Deadline: Wed Nov 4 2026, 9:00 PM ET.**

## Read first
- `docs/DESIGN.md`: every product and architecture decision (locked; discuss before changing).
- `docs/SPIKE.md`: the current milestone and its pass bar.
- `docs/META-API.md`: Meta model capabilities, endpoints, realtime details, pricing.

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
