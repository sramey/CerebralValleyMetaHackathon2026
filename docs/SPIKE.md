# Spike: can Wonder write working mods fast enough to feel live?

**Goal:** answer the one question that can kill the project, by **Thu Oct 29**. Build it ugly on purpose: colored rectangles, no art, no voice.

## Build
1. **Engine core:**
   - 60 Hz fixed-step deterministic simulation, no DOM.
   - Tile collision, gravity, input, camera, particles.
   - A layer system (for parallax).
   - Canvas or PixiJS rendering with rectangles.
2. **Mod API v0 + loader:** `defineMod` with `setup`/`dispose`/`knobs`/`test`. Loaded with a dynamic `import()` of the compiled module; `dispose()` removes everything the mod created.
3. **Server:**
   - Text command → Muse Wonder (with the API reference and world manifest in the prompt) → mod source.
   - esbuild compile.
   - Verifier in a worker thread.
   - Push the result to the browser over a WebSocket.
4. **Verifier v0:**
   - Layer 1 health checks: loads; 600 headless frames; no exceptions or NaN; bounded entities; under 2 ms per frame.
   - Layer 2: the mod's own `test()`.
   - On failure: one auto-fix attempt by Wonder with the error output.
5. **Text box** in the browser and a list of loaded mods with undo.
6. **Timing log** for each command: router / Wonder / compile / verify / total.

## Day-1 benchmarks (before the spike)
Measure typical and worst-case response times for:
- Muse Spark, short structured output (router).
- Muse Wonder, writing about 80 lines of mod code.
- Muse Image, one sprite sheet.
- SAM 3.1, one image.
- Voice Transcribe, the delay from speech to partial transcript.

Record the results in `docs/META-API.md`.

## The 10 test commands, run in order on one world
1. add a player
2. add some ground
3. make the player jump higher
4. add a pit
5. add enemies that walk back and forth
6. make enemies die when I stomp them
7. make it rain
8. add a parallax background
9. when I shoot, shoot a fire arrow (projectile + particle trail + impact burst)
10. add a moving platform

Extra checks: "make the player bigger" and "add coins and a score."

## Pass bar (go / no-go)
- ✅ **8 of 10** commands produce a working mod within one auto-fix retry.
- ✅ Typical response **under 15 s** for new things and **under 2 s** for tweaks.
- ✅ After all 10, the game still runs at 60 fps and **every mod can be undone cleanly**.

**If it misses:** simplify or narrow the mod API, add more examples to Wonder's prompt, lean harder on knobs, then re-run. Decide on Thursday, not later.
