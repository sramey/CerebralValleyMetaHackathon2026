import { describe, it, expect, vi } from "vitest";
import {
  QUICK_ACTIONS,
  drawerToggleState,
  isQuickActionTarget,
  quickActionFor,
  quickButtonHtml,
  createQuickbar,
} from "../src/client/quickbar";

describe("quick action definitions", () => {
  it("defines the three required panel features", () => {
    expect(QUICK_ACTIONS).toHaveLength(3);
    const targets = QUICK_ACTIONS.map((a) => a.targetId);
    expect(targets).toEqual(["brain-btn", "sketch-btn", "camera-btn"]);
  });

  it("assigns appropriate icons, labels, and aria-labels to each action", () => {
    const brain = quickActionFor("brain-btn")!;
    expect(brain.icon).toBe("🧠");
    expect(brain.label).toBe("What it has learned");
    expect(brain.ariaLabel).toBe("What it has learned");
    expect(brain.id).toBe("quick-brain-btn");

    const sketch = quickActionFor("sketch-btn")!;
    expect(sketch.icon).toBe("✏️");
    expect(sketch.label).toBe("Draw a level");
    expect(sketch.ariaLabel).toBe("Draw a level");
    expect(sketch.id).toBe("quick-sketch-btn");

    const camera = quickActionFor("camera-btn")!;
    expect(camera.icon).toBe("📷");
    expect(camera.label).toBe("Bring an object in");
    expect(camera.ariaLabel).toBe("Bring an object in (camera)");
    expect(camera.id).toBe("quick-camera-btn");
  });

  it("checks whether an ID is a valid quick action target", () => {
    expect(isQuickActionTarget("brain-btn")).toBe(true);
    expect(isQuickActionTarget("sketch-btn")).toBe(true);
    expect(isQuickActionTarget("camera-btn")).toBe(true);
    expect(isQuickActionTarget("export-btn")).toBe(false);
  });
});

describe("drawerToggleState helper", () => {
  it("returns « and aria-expanded false when hidden (collapsed by default)", () => {
    const state = drawerToggleState(true);
    expect(state.glyph).toBe("«");
    expect(state.ariaExpanded).toBe(false);
  });

  it("returns » and aria-expanded true when visible (expanded)", () => {
    const state = drawerToggleState(false);
    expect(state.glyph).toBe("»");
    expect(state.ariaExpanded).toBe(true);
  });
});

describe("quickButtonHtml", () => {
  it("renders an accessible button markup with real button tag, aria-label, and icon+label spans", () => {
    const brain = quickActionFor("brain-btn")!;
    const html = quickButtonHtml(brain);
    expect(html).toContain('id="quick-brain-btn"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="What it has learned"');
    expect(html).toContain('class="quick-icon" aria-hidden="true">🧠</span>');
    expect(html).toContain('class="quick-label">What it has learned</span>');
  });

  it("renders camera button markup with camera icon and title", () => {
    const camera = quickActionFor("camera-btn")!;
    const html = quickButtonHtml(camera);
    expect(html).toContain('id="quick-camera-btn"');
    expect(html).toContain('title="Bring an object in (camera)"');
    expect(html).toContain('📷');
  });

  it("renders sketch button markup with pencil icon", () => {
    const sketch = quickActionFor("sketch-btn")!;
    const html = quickButtonHtml(sketch);
    expect(html).toContain('id="quick-sketch-btn"');
    expect(html).toContain('✏️');
  });
});

// Bug qblayout: the bar is icon-only, so the words have to survive somewhere — every button
// keeps a title, an aria-label and the label span that quickbar.css shows on hover/focus.
describe("icon-only buttons stay labelled (bug qblayout)", () => {
  it("gives every action a title and an aria-label", () => {
    for (const action of QUICK_ACTIONS) {
      expect(action.title.trim().length).toBeGreaterThan(0);
      expect(action.ariaLabel.trim().length).toBeGreaterThan(0);
      expect(action.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("renders icon, label, tooltip text and accessible name for all three buttons", () => {
    for (const action of QUICK_ACTIONS) {
      const html = quickButtonHtml(action);
      expect(html).toContain(`id="${action.id}"`);
      expect(html).toContain('type="button"');
      expect(html).toContain(`title="${action.title}"`);
      expect(html).toContain(`aria-label="${action.ariaLabel}"`);
      expect(html).toContain(`class="quick-icon" aria-hidden="true">${action.icon}</span>`);
      expect(html).toContain(`class="quick-label">${action.label}</span>`);
    }
  });

  it("mounts one icon-only button per action, still 40 px-wide-friendly (no text node at the top level)", () => {
    if (typeof document === "undefined") return;
    const container = document.createElement("div");
    const bar = createQuickbar(container, QUICK_ACTIONS);
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button.quick-btn"));
    expect(buttons).toHaveLength(QUICK_ACTIONS.length);
    buttons.forEach((btn, i) => {
      expect(btn.id).toBe(QUICK_ACTIONS[i].id);
      expect(btn.title).toBe(QUICK_ACTIONS[i].title);
      expect(btn.getAttribute("aria-label")).toBe(QUICK_ACTIONS[i].ariaLabel);
      // Exactly two spans: the icon and the (hover-only) label.
      expect(btn.children).toHaveLength(2);
      expect(btn.querySelector(".quick-icon")?.textContent).toBe(QUICK_ACTIONS[i].icon);
      expect(btn.querySelector(".quick-label")?.textContent).toBe(QUICK_ACTIONS[i].label);
    });
  });
});

describe("createQuickbar DOM mounting", () => {
  it("creates a nav with role/label and wires clicks to onTrigger when document is present", () => {
    if (typeof document !== "undefined") {
      const container = document.createElement("div");
      const triggered: string[] = [];
      createQuickbar(container, QUICK_ACTIONS, (targetId) => triggered.push(targetId));
      expect(container.querySelector("#quickbar")).toBeTruthy();
      const buttons = container.querySelectorAll(".quick-btn");
      expect(buttons).toHaveLength(3);
      (buttons[0] as HTMLButtonElement).click();
      expect(triggered).toEqual(["brain-btn"]);
    } else {
      // If run in pure Node without DOM, test custom simulated DOM
      const listeners: Record<string, () => void> = {};
      const mockElements: any[] = [];
      const mockDocument = {
        createElement: (tag: string) => {
          const el = {
            tag,
            id: "",
            className: "",
            title: "",
            attributes: {} as Record<string, string>,
            children: [] as any[],
            textContent: "",
            setAttribute: (k: string, v: string) => { el.attributes[k] = v; },
            append: (...args: any[]) => { el.children.push(...args); },
            appendChild: (child: any) => { el.children.push(child); return child; },
            addEventListener: (ev: string, fn: () => void) => {
              if (el.id) listeners[el.id] = fn;
            },
          };
          mockElements.push(el);
          return el;
        },
      };

      const originalDoc = (globalThis as any).document;
      try {
        (globalThis as any).document = mockDocument;
        const container = mockDocument.createElement("div");
        const triggered: string[] = [];
        createQuickbar(container as any, QUICK_ACTIONS, (targetId) => triggered.push(targetId));
        expect(container.children).toHaveLength(1);
        const nav = container.children[0];
        expect(nav.id).toBe("quickbar");
        expect(nav.attributes["aria-label"]).toBe("Quick actions");
        expect(nav.children).toHaveLength(3);

        listeners["quick-brain-btn"]?.();
        expect(triggered).toEqual(["brain-btn"]);

        listeners["quick-sketch-btn"]?.();
        expect(triggered).toEqual(["brain-btn", "sketch-btn"]);

        listeners["quick-camera-btn"]?.();
        expect(triggered).toEqual(["brain-btn", "sketch-btn", "camera-btn"]);
      } finally {
        (globalThis as any).document = originalDoc;
      }
    }
  });
});
