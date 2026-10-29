# 0023 — Draw-to-build: sketch a level, Wonder reads it, a compiler builds it

- **Status:** Draft
- **Date:** 2026-10-29

## Context

The P1 feature "sketch a level and it builds itself" needs three things at once: the player can
draw on the game screen, a Meta model understands the drawing, and the result lands at the
coordinates the player drew, not wherever a model felt like putting it.

Facts we established while building it:

- `muse-wonder-1.0` accepts OpenAI-style multimodal content on `/v1/chat/completions`
  (`content: [{type:"text"},{type:"image_url",image_url:{url:"data:image/png;base64,..."}}]`).
  Measured: **1878 ms, 486 prompt tokens, 200 OK** on a 320x200 sketch drawn in code, and it
  echoed the stroke boxes correctly. Until now only `/v1/responses` with SAM had taken images.
- The client already knows the camera offset, so every stroke can carry the world-space box it
  covers (`wx = screenX + camX`, `wy = screenY + camY`); the sim has no zoom.
- The existing build path (compile → verify 600 frames → hot-load as an undoable mod) only needs
  a mod source string, so any deterministic producer of that string reuses the whole safety net.
- The verifier runs each mod alone in an empty world (ADR 0003), so a generated level mod has to
  spawn its own ground in `test()`.

## Decision

A sketch becomes a mod in two steps: **Wonder reads it, a compiler builds it.** Wonder gets the
PNG sketch *and* the exact world boxes of every stroke, and returns a small JSON level spec
(platforms with a kind, coins, enemies). `server/sketch.ts` compiles that JSON into the level mod
source deterministically, then verifies and hot-loads it like any other mod. If the model's reply
cannot be used, a stroke-box fallback level is compiled instead, so the feature always produces
something the player drew.

## Consequences

- Geometry is exact: the compiler writes the drawn `x/y/w/h` literals, so the built entities sit on
  the drawn boxes. Wonder may tidy within ~30 px (e.g. thicken a 4 px line into a 20 px ledge).
- No model-written code ever comes out of an image: the code shape is fixed, the model only chooses
  numbers. That keeps verification cheap (one build per sketch, ~5 s measured end to end) and makes
  a malicious/odd drawing unable to change what the mod is allowed to do.
- The mod id is derived from the level geometry, so redrawing the same map replaces it and undo is
  one click on the card.
- We now depend on chat-completions image parts for Wonder. `ChatMessage.content` is a union
  (`string | MessagePart[]`), so text-only callers are unchanged.
- The level is deliberately primitive: `sketch-platform`, `sketch-mover-platform`,
  `sketch-trampoline`, `sketch-coin`, `sketch-walker`, all drawn by the engine. Art generation for
  sketched content is not wired, so a sketch never spends image budget.
- A sketch costs one build from the spend guard, plus one if the first reply is unusable.

## Alternatives considered

- **Ask Wonder for the whole mod source** (like a normal command): the model would have to turn a
  picture into literal coordinates and stay there; token cost is several times higher, alignment is
  best-effort, and we would be trusting image-derived code. Rejected.
- **SAM 3.1 segmentation only:** gives boxes for a noun phrase but no semantics (is this blob a
  platform, a pit or a tower?) and one object type per request. Rejected as the primary path.
- **Deterministic stroke boxes only, no model:** cheapest and exact, but it cannot tell a stair from
  a wall, ignores the picture's shapes, and uses no Meta model — the opposite of the goal. Kept only
  as the fallback.
