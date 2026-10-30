# ADR 0062: Aware sprite generation — Platformer orientation and sequential actions

- **Status:** Draft
- **Date:** 2026-10-30
- **Amends:** ADR 0007 (art pipeline), ADR 0017 (mood restyle), ADR 0053 (flying poses)

## Context

When generating or restyling sprite sheets via Muse Image (`generateSubjectArt` in `server/art.ts` and whole-world mood restyles like "make it spooky" via `restyleSheet` in `server/mood.ts`), image generation prompts only specified generic style anchors or bare pose words.

Without explicit context, orientation, and action constraints:
1. Muse Image frequently hallucinated 3x3 or multi-row character sheets with 4-way RPG turnaround poses (front, side, and backwards/rear view looking away from the camera, or sitting/top-down postures).
2. The column-projection slicer in `src/client/sprites.ts` selected the band with the largest pixel area (such as the wide hem of a rear-view cloak in `ninja--spooky.webp`), causing player and creature characters to render backwards, facing away from the player.
3. Mood restyles occasionally replaced the subject entirely (e.g. turning the player into top-down turtles or pumpkins).

## Decision

Update sprite generation prompts (`spritePrompt` in `server/art.ts` and `moodPrompt` in `server/mood.ts`) to be explicitly aware of three pillars:

1. **What it is making:**
   - Identity & role: Specifies the subject name (e.g. `ninja`, `slime`, `dragon`), its entity kind (creature, held item, scenery prop), and the target game context: a 2D side-scrolling platformer.
2. **The orientations it will be:**
   - Strict 2D side-scroller side-view profile, facing right in ALL poses.
   - Explicit negative constraints: NEVER face backwards or away from the camera (no rear view, no back of character facing away), NEVER front-facing (no RPG turnaround), no top-down angles.
   - Single-row layout constraint: Exactly 1 single horizontal row of 4 poses from left to right (NEVER multiple rows, NEVER a 2D grid).
3. **The actions it will perform:**
   - Ground characters/creatures: 4 sequential action poses from left to right, all facing right: (1) idle standing pose facing right, (2) running forward stride facing right, (3) running forward stride facing right, (4) jumping mid-air leap pose facing right.
   - Flying creatures: 4 airborne flight action poses from left to right, all facing right: (1) hovering idle facing right, (2) gliding forward facing right, (3) flapping/flying forward facing right, (4) diving/ascending facing right (completely off the ground, no ground line or shadow).
   - Held items: 4 standalone item variants in 1 horizontal row, side view pointing right (no character/hands holding it).
   - Scenery props: 4 static variations in 1 horizontal row on the same baseline (not a character, no animation poses).

Existing corrupted restyled cache files (`ninja--spooky.webp`, `ninja--daytime.webp`, etc.) are purged from disk so they regenerate cleanly with the new prompt contract.

## Consequences

- Generated and restyled character sheets reliably produce 4 side-scrolling profile poses facing right in 1 horizontal row, preventing backwards sprites and multi-row grid distortions.
- Slicing and animation cycles in `src/client/sprites.ts` and `src/client/main.ts` map cleanly to the 4 action frames (idle = frame 0, run = frames 1-2, jump = frame 3).
- Existing unit tests for art prompts and mood restyle pass with enhanced contract checks.

## Alternatives considered

- **Client-side pose/orientation heuristics:** Inspecting pixel distributions in Canvas2D cannot synthesize a missing profile view from a rear-view cloak image. Prompt awareness at generation time fixes the root cause.
- **Top-band slicer clamp:** While clamping the slicer to the top band prevents picking the bottom row of a multi-row sheet, it does not prevent the model from generating front-facing or turnaround poses in the top row. The generator must be aware of the 2D side-scrolling orientation contract.
