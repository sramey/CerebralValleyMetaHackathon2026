# 0032: Command router can run on Muse Spark Open (open weights) via Baseten

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** The hackathon has a bonus for using Meta's open-weights models served by a
  partner. Muse Spark Open (`meta-models/muse-spark-open-1026`) is the open-weights sibling
  of the hosted Muse Spark we already use, and Baseten serves it on an OpenAI-compatible
  endpoint. The command router is the best job to give it: one short, structured call on
  every command, easy to compare for latency, and a failure is cheap because the hosted
  model can answer instead. The Baseten key is not available yet, so the path must ship
  dormant and switch on without a code change.
- **Decision:** `server/router-model.ts` routes the router call. When `BASETEN_API_KEY` is
  set it POSTs to `https://inference.baseten.co/v1/chat/completions` (Baseten's documented
  base URL; auth is `Authorization: Bearer <key>`, the form its docs show) with
  `reasoning_effort: "minimal"`. Any HTTP error, timeout (`BASETEN_TIMEOUT_MS`, default
  4000 ms) or empty reply falls back to hosted `muse-spark-1.2` for that call. With the
  key unset nothing changes: hosted Spark, no Baseten request. `BASETEN_BASE_URL` and
  `BASETEN_MODEL` override the URL and slug (used by tests against a local mock, and in
  case Baseten's catalog spells the slug differently; `GET /v1/models` lists it). The
  server sends a `routed` message (`model`, `open`, `ms`, `fellBack`) after every route;
  the orb shows "routed by <model>" and the pipeline's Spark node names the model that
  answered. `npm run bench:router` measures p50/p95 for both on ten fixed commands.
- **Consequences:**
  - Hard rule intact: Muse Spark Open is a Meta model, hosted by a partner.
  - A new optional env var and a new `ServerMsg` kind (additive).
  - The router prompt and parser are shared, so both models must emit the same JSON; the
    bench counts replies without an `"action"` field.
  - The Baseten slug and `reasoning_effort` acceptance are unverified until the key exists;
    the fallback keeps the product working either way.
  - Wonder (mod writing) stays on hosted Wonder; moving it is a separate decision.
