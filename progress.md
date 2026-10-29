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

## Status update — 2026-10-28 (async art + scenery, uncommitted)

- Art now streams asynchronously: the mod ships right after verify (~5s builds) with `artPending`, the sheet arrives later via a new `{kind:"art"}` message, and entities render a pixelized pulsing digitize placeholder (`drawDigitize`) in their exact shape/place while art generates. Art loads retry once with a cache-buster after a 0-frame result (observed live once).
- Scenery classification (`isScenerySubject` in `server/art.ts`): level/environment subjects (trees, rocks, houses...) get a variants-not-poses scenery sheet (no faces/legs) and static per-entity variant frames (`frames[e.id % n]`) instead of animation cycling. Verified: "add trees" produced 5+ distinct static trees.
- Sprite fixes: every entity with area >= 30% of its owner+subject group max gets a sprite (repeated instances like trees all render; small assembled parts like wheels do not). Flying creatures (`gravityScale 0`, airborne) now cycle all frames — the sky duck visibly flaps; no duplication reproduced.
- Slicer keeps only the dominant vertical band per frame, so stray objects a sheet sneaks in (a rock pile above a tree) no longer float in-game.
- Gates: tsc clean, tests 20/20, Vite build green. Server restarted on the new code (detached, port 8787).
- Uncommitted: contract/art/index/main/sprites changes plus generated sheets (duck, tree, hippo, zebra). Needs the owner's explicit "commit and push".

## Status update — 2026-10-28 (camera object prototype, uncommitted)

- "Bring an object in (camera)" works end-to-end: webcam capture (or photo upload fallback), SAM 3.1 returns a tight box in ~1.2s, a server-built template mod spawns one physics prop (verified like any mod, Size knob, gentle hop), and the client cuts the photo out inside the box with a border flood-fill and renders it as the prop's sprite. Verified live with a photographed red mug standing next to the ninja.
- SAM findings (ADR 0010): the box coordinate space follows the SENT image size, not always 1600 — the server now normalizes by SAM's reported w/h (this was a real bug: half-scale box, crop on blank wall, invisible prop). The mask body is `<h>,<w>,` plus a base94-range RLE string; decoding it is still open and would replace flood-fill.
- Prototype limits: flood-fill struggles with multi-tone backgrounds (fringe remnants remain); the photo texture lives only in the capturing client; one object per prompt.
- Debug hooks kept: `window.art_state()` (subjects/pending/sprites) next to the existing playtest hooks, plus a `[photo]` console line with box/crop/cut sizes.
- Uncommitted: camera prototype (contract, server/photo.ts, index, client, ADR 0010) plus user-generated airplane/cloud sheets. Needs the owner's explicit "commit and push".

## Status update — 2026-10-28 (find/click + pixel imports, uncommitted)

- Camera flow is now find-then-bring: SAM detection is previewed as a green box on the captured photo ("the green box is what enters the game"), SAM prompt retries (label → last word → "object") rescue most misses, and clicking the object in the preview cuts around the click with no SAM at all. All three paths verified live in the browser.
- Photo imports are pixel-art by default (56-row grid, posterized, nearest-neighbor; checkbox in the modal): a photographed mug now enters as a chunky pixel mug that matches the game's art.
- Real-world note: a hand-held soda can came in with a loose box (can + fingers) under the old blind flow; the green-box preview exists precisely so that case is visible before committing, with click as the override.
- SAM mask decode: six encoding hypotheses tested and rejected (see ADR 0010 amendment); flood-fill remains the cutout until that codec is cracked.
- Uncommitted: find/click/pixel-import changes. Needs the owner's explicit "commit and push".

## Status update — 2026-10-28 (polish + combat rules, uncommitted)

- HUD is now a fixed viewport layer (orb chat top-center with feedback, drawer toggle) over a layout that can never scroll the page; sidebar scrolls internally. Camera is render-smoothed: player at 38% width, feet at 90% height, ground resting at the bottom at any window size. Starter world auto-loads.
- Objects are clickable: a radial menu blooms around an entity (Bigger/Smaller/Front/Back/Remove). Generated sprites render in layers (scenery → photos → creatures → player always front), with a 240px sprite-height sanity cap. Magenta fringe on generated sheets is despilled/eroded in the slicer. Tornadoes classify as scenery now; Wonder has pixel-size guidance (30–70px creatures, >200 only when "giant").
- Camera imports: background-diff capture (remember empty scene → only new pixels enter), wand click now highlights the whole object with strict tolerances + sensitivity slider, SAM green-box find and pixel-art conversion all verified live.
- Combat & targeting rules (ADR 0011): default creatures wander; hostiles hunt only when asked; heroes fight hostiles, never the player. Everything defaults to 100 HP, `api.damage` destroys at 0 (health bars render), and the player auto-respawns after a knockout. Verified live: hunter killed the player, a guardian destroyed the hunter, player respawned.
- Bug root-caused: "ground keeps disappearing" was the 500-entity cap evicting the oldest entities (ground first) when spawner mods leaked entities (raindrops landing and freezing). Cap now evicts the spawner's own oldest first; rain despawns landed drops. Owner-scoped despawn also stops mods deleting each other's entities. Commands route to hand-built mods by EXACT match only (client + server) — creative sentences go to Wonder.
- Tests: 25/25 (new: owner-despawn, health/damage, rain-soak, cap eviction). One anomaly seen once (a hero idling in live play) not reproduced in sim or a second live run; watching it.
- Uncommitted: everything since 16609c8. Needs the owner's explicit "commit and push".

## Status update — 2026-10-28 (celestial scenery)

- Sun/moon/etc. now classify as scenery via `isScenerySubject`.
- Scenery prompt hardened to ONLY-the-subject after a landscape composition (sun + rock piles); art subjects strip trailing locative phrases ("in the sky").
- Giant sun verified faceless/static in-game.
- Async-art + scenery work being committed at the owner's request.

## Status update — 2026-10-29 (orchestration + voice merged)

- Orchestration: `main` session orchestrates; `top`/`bottom` sessions work in leased worktrees (`scripts/wt.sh`), talk directly, and track work as beads. Ports come from `.env` so worktrees run live side by side. Protocol: `docs/ORCHESTRATION.md`; plan: `docs/WINPLAN.md`.
- Voice merged (bead gju, ADR 0012): hold Shift (or a gamepad shoulder), the orb pulses with mic volume, Muse Voice Transcribe partials show under it, release submits. Audio goes over the existing WebSocket as binary PCM16 16 kHz; the server proxies to a pre-warmed Meta session (key never in the browser). Worktree check 10/10 correct; re-checked on main 4/4, release→final p50 126 ms, press→first partial ~1.0 s (Meta emits after the first word).
- Rough: the first press asks for mic permission and is a throwaway; the mic stays open after that; gamepad hold untested live. Deploy must cap warm voice sessions (one per connected client; Meta limit 256 concurrent).
- Gates on main after merge: tsc clean, 41/41 tests, build green.
- Starter level will gain a low overhang (verifier lease) so "make me huge" fails honestly.
