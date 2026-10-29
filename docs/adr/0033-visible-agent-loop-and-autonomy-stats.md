# 0033: Show Wonder's tool loop live, and measure its autonomy

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** Wonder already runs as a tool-using agent (ADR 0013, 0016): it can call
  `inspect_world`, writes a draft, playtests it with `run_playtest`, reads a rejection and
  retries. A viewer saw none of that, only a progress bar. For a judge scoring autonomy, the
  loop has to be visible on screen, and the numbers have to come from the game's own log.
- **Decision:** `runAgent` takes an `onStep` callback fired after every tool call with a
  one-line args summary and a one-line result (`summarizeArgs`, `summarizeResult` in
  `server/agent.ts`). The server forwards each as a new additive `agentStep` message
  (`command`, `phase` write|fix, `n`, `tool`, `args`, `result`, `ok`, `ms`). The pipeline lane
  for that command renders a chip chain (inspect, write, playtest, rejected, fix, write,
  playtest, pass; `src/client/agent-steps.ts`, pure and tested) plus one detail row per call.
  The build log's `agent` object gains `playtests` and `rejected`; `GET /api/stats` gains an
  allow-listed numbers-only `agent` block (`builds`, `callsPerBuild`, `playtests`,
  `rejected`, `selfCorrected`, `selfCorrectedPct`) and the P panel a second row of three tiles.
  "Self-corrected" means a landed agent build that had a rejected playtest or needed the
  fix round. The tool rules now tell Wonder to call `inspect_world` first when the request
  changes something that already exists.
- **Consequences:**
  - One new `ServerMsg` kind and one new `StatsFeed` field (both additive); older log lines
    without the new fields are derived from their `tools` trace.
  - Result lines can contain the playtest's plain-language reason, never source or paths;
    the stats feed still carries numbers only (ADR 0027).
  - Whether Wonder actually calls `inspect_world` is the model's choice, so a given build
    may show no inspect step. The chain shows what happened, not a script.
