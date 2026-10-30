# 0070 — Hostile identity: stomping, pet friendly fire, no sinking and steady facing

- **Status:** Draft
- **Date:** 2026-10-30
- **Context:** Playtest 2026-10-30 (bead 49d). A first-time player hand-drew a level with five
  enemies: none of them could fight. The level compiler spawned them as `sketch-walker` with
  `data.casual`, which the engine reads as *friendly* — so they were not damageable, dealt no
  contact damage and could not be stomped. The same session asked for "a T-Rex pet that stomps
  zombies": it sank through the ground, flipped left-right every frame while parked on a drawn
  ledge, and was reported as hurting its owner. Stomping only existed inside the wave mod
  (`src/sim/waves.ts`), for its own tracked swarm, so nothing else in the game answered to a
  jump. Every one of those is an engine or prompt rule, not a one-mod bug: a mod, or the
  compiler's own template, will make the same class of mistake again.
- **Decision:** The engine owns four laws the mods and the prompts now only describe:
  1. **Stomp** — a falling player who lands on a hostile's head finishes it and bounces
     (`src/sim/stomp.ts`, run in `World.step` before contact damage). Any hostile answers to it;
     the head you land on cannot also body-check you that turn.
  2. **Pets never fight their owner** — `data.pet` / `companion` / `ally`, a pet-type name, or
     `data.interact = "Pet"` makes an entity a companion even if the mod also set `hostile`
     (`isPet`). A companion never hurts the player or an ally on contact, and a projectile that
     is not enemy fire hits hostiles only. An explicit `hostile` flag now also beats `casual` in
     `isFriendly`, so a tagged hunter is never treated as a bystander.
  3. **No sinking** — a body that overlaps a solid while rising is put on top of it when its
     head is above the solid's top, instead of being pushed out of the underside (which dropped
     a big pet through the floor for good).
  4. **Steady facing** — a facing flip costs `FACING_HOLD_TICKS` of rest (`src/sim/facing.ts`),
     and a walker with a ledge on *both* sides stops instead of turning round every tick.
  The level compiler emits drawn enemies as real hostiles (`hostile`, `enemy`, `creature`,
  contact damage, chase), and `WONDER_SYSTEM` / the open-weights reviewer tell a build the same
  four rules, so the next request gets them right the first time.
- **Consequences:** Drawn and Wonder-built enemies can be fought without any mod support.
  Companions can no longer be a damage source, which also means a mod that deliberately wanted a
  "traitor pet" cannot have one (nobody asked; the failure mode is much worse). A creature on a
  perch narrower than its own body now stands still instead of pacing. The prompts carry four
  more engine facts, and mods that hand-rolled a stomp or a pet damage check now duplicate
  engine behaviour (harmless, and `run_playtest`/the reviewer will flag the worst of it).
- **Alternatives considered:** Fix only the sketch template (rejected: the T-Rex bugs are the
  same class and come from mods, not from the template; the next request would repeat them).
  Fix it in `WONDER_SYSTEM` only (rejected: the prompt is advice, and a mislabelled pet hurting
  its owner is unacceptable — the guard must be structural). Give every hostile a `stomp` flag so
  stomping stays opt-in (rejected: "jump on the enemy" is the first thing a player tries in a
  platformer; the friendly-fire and stomp exceptions are a much smaller surprise than a jump that
  does nothing).
