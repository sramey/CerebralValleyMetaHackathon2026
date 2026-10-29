# Architecture Decision Records

One file per decision, numbered in order, never edited after acceptance — a changed mind gets a **new** ADR that supersedes the old one. The old file stays; its Status line changes to `Superseded by ADR-NNNN`.

## Format

Each ADR is `NNNN-short-title.md` with exactly these sections:

- **Status:** Draft | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **Context:** What forced a choice. Facts, constraints, evidence.
- **Decision:** What we chose, in one or two sentences.
- **Consequences:** What gets easier, what gets harder, what we now owe.
- **Alternatives considered:** What else was on the table and why it lost.

Keep it under a screenful. An ADR records *why*, not *how* — the code shows how.

## When an ADR is required

Per the rule in `AGENTS.md`: any change that

- picks between real alternatives,
- creates or changes a contract between components (sim/server/client, mod API, wire protocol),
- changes runtime semantics another component depends on, or
- would surprise a future reader ("why is it done *this* way?")

…ships with an ADR in the same change. Bug fixes with one obvious cause, refactors with no behavior change, and visual-only tweaks do not need one — if in doubt, write it; a short ADR is cheap.

New ADRs start as **Draft**. Only the project owner marks one **Accepted**.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-reasoning-effort-minimal.md) | All Meta calls use `reasoning_effort: minimal` | Draft |
| [0002](0002-router-guardrails.md) | Router sends its schema; build-shaped commands always build | Draft |
| [0003](0003-verifier-in-process-empty-world.md) | Verifier runs in-process, each mod alone in an empty world | Draft |
| [0004](0004-solid-with-gravity-physics.md) | Solid entities with gravity still get physics | Draft |
| [0005](0005-tweak-edit-fallbacks.md) | Invalid tweaks fall back to edit/new instead of failing | Draft |
| [0006](0006-spark-subagent-workers.md) | Build work is delegated to Spark subagents by file ownership | Draft |
| [0007](0007-art-pipeline-chroma-key-first.md) | Art: Image sheet + client chroma-key slicing; SAM validates, mask decode deferred | Draft |
| [0008](0008-async-art-digitize-placeholder.md) | Art streams asynchronously; digitize placeholder while it generates | Draft |
| [0009](0009-scenery-vs-creature-art.md) | Intent classification: scenery vs creature art | Draft |
| [0010](0010-camera-object-prototype.md) | Camera object prototype: SAM box + client flood-fill cutout, template mod | Draft |
| [0011](0011-combat-targeting-and-health.md) | Combat targeting and health: opt-in hostiles/heroes, 100 HP + damage, exact-match routing | Draft |
| [0012](0012-voice-hold-to-talk.md) | Voice: hold-to-talk proxied through our server to a pre-warmed Muse Voice Transcribe session | Draft |
| [0014](0014-deploy-share-spend-visitor.md) | Deploy: single-port server, per-session worlds, share links, spend guard, visitor mode | Draft |
| [0013](0013-visible-verifier.md) | Visible verifier: bot playtest in a copy of the player's world, ghost replay, Wonder `run_playtest` agent fix | Draft |
| [0015](0015-spark-visual-kind-shapes-fx.md) | Spark picks each entity's visual kind in the router call; shapes and effects drawn in code | Draft |
| [0016](0016-parallel-agentic-builds.md) | Parallel build pool, Wonder as a Meta tool-calling agent, pronoun memory | Draft |
