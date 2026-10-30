# 0058 — Faster builds: fewer sequential model turns

- **Status:** Draft
- **Date:** 2026-10-30

## Context

A speed review of the request-to-mod path found that compile, verify and the bot playtest
take 10 to 120 ms per mod, while a build takes 10.2 s at the median and 26.9 s at p90
(`docs/evidence/build-stats.md`). Nearly all of the time is Meta model turns run one after
another. Four of those turns did no work the server could not do itself, or could have run
at the same time as another one:

- Relative asks ("make them faster", "jump higher") routed as `edit`, so each one cost a whole
  Wonder rewrite (edit median 17.7 s). The log shows 0 knob tweaks against 19 edits; ADR 0005
  already names "jump higher" as a known miss.
- Any `add`/`make` command containing "and" or a comma waited for a Spark split call before
  the router started, even when it was one request ("make me big and fast").
- For anything that touches existing mods, Wonder spent its first turn calling `inspect_world`,
  a local call of a few ms, and then a second turn to write.
- The fix round sent a different system prompt from the write round, so a provider-side prefix
  cache (if Meta has one; unverified) could never reuse it.

## Decision

1. **Relative tweaks.** `server/relative-tweak.ts` recognizes a narrow set of whole-command
   relative asks (speed: faster/slower/speed up/slow down; jump: higher/lower; count: more/fewer
   `<thing>`). After routing, when the command is one of these and the target mod (router target,
   "me" → `player`, pronoun memory, or a mod the command names) has a matching numeric knob, the
   route becomes a `tweak`: the knob is scaled (×1.5, ×2 for "a lot", ×1.25 for "a bit") and
   clamped to its min/max. If nothing matches, or the knob is already at its limit, the router's
   route stands. Size words ("huge", "giant") are deliberately not matched, so the
   rejected-then-fixed "make me huge" beat is unchanged.
2. **Split alongside the router.** For a compound-shaped command, `handleCommand` starts the
   router call and the split call together. Two or more items build in parallel as before (the
   router reply is dropped). One item goes straight to `handleSingle` with the router call already
   in flight.
3. **Prefetched world snapshot.** `runAgent` takes `prefetch: ["inspect_world"]`, used when the
   build edits a mod, is about the player, or uses a pronoun. The tool runs before the first model
   turn and appears in the conversation as a call the model made, with its result, so the lane
   still shows it and it still counts toward the 3-call bound. The tool rule tells Wonder not to
   call it again.
4. **Small items.** The fix round's system prompt is now byte-identical to the write round's
   (the "be terse" instruction moved into its user message). `MAX_PARALLEL` defaults to 4,
   matching the split's 4-item cap, so a 4th item no longer queues behind the slowest build.

## Consequences

- A relative ask lands in one router call (~0.3 to 3 s) instead of a full Wonder build. The tweak
  is not re-verified, the same as every tweak since ADR 0005.
- The matcher is lexical: an ask it misses still takes the old edit path; an ask it catches always
  becomes a knob change, even if the user hoped for a rewrite. Knob changes are undoable with the
  slider.
- A compound command that does split now costs one extra Spark router call (dropped). Single
  "and" commands save one Spark call and its wait.
- Edits and player builds skip one Wonder turn. The snapshot adds up to 4,000 characters to those
  prompts, the same text the model used to ask for.
- No live timings yet: the cloud environment that made this change cannot reach `api.meta.ai`.
  `npm run rehearse` and `npm run stats` on a machine with a key are the before/after check.

## Alternatives considered

- **Better router prompt only:** cheapest, but the router already gets the knob list and still
  answers `edit`; ADR 0005 recorded the same miss. A deterministic rule is testable offline.
- **Router returns the split list itself:** saves the extra call on real compounds too, but
  changes the router's JSON contract (shared with the Baseten path, ADR 0032) without a way to
  test it live before the demo.
- **Start Wonder speculatively alongside the router:** saves 0.7 to 3 s on every new build, but
  ADR 0044 promises a declined request never spends a Wonder call. Revisit with the safety screen.
- **Continue the write conversation in the fix round instead of a fresh run:** keeps context, but
  sends a longer history, so it may be slower without prefix caching. Not provable offline.

## Orchestrator note (10-29, merge)

Renumbered from 0054 (taken by the bounded sketch build). On main the compound split is Muse
Spark with a deterministic guard (ADR 0053), entered through `mightBeCompound`; the router now
starts beside that Spark split, and a compound of mood + build still runs in order. For a real
compound the early router call is one Spark call that goes unused.

## Note (10-30, bug cps)

A pronoun ask ("make them faster") now resolves to the mod touched last even when the router
aimed it at `player`; only "me/my/I" still means the player. The rule lives in
`server/route-rules.ts` (ADR 0059), not in the relative-tweak block of `handleSingle`.
