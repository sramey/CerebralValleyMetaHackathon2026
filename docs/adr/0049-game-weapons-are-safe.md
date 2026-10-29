# 0049 — Game weapons and fighting are explicitly allowed by the kid-safe screen

- **Status:** Draft
- **Date:** 2026-10-29

## Context

ADR 0044 put a two-lane screen in front of every build request. Its first live pass found a
false decline the word list could not excuse: `add a sword that stabs enemies` was refused in
0 ms because `stab` sat in the violence list. The owner's rule is the opposite of what that
refusal assumed — **this is a pixel-art action platformer, and game weapons and fighting must
pass** — and the demo itself needs a gun, a flamethrower, fireballs and exploding bosses on
screen. A family refused the thing the game is made of does not read as a guard; it reads as a
broken product.

The guard's own contract already said "graphic violence", but a word list cannot tell
"a sword that stabs enemies" from "a stab wound", and a classifier prompt that lists weapons as
safe without saying so emphatically will still hedge.

## Decision

1. The local list keeps only phrases with **no** game reading: graphic gore, sexual content,
   hate, self-harm, real personal information. `stab`/`stabbing` left the violence list;
   `slit throat` stayed; `stab myself` moved to the self-harm list where it belongs.
2. The Spark prompt lists weapons of every kind, fighting, defeating enemies, exploding bosses
   and spooky characters as SAFE, and states the rule the classifier must apply: a weapon, a
   fight, an explosion or a scary character is **never on its own** a reason to refuse. Only
   graphic harm to a real person or group (or another UNSAFE item) is.
3. The three demo command sets (`rehearse.json`, `rehearse-aware.json`, `rehearse-weapons.json`)
   are screened live by `npm run safety:rehearse`, which exits non-zero on any decline. It
   screens sentences only (one Spark call each, none for a word-list hit) instead of building,
   because a build spends several calls per command and says nothing extra about the guard.

## Consequences

- A rehearsed demo command that gets declined now fails a script, not a recording take.
- Weapons and violence the guard still refuses are the ones a family cannot act on: gore,
  cruelty, torture, harm to real people. The screen is a filter, not a proof (0044).
- Anyone adding a demo command adds it to a set and runs the harness; both are one line.
- Owed: the ADR index row (owned outside this change) and the README line for the guard.

## Alternatives considered

- **Keep `stab` and add "stabs enemies" as an allowed phrase:** phrase-by-phrase patching of a
  word list is how a family ends up refused for the next phrasing; the list is the wrong lane
  for intent.
- **Lean on the prompt only:** the local lane is the deterministic one and answers before any
  model; leaving a known false positive there means the demo can fail with no model involved.
- **Raise the classifier's budget so more verdicts land inside the screen:** latency, not
  coverage, was the reason `stab` slipped through; more waiting would not have helped.
