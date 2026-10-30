# 0060 - Cancel a build that is still running

- **Status:** Draft
- **Date:** 2026-10-30

## Context

A playtester on 10-29 said it plainly: "we need to cancel your last prompt somewhere".
Every ask used to be a commitment. A compound command ("add a dragon, some coins, and make
it rain") runs as parallel builds (ADR 0016), each one a chip under the orb with its own
trail of stages, and the only ways out of a build that was not wanted were to wait it out
(seconds to tens of seconds of Meta calls) or to reload the page. A mis-spoken sentence or a
wrong idea cost a whole build plus whatever it hot-loaded.

The pieces were almost there: the chips already carry the server's own `command` key, `chat`
already takes an `AbortSignal` (used by the sketch and paper deadlines, ADR 0054), and the
pipeline has clear checkpoints before it touches the world. What was missing was a way to say
"stop this one" - and a rule for what happens when the model replies anyway.

## Decision

A running build can be cancelled from its chip, and **the cancelled flag, not the abort
signal, is what the pipeline trusts**.

1. **One message, keyed by the chip's own command.** The client sends
   `{kind: "cancel", command}` (a new `ClientMsg` member, validated like every other frame,
   ADR 0036). The command text is the same key the server stamps on that build's stage and
   timing messages, so a compound's lanes are cancelled one at a time: stopping "add some
   coins" leaves "add a dragon" building.
2. **`server/cancel.ts` is the registry.** One per connection, `begin(command)` returns a
   `CancelJob` with an `AbortController`; `cancel(command)` aborts every job still in flight
   under that command; the build's own timing message closes the job (so no path has to
   remember to release it). Dependency-free and clock-free, so it is tested headless.
3. **The signal reaches every model call on the build's path.** `runAgent` and `routerChat`
   take an optional `signal` and pass it to the request; the plain-completion fallback inside
   the agent loop does not start a *new* call after a cancel; the sketch and paper pipelines
   join the player's signal to their own deadline with `anySignal`.
4. **The result is dropped if it lands later.** Aborting a `fetch` that already returned
   cannot un-return it, so the build checks `job.cancelled` after every await and once more
   right before it touches the world: after routing, after the write, after the fix round,
   before the built-in mods, and before the hot-load / level replace. A cancelled build never
   lands, never becomes a manifest entry, and never spends the auto-fix round.
5. **The chip always ends.** Cancelling answers with `stage: "failed"` and detail
   `"cancelled"`, plus the usual timing message: the chip settles (and lingers 2.5 s like any
   other), the orb leaves "building", and the client rewrites the stage into plain words
   ("Cancelled. Your game is unchanged…") instead of the generic failure line. The client also
   settles the chip itself after 8 s if the server never answers, so a dead server cannot
   leave the orb spinning.
6. **It is not a failure.** `logBuild` records outcome `"cancelled"`, which the stats
   aggregates neither count as landed nor as failed: cancelling by hand must not flatter or
   skew the success rate the README and the demo quote.

## Consequences

- **Easier:** a mis-spoken or unwanted ask costs a click. The demo can show a build being
  stopped mid-flight, which is a small extra proof that the player is in charge.
- **Harder:** every future model call on a build path has to take the signal and be followed
  by a `cancelled` check, or it becomes the one place a cancel cannot reach. Compile, verify
  and the bot playtest stay uninterruptible (they run in this process with no signal of their
  own); a cancel that arrives during them is honoured at the next checkpoint, which is a few
  hundred milliseconds to a couple of seconds later.
- **Spent either way:** a cancelled build does not refund its budget unit, and a call already
  on the wire still bills at Meta. The cancel stops the *next* call, not the one in flight.
- **Owed:** the ADR index row in `docs/adr/README.md` (owned outside this change), and a
  `cancel` event on the family-test metrics if we want to see how often players use it.
- **Not cancelled:** the kid-safe screen, the mood restyle sweep, photo segmentation (SAM has
  no signal here) and an explained-object call are single short calls with no chip; they run
  to completion. They are candidates if the same complaint comes back for them.

## Alternatives considered

- **Let the client drop the chip and ignore later messages.** Looks instant, but the build
  keeps spending Meta budget, keeps the id reserved, and still hot-loads a mod the player just
  rejected - the exact opposite of "cancel".
- **Only abort the fetch, no `cancelled` flag.** Cheaper to write, but a reply that was
  already in flight would still compile and land, and the sketch/paper paths fall back
  deterministically when their ask fails - a cancel would hand you a built level.
- **Cancel the whole connection's work.** One click stopping a compound's other lanes is not
  "cancel the last prompt"; parallel builds exist to be independent (ADR 0016/0053).
- **Undo after the fact instead of cancelling.** Undo exists for a landed mod, but it cannot
  give back the seconds of waiting or the budget, and it removes the proof that the player
  could stop the machine.
- **A "stop" gesture in voice.** Hold-to-talk already sends a final transcript when the key is
  released; a second voice path would need its own intent routing for the same one-bit action.
