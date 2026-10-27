# ADR 0005: Invalid tweaks fall back to edit/new instead of failing

- **Status:** Draft
- **Date:** 2026-10-27

## Context

Routing (ADR 0002) is probabilistic. Two failure shapes reached users: a tweak naming a mod/knob the server manifest does not have (dead end: "couldn't apply that tweak"), and a tweak naming a loaded mod but a knob that does not fit the request (the request actually changes behavior, e.g. "turtles should throw shells" — DESIGN §8's *edit* class). Separately, DESIGN §8 requires edits to rewrite a mod under the same id so the world does not stack duplicates.

## Decision

The server validates every tweak against its manifest before sending it:

- Tweak with an **unknown target** → treated as `new` (Wonder builds it).
- Tweak with a **known target but inapplicable knob** → treated as `edit`: Wonder rewrites that mod's source via `buildEditPrompt`, re-verified, stored and shipped under the **same id** (old id dropped if Wonder renames).
- `edit` with a missing target → falls back to `new`.

## Consequences

- Mis-routes degrade into a slower-but-correct build instead of an error message. Cost: an unneeded Wonder call (~8s) instead of an instant tweak.
- Same-id edit was proven live: spike command 6 ("make enemies die when I stomp them") rewrote `walker-enemy` in place during the 10/10 spike run.
- Known imperfection: "make the player jump higher" built a new `mega-jump` mod instead of tweaking the jump knob. Tightening relative-tweak language ("higher/faster/slower" against an existing knob) is future router work; it passes functionally today.
- The server manifest and the client's loaded mods can still diverge (client may load local built-ins the server has never seen). The client remains the authority for what is on screen; server fallbacks only choose *how to build*, never mutate client state directly.
- Amendment (2026-10-27, playtest fix): a fully-specified tweak (target + knob + numeric value) naming a mod the **server** has not seen is now forwarded to the client anyway, because the client may hold it as a local built-in. The client applies it if loaded, or says "add that mod first" if not. Unknown-target tweaks *without* a full spec still fall back to `new` as above.

## Alternatives considered

- **Return an error and let the user rephrase:** cheapest to build, worst demo experience; every router miss becomes a visible failure.
- **Always treat tweaks as edits:** correct but throws away the sub-2s knob path DESIGN §8 promises for follow-ups.
