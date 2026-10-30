# Playtest 2026-10-30 — hostiles and pets (bead 49d)

What tester 1 hit, what caused it, and what now stops it. Engine rules: **ADR 0071**.

## 1. Enemies drawn with "Draw a level" could not be fought

**Saw:** a hand-drawn level with five enemies. They walked through the player, bullets passed
through them, and jumping on them did nothing.

**Cause:** the level compiler (`server/sketch.ts`) emitted every drawn enemy as
`type: "sketch-walker"` with `data: { casual: true }`. In the engine `casual` means *friendly*
(it makes a creature hop over the player): `isFriendly` returned true, so `isDamageableTarget`
said no, `hurtsOnContact` said no, and nothing could stomp them. Stomping itself only existed
inside the wave mod (`src/sim/waves.ts`), for its own tracked swarm.

**Fix:** drawn enemies are real hostiles (hostile / enemy / creature, contact damage, chase
within ~280 px, patrol around the drawn spot otherwise), and stomping is an engine pass that any
hostile answers to. The compiled level's own `test()` asserts the flags.

**Proof:** `tests/sketch-hostiles.test.ts` runs the real compiler output: flags, contact damage,
bullet damage, chase, stomp, and a playable world with `playerMod`.

## 2. The T-Rex pet sank into the ground, spun, and hurt its owner

**Saw:** "add a T-Rex pet that stomps zombies" produced a 150x130 companion that sank into the
floor, flipped left-right while standing on things, and was blamed for player damage.

**Causes and fixes:**

- **Spinning.** The pet's own tick set `vx` every frame; the engine's ledge guard zeroed it and
  turned the creature round. On a perch narrow enough to have a drop on *both* sides, that ran
  every tick: 399 facing flips in 400 ticks in a headless reproduction. The guard now stands a
  creature still when there is a ledge both ways, and `faceToward` rate-limits flips
  (`FACING_HOLD_TICKS`), so a real turn still reads at once but jitter never reaches the pixels.
- **Sinking.** In the Y axis pass, a body that overlapped a solid while moving *up* was pushed
  out of the solid's **underside**. A companion that hopped while standing in the floor was
  therefore dropped below the ground and fell for good. It is now put on top whenever its head is
  above the solid's top.
- **Hurting its owner.** The companion was `casual` (so the base world was fine), but the shape
  of the next request — a pet that *stomps zombies* — invites a mod to mark the pet
  `hostile: true`, which is exactly what contact damage and player-aimed targeting look for. The
  engine now treats `pet` / `companion` / `ally` / `interact: "Pet"` as a companion **whatever
  else the mod set**: a companion never hurts the player or an ally, and a shot that is not enemy
  fire hits hostiles only. `WONDER_SYSTEM` says the same, and the open-weights reviewer has a
  `PETS:` checklist item.

**Proof:** `tests/pets.test.ts`, using a fixture trimmed from the generated pet mod.

## Notes for the next lease

- `waves.ts` still has its own stomp for tracked swarm; it now double-counts nothing (a stomped
  enemy is dead before the contact pass) but could be deleted in favour of the engine rule.
- The drawn-enemy chase runs at 55 px/s, inside the "never faster than 110 px/s" guideline. A
  future "hard mode" would be a knob, not code.
