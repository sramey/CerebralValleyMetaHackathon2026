@AGENTS.md

## How we work now (from 2026-10-29)
- One orchestrator chat owns `main`; two worker windows (top, bottom) each work in a leased git worktree. Protocol: `docs/ORCHESTRATION.md`. If you're a worker, your brief is in `C:\Users\srame\source\metabuild-wt\_leases\<task>.md`: stay inside your worktree and branch.
- Win plan and remaining schedule: `docs/WINPLAN.md`. Every lease must move a line in it; anything else waits.

## Hard rule: Meta inside the product
Every AI call the game makes at runtime goes to a Meta model or Meta agent feature (Spark, Wonder, Muse Image, SAM 3.1, Voice Transcribe, and Wonder's agent features: tools, sub-agents). No other AI provider inside the product, ever. Using more of Meta's stack for real jobs is a scoring goal (Meta tooling = 25%), so when a lease could use a Meta capability instead of hand-written code, prefer it and say so in the Report.

## Lessons (append as we learn; keep each to one line)
- Meta calls need `reasoning_effort: "minimal"` or replies come back empty (ADR 0001).
- The verifier runs each mod alone in an empty world (ADR 0003): tests must spawn their own ground.
- Entity-cap eviction once deleted the ground; spawner mods must despawn what they make.
- Server/client ports come from `.env` (`PORT`, `VITE_PORT`, `VITE_WS_URL`) so worktrees run live side by side.
