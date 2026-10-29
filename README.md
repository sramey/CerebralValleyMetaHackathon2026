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
- **Art:** Muse Image generates a sprite sheet on demand per mod subject (client chroma-keys and slices it; SAM 3.1 probes/validates). Art streams asynchronously — the mod hot-loads first with a pulsing pixel-noise digitize placeholder in the entity's shape/place, then the sheet lands ([ADR 0008](docs/adr/0008-async-art-digitize-placeholder.md)). Scenery subjects (trees, rocks, sun/moon, etc.) get static variant sheets with no faces/limbs and no animation cycling; creatures keep pose sheets ([ADR 0009](docs/adr/0009-scenery-vs-creature-art.md)).
- **Voice:** hold Shift (or a gamepad shoulder) and talk. The orb pulses with mic volume, live partials from Muse Voice Transcribe show under it, and releasing submits the command. Audio is proxied through our server (the key never reaches the browser) into a pre-warmed Meta session; final text lands ~130 ms after release ([ADR 0012](docs/adr/0012-voice-hold-to-talk.md)). The text box stays as a fallback.

See [docs/DESIGN.md](docs/DESIGN.md) for all locked product and architecture decisions, [docs/SPIKE.md](docs/SPIKE.md) for the current milestone, and [docs/META-API.md](docs/META-API.md) for model endpoints and pricing.

## Current milestone: the win plan

The spike passed its go/no-go early (10/10). The remaining plan, in priority order, is in [docs/WINPLAN.md](docs/WINPLAN.md): voice (done), deploy-ready server with share links (done), a visible verifier (done) with a ghost playtest, deploy with share links, a non-coder user test, then rehearsal. Work runs in parallel git worktrees ([docs/ORCHESTRATION.md](docs/ORCHESTRATION.md)).

## Hackathon

- **Event:** Meta Global AI Developer Hackathon (Cerebral Valley), solo entry, Indie track.
- **Deadline:** Wed Nov 4 2026, 9:00 PM ET (targeting 3 PM submission: 3-min demo video, public repo, live product URL).
- **Rubric:** Impact 30 · Meta tooling 25 · Depth 20 · Demo 25.
- **Targeting:** Best Creative (Muse Image/Wonder), Best Agentic, Community vote, Most Viral on X.

## Tech at a glance

| Layer | Tech |
|---|---|
| Language | TypeScript everywhere |
| Client | Vite + PixiJS (WebGL), on-demand generated art with digitize placeholder while it loads |
| Game server | Node + `ws` WebSocket on port 8787, esbuild compiles mods, verifier steps the sim headless in-process |
| Sim core | Pure deterministic 60 Hz simulation (`src/sim`), no DOM/clock/`Math.random` — identical in browser and server verifier |
| Models (Meta Model API, `https://api.meta.ai/v1`) | **Muse Spark `muse-spark-1.2`** routes commands · **Muse Wonder `muse-wonder-1.0`** writes/edits/fixes mods · **Muse Image** sprite sheets on demand · **SAM 3.1** sprite cutout (probe/validate; mask decode deferred) · **Muse Voice Transcribe** hold-to-talk, realtime. All text calls use `reasoning_effort: minimal` — see [ADR 0001](docs/adr/0001-reasoning-effort-minimal.md) |

Key decisions and why: [docs/adr/](docs/adr/README.md) · Product/architecture: [docs/DESIGN.md](docs/DESIGN.md) · Current milestone: [docs/SPIKE.md](docs/SPIKE.md) · Model notes: [docs/META-API.md](docs/META-API.md) · Build log: [progress.md](progress.md)

## Run it locally

```sh
npm install
cp .env.example .env   # then fill in MODEL_API_KEY (Meta Model API key)
npm run dev            # game client  -> http://127.0.0.1:5173/
npm run server         # AI server    -> ws://127.0.0.1:8787 (second terminal)
npm test               # vitest suite
npx tsx scripts/spike-run.ts   # re-run the 10-command spike exam against the live server
powershell scripts/voice-synth.ps1; npx tsx scripts/voice-check.ts 10   # live voice check (synthesized speech)
```

**Production (one port):** `npm run build && npm start` serves the game and its WebSocket on one port (`PORT`, default 8787; `HOST=0.0.0.0` to expose). **Share this world** copies a `/?w=<id>` link that reopens the exact world for anyone to remix. Per-visitor and global spend caps plus curated demo worlds keep a public URL playable without burning Meta credit; `AI_KILL_SWITCH=1` turns all AI off. A `Dockerfile` is included (`docker run -p 8787:8787 -e MODEL_API_KEY=... -v metabuild-data:/app/data metabuild`). Env vars are listed in `.env.example`; details in [ADR 0014](docs/adr/0014-deploy-share-spend-visitor.md).

Never commit keys. `.env` is gitignored. Without a key the game still runs on built-in mods; the AI server answers that it can't write mods yet.

## Status (2026-10-29)

**Working and verified**

- Engine, mod API + loader (knobs, undo, clean dispose), sample mods (player, ground, enemies, rain, coins, moving platform, fire arrows).
- Live AI path end-to-end: type a sentence → Spark routes → Wonder writes a mod → esbuild compiles → 600-frame headless verify (failed mods are rejected, game unchanged, one auto-fix round) → hot-loads into the running game with its own mod card and knobs.
- **Spike exam: 10/10 commands in one world, median 8.7s per build (bar: 8/10, <15s)** — run it yourself with `scripts/spike-run.ts`. This passes the Thu Oct 29 go/no-go bar early.
- **Real usage log:** 78 AI builds through 2026-10-28 → 74 landed (95%), median 9.4 s, p90 26.5 s, 9 rescued by the auto-fix (`logs/builds.jsonl`, `scripts/review-log.ts`).
- **Voice:** hold Shift and talk. 10/10 live runs transcribed correctly in the worktree check, 4/4 on main; release → final text p50 ~126 ms ([ADR 0012](docs/adr/0012-voice-hold-to-talk.md)).
- **Camera import:** hold up a real object; SAM 3.1 finds it (~1.2 s), it's cut out, pixelated and dropped into the game as a physics prop ([ADR 0010](docs/adr/0010-camera-object-prototype.md)).
- **Combat and health:** opt-in hostiles and heroes, 100 HP, health bars, player respawn ([ADR 0011](docs/adr/0011-combat-targeting-and-health.md)). Clickable objects with a radial menu.
- **"It can't break":** every AI-written mod is playtested by a scripted bot in a copy of *your* world (3 seeds × 2 worlds, 1–6 ms). A ghost window replays the actual run. A failing change is rejected with a one-line reason, and Wonder, as a tool-using agent (`run_playtest`), fixes and re-playtests it before it lands. Live on main: "make me huge" → *"You'd be too big to fit through the gap"* → fixed → landed, 2/2 (7/7 across the lease's runs once tuned) ([ADR 0013](docs/adr/0013-visible-verifier.md)).
- **Share links, spend guard, visitor mode:** a live check builds 3 AI mods, saves the world, reopens the link in a fresh session with byte-identical code, and remixes it (`scripts/deploy-check.ts`, 8/8 on main).
- Tests: 70 passing (`npm test`), typecheck clean, production build green.

**Art pipeline: first proof (2026-10-27)**

- Muse Image (`muse-image-1.0`) generates a sprite sheet in ~8s; the client chroma-keys the magenta background, slices frames, and animates the player as a real AI-drawn ninja (idle/run/jump). Regenerate with `npx tsx scripts/art-sheet.ts`. SAM 3.1 answers in ~1.2s with box + encoded mask (mask decode pending — [ADR 0007](docs/adr/0007-art-pipeline-chroma-key-first.md)). Art is now generated on demand per mod subject and streams asynchronously with a digitize placeholder while it loads ([ADR 0008](docs/adr/0008-async-art-digitize-placeholder.md)); scenery subjects render as static variants with no animation cycling ([ADR 0009](docs/adr/0009-scenery-vs-creature-art.md)).

**Not built yet**
- Goal-reachability search (the playtest bot runs right and jumps; it doesn't prove a goal is reachable).
- Endless level generator (cut for the hackathon).
- Public hosting (deploy-ready; host not chosen yet), worker-thread verifier isolation ([ADR 0003](docs/adr/0003-verifier-in-process-empty-world.md)).
- Known nit: relative tweaks ("jump higher") sometimes build a new mod instead of instantly tweaking a knob ([ADR 0005](docs/adr/0005-tweak-edit-fallbacks.md)).
