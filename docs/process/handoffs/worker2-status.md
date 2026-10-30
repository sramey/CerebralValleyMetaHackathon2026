# worker2 status — server slice (spike v0)

## Files created (server/**, scripts/** only)
- `server/prompt.ts` — `MOD_API_REFERENCE` (matches `src/contract.ts`: ModApi/ModDefinition/TestApi, no-imports/no-fences rules, forbidden tokens), `WONDER_SYSTEM`, `buildWonderPrompt(command, manifest)`, `buildFixPrompt`, `ROUTER_SYSTEM` + `buildRouterPrompt` (Spark JSON routing), `formatManifest`.
- `server/compile.ts` — `FORBIDDEN_MOD_TOKENS` check (layer 0, pre-compile) + esbuild `transformSync` TS→ESM. Never throws. Note: esbuild rewrites `export default X` to `export { … as default }`, so the export check matches `/export\s*(default|\{)/`.
- `server/verify.ts` — `verifyMod(source, compiledJs)`: cache-busted `data:`-URL dynamic import, shape check (id/title/setup/dispose), fresh `World(1234)` + `ModLoader`, 600 headless frames, fail on exception / NaN / entities > 500 / > 2 ms-per-frame, runs `runModTest`, checks dispose cleaned up. Returns `{ok:false, errors}` — never throws.
- `server/index.ts` — `WebSocketServer` on 127.0.0.1:8787. Hello `say` on connect. `command` → `stage:routing` (Spark JSON new/tweak/edit/undo/question vs manifest) → `writing` (Wonder) → `compiling` → `verifying` → one `fixing` round → `mod` + `timing`; `tweak` → `tweak`; `undo` → `removed`; question/failure → `say`. Missing key still runs, answering `say`. Per-message try/catch. Direct `undo`/`knob` client messages handled against the server manifest.
- `scripts/benchmark.ts` — measures Spark-router + Wonder-mod latency (3 runs each, p50/p95); Image / SAM / transcribe rows print `skipped`.

Nothing outside `server/**` + `scripts/**` touched. No commit/push (orchestrator commits).

## Smoke output
- `npx tsc --noEmit` → exit 0 (whole project).
- `npx tsx server/index.ts` → `meta server listening on ws://127.0.0.1:8787`.
- WS probe (node + repo `ws` package): `OPEN` → recv hello `say` → sent `{kind:"command",text:"hello"}` → recv `stage:routing` → recv `say` "I didn't quite get that…" → recv `timing {route:2604,…}` → close. Spark routing live (~2.6 s).
- Direct compile/verify probe (deleted after): good mod → compile ok, verify ok (0.0005 ms/frame, 1 entity); `fetch` mod → `forbidden token: fetch`; NaN mod → verify fail `NaN or non-finite…`. Server stopped after smoke; not left running.

## Verifier isolation choice
In-process dynamic import of a cache-busted `data:` URL (counter + timestamp fragment). Rationale for spike v0: mod code is already constrained (no imports possible — Wonder prompt forbids them, forbidden-token check runs pre-compile, and a `data:`-URL module cannot resolve relative imports anyway), each import gets a fresh URL so no module-cache cross-talk, and every await point is wrapped so verifyMod never throws. A worker thread (per docs/SPIKE.md) would add true fault isolation against infinite loops / event-loop blocking — recommended follow-up if Wonder ever emits a tight infinite loop; current budget check only catches slow-not-hung mods.

## Blocked
- Nothing. Open question for orchestrator: `src/contract.ts` needed no changes.
