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
| [0001](0001-reasoning-effort-minimal.md) | All Meta calls use `reasoning_effort: minimal` | Accepted |
| [0002](0002-router-guardrails.md) | Router sends its schema; build-shaped commands always build | Accepted |
| [0003](0003-verifier-in-process-empty-world.md) | Verifier runs in-process, each mod alone in an empty world | Accepted |
| [0004](0004-solid-with-gravity-physics.md) | Solid entities with gravity still get physics | Accepted |
| [0005](0005-tweak-edit-fallbacks.md) | Invalid tweaks fall back to edit/new instead of failing | Accepted |
| [0006](0006-spark-subagent-workers.md) | Build work is delegated to Spark subagents by file ownership | Accepted |
| [0007](0007-art-pipeline-chroma-key-first.md) | Art: Image sheet + client chroma-key slicing; SAM validates, mask decode deferred | Accepted |
| [0008](0008-async-art-digitize-placeholder.md) | Art streams asynchronously; digitize placeholder while it generates | Accepted |
| [0009](0009-scenery-vs-creature-art.md) | Intent classification: scenery vs creature art | Accepted |
| [0010](0010-camera-object-prototype.md) | Camera object prototype: SAM box + client flood-fill cutout, template mod | Accepted |
| [0011](0011-combat-targeting-and-health.md) | Combat targeting and health: opt-in hostiles/heroes, 100 HP + damage, exact-match routing | Accepted |
| [0012](0012-voice-hold-to-talk.md) | Voice: hold-to-talk proxied through our server to a pre-warmed Muse Voice Transcribe session | Accepted |
| [0014](0014-deploy-share-spend-visitor.md) | Deploy: single-port server, per-session worlds, share links, spend guard, visitor mode | Accepted |
| [0013](0013-visible-verifier.md) | Visible verifier: bot playtest in a copy of the player's world, ghost replay, Wonder `run_playtest` agent fix | Accepted |
| [0015](0015-spark-visual-kind-shapes-fx.md) | Spark picks each entity's visual kind in the router call; shapes and effects drawn in code | Accepted |
| [0016](0016-parallel-agentic-builds.md) | Parallel build pool, Wonder as a Meta tool-calling agent, pronoun memory | Accepted |
| [0018](0018-unstick-casual-locomotion.md) | One-way floating platforms, engine stuck recovery, casual hop over the player | Accepted |
| [0019](0019-declarative-mod-hud-api.md) | Declarative HUD widgets through ModApi, owner-scoped | Draft |
| [0020](0020-self-improving-rules.md) | Feedback and auto-fixes become Spark-distilled rules and skills on disk | Draft |
| [0017](0017-world-mood-restyle.md) | World mood restyle: Spark mood spec, palette swap, Muse Image edit from original sheets | Draft |
| [0021](0021-in-app-pipeline-view.md) | In-app live pipeline view replaces the architecture slide | Draft |
| [0022](0022-code-stream-build-theater.md) | Stream Wonder code live: build theater behind the stage + pipeline pane | Draft |
| [0023](0023-reliable-huge-beat.md) | Reliable "make me huge" beat: clearance 72px, learner skips size rejections | Draft |
| [0024](0024-entity-ontology-and-theme-routing.md) | Entity ontology and theme routing | Draft |
| [0025](0025-usable-item-keybinding-and-damage-pattern.md) | Usable item key (F/E/X/J) and reusable enemy-damage helper | Draft |
| [0026](0026-draw-to-build-level-sketcher.md) | Draw-to-build: sketch overlay → multimodal Wonder → bounded level spec | Draft |
| [0027](0027-in-app-stats-feed.md) | In-app stats feed: GET /api/stats + impact panel in the pipeline view | Draft |
| [0028](0028-sketch-mode-phrases-pause-side-palette.md) | Sketch mode: local phrases, frozen sim, side palette | Draft |
| [0032](0032-open-weights-router-on-baseten.md) | Open-weights router: Muse Spark Open on Baseten with hosted fallback | Draft |
| [0033](0033-visible-agent-loop-and-autonomy-stats.md) | Visible agent tool loop + autonomy stats | Draft |
| [0029](0029-overlay-layout-z-order-pipeline-sketch-hud.md) | Overlay layout, z-order, and responsive scaling across sketch, pipeline, and HUD | Draft |
| [0030](0030-sketch-idle-guard-live-stats-refresh.md) | Sketch mode lets go after 3 minutes idle, and the impact tiles move when a build lands | Draft |
| [0031](0031-art-decisions-derive-from-ontology.md) | Art decisions derive from the entity ontology | Draft |
| [0034](0034-anonymous-tester-metrics.md) | Anonymous family-test metrics (?tester=N) → aggregates-only page | Draft |
| [0036](0036-validate-every-client-message.md) | Validate every client message at the door | Draft |
| [0037](0037-share-links-and-url-flags-untrusted.md) | Share links and URL flags are untrusted input, decoded in one defensive place | Draft |
| [0039](0039-pickup-reach-and-sketch-replaces-level.md) | Pickup reach matches the drawn player; a sketched level replaces the level | Draft |
| [0043](0043-explain-this-mod-in-plain-words.md) | 'How does this work?': Spark explains a mod in plain words with its key lines | Draft |
| [0044](0044-kid-safe-screen.md) | Kid-safe screen: local list + budgeted Spark verdict before routing; art prompts screened too | Draft |
| [0041](0041-time-travel-timeline.md) | Time-travel timeline: snapshot every world change, restore as a new step | Draft |
| [0042](0042-export-single-html.md) | Download the world as one self-contained, offline HTML game | Draft |
| [0046](0046-basketball-goal-and-action-key.md) | Basketball goal as a real structure; B is the action key | Draft |
| [0040](0040-paper-to-level.md) | Paper to level: photograph a drawn level and it gets built | Draft |
| [0048](0048-camera-dialog-film-ready-layout.md) | Film-ready camera dialog; upload is the default door | Draft |
| [0049](0049-game-weapons-are-safe.md) | Game weapons and fighting are explicitly allowed by the kid-safe screen | Draft |
| [0051](0051-creature-steering.md) | Creatures steer: fliers turn at walls, walkers stop at ledges, hostiles get engine AI states | Draft |
| [0050](0050-grappling-hook-and-pointer-aim.md) | Grappling hook: pointer aim in InputState, engine rope/raycast/winch helpers | Draft |
| [0053](0053-compound-splitting-one-subject-one-build.md) | Spark splits compound commands; a guard keeps one subject with its behaviors in one build; flying creatures and dropped pickups | Draft |
| [0054](0054-bounded-sketch-build.md) | Bounded sketch build: compact JPEG, 15 s vision ceiling, instant stroke-box fallback | Draft |
| [0052](0052-wave-spawner-and-swarm-archetype.md) | Wave spawner: multi-angle offscreen spawns, anti-clumping, kill-paced level-ups; built-in swarm mod | Draft |
| [0055](0055-engine-owned-collectibles.md) | Engine-owned collectibles: data.collectible auto-collects into one shared score HUD | Draft |
| [0056](0056-contain-crashing-and-looping-mods.md) | Contain crashing and looping mods: quarantine on throw, compile-time loop guards | Draft |
| [0057](0057-engine-rules-gear-shots-ground-broad-phase.md) | Engine rules for gear, shots and the ground slab; a broad phase for collision | Draft |
| [0058](0058-faster-builds-fewer-sequential-model-turns.md) | Faster builds: relative tweaks, split beside the router, prefetched world snapshot | Draft |
| [0059](0059-living-creations-events-speech-orders-and-route-rules.md) | Living creations: mod events, speech bubbles, voice orders to any creature, route rules as a named pipeline | Draft |
| [0060](0060-cancel-a-running-build.md) | Cancel a running build: an x on its chip aborts that one build and drops its result | Draft |
| [0061](0061-gear-sockets-on-the-drawn-body.md) | Gear sockets on the drawn body: hand/back/head/feet/belt for any character, clamped nudges, a dragon can wear a hat | Draft |
| [0062](0062-aware-sprite-generation-orientation-and-actions.md) | Aware sprite generation: 2D side-scrolling platformer orientation facing right and 4 sequential action poses | Draft |
| [0063](0063-fallen-creatures-go-back-on-the-ground.md) | Fallen creatures go back on the ground: a creature 900 px below the main slab is stood beside the player | Draft |
| [0064](0064-friendly-fire-protection-and-clustered-burst-explosions.md) | Friendly fire protection and spatially clustered burst explosions | Draft |
| [0065](0065-how-was-this-made-receipt.md) | "How was this made?": a receipt for every creation, from words to verified playable mod | Draft |
| [0066](0066-genre-change-set-scene.md) | Genre change: `api.setScene` hides terrain and scenery, sets a backdrop and player skin, and undo restores it all | Accepted |
| [0067](0067-themed-parallax-backdrops.md) | Themed parallax backdrops: "change the background to medieval" is a background-scoped mood carrying code-drawn scenery motifs | Accepted |
| [0068](0068-open-weights-build-reviewer.md) | Open-weights build reviewer: Muse Spark Open on Baseten reviews each finished build, hot-swaps a fix only if it passes the verify gates, and learns a rule | Accepted |
| [0069](0069-what-it-has-learned-area.md) | "What it has learned": an in-game area (`GET /api/brain`) for the reviewer scorecard, each fix with its diff and the rule it taught, and the rules and skills library | Proposed |
| [0070](0070-world-survives-reload.md) | The current world survives a reload and a server restart: one autosaved slot per browser, scrubbed files, one-click "New world" | Proposed |
| [0071](0071-hostile-identity-stomp-pets-and-facing.md) | The engine owns stomping, pet friendly fire (a companion never hurts the player), no sinking into solids and steady facing | Proposed |
| [0072](0072-walker-hostiles-grounding-and-art-persistence.md) | Creature sheets slice into 4 whole frames on one baseline; wave walkers are grounded unless flyers are asked for; editing a mod keeps its art unless the art is asked to change | Proposed |
| [0073](0073-generated-levels.md) | Level requests go to a deterministic generator (`api.buildLevel`): pits, platforms at several heights, spikes, walkers, checkpoints and a goal; "harder", "extend" and "new" are knob changes; place themes are deterministic | Proposed |
| [0074](0074-engine-loadout.md) | The engine owns the loadout: one active item, switch (Q), drop (G), reload (R), a mounted vehicle's weapon overrides the player's gear, vehicles run over hostiles | Proposed |
| [0075](0075-engine-owned-hurt-window-and-knockback.md) | Getting hurt is engine-owned: a short invulnerability window, a knockback and a red flash | Proposed |
| [0076](0076-drawn-crosshair-over-the-stage.md) | A drawn crosshair over the stage for aiming, hidden for keyboard and gamepad play | Proposed |
| [0077](0077-reconnect-adopts-the-home-world.md) | A reconnect adopts the browser's own world file back into the session, so knobs, undo and edits keep working with no reload | Proposed |
| [0078](0078-open-weights-second-opinion-on-stage.md) | The open-weights second opinion is shown on stage (fix card, +1 rule pulse, pipeline node) and can be asked for: "double-check my world" | Proposed |
| [0079](0079-startup-no-key-screen.md) | A startup screen in visitor mode (no Meta key) says which features need a key and what still plays, then drops you into the demo worlds | Proposed |
| [0080](0080-landmark-art-is-one-picture.md) | A landmark's art is one picture of the whole subject: one-image art order, single-frame slicing, uniform scaling on the ground, and no parallax double-draw | Proposed |
