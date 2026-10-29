@AGENTS.md

## How we work now (from 2026-10-29)
- One orchestrator chat owns `main`; two worker windows (top, bottom) each work in a leased git worktree. Protocol: `docs/ORCHESTRATION.md`. The orchestrator talks to the windows directly and all work is tracked as beads (`BEADS_DIR=<workspace>\metabuild-ideation\.beads`). If you are a worker: claim your bead, stay inside your worktree and branch, and message `main` when done.
- Win plan and remaining schedule: `docs/WINPLAN.md`. Every lease must move a line in it; anything else waits.

## Hard rule: Meta inside the product
Every AI call the game makes at runtime goes to a Meta model or Meta agent feature (Spark, Wonder, Muse Image, SAM 3.1, Voice Transcribe, and Wonder's agent features: tools, sub-agents). No other AI provider inside the product, ever. Using more of Meta's stack for real jobs is a scoring goal (Meta tooling = 25%), so when a lease could use a Meta capability instead of hand-written code, prefer it and say so in your hand-back.

## Lessons (append as we learn; keep each to one line)
- Meta calls need `reasoning_effort: "minimal"` or replies come back empty (ADR 0001).
- The verifier runs each mod alone in an empty world (ADR 0003): tests must spawn their own ground.
- Entity-cap eviction once deleted the ground; spawner mods must despawn what they make.
- Server/client ports come from `.env` (`PORT`, `VITE_PORT`, `VITE_WS_URL`) so worktrees run live side by side.
- Antigravity (`agy`) can be a third worker, but only headless: `agy -p "<brief>" --model gemini-4-argon-high --dangerously-skip-permissions` from inside a slot-3 worktree (owner approved skip-permissions 2026-10-29). `--mode auto` isn't available on this account, and without skipping permissions a headless run stalls. The owner's interactive `agy` window can't receive SendMessage.
- OpenCode can run two more headless workers: `opencode run -m opencode-go/<model> --auto --title <bead> "<brief>"` from inside the leased worktree (owner approved `--auto` 2026-10-29). Use OpenCode Go subscription models (kimi-k3.1-pro, glm-5.3), never pay-per-token OpenRouter, without asking. Brief = scratchpad worker preamble + `bd show <id>`.

## Public repo: nothing personal or secret
This repo is public and judged. Never commit keys, tokens, `.env`, emails, personal names/paths (use relative paths, not `C:\Users\...`), family/tester identities, raw logs or recordings with private info. If something must exist locally, put it under a gitignored path (`logs/`, `data/`, `.env*`, `output/`). Check `git diff --cached` for this before every commit; workers too.
- OpenCode Go has a usage cap: two workers hit "Go usage limit exceeded" after ~1 h each (10-29). One worker also printed `.env` (with the key) into its transcript: the brief now forbids printing `.env`; check worker logs for secrets before keeping them.
