# ADR 0041: Time-travel timeline

- **Status:** Draft
- **Date:** 2026-10-29

## Context
"It can't break" is only believable if the player can see it: every build, mood and undo should be reversible later, not just the last one. Undo today removes one mod. The server already holds each verified mod's source and a share-link serializer (`snapshotWorld`, ADR 0020) that captures a whole world, and the client already knows how to open one (`applyWorld`).

## Decision
The server keeps a per-session `Timeline` (`server/timeline.ts`, pure and in memory): each time the world's fingerprint changes (which mods, their code, the mood; knob drags do not count) it stores a step holding a `snapshotWorld` copy plus mood, restyled sheets and the sketch level stash. Steps are named by the player's command when fresh, else by the diff. `timelineRestore {n}` rebuilds the session from step n and replies with the existing `world` message (id `""`, so no URL change), then records a NEW "Restored" step. History is capped at 60, always keeping the first step. The client strip (`src/client/timeline.ts`) shows a dot per step; hover or click lists what that world held against the current one, with a Restore button.

## Consequences
- Restore is never destructive and reuses the share-link path, so a restored world remixes and undoes like any other. The sketch level stash is snapshotted and restored with it, so undoing a sketch after a restore still brings back the replaced level.
- Wire protocol gains `timeline` (server) and `timelineRestore` (client) only.
- Snapshots live in server memory per connection and are lost on reconnect; sources are shared strings, so cost is small.
- Preview is a mod list, not a rendered picture of the world.

## Alternatives considered
- Client-side snapshots: the client must not upload compiled code to the server, so a restore could not rebuild the server manifest.
- Rendered thumbnails or a live scrub of the stage: more work (headless world per step, entity caps) for the same trust signal; deferred.
- Recording every knob change: floods the strip; tweaks are not builds.
