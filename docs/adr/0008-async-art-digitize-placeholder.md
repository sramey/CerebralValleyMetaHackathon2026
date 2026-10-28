# ADR 0008: Art streams asynchronously; digitize placeholder while it generates

- **Status:** Draft
- **Date:** 2026-10-28

## Context

Image generation takes 10–24s and blocked mod delivery (build totals 16–32s; the player stared at stage text). The owner asked for a pixelized pulsing "digitizing" materialize effect in the shape/place of the incoming object while its art loads.

## Decision

The mod ships immediately after verify with `artPending: <key>` when art is uncached (cached art still attaches inline); the server generates fire-and-forget and then sends `{kind:"art", modId, art}`; the client renders a pulsing pixel-noise digitize placeholder inside the entity box until frames land, and retries a 0-frame art load once with a cache-busted URL before falling back to the rect.

## Consequences

- Perceived build time ~5s.
- Wire protocol gained `artPending` + the `art` message (contract change, hence this ADR).
- A server restart drops in-flight art generations (the mod stays, art just never arrives).
- Placeholder needs pending-subject tracking client-side.

## Alternatives considered

- **Keep blocking on art:** rejected: dead time, no materialize moment.
- **Generate art before/without a mod:** rejected: art is per verified mod subject.
