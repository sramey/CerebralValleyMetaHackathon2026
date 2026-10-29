You are worker2 (server peer window). The orchestrator (main chat) is talking to you through this session. Work in <workspace>\metabuild.

READ FIRST: docs/WORKERS.md (your slice), docs/META-API.md, docs/DESIGN.md sections 7,8,13,14, docs/SPIKE.md, src/contract.ts (fixed — do not change it; flag the orchestrator via docs/handoffs/worker2-status.md if it must change), progress.md.

STATE: Client is done and playable (Pixi, text box, mod cards, WS client expecting ws://127.0.0.1:8787 with ServerMsg/ClientMsg from src/contract.ts). server/meta.ts EXISTS (loadEnv + chat for muse-spark-1.2 / muse-wonder-1.0; .env key verified live, NEVER print/commit it). server/index.ts does NOT exist yet — `npm run server` fails and the game shows "Server: offline". Closing that gap is the top priority.

YOUR SLICE (only these): server/**, scripts/**
DO NOT TOUCH: src/sim/**, src/mods/**, tests/**, index.html, src/client/**, src/contract.ts, package.json. Imports you may use from worker1: World (src/sim/world), ModLoader + runModTest (src/sim/loader), no file extensions.

TASKS:
1. server/prompt.ts — Wonder system prompt + mod-API reference matching src/contract.ts exactly (export default mod object, no imports, no markdown fences in output), plus world-manifest formatting.
2. server/compile.ts — forbidden-token check (FORBIDDEN_MOD_TOKENS) + esbuild TS->ESM transform.
3. server/verify.ts — verifyMod(source, compiled): dynamic-import compiled mod, load in fresh World+ModLoader, 600 headless frames, fail on exception/NaN/entity count >500, report avg ms/frame, run mod test() via runModTest. Bad mods return {ok:false, errors}; never crash the server.
4. server/index.ts — WebSocketServer on 8787 per contract protocol: on command -> stage routing (Spark JSON route: tweak/new/edit/undo/question against manifest) -> writing (Wonder) -> compiling -> verifying -> ONE auto-fix round -> send {kind:"mod"} + timing; tweak -> {kind:"tweak"}; undo -> {kind:"removed"}; question/failure -> {kind:"say"}. If MODEL_API_KEY missing, still run and answer with say. Log timing per command.
5. scripts/benchmark.ts — Spark router + Wonder mod latency table; Image/SAM/transcribe rows marked skipped.
6. Verify yourself: `npx tsc --noEmit` (your files only), start server, prove it listens on 8787 and answers one WS message (question or hello), then stop it. Do not leave it running.

WHEN DONE: write docs/handoffs/worker2-status.md with: files created, smoke output, verify isolation choice (worker thread vs in-process), anything blocked. Do NOT commit or push — the orchestrator commits.