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

## Hackathon

- **Event:** Meta Global AI Developer Hackathon (Cerebral Valley), solo entry, Indie track.
- **Deadline:** Wed Nov 4 2026, 9:00 PM ET (targeting 3 PM submission: 3-min demo video, public repo, live product URL).
- **Rubric:** Impact 30 · Meta tooling 25 · Depth 20 · Demo 25.
- **Targeting:** Best Creative (Muse Image/Wonder), Best Agentic, Community vote, Most Viral on X.

## Tech at a glance

| Layer | Tech |
|---|---|
| Language | TypeScript everywhere |
| Client | Vite + PixiJS (WebGL), code-drawn placeholder art for now |
| Game server | Node + `ws` WebSocket on port 8787, esbuild compiles mods, verifier steps the sim headless in-process |
| Sim core | Pure deterministic 60 Hz simulation (`src/sim`), no DOM/clock/`Math.random` — identical in browser and server verifier |
| Models (Meta Model API, `https://api.meta.ai/v1`) | **Muse Spark `muse-spark-1.2`** routes commands · **Muse Wonder `muse-wonder-1.0`** writes/edits/fixes mods · **Muse Image** sprite sheets (planned) · **SAM 3.1** sprite cutout (planned) · **Muse Voice Transcribe** hold-to-talk (planned). All text calls use `reasoning_effort: minimal` — see [ADR 0001](docs/adr/0001-reasoning-effort-minimal.md) |

Key decisions and why: [docs/adr/](docs/adr/README.md) · Product/architecture: [docs/DESIGN.md](docs/DESIGN.md) · Current milestone: [docs/SPIKE.md](docs/SPIKE.md) · Model notes: [docs/META-API.md](docs/META-API.md) · Build log: [progress.md](progress.md)

## Run it locally

```sh
npm install
cp .env.example .env   # then fill in MODEL_API_KEY (Meta Model API key)
npm run dev            # game client  -> http://127.0.0.1:5173/
npm run server         # AI server    -> ws://127.0.0.1:8787 (second terminal)
npm test               # vitest suite
npx tsx scripts/spike-run.ts   # re-run the 10-command spike exam against the live server
```

Never commit keys. `.env` is gitignored. Without a key the game still runs on built-in mods; the AI server answers that it can't write mods yet.

## Status (2026-10-27)

**Working and verified**

- Engine, mod API + loader (knobs, undo, clean dispose), sample mods (player, ground, enemies, rain, coins, moving platform, fire arrows).
- Live AI path end-to-end: type a sentence → Spark routes → Wonder writes a mod → esbuild compiles → 600-frame headless verify (failed mods are rejected, game unchanged, one auto-fix round) → hot-loads into the running game with its own mod card and knobs.
- **Spike exam: 10/10 commands in one world, median 8.7s per build (bar: 8/10, <15s)** — run it yourself with `scripts/spike-run.ts`. This passes the Thu Oct 29 go/no-go bar early.
- Tests: 16 passing (`npm test`), typecheck clean, production build green, verified in a real browser.

**Not built yet**

- Art pipeline (Muse Image sprite sheets + SAM 3.1 cutout) and the style bible — code-drawn shapes are placeholders.
- Voice hold-to-talk (Muse Voice Transcribe); text box is the input for now.
- Endless level generator + "can you still win?" reachability bot, ghost playtest view.
- Hosting/share links, session limits, worker-thread verifier isolation ([ADR 0003](docs/adr/0003-verifier-in-process-empty-world.md)).
- Known nit: relative tweaks ("jump higher") sometimes build a new mod instead of instantly tweaking a knob ([ADR 0005](docs/adr/0005-tweak-edit-fallbacks.md)).
