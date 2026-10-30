# How this was built (process records)

These files are not about the product. They record how the work was organized during the hackathon: one orchestrator session owning `main` and several AI worker sessions in leased git worktrees.

- [ORCHESTRATION.md](ORCHESTRATION.md): the current protocol (leases, worktrees, beads, hand-backs).
- [rehearsal-20x.md](rehearsal-20x.md): the demo commands run 20 times each against the live server, with the pass rates, the one flake it found and the fix.
- [WORKERS.md](WORKERS.md): the spike-era worker split, superseded by ORCHESTRATION.md.
- [handoffs/](handoffs/): the spike-era worker briefs and their status reports, kept as written.

For the product itself, start at the [README](../../README.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).
