# 0036 — Validate every client message at the door, before dispatch

- **Status:** Draft
- **Date:** 2026-10-29

## Context

The WebSocket is the only door into the server, and it takes JSON text frames from
whoever is connected. Before this change `handleMessage` did `JSON.parse(raw) as ClientMsg`
and dispatched on `msg.kind`: a compile-time type assertion standing in for a runtime
check. Three concrete problems came out of that:

- A shape the client never sends (a `command` with no text, a `knob` with `value: NaN`, a
  `worldState` with ten thousand entries) reached a handler and threw. The socket wrapper
  caught it and sent an "Oops:" line, so the server stayed up, but the error text was
  internal and the work was already half-started.
- Handlers guarded their own fields and each stopped at a different place: `photo` capped
  the image at 4 MB, `sketch` had its own sanitizer, `worldState` filtered ids, `undo` did
  not look at `modId` at all, `restyle` filtered after the spend check had already run for
  some keys. "Is this message safe?" had no single answer.
- `msg.knob in rec.knobs` is true for `"constructor"`, `"toString"` and `"__proto__"`, and
  the handler then spread the match and wrote it back into the knob table. A frame like
  `{"kind":"knob","modId":"player","knob":"__proto__","value":1}` could rewrite a
  prototype instead of a knob.

Judges run this locally and it may be hosted, so a malformed or hostile frame must cost
the server nothing: no crash, no half-run pipeline, no Meta spend, and a plain sentence in
reply.

## Decision

One pure module, `server/validate.ts`, owns the wire contract. `gateMessage(raw, onMsg,
onInvalid)` is the socket's only entry point: it refuses oversized frames before parsing,
catches JSON errors, validates the parsed value against the `ClientMsg` union, and then
either dispatches a rebuilt message or sends one short reply. `server/index.ts` calls it
once; the dispatch body below it is unchanged.

The validator is a **whitelist, not a cast**: it rebuilds every message field by field, so
unknown fields are dropped and handlers can trust the shape they receive. Per kind it
checks:

- **shape**: object, string `kind` in the known set, required fields present, correct types;
- **string lengths**: command/note 1..1000, prompt 0..500, ids and knob names 1..64;
- **numeric ranges**: every number finite and |n| ≤ 1e9, `aspect` in 0.1..10, sketch boxes
  positive, knob names and bbox/point numbers checked before they become world coordinates;
- **image caps**: a `data:image…` URL under 4 MB (photos and sketches), the same cap the
  handlers already applied;
- **collection caps**: ≤ 64 mods per world list, ≤ 24 knob values per mod, ≤ 32 sheet keys,
  ≤ 400 strokes with ≤ 400 points each;
- **keys**: `__proto__`, `prototype` and `constructor` are refused anywhere they would be
  used as an object or Map key. Ids a model writes ("Rain Cloud ✨") are still allowed, so a
  permissive id never breaks a session; only client-generated keys (photo keys, world ids)
  are held to a slug pattern.

Two kinds of frame are **sanitized rather than refused**: `worldState` and `worldSave` are
status reports, and one unusable entry inside the list (a null knob value the client is
carrying, a mod id we cannot key on) drops only that entry. Refusing the whole frame would
cost the session its playtest world copy and the recent-mod memory, and would show an error
line before every command. The frame itself is still refused when `mods` is not an array or
is over the cap, which the real client never does.

The same ADR covers the matching handler fixes: the knob branch uses
`Object.prototype.hasOwnProperty` instead of `in`, and knob numbers are clamped into the
knob's declared `min`/`max` (`clampKnobValue`) so a hostile tweak cannot post 1e9 into the
sim.

## Consequences

- A bad frame never reaches a handler, so it can never take a build/image/SAM/voice unit
  from the spend guard: spending happens inside handlers, and handlers are only reachable
  through the gate. `tests/ws-guard.test.ts` asserts exactly that, per frame.
- Replies are plain, short and fixed (`REPLY` in `server/validate.ts`): they never echo the
  client's text or an internal error message, so nothing a visitor sends can end up in the
  orb or in the build log as a stack trace.
- The valid path is unchanged: the client already sends only the documented fields, and
  the validator passes every one of its messages through. World lists lose only entries the
  server could not have used anyway, and the handler's own `sanitizeValues`/`sanitizeSketch`
  still do the semantic cleanup. One additive behavior change: the server now answers an
  unknown `kind` with a sentence instead of ignoring it silently, and out-of-range knob
  numbers are clamped rather than applied as sent.
- Caps live in one place, so raising a limit (say the photo cap) is a one-line change
  instead of a hunt through the handlers.
- Every new `ClientMsg` member must be added to the validator as well as the contract; the
  fuzz test's typed `VALID` table fails to compile if a kind is missing.
- Deep validation stays where it already lives (`sanitizeSketch`, `sanitizeValues`): the
  gate checks the shape and the caps, and those functions still do the semantic cleanup.
- Costs nothing at runtime: the gate is O(size of the message) string/number checks, and
  the fuzz suite runs headless in ~80 ms with no sockets, keys or live calls.

## Alternatives considered

- **A schema library (zod, ajv, TypeBox):** would remove hand-written checks, but adds a
  dependency we are not allowed to take and puts the union's truth in a second place. The
  hand-written gate is ~250 lines and the typed `VALID` table makes omissions a compile
  error.
- **Trust the TypeScript union and try/catch around dispatch:** the current behavior. It
  keeps the server up but cannot tell "wrong kind" from "handler bug", gives the visitor an
  internal message, and leaves prototype keys and NaN in play.
- **Validate inside each handler:** that is what we had; the rules drift, and spend
  decisions are made before and after validation in different orders.
- **Reject every unknown field strictly (no silent dropping):** stricter, but breaks the
  client on any additive field and makes deploys order-sensitive. Dropping is enough,
  because handlers now see a rebuilt object.
