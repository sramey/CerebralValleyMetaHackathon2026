# Meta Model API notes

Sources: dev.meta.ai/docs/models, /speech-to-text, /media-segmentation, /pricing-rate-limits (read 2026-10-27). Check the docs before relying on details.

- **Base URL:** `https://api.meta.ai/v1`. It's OpenAI-SDK compatible (`base_url` + `MODEL_API_KEY`).
- **Protocols:** Responses, Chat Completions, Messages.

| Model | Input | Output | Notes |
|---|---|---|---|
| Muse Wonder (`muse-wonder-1.0`, preview) | text, image, video, audio, PDF | text | Strongest. Sub-agents, parallel tools, 1M context, reasoning effort `minimal`…`max`, computer use, search grounding |
| Muse Spark (3 versions; Muse Code defaults to `muse-spark-1.2`) | text, image, video, audio, PDF | text | Faster. Same features minus computer use |
| Muse Image | text + image | image | Generate **and edit** (use edit-from-anchor for the style bible) |
| Muse Voice Transcribe | audio | text | Speech to text only |
| SAM 3.1 (`sam-3.1`) | image or video + short noun-phrase prompt | boxes + masks (streamed) | One object type per request; tracks across video frames |

**No text-to-speech.** The orb talks with on-screen text plus sound effects.

## Realtime facts
- **Voice Transcribe realtime:** `wss://api.meta.ai/v1/asr/realtime?sessionId=<id>`.
  - Verified handshake (2026-10-29): first frame `{authorization:{accessToken:"Bearer KEY"}, audioEncoding:"PCM_16KHZ", model:"muse-voice-transcribe-1.0", mode:"PUSH_TO_TALK", partialMode:"CUMULATIVE", keywords, languageBias}`; ack is `{"sessionId":...}`. In PUSH_TO_TALK, `endStream` ends the whole session, so it's one session per utterance; the final arrives ~100 ms after `endStream`, close 1000 ~500 ms later.
  - Send a JSON handshake as the first text frame within 10 s, with auth in `authorization.accessToken` = `Bearer <key>`. The HTTP Authorization header is ignored.
  - Audio is PCM signed 16-bit little-endian mono at 16 or 24 kHz, sent as binary frames **paced at real time**. Keep sending silence while live.
  - Partial transcripts stream as you speak. End with `{"type":"endStream"}` and keep reading until close code 1000.
  - Sessions run up to 60 minutes. Limits: 256 concurrent streams, 16,000 per hour.
  - Supports `keywords` / `languageBias`, set at start.
  - Costs $0.18 per hour.
- **SAM 3.1:** request-based, results stream back (`client.responses.stream(model="sam-3.1", …)` or SSE). Video costs $0.20 per 1,000 frames, **minimum 50 frames per video request**. There's no live-webcam endpoint, so send frames or clips.
- **Spark / Wonder:** request/response with streamed text. Use them as a "director" (seconds), never per frame.

## Rate limits
Per team, not per key. Read the `x-ratelimit-*` headers.

## Credits
- $150 Meta credit, claimed through the hackathon Google Form. It arrives in batches, so claim early.
- Set a Spend Limit alert on the Billing page.

## Benchmarks (measured 2026-10-27)

| Call | p50 | p95 | Notes |
|---|---|---|---|
| Spark router (short JSON) | ~0.7s | ~3.2s | With the router system prompt + 1024 tokens, `reasoning_effort: minimal`. At 256 tokens replies returned empty |
| Wonder mod (~80 lines) | ~8s | ~13s | Full command median 8.7s / p95 12.3s across the 10-command spike run (`scripts/spike-run.ts`), incl. route+compile+verify |
| Muse Image sprite sheet | ~8s | — | `POST /v1/images/generations`, model `muse-image-1.0` -> WebP `b64_json`. One consistent character, 4 poses, flat magenta |
| SAM 3.1 single image | ~1.2s | — | `POST /v1/responses`, model `sam-3.1` -> box coords + encoded mask string (format not yet decoded; client chroma-keys instead, ADR 0007) |
| Transcribe: speech onset → first partial | ~0.86 s | ~0.99 s | Meta emits after the first word. Release → final ~0.13 s p50. Cold handshake 0.5–0.8 s, hidden by a warm session (ADR 0012) |

Critical finding: at the default reasoning effort, Wonder/Spark replies come back **empty** on our prompts (reasoning tokens eat the whole budget). All calls use `reasoning_effort: minimal` — see [ADR 0001](adr/0001-reasoning-effort-minimal.md).
