# ADR 0070: The current world survives a reload and a server restart

- **Status:** Draft
- **Date:** 2026-10-30

## Context

A first-time tester built for about twenty minutes: jetpack, rideable dragon, zombie waves, a blaster, a grappling hook, a car, a tank, a T-Rex pet, meteors, a drawn level, a basketball rival and two moods. They reloaded the page and lost all of it. Until now a world only became a file when the player pressed **Share this world** (ADR 0014), and every reload boots the starter world: sessions live in memory, keyed by the socket. A server restart was just as fatal for anything unshared. Making something is the whole product, so losing it on a refresh is the worst bug in the game, and "the build is the undo" does not help when the world itself is gone.

Nothing here is hosting or accounts: one person, one browser, one machine, the same local server.

## Decision

Each browser owns **one autosaved world**, stored with the machinery that already exists for share links.

1. **A slot id per browser.** The client keeps `home-<12 base64url chars>` in its own local storage (`ttb.home`) and creates one on the first visit. The id is unguessable, is the only thing stored, and never leaves the machine except as part of a world URL if the player shares it.
2. **Autosave on every change.** A landed mod, an undo, a mood, a knob, a sketch, a local built-in and a timeline restore all report the world (`worldState`) and debounce one `worldSave` carrying `slot`. The server snapshots that through the same path as a share link (`snapshotWorld`: built-ins as references, AI mods from its own verified manifest), so an autosaved file can never contain code the server did not verify. It rewrites `DATA_DIR/worlds/<slot>.json` in place and stays silent on the wire: no share id, no clipboard, no orb line. The page also flushes a pending save on `pagehide`/hidden, so closing the tab inside the debounce window still saves the last build.
   - Sessions are per socket, so a reconnect or a server restart leaves the page holding mods the server has no manifest for. An autosave therefore keeps, for any id the client still has loaded but the session does not, the record the slot file already had (`reuseStoredMods`). The fallback record is the server's own previously verified file, never the client's, so a restarted server cannot quietly hollow out the world it is saving.
3. **Restore on boot.** With no `?w=` in the URL the client sends `worldResume <slot>`. The server answers with the stored world marked `resumed` (the URL stays clean: this was not a link) or with `worldMissing`, and the client then starts fresh. A `?w=` link still wins over the browser's own world (ADR 0037), and a first-ever visit asks for nothing.
4. **New world is one click.** A `New world` button (also "new world", "start over", "fresh start" by voice or text) unloads every mod, clears the mood, takes a fresh slot, sends `worldState { reset: true }` so the server drops its own copy of the old mods (edits, playtests and `inspect_world` must not see mods that are no longer on screen), and loads the starter world again. Nothing is deleted: the previous world stays a normal file, reachable from the timeline within the session, so a mis-click is recoverable.
5. **Nothing personal leaves in a file.** Everything is scrubbed on the way to disk (`server/hygiene.ts`): this process's own key values, key-shaped tokens, long hex runs, email addresses and home directory paths are redacted in every string of the world, share saves included. A world file is JSON on disk that may be shared, exported as a game and read by a judge, so it must never carry anyone's details.
6. **Housekeeping.** Autosave slots nobody opened for 14 days are pruned at startup; only `home-*` files are ever deleted, never a shared world or a curated demo.

## Consequences

- A reload, a crash of the server, or closing the laptop and coming back tomorrow gives the player their world: the file is the only state that matters.
- The game now writes a JSON file a few times a minute while someone builds. Files are small (kilobytes) and rewritten in place, so this is cheap; a world over the size cap says so once and stops autosaving rather than failing silently forever.
- Opening a link or a demo still replaces the world on screen, as in ADR 0014; the first build after that copies the opened world into the player's own slot. The browser's previous world is still on disk but the client no longer points at it, which is the price of "one current world" and no accounts.
- A tester's world lives in the browser profile that built it. Clearing site data, a private window, or another browser starts a new world; a share link is still the only way to carry a world between machines.
- Scrubbing is deliberately narrow, so a secret that matches none of the patterns (a plain phrase someone typed as a mod title) would still be saved. Nothing about it is expected in model-written code, and the env-key cut is the backstop.
- The wire grew three optional fields and one message (`worldSave.slot`, `worldState.reset`, `world.resumed`, `worldResume`/`worldMissing`), all validated at the door (ADR 0036); an old client simply never sends them.

## Alternatives considered

- **Put the world in the URL:** no server storage, but mod sources are far too large (ADR 0014 already rejected this).
- **A cookie or account session:** a login for a local toy, and a server-side session still dies on restart: the file is the thing that survives.
- **One global "current world" file on the server:** simplest save path, but two tabs, two visitors or a demo rehearsal would clobber each other's world (ADR 0014 exists to prevent exactly that mixing).
- **Save only when the player asks:** a "Save" button is one more thing for a first-time player to not press; the tester's loss is the evidence.
- **Re-verify restored mods on load:** they were verified when built and are stored by the server (ADR 0014); re-verifying would add seconds to every reload.
