# 0019 — Declarative mod HUD API (world.hud, rendered by the client)

**Status:** Draft

**Date:** 2026-10-29

## Context

Three problems at once: (1) the starter world showed no player health — `drawHealthBar` hides bars at full health, so a fresh player sees nothing; (2) mods could change values the player cares about (`coins` bumps `player.data.score`) but nothing ever rendered them; (3) mods are forbidden the DOM (`FORBIDDEN_MOD_TOKENS`) and `ModApi` had no HUD surface, so "add a speedometer", "add a timer", "show my health as hearts" were unbuildable by Wonder. Any fix had to stay deterministic and headless (verifier, ghost replay) and clean up on undo.

## Decision

HUD widgets are **pure data on the world**, written through a declarative `ModApi` slice — `setHud(id, def)` / `removeHud(id)` / `hud(id)` / `hudList()` — with four kinds (`bar`, `hearts`, `stat`, `banner`) and seven anchor positions. Widgets record `owner` and die with `world.removeByOwner` on unload, exactly like entities. Timed banners age on sim time inside `step()`. The client renders `world.hud` as a DOM overlay (`src/client/hud.ts`, `#game-hud` in `#stage-wrap`); the sim never touches the DOM.

## Consequences

- Wonder can build HUD mods from prompts, and they verify + undo like any mod (`t.api.hud` reads state in tests; HUD-only mods spawn nothing, so `pickArtType` never triggers Muse Image).
- Starter `player` shows a live HP bar (refills on respawn) and `coins` a live score stat — the first screen now explains itself.
- We owe: keeping the widget schema small (numbers only — formatted text belongs in banners), and HUD perf stays trivial (Map writes; the renderer reconciles and only writes DOM on change).
- In-canvas HUD (ghost window, screenshots of the sim alone) does not exist; the overlay is browser-only. Acceptable: the ghost is a schematic view.

## Alternatives considered

- **Mods write DOM directly** — violates the isolation rule and breaks headless verification. Rejected.
- **A fixed engine-owned HUD** (hard-coded health/score) — not promptable, not per-mod, and Wonder couldn't extend it. Rejected.
- **Draw HUD in the Pixi canvas** — one render path, but text layout, anchors and blur cost more code than the DOM overlay and the sim/render split got muddier. Deferred until someone needs HUD in canvas captures.
- **Event/signal-based HUD updates** — more machinery for no gain at this scale; an upsert by id is simpler for AI-written mods to get right.
