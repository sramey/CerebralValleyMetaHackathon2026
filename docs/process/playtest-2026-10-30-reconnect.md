# Playtest 2026-10-30 — a reconnect keeps the world editable (bead 2ww)

Follow-up to ADR 0070 (the world survives a reload). Rules: **ADR 0072**.

## Saw

A world built by talking (jetpack, rideable dragon, a drawn level) survives a reload and a server
restart — the autosave file is there and the page comes back with all of it. But if the server
restarted while the tab stayed open, the world looked fine and was not: "make it bigger" rebuilt a
mod that was already on screen, and every knob answered *"Unknown mod or knob."* / undo answered
*"Nothing loaded with id …"*. Only a page reload made the world editable again.

## Cause

Sessions are keyed by the socket (`server/index.ts`, `sess(ws)`), so a restarted server has an empty
manifest while the page still shows the mods. Three handlers resolve ids against that manifest and
nothing else:

- `knob` → `manifest.get(modId)` (else "Unknown mod or knob.")
- `undo` → `manifest.has(modId)` (else "Nothing loaded with id …")
- an edit command → the router picks `route.target` out of `manifestText(ws)`, and the edit prompt is
  built from `manifest.get(target).source`

ADR 0070's `reuseStoredMods` protected the *file* on the next autosave, which is why the world did not
disappear; it did nothing for the *session*, which is where editing happens.

## Fix

A reconnect now tells the server "this page still has my world, and it is my own autosave slot"
(`worldAdopt { id, mods }`, ADR 0072). The server adopts its own stored file back into the session for
the ids the page still lists and the session does not know, applies the page's knob values on top
(clamped), and answers with nothing: no `world` frame, so nothing on screen is re-rendered or reset.

- `WorldStore.adoptSlot` / `adoptStoredMods` / `sessionRecOf` (`server/worlds.ts`) do the work;
  `applyStoredWorld` and the timeline restore now share `sessionRecOf` so a resumed world and an
  adopted one build their records the same way.
- Client: `worldIsHome` is true once the page resumed its own slot or autosaved into it, and
  `adoptFrame` (`src/client/home-world.ts`) sends the message only then — a world opened from a share
  link or a demo has its own ids and never adopts the browser's previous file.

## Proof

- `tests/reconnect-adopt.test.ts`: build, autosave, restart (a fresh `WorldStore` and a fresh
  manifest), reconnect, then a knob change, an undo and an edit all work; the tuned knob the page
  reported beats the file's older value; a build made after the reconnect is never overwritten; an id
  the page no longer lists is not adopted; the client rule never sends from a link world.
- `tests/ws-guard.test.ts` covers the new frame at the door (home slots only, mod list validated).
- Live, on the lease ports (8795), with a real restart: a new session without the adopt answered
  "Unknown mod or knob" / "Nothing loaded with id" (the bug); the same frames with the adopt after
  `Stop-Process` + restart answered `{"kind":"tweak",…}` and `{"kind":"removed",…}`, and the following
  autosave wrote the file with the new knob value and without the undone mod.
- Live in the browser: the tab resumed a fixture world, the server process was killed and started
  again, the page reconnected on its own, the server logged `[reconnect] adopted 1 mod(s)`, a slider
  moved on the dragon card reached the file (`speed: 180`), and the card's Undo removed the dragon
  from the world and from the file — with no reload at any point.

## Notes for the next lease

- Not adopted: the mood, the level stash behind a sketched level, and the timeline steps from before
  the restart. After a restart a mood undo still works client-side, but the server's mood is unset, so
  the next "make it spooky" starts from none; undoing a sketched level will not bring the previous
  level back, and restoring a pre-restart timeline step answers "That step is no longer in the
  timeline." Each is its own small bead.
- The server's greeting ("hello! Tell me what to build") still lands in the orb on every reconnect,
  replacing whatever it said, adopted world or not. Pre-existing, unrelated to this bead.
