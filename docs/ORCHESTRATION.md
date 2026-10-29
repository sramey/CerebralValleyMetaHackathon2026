# Orchestration: leases, worktrees, merges

Replaces `docs/WORKERS.md` (kept as the spike-era record).

## Roles
- **Orchestrator** (the `main` session, senior engineer): owns `main`, decides priorities, triages beads, leases worktrees, reviews, merges, cleans up. Pings the owner only for things the owner must decide or know (see below).
- **`top` / `bottom`** (worker sessions): each holds **one lease (one bead) at a time** and works only inside its worktree.
- **Owner** (the human): makes product calls, adds work as beads, and is the only one who says "push".

## Channels
- **Talk:** the orchestrator messages `top` and `bottom` directly (SendMessage); workers message `main` back. No note files.
- **Track:** every piece of work is a **bead**. Workspace: `C:\Users\srame\source\metabuild-ideation\.beads`; from a worktree, set `BEADS_DIR` to that path. The bead holds the goal, acceptance, worktree and ports. The owner can add beads any time; the orchestrator triages them against `docs/WINPLAN.md`.

## Layout
```
C:\Users\srame\source\metabuild              main (orchestrator only)          server :8787  vite :5173
C:\Users\srame\source\metabuild-wt\<task>    branch wt/<task> (one worker)     server :8790+slot  vite :5180+slot
```
Slot 1 = `top`, slot 2 = `bottom`, slot 3 = Antigravity (headless), further slots = OpenCode (headless) or overflow; each lease gets the next free slot so ports never clash. Headless workers can't receive messages: the orchestrator writes a brief file (rules + bead), runs them in the background, and reviews their final report and branch.

## Lease lifecycle
1. **Lease.** The orchestrator commits anything pending on `main`, runs `scripts/wt.sh new <task> <slot>`, makes sure the bead holds goal, acceptance, files owned/off-limits and a pre-assigned ADR number, and messages the window with the bead id, worktree and ports. The worker claims it (`bd update <id> --claim`).
2. **Work.** The worker stays in its worktree, commits small and often **on its branch only**, and never touches `main`, other worktrees, or the push button. Blocked or a real choice to make → message `main`.
3. **Hand back.** Gates green (`npx tsc --noEmit`, `npm test`, `npm run build`, plus a live check on its own ports), work committed, report added to the bead (`bd update <id> --notes`). Then the worker messages `main`: done, commits, evidence, what's rough. Follow-up work becomes new beads.
4. **Merge.** The orchestrator reviews `git diff main...wt/<task>`, merges with `--no-ff` into `main`, re-runs the gates on `main`, smoke-tests live, updates `progress.md` / `README.md` / ADR index, runs `scripts/wt.sh done <task>`, and closes the bead.
5. **Re-lease.** The window gets its next bead.

## Rules that keep merges cheap
- Prefer **new files** over edits to hot files. `src/client/main.ts` and `server/index.ts` are shared: add a module and wire it in with a few lines.
- Wire-protocol additions go in `src/contract.ts` as **new union members only**; never rename or change existing ones.
- Workers don't edit `progress.md`, `README.md`, `docs/adr/README.md` or `docs/DESIGN.md`; they put that content in their hand-back and the orchestrator lands it at merge.
- ADR numbers are pre-assigned per lease so two branches never collide.
- New npm dependency = stop and ask the orchestrator (`node_modules` is a shared junction).
- Never commit `.env` (each worktree's `.env` holds its lease ports).

## Commits and pushes
- Local commits on `wt/*` branches and local `--no-ff` merges into `main` are delegated to the orchestrator (owner, 2026-10-29).
- **Pushing to GitHub still needs the owner's explicit "push".** The repo is public and judged.

## When the orchestrator pings the owner
- A product or demo decision (anything in `DESIGN.md`'s locked decisions, the demo script, cuts).
- Spend: anything that could burn Meta credit fast, or a new paid service or account (hosting, domains).
- Rules risk (originality, what may appear in the demo).
- Accepting ADRs (only the owner marks Accepted).
- A lease that's blocked or will miss its day.

Everything else (task order inside a day, code review calls, merge conflict resolution, refactors) the orchestrator decides and records in `progress.md`.
