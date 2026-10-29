# 0027: In-app stats feed (`GET /api/stats` + panel in the pipeline view)

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** The demo video cannot use slides, so the impact numbers (builds landed,
  first-try rate, auto-fix saves, median time to a playable change) have to be visible in
  the product itself. The numbers already exist as a local, gitignored JSONL creation log
  (`logs/builds.jsonl`, written by `server/createlog.ts`) and as `npm run stats`, which
  aggregates it in `server/stats.ts` and renders a committed markdown page. That page is a
  slide by another name; a viewer still has to leave the game. Two problems had to be
  solved at once: the game client must read the numbers, and reading them must not leak
  anything the log holds (every player command, mod titles, Windows paths, error bodies).
- **Decision:** Serve the aggregate as an allow-listed numbers-only payload at
  `GET /api/stats` from the existing single-port server, built by a new pure
  `server/stats-feed.ts` on top of the same `aggregate()` the script uses, and rendered in
  the pipeline overlay (`P`) by a new `src/client/stats-panel.ts`. `npm run stats -- --json`
  prints the identical payload. The endpoint is CORS-open, read-only, derived from data the
  game already produced, and carries no text field that came from a player.
- **Consequences:**
  - One aggregation implementation, two front doors: the markdown page and the panel can
    never disagree about a number, and a test can pin both.
  - The response shape (`StatsFeed` in `src/contract.ts`) is now a small public contract;
    adding a number means extending that interface and the allow-list in `stats-feed.ts`.
    Prompt text can never reach the wire because the mapper only picks numbers.
  - The panel is a view, not a source: if the endpoint is down it says so rather than
    showing a cached or invented figure. It polls only while the overlay is visible.
  - Per-build numbers (routes, failure buckets, art timing) stay on the markdown page;
    the panel deliberately shows the five numbers a judge reads in three seconds.
  - Deploy notes: nothing to configure; on the deployed single port the panel fetches its
    own origin, in dev it derives the HTTP base from `VITE_WS_URL` (same env var the
    socket already uses).
- **Alternatives considered:**
  - Bake the numbers into the client bundle at build time: stale the moment a build lands,
    and it would make a stale artifact of a living log.
  - Expose the raw log over HTTP and aggregate in the browser: the log holds every player
    command (prompts, paths, names), so it must never leave the machine as text.
  - Ship the markdown page into the overlay as an iframe: heavy, unreadable at capture
    size, and still a document rather than part of the product.
  - A WebSocket message on the existing socket: works, but the numbers are also useful from
    `curl`/scripts during a demo, and a boring GET survives the proxy unchanged.
