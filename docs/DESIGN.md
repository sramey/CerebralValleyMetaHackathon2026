# Design: Talk-to-Build Platformer

Every decision here was settled in a design Q&A on 2026-10-27. Treat them as decided. If one needs to change, discuss it first and then update this file.

## One-liner

You start with an empty black screen. You talk to it, and a modern pixel-art side scroller builds itself around you **while you play**:
- "add a player, make it a ninja"
- "add some ground"
- "fire arrows when I shoot"
- "turtle enemies"
- "make it spooky"

Each change is written by AI agents, **verified by a headless playtest before it goes live**, and hot-loaded into the running game without a restart.

**Pitch:** "Game making takes years to learn. What if it took a sentence?" Close with: "Every change is written, tested and verified by agents before it touches the running game. We built it for games, but this is how software should change live."

## Hackathon context

- **Event:** Meta Global AI Developer Hackathon (Cerebral Valley), solo, **Indie track**.
- **Deadline:** **Wed Nov 4 2026, 9:00 PM ET.** Target submitting by 3 PM.
- **Submission:** a 3-minute demo video, a **public** repo and a live product URL.
- **Rubric:** Impact 30, Meta tooling 25, Depth 20, Demo 25. The Indie track rewards creativity, technical ambition and "it works."
- **Bonuses we're targeting:**
  - Most Viral on X ($20K).
  - Community vote ($10K).
  - Best Creative, for Muse Image/Wonder ($5K).
  - Best Agentic ($5K).
- **Not targeting** the open-weights bonus (too slow for the fast path).
- **Rules:** only work built during the event; **original IP only**. No Mario, no Nintendo assets, names or sprites.

## Locked decisions

### 1. The AI writes mods against a small engine API (hybrid)
- **Tweaks** ("jump higher", "make the turtles red") → Muse Spark changes a setting the mod already exposes, in under 2 s.
- **New things** ("add turtle enemies") → Muse Wonder writes a **self-contained mod**: code, a sprite request and a test. The verifier checks it, then it hot-loads.
- Mods are isolated. They never edit each other or the engine. Each mod is a visible card that can be toggled or undone.

### 2. The engine holds the laws of nature; everything visible is a mod
- **Built in (never generated):**
  - 60 fps fixed-step loop, rendering, tile collision, physics and gravity.
  - Input, camera, audio playback, particles, lighting layers.
  - Mod loader, verifier, orb.
- **At start the world is empty:** black screen, a pulsing orb, "🎙 say something."
- The player, ground, enemies, art, music and backgrounds are **all mods**. This produces a funny beat: the first ninja falls off the screen until you add ground.

### 3. Engine: our own small TypeScript engine
- **Simulation core:** pure, deterministic, fixed 60 Hz timestep, no DOM. It runs identically in the browser **and headless** in a worker or Node, which is what makes the verifier possible (100× speed playtests).
- **Rendering:** PixiJS (WebGL). Bloom, lighting, screen shake and a CRT toggle live here.
- **Mods:** TypeScript modules against a **tight API** (sketch below). Each has `setup()` and `dispose()` so it hot-swaps cleanly.
  - The API reference goes into Wonder's prompt.
  - Mods may not touch engine internals, the network, the DOM, `eval` or `Function`.

### 4. Art pipeline (SAM 3.1 has a real job)
1. Muse Image generates **one sprite sheet image** per character (idle / run ×4 / jump / attack in a grid, on a flat magenta background). One image keeps the character consistent.
2. **SAM 3.1** segments the subject ("ninja"), giving a clean alpha mask per frame and separating the frames.
3. Normalize: scale to the size grid, nudge toward the world palette, add outlines, align the feet.
4. Art verifier:
   - Frames are consistent (SAM mask overlap between frames).
   - Readable at game size.
   - Contrasts with the background.
   - On-palette.

   It regenerates once with a targeted fix if any check fails.
5. Hot-load with a pixel "materialize" effect. A **gray silhouette placeholder appears instantly** so the game never waits.

**Stretch goal:** hold a drawing or toy up to the webcam and say "make this an enemy." SAM cuts it out, it gets pixelated, and it walks.

### 5. Spike first (see `SPIKE.md`)
Prove that Wonder can reliably write working mods fast **before** any art or voice.

### 6. The AI presence: an orb that lives in the game world

| Stage | Visual |
|---|---|
| Listening | Pulses with mic volume; the live transcript types under it |
| Thinking | Swirls; a one-line ticker streams the plan |
| Building | Flies to where the thing will appear and beams pixels down; placeholder appears |
| Verifying | A **ghost playtest**: a translucent player speed-runs the level in a corner window |
| Done | Object materializes; a mod card slides into the side rail ("🐢 Turtles · undo") |
| Rolled back | Flashes red; a bubble explains why and that it's fixing it |

It talks back with **on-screen text bubbles plus a soft sound effect**. Meta has no text-to-speech.

### 7. The verifier: three layers, built in this order
1. **Health checks (every mod):**
   - Loads, and runs 600 frames headless.
   - No exceptions and no NaN or Infinity in positions.
   - Bounded entity counts.
   - **Under 2 ms of simulation time per frame.**
2. **A per-mod test written by Wonder,** e.g. "spawn turtle → drop player on it → expect shell."
3. **"Can you still win?":** a search bot tries jump arcs using the *real* physics to prove the goal or the next chunk is reachable. This is what the ghost playtest shows.

On failure: errors and test output go back to Wonder for **one auto-fix attempt**. If that fails too, the game is unchanged and the orb explains.

### 8. Router and parallel builds
Muse Spark classifies each command, given a **world manifest** (every mod, its settings, the entities on screen):

| Type | Example | Path |
|---|---|---|
| Tweak | "jump higher", "make turtles red" | Spark sets a knob, under 2 s |
| New | "add turtle enemies" | Wonder writes a new mod (about 10–20 s) |
| Edit | "turtles should throw shells" | Wonder edits that mod's file, re-verified |
| Undo / remove | "undo", "remove the rain" | No AI, instant |
| Question | "what can I add?" | Spark answers in an orb bubble |

- "Them" and "it" mean the last thing touched.
- **Every mod must expose settings knobs** (speed, size, color, rate…), so most follow-ups are instant tweaks.
- Independent builds run **in parallel**, one orb trail per build, and the user can keep talking.
- Stretch: point and talk ("make *this* bigger" while clicking an object).

### 9. Visual style: modern pixel art (Celeste / Dead Cells)
Low-res pixel art with modern effects: dynamic lighting (fire arrows light the walls), bloom, screen shake, hit-stop, dust, rain splashes, parallax. CRT is a voice-toggle option.

### 10. Style bible (keeps all the AI art looking like one game)
1. **Anchor image.** The first art request generates a reference scene, or the user sets the mood. Every later Muse Image request is an **edit against the anchor**.
2. **A soft shared palette** of about 32–48 colors taken from the anchor. Sprites are nudged toward it.
3. **Fixed grid:** 16 px tiles, characters 32–48 px, consistent outlines.
4. **Lighting** (a dark overlay plus light sources) ties everything together.
5. The art verifier checks palette fit.

"Make it spooky" swaps the anchor and lighting, then restyles existing sprites in the background.

### 11. World: endless and rule-driven
- "Add some ground" creates a **level generator mod** that builds chunks ahead of the camera. The world is endless.
- Commands change the **generator rules** ("more pits", "floating platforms", "a castle every so often"). The next chunks reflect them.
- "Here" means at the player's position, for one-off placements.
- Every generated chunk passes a cheap reachability check (verifier layer 3).

### 12. Voice: hold to talk
- Hold a gamepad shoulder button, or **Shift** on the keyboard, while speaking. The orb lights up instantly.
- Muse Voice Transcribe realtime WebSocket. The partial transcript shows under the orb. Vocabulary hints include game terms.
- **Releasing the button sends the command,** with no wait for silence detection.
- A text box stays as a backup (and is the only input during the spike). A wake word comes later.

### 13. Architecture
- **Browser (Vite + TypeScript):** engine, PixiJS, mic capture, orb, UI. A WebSocket to the server.
- **Server (Node or Bun):**
  - Holds the Meta API key.
  - Runs the router, Wonder, Muse Image, SAM and transcription.
  - Compiles mods with **esbuild**.
  - Runs the **headless verifier in worker threads**.
  - Streams build stages to the client.
- Compiled mods ship to the browser and load in place.
- **A world is a list of mods**, saved per session and shareable as a link.
- **Hosting:** a small always-on container (Fly.io, Railway, or Modal credits). Per-session limits protect the $150 Meta credit.
- **Security:** mods are confined to the API. The verifier also checks the source for forbidden globals.

### 14. Models
| Job | Model |
|---|---|
| Router, tweaks, questions | Muse Spark (hosted, low reasoning effort) |
| Writing, editing and fixing mods; mod tests | Muse Wonder (`muse-wonder-1.0`) |
| Sprites, backgrounds, style anchor, restyles | Muse Image (generate + edit) |
| Sprite cutout and frame separation; webcam stretch goal | SAM 3.1 |
| Voice input | Muse Voice Transcribe (realtime) |

See `META-API.md` for capabilities, endpoints and pricing.

## Mod API sketch (proposed; refine during the spike)

```ts
export default defineMod({
  id: "turtles",
  title: "🐢 Turtle enemies",
  knobs: { speed: { value: 40, min: 10, max: 200 }, color: { value: "#3a7" } },
  setup(api, knobs) {
    api.defineEntity("turtle", {
      size: [16, 16], sprite: api.sprite("turtle"), solid: true,
      update(e, dt) { e.vx = e.facing * knobs.speed; if (api.atLedge(e)) e.facing *= -1; },
      onStomp(e, player) { api.replace(e, "shell"); player.vy = -200; },
    });
    api.spawnRule("turtle", { every: 300 /* px of new chunk */ });
  },
  dispose(api) { api.removeEntityType("turtle"); },
  test(t) { /* spawn turtle, drop player on it, expect a shell */ },
});
```

## Demo video (3:00)

| Time | Beat |
|---|---|
| 0:00–0:15 | **Hook:** black screen, orb. "Game making takes years to learn. What if it took a sentence?" |
| 0:15–0:45 | **From nothing:** "add a player, make it a ninja" → it falls off the screen → "add some ground" → it lands |
| 0:45–1:30 | **Build while playing:** parallax forest · fire arrows (light on walls) · turtles · "make them faster" (instant knob). Parallel builds, cards stacking up |
| 1:30–2:00 | **It can't break:** "make me huge" → the ghost playtest finds a gap he can't fit through → auto-fix → the orb explains |
| 2:00–2:20 | **"Make it spooky":** the whole world restyles |
| 2:20–2:40 | **Stretch:** a webcam drawing becomes an enemy |
| 2:40–3:00 | **Close:** architecture card (Wonder · Spark · Image · SAM 3.1 · Voice), the "how software should change live" line, a share link |

**Rules:**
- Use real uncut runs. Speed up build waits only with a visible "⏩ 3×" label.
- Pick 8 commands and rehearse each 20+ times.
- **Record on Tue Nov 3.**

## Schedule
These are checkpoints in order. Pull work forward if ahead. The fixed points are the **Thu go/no-go** and **recording on Tue 11/3**.

| Day | Goal |
|---|---|
| Tue 10/27 | Setup: repo, Meta credits claimed, API key working, **latency benchmarks** (Wonder, Spark, Image, SAM, transcription) |
| Wed 10/28 | Spike build (engine core, mod API, hot-load, text box, Wonder mod writer, health checks). Watch Agents 102 at noon ET |
| Thu 10/29 | **Go / no-go** on the spike pass bar |
| Fri 10/30 | Art pipeline + style bible + lighting |
| Sat 10/31 | Voice hold-to-talk, router, knobs, orb states, mod cards, parallel builds |
| Sun 11/1 | Endless generator, "can you win" bot, ghost playtest, auto-fix |
| Mon 11/2 | "Make it spooky", juice polish, deploy, share links, session limits. Post on X once the spooky transform works |
| Tue 11/3 | Rehearse, fix flakiness, **record the video**. Webcam stretch goal only if ahead |
| Wed 11/4 | Edit the video, README, submit by 3 PM ET |
