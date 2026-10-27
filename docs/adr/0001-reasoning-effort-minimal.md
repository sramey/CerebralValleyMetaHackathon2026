# ADR 0001: All Meta calls use `reasoning_effort: minimal`

- **Status:** Draft
- **Date:** 2026-10-27

## Context

Wonder mod-writing calls returned empty content (`content: null`, `finish_reason: length`) at 2048 and even 8192 max tokens. Raw-response inspection showed default reasoning effort burning the entire completion budget on reasoning tokens for our ~3k-char mod prompt. A tiny test prompt answered normally, which isolated the cause to prompt size × default effort. With `reasoning_effort: minimal`, the same prompt returned a complete mod in ~6s (158 reasoning tokens). Spike latency bar is <15s per new mod; the default effort also took 57s before failing empty.

## Decision

`chat()` in `server/meta.ts` sends `reasoning_effort: "minimal"` by default for every Meta call (Spark router and Wonder writer/fixer). The effort is a parameter so a future call site can raise it deliberately.

## Consequences

- Mod writes land in ~6–9s; router replies reliably inside 1024 tokens.
- Codegen quality at minimal effort proved sufficient: 10/10 spike commands passed verification on 2026-10-27.
- If a future hard mod fails repeatedly, raising effort for the *fix* call is the first knob to try — consciously, per call site.
- Guarded by `tests/meta.test.ts`, which asserts the request body carries `reasoning_effort: minimal`.

## Alternatives considered

- **Bigger `max_tokens` (8192+):** still empty at 8192 and 57s slow. Rejected by measurement.
- **Streaming partial content:** does not fix budget exhaustion; adds protocol complexity mid-spike.
- **Different model for writing:** Spark also works, but Wonder at minimal effort already meets the latency and quality bars.
