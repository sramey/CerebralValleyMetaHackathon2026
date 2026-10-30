# 0056 — Contain crashing and looping mods: quarantine on throw, compile-time loop guards

- **Status:** Draft
- **Date:** 2026-10-30

## Context

An engine review (2026-10-30) found two ways one AI-written mod could stop everything, which
undercuts the "it can't break" claim:

1. `World.step()` called every tick handler with no try/catch, and the client's `frame()` only
   scheduled the next frame at its very end. One throw froze the game for good. The verifier
   cannot catch most of these: it runs each mod alone in an empty world (ADR 0003), so a mod
   that assumes another mod's entity exists only throws in the live world.
2. Mods are verified in-process (ADR 0003). A `while` loop that never ends blocked the Node
   event loop for every session, and the same mod would hang the browser tab.

`ModLoader.load()` also registered a mod before `setup()` ran, so a setup that threw halfway
left its handlers and entities in the world.

## Decision

1. **Quarantine on throw.** `World` takes an optional `onFault(owner, err)`. When set, each
   tick handler runs in a try/catch; a throw stops that owner's handlers and calls `onFault`.
   `ModLoader.isolateFaults(cb)` wires it to unload the mod and report it. The live client and
   the exported HTML game turn it on; the orb says the mod crashed and was taken out. The
   verifier, playtest bot and tests leave it off, so a crashing mod still fails loudly there.
2. **The frame loop always reschedules.** `frame()` wraps its work in try/catch and always
   calls `requestAnimationFrame`, in the client and the exported game.
3. **Loop guards.** `compileMod` passes esbuild's output through a TypeScript-AST transform
   that gives every `for`/`while`/`do`/`for-in`/`for-of` a counter, reset each time the loop
   is entered, that throws past `LOOP_LIMIT` (100,000). A runaway loop becomes an ordinary
   throw: the verifier rejects it in milliseconds, and live it is quarantined by (1).
4. **Setup is atomic.** If `setup()` throws, the loader unloads what it made before rethrowing.
5. **Reloads keep their place.** A knob tweak reloads the mod in its existing tick-order slot,
   so a ghost replay and the live world run handlers in the same order.

## Consequences

- One bad mod costs the player that mod, never the game.
- Compiled mod JS is now printed by the TypeScript printer (reformatted, same semantics).
  `typescript` is needed at server runtime; it is already installed by `npm ci`.
- Mods written into `src/mods` are trusted and not guarded (they are not compiled by `compileMod`).
- Not a sandbox: a mod can still reach globals by indirection (README, "Known limitations").
  Fine for local, single-user runs; public hosting would need a worker-thread verifier with no
  environment and a timeout.

## Alternatives considered

- **Worker-thread verifier with `terminate()`** fixes the server hang and the secrets exposure,
  but not the browser, and it is a bigger change a week before the deadline. Deferred.
- **Regex loop rewriting** is fragile around strings, regex literals and single-statement bodies.
- **Global iteration budget per tick** needs the guard to know about ticks; the per-entry
  counter is simpler and catches the real failure (a loop that never ends).
