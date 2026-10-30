import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initVoice } from "../src/client/voice";
import type { VoiceDeps } from "../src/client/voice";
import type { ClientMsg, ServerMsg } from "../src/contract";

type ListenerMap = Map<string, Set<(e: any) => void>>;

describe("voice state machine (bug 9b7)", () => {
  const windowListeners: ListenerMap = new Map();
  const documentListeners: ListenerMap = new Map();

  const addWinListener = (type: string, fn: any) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(fn);
  };
  const addDocListener = (type: string, fn: any) => {
    if (!documentListeners.has(type)) documentListeners.set(type, new Set());
    documentListeners.get(type)!.add(fn);
  };

  const dispatchWin = (type: string, event: any) => {
    for (const fn of windowListeners.get(type) ?? []) fn(event);
  };

  const origWindow = (globalThis as any).window;
  const origDocument = (globalThis as any).document;
  const origAddEventListener = globalThis.addEventListener;

  beforeEach(() => {
    windowListeners.clear();
    documentListeners.clear();
    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      hidden: false,
      addEventListener: addDocListener,
      removeEventListener: () => {},
    };
    globalThis.addEventListener = addWinListener as any;
  });

  afterEach(() => {
    windowListeners.clear();
    documentListeners.clear();
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDocument;
    globalThis.addEventListener = origAddEventListener;
    delete (globalThis as any).__voice;
  });

  function createTestHarness() {
    const sentJson: ClientMsg[] = [];
    const sentBinary: ArrayBuffer[] = [];
    const said: { text: string; state?: string }[] = [];
    const submitted: string[] = [];
    const logged: string[] = [];

    const bar = {
      classList: {
        toggle: () => {},
      },
      style: {
        setProperty: () => {},
      },
    } as unknown as HTMLElement;

    const feedback = {
      textContent: "",
      title: "",
    } as unknown as HTMLElement;

    const deps: VoiceDeps = {
      bar,
      feedback,
      isOpen: () => true,
      sendJson: (msg) => sentJson.push(msg),
      sendBinary: (buf) => sentBinary.push(buf),
      say: (text, state) => said.push({ text, state }),
      submit: (text) => submitted.push(text),
      log: (line) => logged.push(line),
    };

    const hub = initVoice(deps);
    const api = (globalThis as any).__voice;

    return { deps, hub, api, sentJson, sentBinary, said, submitted, logged, feedback };
  }

  it("empty final transcript while transcribing resets cleanly without reprompting", () => {
    const { hub, api, said, submitted } = createTestHarness();

    // Drive into transcribing state via API
    api.press();
    expect(api.phase).toBe("holding");
    api.release();
    expect(api.phase).toBe("transcribing");

    // Server sends empty transcript (silence / no mic input)
    const msg: ServerMsg = { kind: "transcript", text: "", final: true };
    hub.onServerMsg(msg);

    expect(api.phase).toBe("idle");
    expect(said).toEqual([]);
    expect(submitted).toEqual([]);
  });

  it("whitespace-only or punctuation-only transcript does not reprompt", () => {
    const { hub, api, said, submitted } = createTestHarness();

    api.press();
    api.release();
    expect(api.phase).toBe("transcribing");

    hub.onServerMsg({ kind: "transcript", text: "   ...   ", final: true });

    expect(api.phase).toBe("idle");
    expect(said).toEqual([]);
    expect(submitted).toEqual([]);
  });

  it("unrecognized speech transcript while transcribing reprompts to hold Shift", () => {
    const { hub, api, said, submitted } = createTestHarness();

    api.press();
    api.release();
    expect(api.phase).toBe("transcribing");

    // User spoke a non-command word
    hub.onServerMsg({ kind: "transcript", text: "banana", final: true });

    expect(api.phase).toBe("idle");
    expect(submitted).toEqual([]);
    expect(said).toEqual([{ text: "Didn't catch that — hold Shift and try again.", state: undefined }]);
  });

  it("valid command transcript submits the command and does not reprompt", () => {
    const { hub, api, said, submitted } = createTestHarness();

    api.press();
    api.release();
    expect(api.phase).toBe("transcribing");

    hub.onServerMsg({ kind: "transcript", text: "add a bouncing green slime", final: true });

    expect(api.phase).toBe("idle");
    expect(submitted).toEqual(["add a bouncing green slime"]);
    expect(said).toEqual([]);
  });

  it("late transcript arriving when idle is ignored completely", () => {
    const { hub, api, said, submitted } = createTestHarness();
    expect(api.phase).toBe("idle");

    hub.onServerMsg({ kind: "transcript", text: "something", final: true });
    expect(said).toEqual([]);
    expect(submitted).toEqual([]);
  });

  it("physical release with no mic audio sent cancels instead of transcribing", async () => {
    const { api, sentJson } = createTestHarness();

    // Trigger keydown on canvas with shiftKey true
    dispatchWin("keydown", { code: "ShiftLeft", shiftKey: true, repeat: false, target: {} });
    expect(api.phase).toBe("holding");

    // Wait slightly so it exceeds TAP_MS
    await new Promise((r) => setTimeout(r, 260));

    // Release key with no audio sent
    dispatchWin("keyup", { code: "ShiftLeft", shiftKey: false });

    // Must be cancelled, NOT transcribing
    expect(api.phase).toBe("idle");
    expect(sentJson.some((m) => m.kind === "voiceEnd" && m.cancel === true)).toBe(true);
    expect(sentJson.some((m) => m.kind === "voiceEnd" && !m.cancel)).toBe(false);
  });

  it("focusing or typing into an input while holding Shift cancels the hold", () => {
    const { api, sentJson } = createTestHarness();

    dispatchWin("keydown", { code: "ShiftLeft", shiftKey: true, repeat: false, target: {} });
    expect(api.phase).toBe("holding");

    // User focuses an input element
    const inputEl = { tagName: "INPUT" };
    dispatchWin("focusin", { target: inputEl });

    expect(api.phase).toBe("idle");
    expect(sentJson.some((m) => m.kind === "voiceEnd" && m.cancel === true)).toBe(true);
  });

  it("pressing Shift inside an input element never starts holding", () => {
    const { api } = createTestHarness();

    const inputEl = { tagName: "INPUT" };
    dispatchWin("keydown", { code: "ShiftLeft", shiftKey: true, repeat: false, target: inputEl });

    expect(api.phase).toBe("idle");
  });
});
