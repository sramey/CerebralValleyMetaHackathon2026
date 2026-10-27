# ADR 0006: Build work is delegated to Spark subagents by file ownership

- **Status:** Draft
- **Date:** 2026-10-27

## Context

The project first tried coordinating separate Muse chat windows ("worker1/worker2") as peers. That channel does not exist in this environment: `muse exec --session-id` fails with "session is already in use" on live windows, and `muse session-message` reports "local session messaging is unsupported on this platform". The `list_peer_sessions` / `send_session_message` tools exist in the binary but are not granted to this session. Meanwhile the work splits naturally into disjoint slices with clean contracts (`src/contract.ts`).

## Decision

The main chat acts as **orchestrator** and delegates slice work to **Muse Spark 1.3 contributor subagents** (`muse-spark-1.3`), two at a time, each with:

- an exclusive file-ownership slice (e.g. worker1 = `src/sim`, `src/mods`, `tests`; worker2 = `server`, `scripts`),
- the fixed contract file to build against, and explicit "do not touch" lists,
- instructions to self-verify with the project's own tests/typecheck,
- a compact structured return: complete / evidence / unresolved.

The orchestrator independently re-runs tests, typecheck, build, and browser play before trusting any claim, writes the integration code (`src/client`), and is the only role that commits or pushes — and only when the owner says so.

## Consequences

- Parallel slices land in minutes; both completed rounds passed independent verification with zero contract changes needed.
- File-ownership discipline is load-bearing: two writers in one checkout are safe only because slices are disjoint and the contract is fixed up front.
- Spark at contributor settings is weaker than the orchestrator's model; briefs must carry exact exports, commands, and prohibitions, and every claim is re-verified. Judgment calls the workers make (e.g. tweak-with-bad-knob → edit) are reviewed, and were in that case adopted into ADR 0005.

## Alternatives considered

- **Separate chat windows as workers:** no working message channel (evidence above); the owner relaying prompts by hand does not scale.
- **Sequential solo building:** no parallelism; engine + server + client in one context also blurred the contract boundaries that make the slices testable.
- **Isolated worktrees per worker:** safer against write collisions, but slices are already disjoint; the merge cost was not justified. Revisit if slices ever need to overlap.
