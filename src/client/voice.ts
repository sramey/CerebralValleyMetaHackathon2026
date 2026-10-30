// Hold-to-talk (ADR 0012). Hold Shift (or a gamepad shoulder button): the orb lights up at
// once and pulses with mic volume, live partials appear under it, and releasing sends the
// final text as a normal command. Audio goes to our server as binary PCM16 16 kHz frames;
// the server proxies to Muse Voice Transcribe, so the API key never reaches the browser.
import type { ClientMsg, ServerMsg } from "../contract";
import { TALK_BUTTONS } from "./gamepad";
import { Downsampler, orbLevel, rms } from "./pcm";
import { HOLD_MAX_MS, shiftStillHeld, voiceShouldReprompt, voiceTextOk } from "./voicegate";

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
const MIC_IDLE_MS = 2 * 60 * 1000;
const FINAL_FAILSAFE_MS = 8000;

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
  let audioSent = false;
  let failsafe: ReturnType<typeof setTimeout> | null = null;
  let holdCap: ReturnType<typeof setTimeout> | null = null;
  let mic: Promise<boolean> | null = null;
  let micReady = false;
  let micError = "";
  let ds: Downsampler | null = null;
  let stream: MediaStream | null = null;
  let actx: AudioContext | null = null;
  let micDenied = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
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
    audioSent = false;
    if (failsafe) clearTimeout(failsafe);
    failsafe = null;
    if (holdCap) clearTimeout(holdCap);
    holdCap = null;
    paint("off");
  }

  function fail(message: string): void {
    if (phase === "holding") deps.sendJson({ kind: "voiceEnd", cancel: true });
    reset();
    deps.say(message, "failed");
  }

  /** Close the mic after a quiet spell so the browser's recording indicator goes off; the next gesture reopens it. */
  function releaseMic(): void {
    if (phase !== "idle") { armIdle(); return; }
    stream?.getTracks().forEach((t) => t.stop());
    void actx?.close().catch(() => {});
    stream = null; actx = null; ds = null;
    mic = null; micReady = false;
  }
  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(releaseMic, MIC_IDLE_MS);
  }

  /** Mic + worklet are set up on the first user gesture (so the permission prompt is already answered by the first hold) and reused. */
  function ensureMic(): Promise<boolean> {
    if (mic) return mic;
    mic = (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        const ctx = new AudioContext({ latencyHint: "interactive" });
        actx = ctx;
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
        armIdle();
        return true;
      } catch (err) {
        micError = err instanceof Error ? err.message : String(err);
        if (err instanceof DOMException && err.name === "NotAllowedError") micDenied = true;
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
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
    if (pcm.length && deps.isOpen()) {
      audioSent = true;
      deps.sendBinary(pcm.buffer as ArrayBuffer);
    }
  }

  function press(source: "key" | "pad" | "api"): void {
    if (phase !== "idle") return;
    if (!deps.isOpen()) { deps.say("Server offline — type instead.", "failed"); return; }
    phase = "holding";
    heldBy = source;
    pressAt = performance.now();
    firstPartialAt = -1;
    audioSent = false;
    paint("live");
    micDenied = false; // an explicit press may re-ask
    deps.feedback.textContent = "Listening…";
    deps.feedback.title = "Listening…";
    deps.sendJson({ kind: "voiceStart" });
    // A hold longer than any utterance is a stuck key: cancel it and send nothing.
    holdCap = setTimeout(() => {
      if (phase !== "holding") return;
      deps.sendJson({ kind: "voiceEnd", cancel: true });
      reset();
      deps.feedback.textContent = "Hold Shift only while you speak.";
      deps.feedback.title = "Hold Shift only while you speak.";
    }, HOLD_MAX_MS);
    void ensureMic().then((ok) => {
      if (phase !== "holding") return;
      if (!ok) { fail("Mic blocked — allow it in the browser, or type instead."); return; }
      ds?.reset();
      capturing = true;
    });
  }

  /** Abandon a hold without sending anything (focus lost, stuck key). */
  function cancelHold(): void {
    if (phase !== "holding") return;
    deps.sendJson({ kind: "voiceEnd", cancel: true });
    reset();
  }

  function release(source: "key" | "pad" | "api"): void {
    if (phase !== "holding" || heldBy !== source) return;
    releaseAt = performance.now();
    const isTap = source === "api"
      ? releaseAt - pressAt < TAP_MS && !audioSent
      : !micReady || releaseAt - pressAt < TAP_MS || !audioSent;
    if (isTap) {
      const first = !micReady;
      deps.sendJson({ kind: "voiceEnd", cancel: true });
      reset();
      const prompt = first ? "Mic ready — hold Shift and speak." : "Hold Shift and speak.";
      deps.feedback.textContent = prompt;
      deps.feedback.title = prompt;
      return;
    }
    capturing = false;
    if (holdCap) clearTimeout(holdCap);
    holdCap = null;
    phase = "transcribing";
    paint("wait");
    deps.sendJson({ kind: "voiceEnd" });
    armIdle();
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
      if (msg.text) {
        deps.feedback.textContent = `“${msg.text}”`;
        deps.feedback.title = msg.text;
      }
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
    if (voiceTextOk(text)) deps.submit(text);
    else if (voiceShouldReprompt(text)) deps.say("Didn't catch that — hold Shift and try again.");
    return true;
  }

  // First user gesture of any kind opens the mic, so the permission prompt never eats a hold; after an idle
  // release the next gesture reopens it (permission is already granted, so no prompt, no throwaway).
  const warmMic = (): void => { if (!mic && !micDenied && !micReady) void ensureMic(); else if (micReady) armIdle(); };
  addEventListener("pointerdown", warmMic, { capture: true });
  addEventListener("keydown", warmMic, { capture: true });

  // Keyboard: Shift, but never while typing in a text box.
  addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target) && phase === "holding") cancelHold();
    if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat && !isTypingTarget(e.target)) press("key");
  });
  addEventListener("keyup", (e) => {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") release("key");
  });
  addEventListener("blur", () => { if (phase === "holding" && heldBy === "key") cancelHold(); });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (document.hidden && phase === "holding") cancelHold(); });
  }
  addEventListener("focusin", (e) => {
    if (isTypingTarget(e.target) && phase === "holding") cancelHold();
  });
  // A lost keyup (focus moved while Shift was down) leaves "holding" stuck: any later key or pointer event without Shift ends it.
  const lostShift = (e: KeyboardEvent | PointerEvent): void => { if (phase === "holding" && heldBy === "key" && !shiftStillHeld(e)) cancelHold(); };
  addEventListener("keydown", lostShift, { capture: true });
  addEventListener("pointermove", lostShift, { capture: true });

  // Gamepad shoulder buttons (cheap to poll; only runs while a pad is connected).
  let padDown = false;
  let padLoop = false;
  function pollPad(): void {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const down = pads.some((p) => p && TALK_BUTTONS.some((b) => p.buttons[b]?.pressed));
    if (down && !padDown) press("pad");
    else if (!down && padDown) release("pad");
    padDown = down;
    requestAnimationFrame(pollPad);
  }
  addEventListener("gamepadconnected", () => { if (!padLoop) { padLoop = true; requestAnimationFrame(pollPad); } });

  // Keep a Meta session warm server-side; the server drops an unused one after a few minutes.
  const warm = () => { if (deps.isOpen()) deps.sendJson({ kind: "voiceWarm" }); };
  // The server frees an idle warm session after ~2 min; activity from an engaged player brings it back.
  let lastWarm = 0;
  const warmOnActivity = () => { const t = performance.now(); if (t - lastWarm > 10_000) { lastWarm = t; warm(); } };
  addEventListener("keydown", warmOnActivity);
  addEventListener("pointerdown", warmOnActivity);

  // Test hooks: drive a turn without a physical key, read measured latencies.
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__voice = {
      press: (opts?: { tap?: boolean; noAudio?: boolean }) => {
        press("api");
        if (!opts?.tap) pressAt = performance.now() - TAP_MS - 10;
        if (!opts?.noAudio) audioSent = true;
      },
      release: () => release("api"),
      stats,
      get phase() { return phase; },
      setAudioSent: (sent: boolean) => { audioSent = sent; },
      releaseMic,
      get mic() { return micReady ? "ready" : micError || "pending"; },
    };
  }

  // Connecting does not warm a session: nothing is billed until the first key or pointer gesture (bug ahv).
  return { onServerMsg, onOpen: () => {} };
}
