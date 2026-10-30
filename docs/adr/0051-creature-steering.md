# 0051 — Creature steering: wall turns, ledge stops, and hostile AI states in the engine

- **Status:** Draft
- **Date:** 2026-10-29

## Context

A kid playtest said the AI-made enemies were "kinda dumb". Screenshots showed a flying dragon
pushed against a brick tower for good, and slimes walking off platform edges. `unstick` only
flipped `facing` (never the velocity a mod keeps re-setting), and fliers never hop because
they are never on the ground. Every generated mod re-implemented or skipped this, so the
fix belongs in the engine where every creature gets it for free.

## Decision

1. `World.unstick` now orders a turn: for the next 40 ticks (60 for fliers) the creature's
   `vx` is forced to point away from the wall whatever sign its own code gives it, and `facing`
   flips. Fliers turn after 4 blocked ticks instead of 24.
2. Ground creatures (`kind === "creature"`, gravity on, `data.ledge !== false`) stop when the
   probe in front of the foot finds no support within 40 px. Patrollers turn back; hostiles
   (`data.hostile`) hold the edge facing the player.
3. Hostiles get `data.aiState` (`patrol | notice | attack | cooldown`) and `data.aiDir`
   written each tick by the engine (pure function of positions and `data.lastHit`). During
   `cooldown` (45 ticks after a hit) their `vx` is quartered, which paces combat.
4. Wonder gets one new prompt bullet, CREATURE BEHAVIOUR, describing the above. No existing
   prompt text changed. The contract adds only optional `data` keys.

## Consequences

- Deterministic: no clock, no randomness, step-order independent per entity.
- Cost: one extra rectangle probe per grounded creature per tick.
- A creature meant to cross gaps must opt out with `data.ledge = false`.
