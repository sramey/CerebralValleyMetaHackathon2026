# ADR 0069: "What it has learned": an in-game area for the reviewer, fixes, rules and skills

- **Status:** Proposed
- **Date:** 2026-10-30

## Context

The open-weights reviewer (ADR 0068), the verifier's auto-fix round and the learned rules and skills (ADR 0020) all work, but a viewer cannot see them. A judge should be able to open one screen, right after a build, and see how well the open-weights model does, what it fixed, and what the game learned.

## Decision

- **Endpoint, not a WS message.** `GET /api/brain` (new module `server/brain.ts`, one `brainHandler` line in `server/index.ts`) returns a `BrainFeed` (`src/contract.ts`): a scorecard, the latest fixes, every learned rule and the skills library. Same shape of decision as `/api/stats` (ADR 0027): the client polls while the area is open and also re-reads when a build settles or a "Reviewed by" line arrives.
- **Review rows grow two optional fields**: `diff` (a few removed/added line hunks, from `server/line-diff.ts`) and `rules` (the rule sentences an accepted fix taught). Old rows without them still render ("patch not recorded"). The reviewer now learns its rules just before logging, so the row and the rule agree.
- **Allow-list.** The feed carries mod ids, the reviewer's issue sentences, rule sentences and changed lines of mod code. It never carries a player command, a prompt, a key or a file path (tested).
- **No key, no problem.** With no `BASETEN_API_KEY` (or `REVIEWER=off`) the area shows the hosted-only history (build log, auto-fix saves, rules, skills) and a one-line "Open weights off" note.
- **Router comparison** uses the ADR 0032 benchmark numbers (constants in `server/brain.ts`, refreshed by `npm run bench:router`), next to the live median hosted route time from this machine's log.
- **UI:** a gold "What it has learned" button in the side panel opens a full-stage overlay (`src/client/brain.ts`); Esc closes it.

## Consequences

- One new HTTP route and two optional log fields; no WS change, no new model call, nothing on the sim path.
- Fix cards only appear for reviews made after this change (earlier rows have no diff).
- The benchmark constants can go stale if the router is re-benchmarked; the ADR 0032 table is the source.
