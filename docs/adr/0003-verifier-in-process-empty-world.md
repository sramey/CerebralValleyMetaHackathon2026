# ADR 0003: Verifier runs in-process, each mod alone in an empty world

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-27

## Context

DESIGN §7 and SPIKE.md call for headless verification before hot-load, ideally in worker threads. Worker threads under tsx add loading complexity, and the sim was built pure/deterministic precisely so it can run anywhere. Verification needed to be correct and uncrashable *today*: bad mods must return errors, never take down the server.

## Decision

`server/verify.ts` verifies in-process: cache-busted `data:` URL dynamic import of the compiled mod, shape check, then load into a **fresh `World` + `ModLoader` containing only that mod**, step 600 frames, fail on exception / NaN / entity count > 500, report avg ms/frame, then run the mod's own `test()` via `runModTest`. `verifyMod` never throws. The Wonder prompt states the contract this creates: in `test()` the world is empty — no player or ground exists unless the mod spawns them.

## Consequences

- A pathological mod (infinite loop spawning entities) can still block the server's event loop; entity bound + 600-frame cap limit, but do not eliminate, that risk. Worker-thread isolation is deferred, not rejected — revisit before public hosting (DESIGN §13 session limits).
- Mods whose behavior needs ground/a player must spawn their own in `setup` or `test`. This is documented in the mod-API reference Wonder receives.
- Verified working: forbidden-token mods, NaN mods, and failing-test mods are all rejected with the game unchanged.

## Alternatives considered

- **Worker threads now:** right long-term isolation, wrong week-one cost; tsx worker loading was unproven and the spike deadline is Thursday.
- **Verify inside the client:** the bad code would already have shipped to the browser; defeats the purpose.
- **Verify with player+ground preloaded:** hides missing-spawn bugs and makes mod tests non-hermetic; empty world is the stricter, clearer contract.
