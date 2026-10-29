# ADR 0014: Single-port deploy, per-session worlds, share links, spend guard, visitor mode

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-29

## Context

The submission needs a public URL that judges can play without burning our Meta credit. Until now the server was a dev WebSocket on its own port, and its `manifest` (the mods it had verified) was one global map, so two visitors would have shared and edited one world. Every build, image, cutout and voice session costs money, and nothing counted them.

## Decision

1. **One port.** The Node server serves `dist/` (SPA fallback, hashed assets cached, runtime art from `public/art/gen`, `/healthz`) and attaches the WebSocket to the same `http.Server`, so it runs behind an HTTPS proxy as wss. The production client derives its WebSocket URL from `location`; `VITE_WS_URL` applies to dev only.
2. **Per-connection worlds.** Each WebSocket gets its own manifest. A world is its mod list. A share link is `/?w=<id>` for a JSON file in `DATA_DIR/worlds`. The server saves **only** what it verified itself: built-ins as bare references, AI mods from the session manifest. The client only says which ids are loaded, so a link can never carry code a visitor made up. Opening a link replaces the world and seeds the session manifest, so remixing (edit, undo, tweak) just works.
3. **Spend guard** (`server/budget.ts`). Before every Meta call: builds (per command), images, SAM, and voice seconds of Meta session time are counted per visitor (IP, `X-Forwarded-For` when `TRUST_PROXY=1`) and globally, per UTC day, persisted to `DATA_DIR/budget.json`. `AI_KILL_SWITCH=1` refuses everything, live. A refusal is one friendly orb sentence, never an error. Warm voice sessions are capped at 30 at once and freed after 2 minutes idle; the client re-warms on key/pointer activity.
4. **Visitor mode.** With no key, the kill-switch on, or a budget spent, the server sends the orb a sentence and the list of curated demo worlds (`worlds/demo-*.json`). Built-in commands, controls, share links and demo worlds work without any Meta call.
5. A `Dockerfile` and `.dockerignore` for one container; limits come from env vars (see `.env.example`).

## Consequences

- A public server is safe to run: one visitor can't see or edit another's world, and the worst-case daily Meta spend is bounded by the global caps.
- Per-visitor limits are per IP, so visitors behind one NAT share a quota, and a determined visitor can rotate IPs; the global cap is the real backstop.
- Saved worlds live on the server disk. They vanish with the container unless `DATA_DIR` is a mounted volume.
- Demo worlds are committed JSON, including AI-written mod sources and their generated art, so they play with no key.
- The production client ignores `VITE_WS_URL`: a separately hosted frontend would need a code change.
- A world's AI mods are trusted on load (verified when first built, stored by the server), not re-verified.

## Alternatives considered

- **Client uploads the world to save:** simpler, but every opened link would run unverified code in other visitors' browsers.
- **Store worlds in the URL itself:** no server storage, but mod sources are too large for a URL.
- **Per-WebSocket budgets:** trivially bypassed by reconnecting; per-IP plus a global cap is sturdier at no extra complexity.
- **Separate static host plus WebSocket host:** more moving parts, and CORS/origin handling for a demo.
