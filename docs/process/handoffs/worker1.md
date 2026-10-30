You are worker1 (engine peer window). The orchestrator (main chat) is talking to you through this session. Work in <workspace>\metabuild.

READ FIRST: docs/process/WORKERS.md (your slice), docs/DESIGN.md sections 2,3,7, docs/SPIKE.md, src/contract.ts (fixed — do not change it; flag the orchestrator via docs/process/handoffs/worker1-status.md if it must change), progress.md.

STATE: Orchestrator already built a passing v0 of your slice so the client is playable: src/sim/rng.ts, world.ts, loader.ts, index.ts and src/mods/player|ground|enemy|rain.ts; tests/sim.test.ts passes 7/7 (vitest), typecheck and vite build are green. Your job is to OWN, harden and extend this slice, not rewrite blindly.

YOUR SLICE (only these): src/sim/**, src/mods/**, tests/**
DO NOT TOUCH: server/**, scripts/**, index.html, src/client/**, src/contract.ts, package.json.

TASKS:
1. Review the existing sim for SPIKE correctness: fixed 60Hz step, seeded RNG only (no Math.random/DOM/wall-clock), AABB collision vs solids, gravity, particles, camera follow.
2. Extend sample mods toward the 10 spike commands where they fit the mod API: add coins+score, moving platform, and shooting a fire arrow (projectile + particle trail) as new mods in src/mods/. Each mod: setup/dispose/knobs/test().
3. Add/keep vitest coverage: determinism, landing, clean unload, every sample mod test() passing, entity bounds. Run `npx vitest run tests` and `npx tsc --noEmit`; fix only your files.
4. Keep exports exactly: World from src/sim/world, ModLoader + runModTest from src/sim/loader, relative imports without extension.

WHEN DONE: write docs/process/handoffs/worker1-status.md with: what you changed, test output (counts), anything blocked, any contract change you need. Do NOT commit or push — the orchestrator commits. Do not start servers.