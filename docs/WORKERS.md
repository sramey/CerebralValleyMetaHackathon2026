# Worker coordination — spike build

Orchestrator = main chat. worker1 / worker2 = separate chat windows in this same repo.
Share work **only through files in this repo**. Read this file + `src/contract.ts` before starting.
Do not edit another worker's slice. If the contract needs changing, stop and flag the orchestrator.

## Already done (orchestrator)

- Repo pushed: `990a62c` on `main`.
- `.env` present with `MODEL_API_KEY` (gitignored, verified live: Spark + Wonder both 200, <1s).
- `npm install` done. `esbuild`, `vite`, `tsc` binaries verified.
- Foundation: `package.json`, `tsconfig.json`, `vite.config.ts`.
- Fixed contract: `src/contract.ts` — sim, server and client all build to it. Do not change it unilaterally.
- Started (partial, keep or rewrite inside your slice): `src/sim/rng.ts`, `server/meta.ts`.

## worker1 — engine slice

Owns: `src/sim/**`, `src/mods/**`, `tests/**`

1. `src/sim/world.ts` — deterministic 60Hz `World`: seeded RNG only (no `Math.random`/DOM/clock), gravity, AABB vs solids, particles, camera follows player.
2. `src/sim/loader.ts` — `ModLoader` (`load`/`unload`/`list`, scoped `ModApi`, owned cleanup on dispose) + `runModTest(def)`.
3. `src/mods/` — sample mods (player, ground, enemy, rain), each with `setup`/`dispose`/`knobs`/`test()`.
4. `tests/` — vitest: determinism, physics landing, clean unload, each sample mod's `test()` passes.
5. Done when: `npx vitest run tests` is green.

## worker2 — server slice

Owns: `server/**`, `scripts/**`

1. `server/meta.ts` — Meta client (Spark `muse-spark-1.2`, Wonder `muse-wonder-1.0`); never print/commit the key.
2. `server/prompt.ts` — Wonder prompt + mod-API reference matching `src/contract.ts` exactly.
3. `server/compile.ts` — forbidden-token check + esbuild TS→ESM.
4. `server/verify.ts` — `verifyMod()`: 600 headless frames, no NaN/exceptions, bounded entities, ms/frame reported, mod `test()`; bad mods return errors, never crash the server.
5. `server/index.ts` — WebSocket server on 8787: route (Spark) → write (Wonder) → compile → verify → one auto-fix → hot-load message; timing log per command.
6. `scripts/benchmark.ts` — Spark/Wonder latency only; Image/SAM/transcribe marked skipped for now.
7. Done when: server listens on 8787, sends hello, and survives a bad-mod command.

Imports from worker1 (agree, don't invent others): `World` from `src/sim/world`, `ModLoader` + `runModTest` from `src/sim/loader`. Relative imports with no extension.

## Orchestrator — client + integration

Owns: `index.html`, `src/client/**`, `src/contract.ts`, this file.

Pixi/canvas rectangle rendering, text box, mod cards with undo/knobs, orb placeholder, WebSocket client. Then: review worker slices as they land, run `npm test` + `npm run build`, live dev+server smoke, final play, and commit/push only when told.

## Rules for everyone

- Sim core is pure + deterministic: fixed step, seeded RNG, no DOM/wall-clock.
- Mods: mod API only, no DOM/network/`eval`/`Function`, every mod has `dispose()` + `test()`.
- Sim budget < 2 ms/frame. Original IP only.
- Small commits, named files only (`git add <files>`), no broad `git add .` while other windows are mid-write.
