# ADR 0075: Getting hurt is engine-owned: a short invulnerability window and a knockback

- **Status:** Proposed
- **Date:** 2026-10-30

## Context

A first-time player could not tell they were being hurt. A hit on the player was one health subtraction and a small pale flash: no push, no pause, no window. Worse, contact damage from a hostile cost 10 HP every 0.5 s for as long as you touched it, and a volley of three projectiles in one tick cost all three, so "being hit" was a slow drain rather than an event. Every player mod (the built-in one and every Wonder build) writes `p.vx` from the input on its next tick, so a knockback written by any mod is erased before it can move anyone.

## Decision

The sim owns player damage feedback (`src/sim/hurt.ts`, wired into `World.damage` and `World.step`):

- **Window.** A hit on the player sets `data.invulnUntil = tickCount + 36` (0.6 s at 60 Hz). While that is open `damage()` does nothing at all for the player, so the blink is a promise: the next 0.6 s of contact costs nothing. Creatures keep taking every hit.
- **Repeated hits share it.** Enemy contact damage no longer keeps its own private cooldown (`data.hitCooldown`): it checks the same window, because a hit that does not land must not restart a timer of its own.
- **Knockback.** The hit also queues a knockback (340 px/s away from the nearest thing that could have hurt them, fading over 8 ticks, plus a 205 px/s lift on the first tick). It is applied in the mover loop **after** the mods have run, so it survives a mod that pins `vx`, and a source further than 260 px or directly above/below falls back to pushing the player backwards from their facing.
- **Deterministic.** Tick counts and entity-list order only: no clock, no `Math.random`, so the verifier, the playtest bot and the browser get the same hit.
- **The client reads it.** `data.invulnUntil` is the only new field, and it is ordinary mod-safe `data`, so `src/contract.ts` does not change. The client blinks the sprite for the same window and flashes red (`src/client/feel.ts`).

## Consequences

- A hostile now deals at most one hit per 0.6 s, so every hostile does about 17% less damage per second than before. Mods that deal damage per tick (lava, a spike line) are damped the same way.
- A mod that calls `api.damage(player)` twice in one tick only lands once. That is the point, but it is a behaviour change for existing builds.
- The player is briefly airborne after every hit, which can interrupt a jump or a grapple; the lift is deliberately small (about 14 px).
- A player mod can no longer swallow a knockback, and none of them has to implement one.

## Alternatives considered

- **Knockback and window inside each player mod.** Every build would have to re-invent it, most would forget, and the ones that remembered would fight each other's `vx`.
- **Write `vx` at damage time.** Erased by the player mod on its next tick; the player would never move.
- **No invulnerability, only bigger feedback.** Keeps a zombie chewing 20 HP/s; the flash would advertise a drain rather than an event.
- **Damage-scaled window.** More code and more surprise for a very small gain; one fixed window is easier to reason about and to test.
