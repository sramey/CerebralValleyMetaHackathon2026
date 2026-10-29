# 0031. Art decisions derive from the entity ontology

- **Status:** Draft
- **Date:** 2026-10-29

## Context

`server/art.ts` carried two hand-maintained word lists: `SKIP_TYPES` (types that must never get a generated sheet) and `SCENERY_WORDS` (subjects that get static scenery variants instead of character poses). ADR 0023 had already introduced `src/ontology.ts` as the single deterministic classifier (terrain | effect | projectile | shape | prop | creature | player) and taught `artKeyForType` to consult it, but the two lists stayed and were consulted *before* the ontology. Every new entity type had to be remembered in both places or it slipped through: too little, and terrain or effects got character sheets (ADR 0024); too much, and a real prop got no art. The lists also drifted from the ontology — `SKIP_TYPES` still listed generic creature words (`enemy`, `slime`, `gel`), `SCENERY_WORDS` duplicated prop prefixes, and two substring rules (`string`, `tail`) lived only inside `isSkippedType`. Separately, `server/art.ts` deleted corrupted legacy sheets in a loop at import time, so merely importing the module (in tests or a script) mutated `public/art/gen/`.

## Decision

Add `ArtPlan` (`none` | `held-item` | `scenery` | `sheet`) and `artPlanFor(input)` to `src/ontology.ts`, derived from `entityKind`: terrain/effect/projectile/shape → `none`, held items (prop + `isHeldItemType`) → `held-item`, other props → `scenery`, creatures and the player → `sheet`. Delete `SKIP_TYPES` and `SCENERY_WORDS`; `isSkippedType`, `isScenerySubject`, `artKeyForType`, `pickArtType`, and the prompt choice in `generateSubjectArt` all read the plan. Fold the two substring rules into the ontology's effect tokens (`tail`, `string` and plurals — cosmetic appendages and light strings are code-drawn). Replace the import-time purge with `purgeLegacyArt()`, called explicitly once in `server/index.ts` at startup.

## Consequences

- A new entity type needs no art bookkeeping: its head noun decides. Unseen compounds (`glacier-step`, `thundercloud`, `bone-dagger`, `rosy-apple`) classify correctly with no list edit, and a test pins ten unseen names.
- Generic creature words that `SKIP_TYPES` used to swallow (`enemy`, `enemies`, `slime`, `gel`) are creatures per the ontology, so a mod that literally spawns `type: "slime"` now gets a pose sheet instead of a procedural box. Nothing in the shipped mods, worlds or demo scripts spawns those types, so no Meta image spend changes today.
- `player` is a `sheet` plan but never a generated one: the engine ships its sheet, so `isSkippedType("player")` and `artKeyForType("player")` still reject it.
- Importing `server/art.ts` no longer touches the filesystem; tests and scripts are side-effect free. The legacy purge list stays explicit (a one-time disk cleanup), and a test proves every key in it is code-drawn, so it can never delete valid art.
- One more kind→look mapping to keep in step when the seven entity kinds change; the client's own `kindOf` (ADR 0015 shapes) is still a separate registry.

## Alternatives considered

- **Keep `SKIP_TYPES` but add the ontology check first:** rejected — the list stays alive, keeps drifting, and a future contributor still has to remember it exists.
- **Derive the purge by scanning `public/art/gen/` and deleting anything whose plan is `none`:** rejected — it would delete committed effect sheets (`firefly.webp`, `soil.webp`) and dirty a public checkout on every boot; the legacy keys are a historical fix, not a rule.
- **Add a second "structure" and "item" kind to `EntityKind`:** rejected — a contract change across sim, server, client and the manifest for no new information: static solids are already terrain and held items are already props.
