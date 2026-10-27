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

## Benchmarks (fill in on day 1)
| Call | p50 | p95 | Notes |
|---|---|---|---|
| Spark router (short JSON) | | | |
| Wonder mod (~80 lines) | | | |
| Muse Image sprite sheet | | | |
| SAM 3.1 single image | | | |
| Transcribe: speech → partial | | | |
