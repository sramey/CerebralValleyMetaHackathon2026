# Talk-to-Build Platformer

> Game making takes years to learn. What if it took a sentence?

You start with an empty black screen. You talk to it, and a modern pixel-art side scroller builds itself around you **while you play**:

- "add a player, make it a ninja"
- "add some ground"
- "fire arrows when I shoot"
- "turtle enemies"
- "make it spooky"

Each change is written by AI agents, **verified by a headless playtest before it goes live**, and hot-loaded into the running game without a restart.

Entry for the Meta Global AI Developer Hackathon (solo, Indie track). **Deadline: Wed Nov 4 2026, 9:00 PM ET.**

## How it works

- **Engine (built-in, never generated):** 60 fps fixed-step deterministic simulation, rendering, tile collision, physics, input, camera, particles, lighting, mod loader, verifier, and the orb UI. Runs identically in the browser and headless (Node / worker) so mods can be playtested at 100x speed before they ship.
- **Everything visible is a mod.** The player, ground, enemies, art, music, and backgrounds are all mods written against a small mod API (`setup` / `dispose` / `knobs` / `test`). Mods are isolated, toggleable, and undoable.
- **Router:** Muse Spark classifies each command (tweak / new / edit / undo / question) against a world manifest. Tweaks adjust exposed knobs in under 2s; new things are written by Muse Wonder (~10-20s), compiled with esbuild, verified, then hot-loaded.
- **Art:** Muse Image generates a sprite sheet per character; SAM 3.1 segments it for clean alpha and frame separation; an art verifier checks consistency, readability, contrast, and palette fit.
- **Voice:** hold-to-talk (Shift or gamepad shoulder) via Muse Voice Transcribe realtime. A text box is the fallback and the only input during the spike.

See [docs/DESIGN.md](docs/DESIGN.md) for all locked product and architecture decisions, [docs/SPIKE.md](docs/SPIKE.md) for the current milestone, and [docs/META-API.md](docs/META-API.md) for model endpoints and pricing.

## Current milestone: the spike

Prove Wonder can reliably write working mods fast enough to feel live, before any art or voice. Rectangles, a text box, Wonder writes mods, a verifier, hot-loading.

Pass bar (go/no-go Thu Oct 29): 8 of 10 test commands produce a working mod within one auto-fix retry, typical response under 15s for new things and under 2s for tweaks, and after all 10 the game still runs at 60 fps with every mod undoable cleanly.

## Stack

- TypeScript everywhere
- Client: Vite + PixiJS
- Server: Node or Bun, WebSocket, esbuild, worker threads
- Models: Meta Model API (`https://api.meta.ai/v1`, OpenAI-SDK compatible)

## Setup

```sh
cp .env.example .env   # then fill in MODEL_API_KEY
```

Never commit keys. `.env` is gitignored.

## Status

- [x] Design locked — [docs/DESIGN.md](docs/DESIGN.md)
- [x] Repo created
- [ ] Meta credits claimed, API key working, latency benchmarks — [docs/META-API.md](docs/META-API.md)
- [ ] Spike build (engine core, mod API, hot-load, verifier, text box)
- [ ] Go / no-go — Thu Oct 29
