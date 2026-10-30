# ADR 0060: "How was this made?": a receipt for every creation

- **Status:** Draft
- **Date:** 2026-10-30

## Context
The entry's claim is about technology, not one game: a sentence becomes logic, a test, art and a verified, playable asset, live. Every AI build already passes through that whole chain (Spark's route, Wonder's code and its own `test()`, the compile check, the 600-frame health run, the playtest bot in a copy of the player's world, the auto-fix round, Muse Image's prompt and sheet, the timings). But nothing showed the chain for *one* object. The pipeline view (P) shows the stages in aggregate, "How does this work?" (ADR 0043) explains code, and the build log keeps numbers only. A judge who clicks the slime they just made should be able to see everything that made it, and that "verified" means specific checks that passed.

## Decision
The server keeps a **receipt** with each mod it builds and sends it on request. No model is called and no budget is spent.

- **Captured at build time** in the main AI path (`handleSingle`): the command, Spark's route (action, visual kind, the model that answered, open-weights or fallback, route rules applied), Wonder's tool trace and turns, every source version with the reason a turned-away draft was rejected, the live mod's `test()` and the messages of its `expect` calls, verifier and playtest figures, the art step (the exact `subjectArtPrompt` Muse Image gets, cached / drawing / drawn / code-drawn, the time once the sheet lands), and the stage timings. It lives on the session's `ManifestRec`, like the source.
- **Wire:** client `receipt { modId }`; server `receiptResult { receipt: BuildReceipt }`. Only the id travels up; the receipt comes from the server's own records. Validated at the door like `explain`.
- **Mods with no build record** (built-ins, shared worlds, sketch, paper and photo builds) get a plain receipt: their source and their own test, saying honestly that no build record exists in this session.
- **Client:** a radial-menu action (gold receipt icon; the ring now holds nine buttons at 40°) opens one vertical chain. The proof rows tick green in turn, the Muse Image sheet is shown beside the browser's cut-out of it, and code (draft, fix, test, image prompt) opens on demand. The wording lives in a pure `receipt-model.ts`, pinned by tests.

## Consequences
- The whole thesis is one click away on any object, and it makes the closing beat of the demo video an in-app view, not a slide.
- `server/art.ts` exports `subjectArtPrompt` (the same function the generator uses) and `IMAGE_MODEL`, so the prompt shown cannot drift from the prompt sent. Learned art rules appended at call time are not shown.
- Test checks are read from `expect(cond, "message")` calls in the source. A check whose message is computed at runtime shows as written, with template holes as "…". The receipt lists what the test claims; the verifier proved it passed, or the mod would not be loaded.
- Receipts are per session and in memory. A world reopened from a share link has no receipts (a plain receipt instead), and a restart forgets them. Persisting them with saved worlds is possible later and would not change the wire.
- Sketch, paper and photo builds have their own paths and no receipt yet.

## Alternatives considered
- **Rebuild the chain on the client from build-stage frames.** The client sees stages, code stream and playtests as they happen, but would have to stitch them to a mod id across parallel builds and would lose everything on reload. The server already has the facts in one place.
- **Read it back from `logs/builds.jsonl`.** The log is deliberately numbers-only and local; it holds no prompts or route details per build, and a public server must not serve it.
- **Extend "How does this work?".** That card is for kids learning code in three sentences; mixing in verifier detail would ruin it. Two buttons, two questions.
