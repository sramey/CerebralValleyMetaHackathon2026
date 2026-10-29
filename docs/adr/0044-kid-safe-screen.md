# 0044 — Kid-safe screen on every build request and art prompt

- **Status:** Draft
- **Date:** 2026-10-29

## Context

Families are the audience (the Sunday test): a parent hands a child the phone, the child says
something, and a model acts on it. Today every `command` goes straight to the router and every
image prompt straight to Muse Image, so a sentence like "add a bloody corpse" becomes a mod,
an art sheet, and a spent Meta call — and anything said out loud lands in the build log.

Two constraints pull in opposite directions:

- **Latency.** The router already costs ~0.7 s and a build ~8 s; the working bar for this bead
  is that a normal request pays **under 400 ms extra**. Measured here, a Spark classification
  round trip is 0.4–1.3 s (four prompts, minimal reasoning), so "wait for the model, then
  route" cannot meet that bar on its own.
- **Coverage.** A word list cannot read nuance ("add someone dead" vs "add a dead tree"), and
  a model cannot be trusted to be fast.

## Decision

One module, `server/safety.ts`, screens a request in **two lanes before it is routed**:

1. **Local lane (always, ~0 ms):** a small, ordered word/pattern list for the five categories
   (violence beyond cartoon, sexual, hate, self-harm, personal info). It only holds phrases
   with no playful reading in a family game, and it normalises away the innocent readings we
   know ("blood moon", "water gun") so a family is not refused something harmless. A local hit
   declines immediately and spends nothing.
2. **Spark lane (budgeted):** one Muse Spark call with `reasoning_effort: minimal` and a tiny
   JSON contract returns `{"safe":true}` or `{"safe":false,"category":…,"reply":…}`. The build
   path waits for it at most `SAFETY_BUDGET_MS` (default **350 ms**, so the whole screen stays
   under the 400 ms bar). Measured on this machine, Spark answers in 0.4–1.3 s, so the present
   answer usually arrives **after** that wait. A verdict inside the wait is authoritative in
   both directions; a verdict that misses it is **not discarded**: the pending promise is kept
   on the session and read for free between routing and the Wonder write (`lateVerdict()`),
   which gives the model the router's own second of runway without adding latency. Only a
   verdict later than that (never observed) is dropped — then the request proceeds
   (**fail-open**), because the local lane already cleared the obvious cases and stalling a
   family's build is the worse failure.

The classifier request itself is not cancelled when the wait expires (a hard ceiling of
`MAX_BUDGET_MS` covers a hung connection): cancelling it destroyed the very verdict the build
path still wants to read.

Image prompts (Muse Image subjects) take the **same two lanes** with a longer deadline
(`SAFETY_ART_BUDGET_MS`, default 2000 ms): art is already async and multi-second, so waiting is
free there, and it is the second chance for a subject whose command verdict missed its budget.
A declined prompt means no AI art; the mod still loads with its code-drawn shape.

A decline is one fixed, kind sentence per category (`DECLINE`) that offers a concrete
alternative ("Say 'add a friendly dragon'"). A model-written sentence is used only when it is
short, single-line, and does not hand the player's own words back. The declined request is
never written to the build log — the log line carries `[safety:<category>]` instead.

`SAFETY=off` turns both lanes off (default on), so a demo can prove the guard and then turn it
off, and the tests can assert the off path. Verdicts are memoised per normalised sentence.

## Consequences

- A normal request pays the local lane (~0 ms) plus whatever part of the 350 ms wait the model
  uses; the request is never held longer than that, so the latency promise holds whether or not
  the model is fast.
- Unsafe requests that the word list knows are free to refuse (measured: 0 ms, through the real
  socket). Unsafe requests that only the model can see are refused when its verdict lands before
  the Wonder write — it has the 350 ms wait plus the router call (~1 s) to get there. The guard
  is a strong filter, not a proof; that trade is explicit here so nobody assumes otherwise.
- One extra Spark call per build request, and one per new art subject (cached per subject on
  disk, so once). Both ride the existing spend guard's build/image units, not a new budget.
- Dangerously cheap to change: adding a phrase is one line in `LOCAL_PATTERNS`, adding a
  category is one entry in `DECLINE` plus the prompt. `tests/safety.test.ts` covers both lanes,
  the timeout, the memo, and the off switch with a mock classifier — no keys, no network.
- The classifier is Spark (ADR 0001: `reasoning_effort: minimal`). No other provider, no rule
  engine service, no hosted moderation API.
- Owed: the README and `docs/DESIGN.md` need the "kid-safe screen" line, and this ADR needs an
  index row — both owned outside this change.

## Alternatives considered

- **Block on the model first, then route (no budget):** the simplest mental model and the most
  accurate, but it adds ~0.6 s to every build and can hang the game when the API is slow. It
  fails the latency bar this bead was given.
- **Local word list only:** instant and free, but blind to euphemism and to hate/real names,
  and a long list starts refusing innocent requests.
- **Model only, after routing:** cheapest (no extra sequential wait) but then a declined
  request has already been routed, and the router has read the sentence — the guard has to sit
  in front of the pipeline it protects.
- **A hosted moderation endpoint:** another provider in the product, which the project's
  hard rule forbids, and a second thing to keep alive for the demo.
- **Fail-closed on a timed-out classifier:** safer in theory; in practice a slow Meta call
  would refuse a family's innocent request with no explanation they can act on. The local lane
  is what we trust to be deterministic, so a model miss falls through.
