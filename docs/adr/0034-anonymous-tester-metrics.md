# 0034: Anonymous family-test metrics (?tester=N)

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** Sunday's non-coder test (bead 3hu) is our Impact evidence. The owner should get numbers without taking notes, and the repo is public, so nothing personal can be recorded or committed: no names, and no prompts (a prompt can name a person or leak private words).
- **Decision:** A page opened with `?tester=N` (N is an anonymous index 1 to 99) sends `{ kind: "tester", n, ev, cid?, mood? }` messages over the existing WebSocket: `open`, `typed`, `voice`, `landed`, `rejected`, `failed`, `mood`, `close`. `cid` is a per-session command counter that pairs a rejection with the later landing. `mood` is the slug of the mood the game picked, never the player's words. The server whitelists those fields (`server/testers.ts`), adds a timestamp and a random per-connection session id, and appends rows to `logs/testers.jsonl` (gitignored); it also logs `close` when the socket drops. `npm run testers` merges each tester's sessions, prints a per-number table to the console and writes `docs/evidence/user-test.md` with aggregates only (no per-person rows). Without the flag nothing is sent.
- **Consequences:**
  - One additive `ClientMsg` kind; no new endpoint or dependency.
  - Session length is the last event minus the first (summed over reloads), so a tab closed without a clean disconnect can read short; the server's socket-close row covers most cases.
  - "Builds attempted" counts commands that reached the server, so local one-click chips and local phrases (for example "add coins") are not counted, but a local build still moves the onboarding coach.
  - Per-person rows exist only on the owner's machine; with 3 to 5 testers the committed page reports medians and ranges, not individuals.
