# ADR 0043: "How does this work?" — explain a mod in plain words

- **Status:** Draft
- **Date:** 2026-10-29

## Context
Every object in the game is a mod with real code, and the player can click it. That is the whole education pitch — learn to code by talking — but the code is invisible unless you are the one who wrote it (Wonder). We want the shortest path from "what is that?" to "I read what the code does": one radial-menu action on any object, an answer in three sentences a nine-year-old can read, and the three lines of code that matter shown beside it. Acceptance: the explanation appears in under 5 s, repeating it is cached, and it respects the spend guard. Measured Muse Spark latency for a small JSON reply is p50 ~0.7 s / p95 ~3.2 s (`docs/META-API.md`), so a single Spark call fits the budget.

## Decision
The client sends `explain { modId }` only — never code. The server already holds every verified mod's source in its per-session manifest (builtins adopted from `src/mods`, share-link worlds included), so it explains its own copy. `server/explain.ts` owns one prompt (source with real 1-based line numbers), one parser and one cache:

- **Parser, not trust.** The reply is `{"say": "...", "lines": [n, n, n]}`. Sentences are cut to three, markdown stripped, and every line number is validated against the file — out-of-range, duplicate or non-integer numbers are dropped and topped up from a deterministic heuristic (`api.spawn(`, `.onTick(`, `knobs:`, `dispose()`, `setup()`, `export default`). A model that answers in prose, or a truncated JSON body, still yields a usable card.
- **Cache per source hash** (sha256 prefix, bounded LRU of 128). A repeat click is free and instant; a rebuilt mod's source has changed, so it misses and gets a fresh explanation.
- **One Meta call, spend-guarded.** Explanations are their own spend bucket (`explain`, default 40 per visitor and 800 globally per UTC day, `BUDGET_*_EXPLAINS`), because clicking things to learn should not eat a family's build budget. A cache hit spends nothing at all.
- **Two answers without a model.** An engine-owned object (`owner: "engine"`) and a page with no server both get a local three-sentence card instead of an error.

## Consequences
- New wire kinds: `explain` (client) and `explainResult` (server). Both are validated at the door and covered by the fuzz tests; no code travels on either.
- `budget.Kind` gains `explain`. The persisted counter file is now completed with 0 for any kind it predates, so an old `budget.json` cannot turn a new bucket into NaN.
- A moved or re-parsed line is never shown: line numbers are resolved against the source we hold, so the highlight cannot point at the wrong code, only at less interesting code.
- The panel is a snapshot; it does not follow a later edit of the same mod (click again for the current one).
- Source sent to Spark is capped at 14k characters; a longer mod is explained from its head, and the reply then says how many lines were not shown.
- Stats do not yet report explanation counts; the build log is untouched by design (one JSONL line per build).

## Alternatives considered
- **Send the source from the client.** The client would have to keep and upload code the server already verified; more bytes, more trust surface, no benefit.
- **Show the whole file with highlights.** A 200-line file is a wall of text for a beginner. Three key lines plus the card's sentence 3 ("try changing this") is the teaching unit.
- **A second model pass to choose the lines.** Doubles cost and latency for a decision the parser can make safely; the model's own picks are used when they are valid.
- **Reuse the build bucket.** Simpler, but 20 builds a day is a demo-scale budget and this feature is meant to be clicked freely; a separate generous bucket is cheaper than a family running out mid-explanation.
- **Explaining the entity instead of the mod.** The clicked object is usually one of several an entity's mod creates; the mod is the thing with code.
