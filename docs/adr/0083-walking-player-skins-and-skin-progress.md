# ADR 0083: A plain character swap draws a walker, and the player shows progress while its skin draws

- **Status:** Draft
- **Date:** 2026-11-01
- **Extends:** ADR 0066 (player skins from `api.setScene({ playerSkin })`)

## Context
"Make my character an elephant" became `api.setScene({ playerSkin: "elephant" })`, and the skin art always used the ADR 0066 flight prompt (hovering, thrust, banking, diving). Muse Image drew a flying elephant with a rocket flame. Separately, the ~20 s draw showed nothing on the player, so it looked as if the request had only changed its size.

## Decision
1. **The scene decides the art form.** A scene is a flight scene when its `setScene` hides terrain or sets a backdrop (`world.scene.skinFlight`, read from the source by `skinFlightOfSource` for the server). Any other skin is a ground skin and is ordered with the normal 4-pose platformer prompt (idle, two run strides, jump), cut like any creature sheet (ADR 0072), feet on the same baseline.
2. **Separate cache keys** (`skinSheetKey` in `src/sim/scene.ts`, shared by client and server): flight keeps `<skin>-skin` (existing ADR 0066 sheets stay valid); ground is `<skin>-walk-skin`. The key now keeps hyphenated words whole (`space-ship-skin`, not `ship-skin`), so the client and server agree.
3. **Progress.** While the player's skin key is pending the client draws the same pixelating "digitize" effect a new creature gets (`skinIsPending`), and shows the old look again if the draw fails. A new server message `{ kind: "artFailed", modId, key }` ends the pending state on a declined or failed draw; the client says so in the orb.
4. **Prompt teaching.** A CHARACTER SWAP rule tells Wonder to call only `setScene({ playerSkin })` (no `hideTerrain` or backdrop), leave gravity and controls alone, and not resize the player beyond about 40x52 so it still fits the level.

## Consequences
- A walking and a flying elephant never share a sheet. An old flight sheet cached as `<skin>-skin` is still the flight sheet.
- `SceneState` gains `skinFlight`; `ServerMsg` gains `artFailed`.
- The exported single-file game still does not draw skins (unchanged).

## Alternatives considered
- **One sheet for both forms:** a flight sheet cannot walk, a walk sheet cannot bank. Rejected.
- **A Wonder-chosen `form` option on `setScene`:** more to teach and to get wrong; the scene's own flags already say it.
