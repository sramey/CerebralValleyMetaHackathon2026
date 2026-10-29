# ADR 0042: Export single-file playable HTML game

- **Status:** Draft
- **Date:** 2026-10-29

## Context

Players build custom games with their voice, sketches, and text commands. Previously, worlds could only be played live against the WebSocket server or shared via link (`/?w=<id>`), requiring an active server and internet connection. Players should truly own what they build: "Download game" should produce a game they can take home, archive, attach to an email, or play offline on an airplane with zero server or AI dependencies.

## Decision

1. **Single-file HTML format (`server/export.ts`):** "Download game" produces a single self-contained `.html` file under ~1 MB (enforcing a hard size cap of 5 MB).
2. **Deterministic simulation core & renderer bundled:** The exported file embeds the deterministic simulation core (`World`, `ModLoader`), the PixiJS canvas renderer, procedural WebAudio sound synthesizer (`Sound`), declarative HUD (`createHud`), screen feel, and particle effects.
3. **Loaded mods inlined:** Built-in mods are bundled in the standalone runner (`src/export/runner.ts`); verified AI-written mods are embedded as compiled ESM JavaScript strings and loaded in-browser via dynamic Blob URL imports without external network requests.
4. **Sprites as data URIs:** Character sprite sheets (ninja, chicken), custom mod art, and mood-restyled sheets are encoded as base64 data URIs (`data:image/webp;base64,...`) and decoded into Pixi textures via client-side chroma-keying.
5. **Building disabled:** All creation tools (voice hold-to-talk, orb build prompt, webcam import, WebSocket connection) are omitted in the exported file. The layout presents a clean player interface with game title, controls hint ("Move: A/D or arrows · Jump: W / Space · Shoot: X · Use: F · Sound: M"), sound toggle, active mods list, and a "Made with [Talk-to-Build](https://github.com/sramey/CerebralValleyMetaHackathon2026)" link to the repository.
6. **Wire protocol addition:** `worldExport` client message (validated defensively in `server/validate.ts`) triggers the export, and the server replies with `worldExported` `{ html, filename }` which triggers an automatic browser download.

## Consequences

- Exported games play 100% offline in fresh browsers (verified via headless Edge over `file:///`).
- Zero external CDN dependencies or network calls.
- Total file size is typically ~1 MB, well within the 5 MB ceiling.
- Server memory caches the compiled runner bundle so export generation takes under 5 ms.

## Alternatives considered

- **External CDN script tags (e.g. unpkg / cdnjs):** Rejected because offline play in an airgapped browser is a strict requirement.
- **ZIP archive with separate index.html and assets:** Rejected because a single portable file is much easier to distribute, store, and run with a single click.
- **Client-only bundling:** Rejected because client-side bundling of Pixi and assets would bloat client runtime dependencies, whereas the server already has `esbuild` and direct filesystem access to assets.
