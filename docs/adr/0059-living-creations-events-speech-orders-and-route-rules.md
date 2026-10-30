# 0059 — Living creations: mod events, speech, voice orders, and route rules as a pipeline

- **Status:** Draft
- **Date:** 2026-10-30

## Context

Two gaps showed up reviewing how commands are routed and how built things behave.

**Routing.** After Spark answers, `handleSingle` applied about ten deterministic guards (build
fallback, mood safety net, player ability, pronoun edit, add-is-a-build, pronoun target, relative
tweak) inline, between `send` calls and log lines. Their order mattered and nothing tested it as a
whole. Every new guard went into the same function.

**Interaction.** A mod's only hook was `onTick`. It could not hear that one of its entities was hit,
died or was touched; it could not talk to the player or to another mod; and the player could not
talk to anything once it was built. "The dragon drops coins when it dies" meant polling health every
tick, and "chickens, follow me" meant a whole Wonder rewrite of the chicken mod (an edit is ~18 s at
the median, ADR 0058) for what is a momentary instruction.

## Decision

1. **Route rules are a named, pure pipeline.** `server/route-rules.ts` holds `parseRoute` and
   `resolveRoute(spark's route, ctx) -> { route, rules }`: the same guards, same order, as a list of
   named rules over the server's verified mods and short-term memory. `handleSingle` only carries out
   the result and logs which rules fired. New guards are added there, with a test.
2. **Orders: a seventh route, answered without a model.** `follow | come | stay | flee | free`. A
   narrow local parser (`parseOrder`: the command must end in an order phrase, address at most four
   words, and contain no build words like "a", "always", "when") plus a target match against loaded
   mods' ids, titles and spawned types runs **before** the router; a hit costs no model call and no
   budget. Spark also learns the `order` action; the `order-check` rule validates its target. The
   server sends `{ kind: "order", modId, order }` (`"*"` = every mod) and the client calls
   `ModLoader.order`.
3. **The engine obeys orders for any creature.** `World.giveOrder` records a standing order per
   creature; each tick the engine steers it after the mod's own tick code (`src/sim/interact.ts`), so
   no mod has to be rewritten. `data.orders = false` opts out (a boss). The first creature
   acknowledges with a speech bubble.
4. **Mod events.** `api.on(event, fn)` with `touch`, `hit`, `death`, `interact`, `order`, `signal`.
   Events are queued and delivered at the start of the next tick, never inside another mod's code, with
   the same fault containment as tick handlers (ADR 0056). A death event carries a copy of the entity
   taken before despawn, so x/y say where it fell. `api.damage` now records which mod dealt it.
5. **Speech and interaction.** `api.say(entity, text, seconds)` stores a bubble on `world.speech`
   (pure data, like HUD widgets, ADR 0019); the client draws it (`src/client/speech.ts`). An entity
   with `data.interact` ("Talk", "Open", …) shows a `B · Talk` prompt when the player is near, and the
   action key raises `interact` on its mod. `api.signal(name, value)` reaches every other mod.
6. Wonder's API reference teaches all of this with an INTERACTION section: prefer events over
   polling, talking characters use `data.interact` + `say`, and never hand-code follow/stay.

## Consequences

- "Chickens, follow me", "everyone stay", "dragon, go away" land in milliseconds and work in visitor
  mode (no key). Orders are live session state: they are not part of a saved world, a share link, the
  timeline or an exported HTML game.
- Mods can be cause and effect for each other (signals), and the verifier still runs each one alone
  (ADR 0003): a mod that listens for a signal must still pass its own `test()` with nobody sending it.
- The engine now steers ordered creatures, so a mod that moves a creature by writing `x` directly
  (not `vx`) is not steered. Mods that use `vx` are the norm and what the prompt asks for.
- The step gains a touch pass (only over mods that listen) and an interact pass (only entities with
  `data.interact`); both are linear and well inside the 2 ms budget.
- `on`, `say` and `signal` are optional on `ModApi` like the other helpers, because test doubles build
  partial APIs; the real loader always provides them.

## Alternatives considered

- **Orders as Wonder edits.** Correct but ~18 s each and permanent when the player meant "for now".
- **Mod-declared verbs** (`verbs: { sit: ... }`, routed like knobs). More expressive, but every mod
  would need them written; engine orders cover the common five for every creature today. An `order`
  event lets a mod add flavour. Verbs can come later on the same route.
- **Synchronous events.** Simpler, but a listener would run inside the mod that dealt the damage, so a
  throw would quarantine the wrong mod and handler order would depend on who hit whom.
- **Keep the guards inline.** Cheapest now, but the order bugs it hides only show up live.
