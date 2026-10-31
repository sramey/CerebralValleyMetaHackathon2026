# Learned Engine Rules

Automatically distilled by Muse Spark (`muse-spark-1.2`, `reasoning_effort: "minimal"`) from in-game player feedback and verifier auto-fixes.

## Router & Visual Classification (`router`)

- **[seed]** Simple geometric objects (ball, orb, bubble, ring, spike, block, gem) must route with visual:"shape", never "creature" or sprite art.

## Mod Generation & Physics (`wonder`)

- **[seed]** Dynamic ground entities must spawn at y = 400 - h with solid: false and gravityScale: 1 so they never trap or block the player.
- **[feedback]** Weather rain drops must fall with wind-driven slant/angle and spawn a small splash burst effect on ground impact. _(from `rain`)_
- **[autofix]** Jetpack must require separate input + fuel/cooldown and clamp vertical velocity/altitude; never apply continuous thrust while jump is held.
- **[autofix]** Bind jetpack thrust to held jump input only — never to shoot/fire — and gate thrust with fuel >0 and cooldown checks.
- **[autofix]** Never place solid ground-level walls across the run path; make hideout/decorative walls non-solid or leave a player-sized passable gap.
- **[autofix]** Never spawn rideable/mount entities ahead of the player on the forward path; spawn behind/beside to avoid blocking progression.
- **[review]** car uses solid:false so player falls through when not riding and cannot stand on it as platform _(from `driveable-car`)_
- **[review]** car width knob logic reads knobs.speed instead of knobs.size so size knob is ignored _(from `driveable-car`)_
- **[review]** tank.facing never initialized so first shell velocity is NaN (tank.facing * shellSpeed) until player moves _(from `driveable-tank`)_
- **[review]** tank.vy may be undefined on spawn causing Math.min(tank.vy,300) to produce NaN velocity _(from `driveable-tank`)_
- **[review]** dispose() filtered coins by data.obstacle but coins were spawned with data.collectible only, leaving orphaned coin entities after dispose _(from `obstacle-course`)_
- **[autofix]** Flapping bird pet must set gravityScale=0 and apply per-frame flapPhase/bobHeight vertical lift to stay airborne while following.

## Sprite Sheet & Art Generation (`art`)

- **[seed]** Sprite sheets must keep a flat solid #FF00FF magenta background with wide gaps between poses and no ground lines or text.
