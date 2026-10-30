# 0053: Split a compound command only when it names independent things; one subject is one build

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** "Add a superhero cat that flies around dropping coins" was decomposed by
  Spark into four parallel builds (appearance, patrol, coin dropping, coin entity), all of
  which wrote the same mod id. The player watched four jarring restarts in 25 seconds: a
  ground cat with glowing eyes, then a hovering cat playing a walking animation, then coins
  that could not be collected, then coins that froze mid-air. The fault was the splitter
  prompt itself ("Split the request into at most 4 independent single-add commands"): it
  turns one subject's traits and behaviors into separate commands. Splitting also costs a
  Spark call on every compound-shaped command (bead 2yt).
- **Decision:**
  1. Compound splitting is **deterministic** (`server/compound.ts`, `splitCompound`), with
     no model call. It splits only when every clause is a standalone build command:
     a clause opens with a build verb ("add a castle and **add** a dragon"), a determiner
     where the previous clause is not carrying an attribute list ("add a castle and **a**
     dragon"), or a whole-world mood. A clause that is a behavior ("...and drops coins"),
     a relative clause ("...that flies"), a pronoun subject ("...and make **it** fly") or a
     definite reference back to an earlier part ("...**the** cat") is merged into the part
     before it, so the request stays ONE build. The superhero cat therefore never splits.
     At most 4 parts; overflow clauses join the last part rather than being dropped.
  2. The Wonder prompt (new sections, no rewrites) says the request may describe ONE
     subject with several behaviors and must become ONE mod, names the flying-creature
     archetype (`gravityScale: 0`, altitude, sinusoidal patrol, airborne art), and names
     the dropped-pickup contract (gravity 1 + `data.bounce`, `api.touches`, one shared
     `score` HUD, particle burst).
  3. The engine owns the settle: `data.bounce` (0..0.9) is restitution on landing
     (`src/sim/bounce.ts`, hooked into the Y collision). A dropped coin bounces, decays and
     settles instead of freezing — mods no longer hand-roll it.
  4. Sprite art for a flying request (`server/art.ts` `isFlyingRequest`) asks Muse Image for
     airborne poses (hover, glide, fly, dive) instead of the walk/run cycle, and a flying
     subject gets its own sheet key (`cat-fly`), so a cached walking sheet can never stand
     in for it.
- **Consequences:**
  - A compound command no longer spends a Spark call to decide how to split; it routes and
    builds each part as before (still one budget unit per part).
  - A mood clause in a compound runs parts sequentially, so a world restyle never races a
    build.
  - Anything the splitter is unsure about becomes one Wonder build, which is the safe side:
    an over-broad build self-corrects in one edit, a set of racing builds does not.
  - `data.bounce` is additive spawn data; no contract or wire change, existing mods are
    unaffected (absent or 0 = no bounce, the old behavior).
- **Alternatives considered:** Keeping a Spark splitter with a better prompt (still spends
  a call, still non-deterministic, still can invent parts). Splitting on every "and"
  (breaks "a cat with a cape and a mask"). Giving each part a different mod id so the
  overwrites stop (still four builds for one creature, still four visual phases, and the
  parts would no longer share state).
