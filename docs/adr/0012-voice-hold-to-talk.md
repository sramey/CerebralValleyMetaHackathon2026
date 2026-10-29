# ADR 0012: Hold-to-talk voice through a server proxy with a warm Meta session

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-29

## Context

Voice input must feel instant: hold a key, the orb reacts, words appear, release builds. Muse Voice Transcribe realtime authenticates with the API key inside its first WebSocket frame, so the browser cannot talk to Meta directly without exposing the key. In `PUSH_TO_TALK` mode `endStream` ends the whole session, so one session serves exactly one turn. A cold session costs 500-820 ms (TLS plus handshake ack, measured), which would eat the whole latency budget. Meta wants real-time pacing, at most 5 s of audio ahead, and a live stream that never goes quiet.

## Decision

1. The browser captures the mic (AudioWorklet), downsamples to PCM16 mono 16 kHz and sends **binary WebSocket frames** to our server over the existing socket. Control messages (`voiceWarm`, `voiceStart`, `voiceEnd`) and results (`voiceState`, `transcript` partial/final) are new JSON union members in `src/contract.ts`. The key stays on the server.
2. The server keeps one **pre-handshaken Meta session per client** (the standby), feeding it real-time silence. `voiceStart` takes it over instantly; after each turn a fresh standby is opened (with the current mod names as keywords). If none is ready, audio is queued up to 4 s and the turn still completes (cold start).
3. Release sends `endStream`; the final transcript is used the moment it arrives (no wait for the close). The client submits it exactly like typed text.

## Consequences

- Press to transcribing has no handshake wait; release to final measured 85-160 ms. First partial is bounded by Meta (it emits after the first word), not by us.
- An idle standby costs silence audio only (about $0.18 per hour of session time). It is dropped after 10 minutes unused and re-warmed on window focus, and recycled at 50 minutes (Meta's limit is 60).
- Binary frames avoid base64's 33% overhead on a 32 KB/s stream, but the server socket now mixes text and binary frames.
- The mic stays open after the first press (browser mic indicator stays on); audio is only sent while the key is held.
- Taps under 250 ms and blurred windows are cancelled, so Shift pressed as a modifier never sends a command.

## Alternatives considered

- **Open the Meta session on key press:** simplest, but adds 500-820 ms to every first partial.
- **One long `ENDPOINTING` session streamed continuously:** no per-turn setup, but it costs continuous transcription and replaces explicit push-to-talk with guessed turn boundaries.
- **Browser talks to Meta directly:** lowest hop count, but needs the key in the browser (or a token endpoint Meta doesn't document).
- **Base64 audio in JSON frames:** keeps everything text, at 33% more bandwidth and encode/decode cost per 20 ms chunk.
