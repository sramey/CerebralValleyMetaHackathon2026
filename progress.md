Original prompt: lets setup our project, get oriented, organized, and setup, see what we are building, and our repo is at https://github.com/sramey/CerebralValleyMetaHackathon2026, so we can init that and push what we have for now / i setup .env file, get started, and you have two workers worker1 and worker2 to help out, you are the orchestrator / start building

# Progress

- Repo initialized and pushed: 990a62c on main (docs, README, .env.example).
- .env verified live (Spark + Wonder 200, <1s). npm install done.
- Orchestrator built playable spike client: Pixi rect rendering, fixed-step deterministic sim (src/sim), ModLoader with knobs/undo, sample mods (player/ground/enemies/rain), text box + chips, orb states, WebSocket client with offline local fallback.
- Test hooks exposed: window.advanceTime(ms), window.render_game_to_text().
- Verified: vitest 7/7, vite build green, Playwright fresh-load play (starter world, move, jump, screenshot inspected).

- Spark subagents completed both worker slices (engine hardening + 3 mods; full AI server). Orchestrator verified independently: tests 16/16, tsc clean, build green.
- LIVE AI PATH PROVEN (2026-10-27): "add a bouncing slime that hops around" -> route 0.7s -> Wonder writes mod -> compile -> 600-frame verify -> hot-load in browser in ~9s total. Screenshot: two green slimes hopping, own mod card + knobs.
- Bugs found+fixed on that path: router never sent ROUTER_SYSTEM and used 256 tokens (empty reply); Wonder calls lacked WONDER_SYSTEM; default reasoning_effort emptied mod replies (fix: reasoning_effort=minimal in server/meta.ts, regression test tests/meta.test.ts); build-shaped commands coerced to "new"; verifier empty-world test guidance in prompt; solid-with-gravity entities now get physics (src/sim/world.ts + regression test).

- SPIKE EXAM PASSED (2026-10-27, scripts/spike-run.ts): 10/10 commands live (bar: 8/10), median 8.7s, p95 12.3s (bar: <15s typical). Note: "jump higher" built a new mega-jump mod instead of a knob tweak — passes, but tweak-routing should be tightened later.
- Round-2 visuals landed (Spark worker): per-type code-drawn art (player headband/squash, blob enemies, spinning coins, grass+soil ground, fire trails, rain streaks), moon, parallax hills, vignette. Verified in browser screenshot.
- Server edit route + tweak fallbacks landed; edit confirmed live by spike cmd 6 (walker-enemy rewritten under same id).

- Checkpoint committed + pushed: 26baa43 (spike complete).
- Agent playtest (Spark critic, fresh eyes, 9 screenshots) top finding: player can run off the ground edge and fall forever (reproduced at y=26106, vy=8775), leaving an empty sky — looked like "canvas renders nothing". Fixed: terminal velocity 1100 (src/sim/world.ts), player respawns at spawn after y>1000 (src/mods/player.ts), regression test added (17/17). Re-proven live in browser: same walk now ends back on ground.
- Playtest fix 2: fully-specified tweaks for client-local mods are forwarded to the client instead of rebuilding (server/index.ts; ADR 0005 amended).

- ART PIPELINE PROVEN (2026-10-27): Muse Image sheet (~8s, WebP b64) -> client chroma-key/slice (ADR 0007). Player is an AI-drawn animated ninja. Chicken proof: Spark-generated chicken sheet + chicken mod, "add a chicken" shows a white AI chicken walking next to the ninja (state: 2 chickens, walking). Art now generalizes by entity-type subject (src/client/sprites.ts loadSubjects/framesFor).
- CREDIT RULE (orchestrator): main model decides + verifies mechanically only. All build slices delegate to `muse-spark-1.3` subagents with compact briefs + structured returns. Keep orchestrator turns short; never re-derive what a test/screenshot can state.

## TODO for worker windows (see docs/WORKERS.md)

- worker1: harden/replace src/sim + src/mods + tests ( owns those files; current versions are orchestrator-built and passing).
- worker2: server/** + scripts/benchmark.ts — server/index.ts does not exist yet, so `npm run server` currently fails and the client shows "Server: offline". This is the top gap: live Wonder mod generation end-to-end is NOT yet wired.
- Orchestrator next: once server lands, test a live Wonder command through WS, then commit/push only when user says.

## Status update — 2026-10-28 (art era, uncommitted)

- Server, live Wonder builds, verifier, hot-load, knobs/undo, compound-command splitting, and creation log (`logs/builds.jsonl`, `scripts/review-log.ts`) all work end-to-end in the browser.
- Art on demand works: Wonder behavior mod + `muse-image-1.0` sheet, client chroma-keys and slices it (`src/client/sprites.ts`). Proven live: chicken, black retriever, kite kid, dragons, race car (single entity after the one-entity fix), and a purple fire-eyed cat.
- Sprite slicing now splits merged poses recursively (widest run >520px split at its emptiest central column, max 6 frames); generation prompt requires wide magenta gaps so poses do not touch.
- Gates: `npx tsc --noEmit` clean, `npm test` 20/20, `npm run build` green.
- Known fragility: a server watch-restart during a sequential compound build can drop the remaining sub-builds; the earlier sub-builds are not logged in that case.
- This whole art-era working tree is still UNCOMMITTED. Needs the owner's explicit "commit and push".
