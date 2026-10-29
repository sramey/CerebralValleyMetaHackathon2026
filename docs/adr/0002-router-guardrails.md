# ADR 0002: Router sends its schema; build-shaped commands always build

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-27

## Context

Live probing found the router silently failing in three ways: (1) `server/index.ts` never sent `ROUTER_SYSTEM`, so Spark invented actions outside the schema (`"add_entity"`), which `parseRoute` correctly rejected; (2) at 256 max tokens the reply came back empty (see ADR 0001); (3) Spark sometimes routes "add a bouncing slime" as a tweak against a mod the client does not have loaded (server and client manifests diverge), producing "add that mod first" dead ends.

## Decision

The router is treated as an unreliable classifier wrapped in deterministic guardrails:

- Always send `ROUTER_SYSTEM` as the system message; route at 1024 tokens, minimal effort.
- If no valid route parses and the command is build-shaped (`add|make|create|spawn|give|put|build …`), fall back to `new`.
- If a build-shaped command is routed as tweak/question, coerce it to `new`.

## Consequences

- "Add X" can no longer dead-end on a classifier miss; worst case Wonder writes an unnecessary mod, which the user can undo.
- Spark remains the classifier for genuine tweaks/questions/undo, where its mistakes are cheap.
- Guardrails are regex-shaped, so truly ambiguous phrasings ("make the slime faster" before any slime exists) are covered by ADR 0005's fallbacks instead.

## Alternatives considered

- **Trust Spark fully with a better prompt:** measured unreliable even with the schema sent; variance between identical commands caused user-visible coin flips.
- **Replace Spark routing with local regex routing:** deterministic but loses natural-language tweak/question handling the design wants (DESIGN §8). Guardrails keep both.
