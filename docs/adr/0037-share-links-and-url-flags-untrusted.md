# 0037: Share links and URL flags are untrusted input, decoded in one defensive place

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** A share link (`?w=<id>`) and the flags that ride with it (`?mood`, `?coach`,
  `?nocoach`, `?mute`, `?vol`, `?noshake`, `?tester`) arrive from strangers: chat apps truncate
  them, mail clients escape them, people paste half a URL, and old saves use a shape the current
  code cannot resolve. The client used to read `location.search` in three places
  (`new URLSearchParams(...).get("w")`, `flags.has("mute")`, `Number(get("vol"))`), so a
  truncated or re-encoded link could mute the game (`?vol=` parses as `0`), start a request for a
  world that cannot exist, and leave the visitor on an empty stage with no explanation until a
  timeout fired.
- **Decision:** One pure decoder, `src/client/url-flags.ts` (tested in `tests/url-flags.test.ts`),
  is the only reader of the URL. It returns a typed `UrlFlags`: booleans, a `0..1` volume or null,
  a mood slug or null, and either a validated world id or a `ShareIssue`
  (`empty | oversized | invalid | legacy`). Only an id matching the server's grammar
  (`^[A-Za-z0-9_-]{4,40}$`, mirroring `isWorldId`) is opened; anything else is never sent to the
  server. On an issue the client says one plain sentence ("Couldn't open that world — …"),
  removes the share keys from the URL so a reload does not retry, and loads the starter world,
  online or offline. A grammar-valid id that no longer exists still resolves only through the
  server, so the existing 8 s fallback stays and now ends in the same friendly path. Bad flag
  values are dropped, not guessed: `?vol=abc`, `?vol=1e999`, `?vol=` give no volume; `?mute=0`
  turns a presence flag off; a mood name is slugged the way `moodKey` does it. `?tester` is a QA
  flag that only exposes `window.__urlFlags`.
- **Consequences:**
  - Old-format links (`.json` names, pasted URLs, `world=`/`worldId=`, `#w=`/`#/w/` fragments)
    are reported as `legacy` and fall back to the starter; they are not upgraded, so a link that
    half-works can never open a different world than the sender meant.
  - Every future flag or URL parameter goes through this file; ad-hoc `URLSearchParams` reads in
    the client are a regression.
  - Fuzzing (seeded, 10 000+ cases: random garbage, junk flag combinations, corrupted real links)
    holds the invariants: never throws, volume always in range or null, id always grammar-valid
    or null, an id and an issue never coexist.
- **Alternatives considered:**
  - **Upgrade legacy links by pattern** (strip `.json`, read `world=`, take an old short id).
    Rejected: a guess that resolves to the wrong world is worse than a clean fresh start, and the
    server can only resolve current-format ids anyway.
  - **Keep trusting `URLSearchParams` and let the server answer**. Rejected: it leaves `?vol=` as
    a silent mute, does nothing offline, and gives no explanation until the timeout.
  - **Add a `worldMiss` server message for an immediate miss**. Deferred: this bead is
    client-only and the wire protocol stays untouched; the timeout covers a valid-but-gone id.
