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
- **[autofix]** When changing player skin/size, always implement locomotion in onTick by mapping api.input() to player vx/vy/facing; cosmetics alone don't move the pl
- **[review]** dispose() never removes the api.on("interact") and api.onTick() listeners registered in setup, leaving HUD/logic handlers after unload _(from `zoo-creatures`)_
- **[review]** dispose() does not remove the interact listener and onTick handler registered in setup _(from `dragon`)_
- **[review]** driftSpeed knob allows 0 but Number(knobs.driftSpeed) || 18 replaces 0 with 18, breaking zero-drift setting _(from `fog`)_
- **[review]** Gifts spawned from onTick are never despawned (they fall through ground and accumulate off-screen) despite being capped _(from `santa-sled`)_
- **[review]** dispose() does not remove the interact and tick listeners registered in setup _(from `christmas-carollers`)_
- **[review]** dispose() does not remove the interact/order listeners and tick handler it registered _(from `wandering-characters`)_

## Sprite Sheet & Art Generation (`art`)

- **[seed]** Sprite sheets must keep a flat solid #FF00FF magenta background with wide gaps between poses and no ground lines or text.
