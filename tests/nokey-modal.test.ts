import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NO_KEY_INFO, createNoKeyModal, type StorageLike } from "../src/client/nokey-modal";

type Listener = (ev: any) => void;

class FakeElement {
  attributes = new Map<string, string>();
  style: { display?: string } = {};
  listeners: Record<string, Listener[]> = {};
  focused = false;

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(event: string, fn: Listener): void {
    (this.listeners[event] ??= []).push(fn);
  }

  removeEventListener(event: string, fn: Listener): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
  }

  click(): void {
    for (const fn of this.listeners["click"] ?? []) {
      fn({ target: this });
    }
  }

  focus(): void {
    this.focused = true;
  }
}

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  clear(): void {
    this.data.clear();
  }
}

describe("NO_KEY_INFO copy and architecture truth", () => {
  it("describes the reason plainly without technical jargon or stack traces", () => {
    expect(NO_KEY_INFO.title).toContain("No Meta API Key");
    expect(NO_KEY_INFO.badge).toContain("Visitor Mode");
    expect(NO_KEY_INFO.lead).toContain("MODEL_API_KEY");
    expect(NO_KEY_INFO.why).toContain("api.meta.ai");
  });

  it("lists all disabled AI features and names their Meta models accurately", () => {
    const models = NO_KEY_INFO.disabled.map((d) => d.model);
    expect(models.some((m) => m.includes("Muse Voice"))).toBe(true);
    expect(models.some((m) => m.includes("Wonder"))).toBe(true);
    expect(models.some((m) => m.includes("Muse Spark"))).toBe(true);
    expect(models.some((m) => m.includes("Muse Image"))).toBe(true);

    const titles = NO_KEY_INFO.disabled.map((d) => d.title.toLowerCase());
    expect(titles.some((t) => t.includes("voice"))).toBe(true);
    expect(titles.some((t) => t.includes("mod"))).toBe(true);
    expect(titles.some((t) => t.includes("routing"))).toBe(true);
    expect(titles.some((t) => t.includes("art"))).toBe(true);
    expect(titles.some((t) => t.includes("mood"))).toBe(true);
  });

  it("lists all active gameplay features so players know what they can test", () => {
    const titles = NO_KEY_INFO.enabled.map((e) => e.title.toLowerCase());
    expect(titles.some((t) => t.includes("physics"))).toBe(true);
    expect(titles.some((t) => t.includes("demo worlds"))).toBe(true);
    expect(titles.some((t) => t.includes("drawing") || t.includes("sketch"))).toBe(true);
    expect(titles.some((t) => t.includes("procedural"))).toBe(true);
    expect(titles.some((t) => t.includes("radial"))).toBe(true);
    expect(titles.some((t) => t.includes("export"))).toBe(true);
  });

  it("gives clear instructions on how to set the key and restart", () => {
    expect(NO_KEY_INFO.setupInstructions.join("\n")).toContain("MODEL_API_KEY=your_key_here");
    expect(NO_KEY_INFO.setupInstructions.join("\n")).toContain("npm start");
  });
});

describe("createNoKeyModal controller", () => {
  let modalEl: FakeElement;
  let acceptBtn: FakeElement;
  let storage: MemoryStorage;
  const windowListeners: Record<string, Listener[]> = {};

  beforeEach(() => {
    modalEl = new FakeElement();
    modalEl.setAttribute("hidden", "");

    acceptBtn = new FakeElement();
    storage = new MemoryStorage();

    vi.stubGlobal("window", {
      addEventListener: (ev: string, fn: Listener) => {
        (windowListeners[ev] ??= []).push(fn);
      },
      removeEventListener: (ev: string, fn: Listener) => {
        if (!windowListeners[ev]) return;
        windowListeners[ev] = windowListeners[ev].filter((f) => f !== fn);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(windowListeners)) delete windowListeners[k];
  });

  it("starts closed when hidden attribute is set", () => {
    const controller = createNoKeyModal({
      modal: modalEl as unknown as HTMLElement,
      acceptBtn: acceptBtn as unknown as HTMLElement,
      storage,
    });
    expect(controller.isOpen()).toBe(false);
  });

  it("opens with show() and focuses the accept button", async () => {
    const controller = createNoKeyModal({
      modal: modalEl as unknown as HTMLElement,
      acceptBtn: acceptBtn as unknown as HTMLElement,
      storage,
    });
    controller.show();
    expect(controller.isOpen()).toBe(true);
    expect(modalEl.hasAttribute("hidden")).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    expect(acceptBtn.focused).toBe(true);
  });

  it("closes when the accept button is clicked and triggers onAccept", () => {
    let accepted = false;
    const controller = createNoKeyModal({
      modal: modalEl as unknown as HTMLElement,
      acceptBtn: acceptBtn as unknown as HTMLElement,
      storage,
      onAccept: () => { accepted = true; },
    });

    controller.show();
    expect(controller.isOpen()).toBe(true);

    acceptBtn.click();
    expect(controller.isOpen()).toBe(false);
    expect(modalEl.hasAttribute("hidden")).toBe(true);
    expect(accepted).toBe(true);
    expect(storage.getItem("metabuild.nokey_dismissed")).toBe("1");
  });

  it("closes when Escape is pressed", () => {
    let accepted = false;
    const controller = createNoKeyModal({
      modal: modalEl as unknown as HTMLElement,
      acceptBtn: acceptBtn as unknown as HTMLElement,
      storage,
      onAccept: () => { accepted = true; },
    });

    controller.show();
    const keyEv = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    for (const fn of windowListeners["keydown"] ?? []) fn(keyEv);

    expect(controller.isOpen()).toBe(false);
    expect(accepted).toBe(true);
  });

  it("closes when clicking the backdrop, but not when clicking inside the card", () => {
    const controller = createNoKeyModal({
      modal: modalEl as unknown as HTMLElement,
      acceptBtn: acceptBtn as unknown as HTMLElement,
      storage,
    });
    controller.show();

    // Click on something inside card (target !== modalEl)
    const cardChild = new FakeElement();
    for (const fn of modalEl.listeners["click"] ?? []) {
      fn({ target: cardChild });
    }
    expect(controller.isOpen()).toBe(true);

    // Click on modal backdrop itself (target === modalEl)
    for (const fn of modalEl.listeners["click"] ?? []) {
      fn({ target: modalEl });
    }
    expect(controller.isOpen()).toBe(false);
  });

  it("showIfStartup() opens only if not already dismissed in this session", () => {
    const controller = createNoKeyModal({
      modal: modalEl as unknown as HTMLElement,
      acceptBtn: acceptBtn as unknown as HTMLElement,
      storage,
    });

    // First startup check: opens
    controller.showIfStartup();
    expect(controller.isOpen()).toBe(true);

    // Dismiss it
    controller.hide();
    expect(controller.isOpen()).toBe(false);

    // Subsequent startup check in same session: stays closed
    controller.showIfStartup();
    expect(controller.isOpen()).toBe(false);

    // But explicit show() (e.g. from clicking the banner button) still works
    controller.show();
    expect(controller.isOpen()).toBe(true);
  });

  it("destroy() unregisters window listeners", () => {
    const controller = createNoKeyModal({
      modal: modalEl as unknown as HTMLElement,
      acceptBtn: acceptBtn as unknown as HTMLElement,
      storage,
    });
    controller.show();
    expect((windowListeners["keydown"] ?? []).length).toBe(1);

    controller.destroy();
    expect((windowListeners["keydown"] ?? []).length).toBe(0);
  });
});
