# 0061 — Gear sockets on the drawn body, for any character

- **Status:** Draft
- **Date:** 2026-10-30

## Context

Worn gear was mounted in the sim from the 26x34 hitbox, but the client draws the player 56 px tall
(scaled by h/34) and other characters at 1.5x their hitbox, feet-anchored. A gun at "hand height"
of the hitbox therefore landed near the drawn feet. Wonder's `data.offsetX/offsetY` replaced the
socket outright and unclamped, so a mod could put a gun anywhere. Only the player could wear gear.

## Decision

1. `src/sim/sockets.ts` owns `visualHeight(e)` / `visualBox(e)`: the same numbers the client uses.
   `src/client/main.ts` imports `visualHeight`, so the two cannot drift.
2. Sockets `hand | back | head | feet | belt` are fractions of the drawn box: hand 55% up from the
   feet and in front by facing; back 62% up and behind; head on top; feet at the bottom; belt 40%.
3. Every gear type maps to a socket (gun, blaster, sword, wand, torch, shield: hand; jetpack, cape,
   wings, backpack: back; hat, crown, helmet, halo: head; boots, skates: feet). `data.socket` wins
   only when it names a real socket.
4. `offsetX/offsetY` are now nudges from the socket, clamped to 12% of the drawn height, and the
   item centre is clamped to the drawn body plus a 4 px margin.
5. `data.attachedTo` may be `"player"`, an entity id, or a creature type, so a dragon can wear a
   hat. Mounted gear takes its wearer's facing and velocity. A pickup (`data.pickup === true`) is
   never mounted. Auto-mounting by name still applies to the player only, with the same list.
6. The Wonder prompt gets one line: set `data.socket`/`data.attachedTo`, never position worn gear.

## Consequences

- Old mods that set a large `offsetY` to place a gun now get the hands, which is what they meant.
- The sim assumes a character has art (1.5x). A code-drawn creature without a sprite is drawn at
  its hitbox, so its gear floats up to half a hitbox above it. Accepted: every build gets art.
- Gear keeps its own size; it does not scale with the wearer after "make me huge", it only follows
  the new hands. Scaling gear would need a remembered base size; left as a follow-up.
