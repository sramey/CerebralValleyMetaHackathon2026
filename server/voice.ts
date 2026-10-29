// Hold-to-talk voice (ADR 0012): the browser streams mic audio to us as binary
// frames; we proxy it to Muse Voice Transcribe so the API key never leaves the
// server. One pre-handshaken Meta session is kept warm per client (fed silence
// at real-time pace) so pressing the key starts transcribing with no TLS or
// handshake wait.
import { WebSocket } from "ws";
import type { RawData } from "ws";
import type { ClientMsg, ServerMsg } from "../src/contract";
import { apiKey } from "./meta";

export const ASR_URL = "wss://api.meta.ai/v1/asr/realtime";
export const ASR_MODEL = "muse-voice-transcribe-1.0";
/** PCM16 mono 16 kHz = 32 bytes per millisecond. */
export const BYTES_PER_MS = 32;

/** Fixed game vocabulary; mod titles are appended per session. */
export const GAME_KEYWORDS = [
  "ninja", "platform", "turtles", "turtle", "spooky", "enemies", "coins", "lava", "rain", "fire arrows",
  "moving platform", "chicken", "player", "ground", "superhero", "dragon", "pirate", "robot", "wizard",
  "ghost", "castle", "starter world", "undo", "bigger", "smaller", "faster", "slower",
];
const MAX_KEYWORDS = 60;

export function buildKeywords(modNames: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...modNames, ...GAME_KEYWORDS]) {
    const k = raw.trim();
    const id = k.toLowerCase();
    if (!k || k.length > 40 || seen.has(id)) continue;
    seen.add(id);
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

export function buildHandshake(key: string, keywords: string[]): Record<string, unknown> {
  return {
    authorization: { accessToken: `Bearer ${key}` },
    audioEncoding: "PCM_16KHZ",
    model: ASR_MODEL,
    mode: "PUSH_TO_TALK",
    partialMode: "CUMULATIVE",
    emitAudioProgress: false,
    languageBias: ["English"],
    keywords,
  };
}

export type MetaEvent =
  | { t: "ack"; sessionId: string }
  | { t: "transcript"; text: string; final: boolean }
  | { t: "error"; message: string }
  | { t: "ignore" };

/** Parse one Meta text frame. Unknown or malformed frames are ignored. */
export function parseMetaFrame(raw: string): MetaEvent {
  let o: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return { t: "ignore" };
    o = v as Record<string, unknown>;
  } catch {
    return { t: "ignore" };
  }
  if (o.type === undefined && typeof o.sessionId === "string") return { t: "ack", sessionId: o.sessionId };
  if (o.type === "transcript" && typeof o.transcript === "string") {
    return { t: "transcript", text: o.transcript, final: o.final === true };
  }
  if (o.type === "error") return { t: "error", message: typeof o.message === "string" ? o.message : "voice error" };
  return { t: "ignore" };
}

/** Emits how many silence bytes are owed to keep a live stream at real-time pace. */
export class SilencePacer {
  private sentMs = 0;
  constructor(private startMs: number) {}
  /** Bytes (even count) to send at wall-clock `nowMs`; never more than `capMs` of backlog at once. */
  take(nowMs: number, capMs = 1000): Buffer {
    const dueMs = nowMs - this.startMs - this.sentMs;
    if (dueMs < 1) return Buffer.alloc(0);
    this.sentMs += dueMs; // overflow beyond capMs is dropped, not burst
    return Buffer.alloc(Math.floor(Math.min(dueMs, capMs) * BYTES_PER_MS / 2) * 2);
  }
}

export interface UpstreamHandlers {
  onTranscript(text: string, final: boolean): void;
  onError(message: string): void;
  onClose(): void;
}

/** One Meta realtime session. Audio sent before the handshake ack is queued. */
export class Upstream {
  private sock: WebSocket;
  private ready = false;
  private closed = false;
  private ended = false;
  private live = false;
  private pendingEnd = false;
  private reported = false;
  /** Called once with the session's lifetime in seconds when it closes (spend accounting). */
  onEnd?: (seconds: number) => void;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private pacer: SilencePacer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly createdAt = Date.now();
  readonly ackPromise: Promise<void>;
  /** Wall-clock ms from socket creation to handshake ack (cold-start cost). */
  ackMs = -1;
  handlers: UpstreamHandlers = { onTranscript() {}, onError() {}, onClose() {} };

  constructor(url: string, key: string, keywords: string[]) {
    this.sock = new WebSocket(url + (url.includes("?") ? "&" : "?") + `sessionId=${crypto.randomUUID()}`);
    let settle!: { res: () => void; rej: (e: Error) => void };
    this.ackPromise = new Promise<void>((res, rej) => { settle = { res, rej }; });
    this.ackPromise.catch(() => {});
    const t0 = Date.now();
    this.sock.on("open", () => this.sock.send(JSON.stringify(buildHandshake(key, keywords))));
    this.sock.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      const ev = parseMetaFrame(String(data));
      if (ev.t === "ack") {
        this.ready = true;
        this.ackMs = Date.now() - t0;
        if (this.live) this.flush();
        else this.startSilence();
        if (this.pendingEnd) this.sock.send(JSON.stringify({ type: "endStream" }));
        settle.res();
      } else if (ev.t === "transcript") this.handlers.onTranscript(ev.text, ev.final);
      else if (ev.t === "error") {
        settle.rej(new Error(ev.message));
        this.handlers.onError(ev.message);
      }
    });
    this.sock.on("error", (e: Error) => {
      settle.rej(e);
      this.handlers.onError(e.message);
    });
    this.sock.on("close", () => {
      this.closed = true;
      this.report();
      this.stopSilence();
      settle.rej(new Error("closed before ready"));
      this.handlers.onClose();
    });
  }

  get isReady(): boolean { return this.ready && !this.closed; }
  get isClosed(): boolean { return this.closed; }

  private startSilence(): void {
    // Until a user takes this session over, keep it alive with real-time silence.
    this.pacer = new SilencePacer(Date.now());
    this.timer = setInterval(() => {
      const b = this.pacer?.take(Date.now());
      if (b && b.length && this.sock.readyState === WebSocket.OPEN) this.sock.send(b);
    }, 20);
  }

  private stopSilence(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Real audio takes over from idle silence; flush anything queued during the handshake. */
  goLive(): void {
    this.live = true;
    this.stopSilence();
    if (this.ready) this.flush();
  }

  private flush(): void {
    for (const b of this.queue) this.sock.send(b);
    this.queue = [];
    this.queuedBytes = 0;
  }

  sendAudio(buf: Buffer): void {
    if (this.closed || this.ended) return;
    if (!this.ready) {
      // Cold start: keep up to 4 s (Meta rejects more than 5 s ahead of real time).
      if (this.queuedBytes + buf.length <= 4000 * BYTES_PER_MS) { this.queue.push(buf); this.queuedBytes += buf.length; }
      return;
    }
    this.stopSilence();
    this.sock.send(buf);
  }

  /** Tell Meta the turn is over; it answers with the final transcript, then closes 1000. */
  end(): void {
    if (this.closed || this.ended) return;
    this.ended = true;
    this.goLive();
    if (this.ready) this.sock.send(JSON.stringify({ type: "endStream" }));
    else this.pendingEnd = true; // cold start: the ack handler flushes audio, then ends
  }

  private report(): void {
    if (this.reported) return;
    this.reported = true;
    this.onEnd?.((Date.now() - this.createdAt) / 1000);
  }

  close(): void {
    this.stopSilence();
    this.closed = true;
    this.report();
    try { this.sock.terminate(); } catch { /* ignore */ }
  }
}

interface ClientVoice {
  standby: Upstream | null;
  active: Upstream | null;
  pressAt: number;
  releaseAt: number;
  firstPartialMs: number;
  lastText: string;
  finalTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface VoiceHubOptions {
  /** Titles/ids of loaded mods, added to the recognizer's vocabulary. */
  modNames: (ws: WebSocket) => string[];
  send: (ws: WebSocket, msg: ServerMsg) => void;
  /** Spend guard: `check` returns a friendly refusal (or null), `record` books Meta session seconds. */
  guard?: { check(ws: WebSocket): string | null; record(ws: WebSocket, seconds: number): void };
  /** Cap on warm Meta sessions held at once across all clients. */
  maxStandbys?: number;
  url?: string;
  getKey?: () => string;
  /** How long to wait for Meta's final after endStream before using the last partial. */
  finalTimeoutMs?: number;
  /** Close an unused warm session after this long (the client re-warms on key/pointer activity). */
  standbyIdleMs?: number;
}

const STANDBY_MAX_AGE_MS = 50 * 60 * 1000;

export function createVoiceHub(opts: VoiceHubOptions) {
  const url = opts.url ?? ASR_URL;
  const getKey = opts.getKey ?? apiKey;
  const finalTimeoutMs = opts.finalTimeoutMs ?? 4000;
  const standbyIdleMs = opts.standbyIdleMs ?? 2 * 60 * 1000;
  const maxStandbys = opts.maxStandbys ?? 30;
  const clients = new Map<WebSocket, ClientVoice>();
  const log = (s: string) => console.log(`[voice] ${s}`);

  function state(ws: WebSocket): ClientVoice {
    let c = clients.get(ws);
    if (!c) {
      c = { standby: null, active: null, pressAt: 0, releaseAt: 0, firstPartialMs: -1, lastText: "", finalTimer: null, idleTimer: null };
      clients.set(ws, c);
    }
    return c;
  }

  function open(ws: WebSocket): Upstream | null {
    const key = getKey();
    if (!key) return null;
    const up = new Upstream(url, key, buildKeywords(opts.modNames(ws)));
    up.onEnd = (seconds) => opts.guard?.record(ws, seconds);
    return up;
  }

  const standbyCount = (): number => { let n = 0; for (const c of clients.values()) if (c.standby) n++; return n; };

  function warm(ws: WebSocket): void {
    const c = state(ws);
    if (c.active) return;
    if (opts.guard?.check(ws)) return;
    if (!c.standby && standbyCount() >= maxStandbys) return;
    if (c.standby && !c.standby.isClosed && Date.now() - c.standby.createdAt < STANDBY_MAX_AGE_MS) return;
    c.standby?.close();
    if (c.idleTimer) clearTimeout(c.idleTimer);
    const up = open(ws);
    if (!up) { c.standby = null; return; }
    c.standby = up;
    up.handlers = {
      onTranscript() {},
      onError: (m) => { log(`standby error: ${m}`); if (c.standby === up) c.standby = null; },
      onClose: () => { if (c.standby === up) c.standby = null; },
    };
    up.ackPromise.then(() => {
      log(`standby ready (handshake ${up.ackMs} ms)`);
      if (c.standby === up) opts.send(ws, { kind: "voiceState", state: "ready" });
    }).catch(() => {});
    c.idleTimer = setTimeout(() => { if (c.standby === up) { up.close(); c.standby = null; } }, standbyIdleMs);
  }

  function clearActive(c: ClientVoice): void {
    if (c.finalTimer) clearTimeout(c.finalTimer);
    c.finalTimer = null;
    c.active = null;
  }

  function finish(ws: WebSocket, c: ClientVoice, up: Upstream, text: string, why: string): void {
    if (c.active !== up) return;
    const finalMs = Date.now() - c.releaseAt;
    clearActive(c);
    up.close();
    opts.send(ws, { kind: "transcript", text, final: true, ms: { firstPartial: c.firstPartialMs, final: finalMs } });
    log(`final (${why}) "${text}" press→first partial ${c.firstPartialMs} ms, release→final ${finalMs} ms`);
    if (ws.readyState === WebSocket.OPEN) warm(ws);
  }

  function start(ws: WebSocket): void {
    const c = state(ws);
    if (c.active) { c.active.close(); clearActive(c); }
    if (!getKey()) {
      opts.send(ws, { kind: "voiceState", state: "error", detail: "Voice needs MODEL_API_KEY on the server — type instead." });
      return;
    }
    const refused = opts.guard?.check(ws);
    if (refused) {
      opts.send(ws, { kind: "voiceState", state: "error", detail: refused });
      return;
    }
    let up = c.standby;
    const warmStart = !!up && up.isReady;
    if (!up || up.isClosed) up = open(ws);
    c.standby = null;
    if (c.idleTimer) clearTimeout(c.idleTimer);
    if (!up) {
      opts.send(ws, { kind: "voiceState", state: "error", detail: "Voice isn't available — type instead." });
      return;
    }
    c.active = up;
    c.pressAt = Date.now();
    c.releaseAt = 0;
    c.firstPartialMs = -1;
    c.lastText = "";
    up.handlers = {
      onTranscript: (text, final) => {
        if (c.active !== up) return;
        if (c.firstPartialMs < 0 && text) c.firstPartialMs = Date.now() - c.pressAt;
        if (text) c.lastText = text;
        if (final) finish(ws, c, up, text, "meta");
        else opts.send(ws, { kind: "transcript", text, final: false });
      },
      onError: (m) => {
        if (c.active !== up) return;
        clearActive(c);
        up.close();
        log(`error: ${m}`);
        opts.send(ws, { kind: "voiceState", state: "error", detail: "Couldn't reach voice — type instead." });
      },
      onClose: () => {
        // Meta closes after the final; if it never sent one, fall back to the last partial.
        if (c.active === up && c.releaseAt > 0) finish(ws, c, up, c.lastText, "close");
        else if (c.active === up) {
          clearActive(c);
          opts.send(ws, { kind: "voiceState", state: "error", detail: "Voice connection dropped — type instead." });
        }
      },
    };
    up.goLive();
    log(warmStart ? "press: warm session" : "press: cold start (no ready standby)");
    opts.send(ws, { kind: "voiceState", state: "listening" });
  }

  function end(ws: WebSocket, cancel: boolean): void {
    const c = clients.get(ws);
    const up = c?.active;
    if (!c || !up) return;
    if (cancel) {
      clearActive(c);
      up.close();
      warm(ws);
      return;
    }
    c.releaseAt = Date.now();
    up.end();
    c.finalTimer = setTimeout(() => finish(ws, c, up, c.lastText, "timeout"), finalTimeoutMs);
  }

  return {
    handle(ws: WebSocket, msg: ClientMsg): boolean {
      if (msg.kind === "voiceWarm") warm(ws);
      else if (msg.kind === "voiceStart") start(ws);
      else if (msg.kind === "voiceEnd") end(ws, msg.cancel === true);
      else return false;
      return true;
    },
    audio(ws: WebSocket, data: RawData): void {
      const up = clients.get(ws)?.active;
      if (!up) return;
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      up.sendAudio(buf);
    },
    close(ws: WebSocket): void {
      const c = clients.get(ws);
      if (!c) return;
      c.standby?.close();
      c.active?.close();
      if (c.finalTimer) clearTimeout(c.finalTimer);
      if (c.idleTimer) clearTimeout(c.idleTimer);
      clients.delete(ws);
    },
  };
}
