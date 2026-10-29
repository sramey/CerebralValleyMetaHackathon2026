# Learned Engine Rules

Automatically distilled by Muse Spark (`muse-spark-1.2`, `reasoning_effort: "minimal"`) from in-game player feedback and verifier auto-fixes.

## Router & Visual Classification (`router`)

- **[seed]** Simple geometric objects (ball, orb, bubble, ring, spike, block, gem) must route with visual:"shape", never "creature" or sprite art.

## Mod Generation & Physics (`wonder`)

- **[seed]** Dynamic ground entities must spawn at y = 400 - h with solid: false and gravityScale: 1 so they never trap or block the player.

## Sprite Sheet & Art Generation (`art`)

- **[seed]** Sprite sheets must keep a flat solid #FF00FF magenta background with wide gaps between poses and no ground lines or text.
