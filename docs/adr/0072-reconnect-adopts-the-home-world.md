# ADR 0072: A reconnect adopts the browser's own world file, so the world stays editable

- **Status:** Proposed
- **Date:** 2026-10-30

## Context

ADR 0070 made the world a file per browser: the client autosaves every change, a reload or a server restart hands the same world back, and `reuseStoredMods` stops an autosave from hollowing out a file whose mods the session has forgotten. But sessions are keyed by the socket. A server that restarts under an open tab (or any dropped socket) therefore gives the page a world on screen and a session with an empty manifest — and edits, undo and knobs all resolve ids against that manifest. So with the world looking perfectly fine, "make it bigger" re-built it from nothing, undo answered "Nothing loaded with id …" and every knob answered "Unknown mod or knob", until the player reloaded. The file was never at risk; the *editing* was.

## Decision

On a reconnect, the client says "this is still my world, and it is my own autosave slot" and the server adopts its own file back into the session, silently.

1. **One new client message, `worldAdopt { id, mods }`** (additive; validated at the door like every frame, home slots only). The client sends it on a reconnect of a page that is *showing* its own autosaved world — it was resumed from that slot, or it has been autosaved into it since — and never from a page showing a share link or a demo, whose mods are a different set with their own ids.
2. **Only the session's gaps are filled.** Ids the session already holds are never overwritten (a build made after the reconnect wins), ids the page no longer lists are not raised from the dead, and built-ins stay the client's bundle (`adoptBuiltins`).
3. **The client's knob values win over the file's**, clamped like a live knob message, so a value turned while the socket was down is not snapped back to the file's older one on the next autosave.
4. **Nothing is sent back.** No `world` frame, no re-import, no reset: the page keeps playing, and the world on screen is never re-rendered.

## Consequences

- Edits, undo and the knobs keep working across a restart with no reload, which is the demo-recording case: the world looks alive and is alive.
- The session's first timeline step after a reconnect now holds the real world, because the client's `worldState` arrives just before the adopt.
- What a file cannot carry is still lost on a restart: the mood (the server's `s.mood` stays unset, so a later mood build starts from none), the level stash behind a sketched level (undo after a restart will not bring the previous level back) and the timeline steps from before it. None of them broke the core loop; all are follow-ups.
- The wire grew one message; an old client never sends it, and a new client against an old server simply gets one plain sentence for it.

## Alternatives considered

- **Key sessions by home slot instead of socket:** survives a reconnect but not a restart (sessions are memory), so it fixes half the bug and changes how every other handler finds its session.
- **Answer a reconnect with `worldResume` again:** the server would re-render the client's world — re-importing every mod and resetting positions and state mid-play — for a player who did not ask for anything.
- **Have the client re-upload its own mod sources:** the server would then hold code it never verified, which is the one thing ADR 0014/0070 refuse.
- **Re-verify the adopted mods:** they were verified when built and are stored by the server; re-verifying would add seconds to every reconnect.
