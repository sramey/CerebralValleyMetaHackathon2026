import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { Downsampler, floatToInt16, orbLevel, rms } from "../src/client/pcm";
import { BYTES_PER_MS, buildHandshake, buildKeywords, createVoiceHub, GAME_KEYWORDS, parseMetaFrame, SilencePacer } from "../server/voice";
import type { ClientMsg, ServerMsg } from "../src/contract";

describe("pcm", () => {
  it("clamps and scales floats to int16", () => {
    expect(floatToInt16(0)).toBe(0);
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(5)).toBe(32767);
    expect(floatToInt16(-5)).toBe(-32768);
  });

  it("downsamples 48 kHz to 16 kHz at 3:1 and preserves DC level", () => {
    const out = new Downsampler(48000).process(new Float32Array(480).fill(0.5));
    expect(out.length).toBe(160);
    expect(Math.abs(out[80] - 16384)).toBeLessThanOrEqual(1);
  });

  it("chunked processing at 44.1 kHz equals one pass, with the right overall rate", () => {
    const n = 44100;
    const sig = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 44100));
    const whole = new Downsampler(44100).process(sig);
    const d = new Downsampler(44100);
    const parts: number[] = [];
    for (let i = 0; i < n; i += 882) parts.push(...d.process(sig.subarray(i, i + 882))); // 20 ms chunks
    expect(parts).toEqual(Array.from(whole));
    expect(whole.length).toBeGreaterThanOrEqual(15999);
    expect(whole.length).toBeLessThanOrEqual(16000);
  });

  it("keeps a 440 Hz tone at roughly full amplitude after downsampling", () => {
    const sig = Float32Array.from({ length: 4800 }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 440 * i) / 48000));
    const out = new Downsampler(48000).process(sig);
    const peak = Math.max(...Array.from(out).map(Math.abs)) / 32768;
    expect(peak).toBeGreaterThan(0.75);
    expect(peak).toBeLessThan(0.82);
  });

  it("rms and orbLevel are 0 for silence and rise with volume", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(orbLevel(0)).toBe(0);
    const quiet = rms(new Float32Array(100).fill(0.01));
    const loud = rms(new Float32Array(100).fill(0.3));
    expect(orbLevel(loud)).toBeGreaterThan(orbLevel(quiet));
    expect(orbLevel(10)).toBe(1);
  });
});

describe("meta protocol parsing", () => {
  it("parses the handshake ack, transcripts and errors", () => {
    expect(parseMetaFrame('{"sessionId":"abc"}')).toEqual({ t: "ack", sessionId: "abc" });
    expect(parseMetaFrame('{"type":"transcript","transcript":"Add a ninja.","final":true,"audioProcessedMs":1}')).toEqual({ t: "transcript", text: "Add a ninja.", final: true });
    expect(parseMetaFrame('{"type":"transcript","transcript":"Add","final":false}')).toEqual({ t: "transcript", text: "Add", final: false });
    expect(parseMetaFrame('{"type":"error","message":"nope"}')).toEqual({ t: "error", message: "nope" });
  });

  it("ignores progress, unknown types and garbage", () => {
    expect(parseMetaFrame('{"type":"audioProgress","audioProcessedMs":80}').t).toBe("ignore");
    expect(parseMetaFrame('{"type":"speechStart","turnId":1}').t).toBe("ignore");
    expect(parseMetaFrame("not json").t).toBe("ignore");
    expect(parseMetaFrame("null").t).toBe("ignore");
  });

  it("builds a push-to-talk 16 kHz handshake with the bearer prefix", () => {
    const h = buildHandshake("k123", ["ninja"]);
    expect(h.authorization).toEqual({ accessToken: "Bearer k123" });
    expect(h.audioEncoding).toBe("PCM_16KHZ");
    expect(h.mode).toBe("PUSH_TO_TALK");
    expect(h.keywords).toEqual(["ninja"]);
  });

  it("puts loaded mod names first, dedupes case-insensitively and caps the list", () => {
    const k = buildKeywords(["Ninja", "Purple Dragon", " "]);
    expect(k[0]).toBe("Ninja");
    expect(k[1]).toBe("Purple Dragon");
    expect(k.filter((x) => x.toLowerCase() === "ninja")).toHaveLength(1);
    expect(k).toContain("lava");
    expect(buildKeywords(Array.from({ length: 200 }, (_, i) => `mod${i}`))).toHaveLength(60);
    expect(GAME_KEYWORDS.length).toBeLessThan(60);
  });
});

describe("silence pacer", () => {
  it("owes audio in real time, an even byte count, and drops overflow instead of bursting", () => {
    const p = new SilencePacer(1000);
    expect(p.take(1000).length).toBe(0);
    expect(p.take(1020).length).toBe(20 * BYTES_PER_MS);
    expect(p.take(1020).length).toBe(0);
    expect(p.take(1050).length).toBe(30 * BYTES_PER_MS);
    const big = p.take(10000); // 8.95 s late: capped to 1 s, rest dropped
    expect(big.length).toBe(1000 * BYTES_PER_MS);
    expect(p.take(10010).length).toBe(10 * BYTES_PER_MS);
  });
});

// A stand-in for Meta's realtime endpoint: ack after the handshake, a partial per audio frame, a final on endStream.
async function mockMeta(opts: { ackDelayMs?: number; failWith?: string } = {}) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.on("listening", () => r()));
  const seen = { handshakes: [] as Record<string, unknown>[], bytes: 0, connections: 0 };
  wss.on("connection", (sock) => {
    seen.connections++;
    let words = 0;
    sock.on("message", (data, isBinary) => {
      if (isBinary) {
        const n = (data as Buffer).length;
        seen.bytes += n;
        if (n >= 640) { words++; sock.send(JSON.stringify({ type: "transcript", transcript: "add a ninja".split(" ").slice(0, Math.min(words, 3)).join(" "), final: false })); }
        return;
      }
      const m = JSON.parse(String(data)) as Record<string, unknown>;
      if (m.type === "endStream") {
        sock.send(JSON.stringify({ type: "transcript", transcript: "Add a ninja.", final: true }));
        sock.close(1000, "No more transcript segments");
      } else {
        seen.handshakes.push(m);
        if (opts.failWith) { sock.send(JSON.stringify({ type: "error", message: opts.failWith })); sock.close(1008); return; }
        setTimeout(() => sock.send(JSON.stringify({ sessionId: "s1" })), opts.ackDelayMs ?? 0);
      }
    });
  });
  const url = () => `ws://127.0.0.1:${(wss.address() as { port: number }).port}/v1/asr/realtime`;
  return { wss, seen, url };
}

function fakeClient() {
  const msgs: ServerMsg[] = [];
  const ws = { readyState: 1 } as unknown as WebSocket;
  return { ws, msgs, send: (_w: WebSocket, m: ServerMsg) => { msgs.push(m); } };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const frame = () => Buffer.alloc(640); // 20 ms of PCM16 16 kHz

describe("voice hub against a mock Meta endpoint", () => {
  const servers: Awaited<ReturnType<typeof mockMeta>>[] = [];
  afterEach(() => { for (const s of servers.splice(0)) s.wss.close(); });
  const cmd = (m: ClientMsg) => m;

  it("warm session: partials stream back, release yields the final with timings, and the next session re-warms", async () => {
    const meta = await mockMeta(); servers.push(meta);
    const c = fakeClient();
    const hub = createVoiceHub({ modNames: () => ["Ninja"], send: c.send, url: meta.url(), getKey: () => "test-key" });
    hub.handle(c.ws, cmd({ kind: "voiceWarm" }));
    await until(() => c.msgs.some((m) => m.kind === "voiceState" && m.state === "ready"));
    expect(meta.seen.handshakes[0].authorization).toEqual({ accessToken: "Bearer test-key" });
    expect(meta.seen.handshakes[0].keywords).toContain("Ninja");

    hub.handle(c.ws, cmd({ kind: "voiceStart" }));
    for (let i = 0; i < 3; i++) hub.audio(c.ws, frame() as never);
    await until(() => c.msgs.filter((m) => m.kind === "transcript").length >= 3);
    hub.handle(c.ws, cmd({ kind: "voiceEnd" }));
    await until(() => c.msgs.some((m) => m.kind === "transcript" && m.final));

    const parts = c.msgs.filter((m): m is Extract<ServerMsg, { kind: "transcript" }> => m.kind === "transcript");
    expect(parts.filter((p) => !p.final).map((p) => p.text)).toEqual(["add", "add a", "add a ninja"]);
    const fin = parts.find((p) => p.final)!;
    expect(fin.text).toBe("Add a ninja.");
    expect(fin.ms!.firstPartial).toBeGreaterThanOrEqual(0);
    expect(fin.ms!.final).toBeGreaterThanOrEqual(0);
    expect(meta.seen.bytes).toBeGreaterThan(0);

    await until(() => meta.seen.connections === 2); // standby for the next press
    hub.close(c.ws);
  });

  it("cold start: audio sent before the handshake ack is queued and the turn still completes", async () => {
    const meta = await mockMeta({ ackDelayMs: 150 }); servers.push(meta);
    const c = fakeClient();
    const hub = createVoiceHub({ modNames: () => [], send: c.send, url: meta.url(), getKey: () => "k" });
    hub.handle(c.ws, cmd({ kind: "voiceStart" })); // no warm session
    for (let i = 0; i < 3; i++) hub.audio(c.ws, frame() as never);
    hub.handle(c.ws, cmd({ kind: "voiceEnd" })); // released before the ack
    await until(() => c.msgs.some((m) => m.kind === "transcript" && m.final));
    const fin = c.msgs.find((m) => m.kind === "transcript" && m.final) as Extract<ServerMsg, { kind: "transcript" }>;
    expect(fin.text).toBe("Add a ninja.");
    expect(meta.seen.bytes).toBe(3 * 640);
    hub.close(c.ws);
  });

  it("a tap (cancel) sends no command text", async () => {
    const meta = await mockMeta(); servers.push(meta);
    const c = fakeClient();
    const hub = createVoiceHub({ modNames: () => [], send: c.send, url: meta.url(), getKey: () => "k" });
    hub.handle(c.ws, cmd({ kind: "voiceStart" }));
    hub.handle(c.ws, cmd({ kind: "voiceEnd", cancel: true }));
    await new Promise((r) => setTimeout(r, 300));
    expect(c.msgs.some((m) => m.kind === "transcript" && m.final)).toBe(false);
    hub.close(c.ws);
  });

  it("Meta rejecting the session surfaces one orb-sized error", async () => {
    const meta = await mockMeta({ failWith: "bad token" }); servers.push(meta);
    const c = fakeClient();
    const hub = createVoiceHub({ modNames: () => [], send: c.send, url: meta.url(), getKey: () => "k" });
    hub.handle(c.ws, cmd({ kind: "voiceStart" }));
    await until(() => c.msgs.some((m) => m.kind === "voiceState" && m.state === "error"));
    const err = c.msgs.find((m) => m.kind === "voiceState" && m.state === "error") as Extract<ServerMsg, { kind: "voiceState" }>;
    expect(err.detail).toMatch(/type instead/);
    hub.close(c.ws);
  });

  it("an unreachable Meta endpoint surfaces an error instead of throwing", async () => {
    const c = fakeClient();
    const hub = createVoiceHub({ modNames: () => [], send: c.send, url: "ws://127.0.0.1:1/v1/asr/realtime", getKey: () => "k" });
    hub.handle(c.ws, cmd({ kind: "voiceStart" }));
    await until(() => c.msgs.some((m) => m.kind === "voiceState" && m.state === "error"));
    hub.close(c.ws);
  });

  it("without an API key it says so and does not connect", () => {
    const c = fakeClient();
    const hub = createVoiceHub({ modNames: () => [], send: c.send, getKey: () => "" });
    hub.handle(c.ws, cmd({ kind: "voiceStart" }));
    const err = c.msgs[0] as Extract<ServerMsg, { kind: "voiceState" }>;
    expect(err).toMatchObject({ kind: "voiceState", state: "error" });
    expect(err.detail).toMatch(/MODEL_API_KEY/);
  });
});

describe("voice spend guard", () => {
  it("a refused start says why and opens no Meta session; session seconds are booked when one ends", async () => {
    const meta = await mockMeta();
    const c = fakeClient();
    let refuse: string | null = "Voice is used up for today.";
    const booked: number[] = [];
    const hub = createVoiceHub({
      modNames: () => [], send: c.send, url: meta.url(), getKey: () => "k",
      guard: { check: () => refuse, record: (_w, s) => { booked.push(s); } },
    });
    hub.handle(c.ws, { kind: "voiceWarm" });
    hub.handle(c.ws, { kind: "voiceStart" });
    expect(c.msgs[0]).toMatchObject({ kind: "voiceState", state: "error", detail: "Voice is used up for today." });
    await new Promise((r) => setTimeout(r, 100));
    expect(meta.seen.connections).toBe(0);

    refuse = null;
    hub.handle(c.ws, { kind: "voiceStart" });
    hub.audio(c.ws, frame() as never);
    hub.handle(c.ws, { kind: "voiceEnd" });
    await until(() => c.msgs.some((m) => m.kind === "transcript" && m.final));
    await until(() => booked.length >= 1);
    expect(booked[0]).toBeGreaterThan(0);
    hub.close(c.ws);
    meta.wss.close();
  });
});
