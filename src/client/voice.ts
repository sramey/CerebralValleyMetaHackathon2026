// Hold-to-talk (ADR 0012). Hold Shift (or a gamepad shoulder button): the orb lights up at
// once and pulses with mic volume, live partials appear under it, and releasing sends the
// final text as a normal command. Audio goes to our server as binary PCM16 16 kHz frames;
// the server proxies to Muse Voice Transcribe, so the API key never reaches the browser.
import type { ClientMsg, ServerMsg } from "../contract";
import { Downsampler, orbLevel, rms } from "./pcm";

export interface VoiceDeps {
  /** Orb bar element; gets class `voice-live` / `voice-wait` and the --level CSS variable. */
  bar: HTMLElement;
  /** The line under the orb where partials are typed. */
  feedback: HTMLElement;
  isOpen(): boolean;
  sendJson(msg: ClientMsg): void;
  sendBinary(buf: ArrayBuffer): void;
  say(text: string, state?: string): void;
  /** Sends text exactly as if it had been typed. */
  submit(text: string): void;
  log(line: string): void;
}

export interface VoiceStat { text: string; pressToFirstPartialMs: number; releaseToFinalMs: number }

type Phase = "idle" | "holding" | "transcribing";

/** Holds shorter than this are treated as an accidental tap and cancelled. */
const TAP_MS = 250;
const FINAL_FAILSAFE_MS = 8000;
const PAD_BUTTONS = [4, 5]; // LB / RB

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function initVoice(deps: VoiceDeps) {
  let phase: Phase = "idle";
  let heldBy: "key" | "pad" | "api" | null = null;
  let pressAt = 0;
  let releaseAt = 0;
  let firstPartialAt = -1;
  let capturing = false;
  let failsafe: ReturnType<typeof setTimeout> | null = null;
  let mic: Promise<boolean> | null = null;
  let micReady = false;
  let micError = "";
  let ds: Downsampler | null = null;
  const stats: VoiceStat[] = [];

  function paint(live: "live" | "wait" | "off", level = 0): void {
    deps.bar.classList.toggle("voice-live", live === "live");
    deps.bar.classList.toggle("voice-wait", live === "wait");
    deps.bar.style.setProperty("--level", String(level));
  }

  function reset(): void {
    phase = "idle";
    heldBy = null;
    capturing = false;
    if (failsafe) clearTimeout(failsafe);
    failsafe = null;
    paint("off");
  }

  function fail(message: string): void {
    if (phase === "holding") deps.sendJson({ kind: "voiceEnd", cancel: true });
    reset();
    deps.say(message, "failed");
  }

  /** Mic + worklet are set up once, on the first press (the user gesture); later presses reuse them. */
  function ensureMic(): Promise<boolean> {
    if (mic) return mic;
    mic = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        const ctx = new AudioContext({ latencyHint: "interactive" });
        await ctx.audioWorklet.addModule("/voice-worklet.js");
        await ctx.resume();
        const src = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "voice-capture");
        const mute = ctx.createGain();
        mute.gain.value = 0; // some browsers only pull a worklet that reaches the destination
        src.connect(node).connect(mute).connect(ctx.destination);
        ds = new Downsampler(ctx.sampleRate);
        node.port.onmessage = (ev: MessageEvent<Float32Array>) => onChunk(ev.data);
        micReady = true;
        return true;
      } catch (err) {
        micError = err instanceof Error ? err.message : String(err);
        mic = null; // let a later press retry (e.g. after the user allows the mic)
        return false;
      }
    })();
    return mic;
  }

  function onChunk(samples: Float32Array): void {
    if (!capturing || !ds) return;
    paint("live", orbLevel(rms(samples)));
    const pcm = ds.process(samples);
    if (pcm.length && deps.isOpen()) deps.sendBinary(pcm.buffer as ArrayBuffer);
  }

  function press(source: "key" | "pad" | "api"): void {
    if (phase !== "idle") return;
    if (!deps.isOpen()) { deps.say("Server offline — type instead.", "failed"); return; }
    phase = "holding";
    heldBy = source;
    pressAt = performance.now();
    firstPartialAt = -1;
    paint("live");
    deps.feedback.textContent = "Listening…";
    deps.sendJson({ kind: "voiceStart" });
    void ensureMic().then((ok) => {
      if (phase !== "holding") return;
      if (!ok) { fail("Mic blocked — allow it in the browser, or type instead."); return; }
      ds?.reset();
      capturing = true;
    });
  }

  function release(source: "key" | "pad" | "api"): void {
    if (phase !== "holding" || heldBy !== source) return;
    releaseAt = performance.now();
    if (!micReady || releaseAt - pressAt < TAP_MS) {
      const first = !micReady;
      deps.sendJson({ kind: "voiceEnd", cancel: true });
      reset();
      deps.feedback.textContent = first ? "Mic ready — hold Shift and speak." : "Hold Shift and speak.";
      return;
    }
    capturing = false;
    phase = "transcribing";
    paint("wait");
    deps.sendJson({ kind: "voiceEnd" });
    failsafe = setTimeout(() => fail("Didn't hear back — type instead."), FINAL_FAILSAFE_MS);
  }

  function onServerMsg(msg: ServerMsg): boolean {
    if (msg.kind === "voiceState") {
      if (msg.state === "error") fail(msg.detail ?? "Voice isn't available — type instead.");
      return true;
    }
    if (msg.kind !== "transcript") return false;
    if (phase === "idle") return true; // late message from a cancelled turn
    if (!msg.final) {
      if (firstPartialAt < 0 && msg.text) firstPartialAt = performance.now();
      if (msg.text) deps.feedback.textContent = `“${msg.text}”`;
      return true;
    }
    if (phase !== "transcribing") return true;
    const now = performance.now();
    const text = msg.text.trim();
    const stat: VoiceStat = {
      text,
      pressToFirstPartialMs: firstPartialAt < 0 ? -1 : Math.round(firstPartialAt - pressAt),
      releaseToFinalMs: Math.round(now - releaseAt),
    };
    stats.push(stat);
    deps.log(`voice: "${text}" press→first partial ${stat.pressToFirstPartialMs}ms, release→final ${stat.releaseToFinalMs}ms`);
    reset();
    if (text) deps.submit(text);
    else deps.say("Didn't catch that — hold Shift and try again.");
    return true;
  }

  // Keyboard: Shift, but never while typing in a text box.
  addEventListener("keydown", (e) => {
    if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat && !isTypingTarget(e.target)) press("key");
  });
  addEventListener("keyup", (e) => {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") release("key");
  });
  addEventListener("blur", () => { if (phase === "holding" && heldBy === "key") release("key"); });

  // Gamepad shoulder buttons (cheap to poll; only runs while a pad is connected).
  let padDown = false;
  let padLoop = false;
  function pollPad(): void {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const down = pads.some((p) => p && PAD_BUTTONS.some((b) => p.buttons[b]?.pressed));
    if (down && !padDown) press("pad");
    else if (!down && padDown) release("pad");
    padDown = down;
    requestAnimationFrame(pollPad);
  }
  addEventListener("gamepadconnected", () => { if (!padLoop) { padLoop = true; requestAnimationFrame(pollPad); } });

  // Keep a Meta session warm server-side; the server drops an unused one after a few minutes.
  const warm = () => { if (deps.isOpen()) deps.sendJson({ kind: "voiceWarm" }); };
  addEventListener("focus", warm);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) warm(); });

  // Test hooks: drive a turn without a physical key, read measured latencies.
  (window as unknown as Record<string, unknown>).__voice = {
    press: () => press("api"),
    release: () => release("api"),
    stats,
    get phase() { return phase; },
    get mic() { return micReady ? "ready" : micError || "pending"; },
  };

  return { onServerMsg, onOpen: warm };
}
