import "./nokey-modal.css";

/**
 * Pure metadata and copy explaining visitor mode (when MODEL_API_KEY is missing).
 * Kept pure and exported so tests can verify the exact capabilities and models mentioned.
 */
export const NO_KEY_INFO = {
  title: "No Meta API Key Detected",
  badge: "Visitor Mode · AI Paused",
  lead: "Metabuild connects to Meta Model API to write code, transcribe voice, and generate pixel art in real time. Because MODEL_API_KEY is not set on this server, AI features are temporarily paused, but the full game engine and pre-built worlds are ready to play.",
  why: "Generative commands invoke Meta's hosted models (api.meta.ai). Running without an authorized key switches the server into visitor mode so you can play without errors or unexpected costs.",
  disabled: [
    {
      title: "Voice Control (Hold Shift)",
      desc: "Real-time voice-to-command transcription",
      model: "Muse Voice Transcribe",
    },
    {
      title: "AI Mod Generation",
      desc: "Live code writing for custom entities, hazards, & weapons",
      model: "Wonder",
    },
    {
      title: "Autonomous Playtest & Fix",
      desc: "Bot simulation loop that tests and repairs broken mods",
      model: "Wonder + Verifier",
    },
    {
      title: "Natural Language Routing",
      desc: "Translating conversational prompts into game actions",
      model: "Muse Spark",
    },
    {
      title: "AI Pixel Art & Camera Cutouts",
      desc: "Custom sprite sheets and webcam object segmentation",
      model: "Muse Image + SAM 3.1",
    },
    {
      title: "World Mood Restyling",
      desc: "Whole-world palette restyling and sprite editing",
      model: "Muse Image EDIT",
    },
  ],
  enabled: [
    {
      title: "Full Game Physics & Combat",
      desc: "Move (A/D/arrows), jump (W/Space), shoot (X/B), and use/drop items (Q/G/R)",
    },
    {
      title: "Curated Demo Worlds",
      desc: "Pre-built platformer stages, enemies, bouncy slimes, and obstacles",
    },
    {
      title: "Level Drawing Tool",
      desc: "Sketch platforms and terrain by hand with ✏️ Draw a level",
    },
    {
      title: "Procedural Level Generator",
      desc: "Instant infinite platformer terrain generation with custom seeds",
    },
    {
      title: "Radial Menu & Knobs",
      desc: "Click any entity in-world to resize, send front/back, or tune properties",
    },
    {
      title: "Standalone Offline Export",
      desc: "Download the running game as a single-file, zero-dependency HTML file",
    },
  ],
  setupInstructions: [
    "Add your Meta Model API key to .env in the project root:",
    "MODEL_API_KEY=your_key_here",
    "Then restart the server: npm start",
  ],
  acceptButton: "Got It — Play Demo Worlds",
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NoKeyModalOptions {
  modal: HTMLElement;
  acceptBtn: HTMLElement;
  onAccept?: () => void;
  storage?: StorageLike;
}

export interface NoKeyModalController {
  show(): void;
  hide(): void;
  isOpen(): boolean;
  showIfStartup(): void;
  destroy(): void;
}

const SESSION_KEY = "metabuild.nokey_dismissed";

export function createNoKeyModal(opts: NoKeyModalOptions): NoKeyModalController {
  const { modal, acceptBtn, onAccept } = opts;
  const storage: StorageLike | null = opts.storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);

  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let clickBackdropHandler: ((e: MouseEvent) => void) | null = null;
  let previousFocus: HTMLElement | null = null;

  function isOpen(): boolean {
    return !modal.hasAttribute("hidden") && modal.style.display !== "none";
  }

  function hide(): void {
    if (!isOpen()) return;
    modal.setAttribute("hidden", "");
    try {
      storage?.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    if (keydownHandler) {
      window.removeEventListener("keydown", keydownHandler);
      keydownHandler = null;
    }
    if (clickBackdropHandler) {
      modal.removeEventListener("click", clickBackdropHandler);
      clickBackdropHandler = null;
    }
    if (previousFocus && typeof previousFocus.focus === "function") {
      try {
        previousFocus.focus();
      } catch {
        /* ignore */
      }
    }
    onAccept?.();
  }

  function show(): void {
    if (isOpen()) return;
    previousFocus = (typeof document !== "undefined" ? (document.activeElement as HTMLElement) : null) ?? null;
    modal.removeAttribute("hidden");

    // Put focus on the accept button for accessibility
    setTimeout(() => {
      acceptBtn.focus();
    }, 10);

    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        hide();
      }
    };
    window.addEventListener("keydown", keydownHandler);

    clickBackdropHandler = (e: MouseEvent) => {
      if (e.target === modal) {
        hide();
      }
    };
    modal.addEventListener("click", clickBackdropHandler);
  }

  function showIfStartup(): void {
    try {
      if (storage?.getItem(SESSION_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    show();
  }

  acceptBtn.addEventListener("click", () => hide());

  return {
    show,
    hide,
    isOpen,
    showIfStartup,
    destroy() {
      if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
      if (clickBackdropHandler) modal.removeEventListener("click", clickBackdropHandler);
    },
  };
}
