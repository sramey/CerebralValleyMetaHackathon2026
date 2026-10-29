# Orchestration: leases, worktrees, merges

Replaces `docs/WORKERS.md` (kept as the spike-era record).

## Roles
- **Orchestrator** (the main chat, senior engineer): owns `main`, decides priorities, writes briefs, leases worktrees, reviews, merges, cleans up. Pings the owner only for things the owner must decide or know (see below).
- **Top window / bottom window** (worker chats): each holds **one lease at a time** and works only inside its worktree.
- **Owner** (the human): relays "done" between windows, makes product calls, and is the only one who says "push".

## Layout
```
C:\Users\srame\source\metabuild              main (orchestrator only)          server :8787  vite :5173
C:\Users\srame\source\metabuild-wt\<task>    branch wt/<task> (one worker)     server :8790+slot  vite :5180+slot
C:\Users\srame\source\metabuild-wt\_leases   LEDGER.md + one brief per task (outside git)
```
Slot 1 = top window, slot 2 = bottom window.

## Lease lifecycle
1. **Lease.** Orchestrator commits anything pending on `main`, runs `scripts/wt.sh new <task> <slot>`, writes `_leases/<task>.md` (goal, done-bar, files owned, files off-limits, pre-assigned ADR number), and adds a LEDGER row. The owner pastes into the window: `Read C:\Users\srame\source\metabuild-wt\_leases\<task>.md and do it.`
2. **Work.** The worker stays in its worktree, commits small and often **on its branch only**, and never touches `main`, other worktrees, or the push button.
3. **Hand back.** Gates green (`npx tsc --noEmit`, `npm test`, `npm run build`, plus a live check in its own ports), work committed, then the worker fills the **Report** section of its brief and tells the owner "done".
4. **Merge.** Orchestrator reviews `git diff main...wt/<task>`, merges with `--no-ff` into `main`, re-runs the gates on `main`, smoke-tests live, updates `progress.md` / `README.md` / ADR index, then `scripts/wt.sh done <task>` and closes the LEDGER row.
5. **Re-lease.** The window gets its next brief.

## Rules that keep merges cheap
- Prefer **new files** over edits to hot files. `src/client/main.ts` and `server/index.ts` are shared: add a module and wire it in with a few lines.
- Wire-protocol additions go in `src/contract.ts` as **new union members only**; never rename or change existing ones.
- Workers don't edit `progress.md`, `README.md`, `docs/adr/README.md` or `docs/DESIGN.md`; they put that content in their Report and the orchestrator lands it at merge.
- ADR numbers are pre-assigned in the brief so two branches never collide.
- New npm dependency = stop and ask the orchestrator (node_modules is a shared junction).
- Never commit `.env` (each worktree's `.env` holds its lease ports).

## Commits and pushes
- Local commits on `wt/*` branches and local `--no-ff` merges into `main` are delegated to the orchestrator (owner, 2026-10-29).
- **Pushing to GitHub still needs the owner's explicit "push".** The repo is public and judged.

## When the orchestrator pings the owner
- A product or demo decision (anything in `DESIGN.md`'s locked decisions, the demo script, cuts).
- Spend: anything that could burn Meta credit fast, or a new paid service/account (hosting, domains).
- Rules risk (originality, what may appear in the demo).
- Accepting ADRs (only the owner marks Accepted).
- A lease that's blocked or will miss its day.
Everything else (task order inside a day, code review calls, merge conflict resolution, refactors) the orchestrator decides and records in `progress.md`.
