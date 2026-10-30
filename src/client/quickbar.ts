// Quick action bar (bead metabuild-ideation-b1y): compact in-game buttons
// for the three primary panel features ("What it has learned", "Draw a level",
// and "Bring an object in") while the side panel starts collapsed by default.
import "./quickbar.css";

export interface QuickAction {
  readonly id: string;
  readonly targetId: string;
  readonly icon: string;
  readonly label: string;
  readonly title: string;
  readonly ariaLabel: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "quick-brain-btn",
    targetId: "brain-btn",
    icon: "🧠",
    label: "What it has learned",
    title: "What it has learned — reviewer, fixes, rules",
    ariaLabel: "What it has learned",
  },
  {
    id: "quick-sketch-btn",
    targetId: "sketch-btn",
    icon: "✏️",
    label: "Draw a level",
    title: "Draw a level (sketch)",
    ariaLabel: "Draw a level",
  },
  {
    id: "quick-camera-btn",
    targetId: "camera-btn",
    icon: "📷",
    label: "Bring an object in",
    title: "Bring an object in (camera)",
    ariaLabel: "Bring an object in (camera)",
  },
];

/**
 * Returns the toggle button text and aria-expanded attribute for a given drawer collapsed state.
 * When collapsed (hidden = true), toggle shows « and aria-expanded is false.
 * When expanded (hidden = false), toggle shows » and aria-expanded is true.
 */
export function drawerToggleState(hidden: boolean): { glyph: "«" | "»"; ariaExpanded: boolean } {
  return hidden
    ? { glyph: "«", ariaExpanded: false }
    : { glyph: "»", ariaExpanded: true };
}

export function isQuickActionTarget(id: string): boolean {
  return QUICK_ACTIONS.some((a) => a.targetId === id);
}

export function quickActionFor(targetId: string): QuickAction | undefined {
  return QUICK_ACTIONS.find((a) => a.targetId === targetId);
}

/** Pure string representation of a quick action button for rendering or testing. */
export function quickButtonHtml(action: QuickAction): string {
  return `<button id="${action.id}" type="button" class="quick-btn" title="${action.title}" aria-label="${action.ariaLabel}"><span class="quick-icon" aria-hidden="true">${action.icon}</span><span class="quick-label">${action.label}</span></button>`;
}

/** Mounts the quick action bar into the game view (stageWrapEl). */
export function createQuickbar(
  mount: HTMLElement,
  actions: readonly QuickAction[] = QUICK_ACTIONS,
  onTrigger: (targetId: string) => void = (targetId) => document.getElementById(targetId)?.click(),
): HTMLElement {
  const bar = document.createElement("nav");
  bar.id = "quickbar";
  bar.className = "quickbar";
  bar.setAttribute("aria-label", "Quick actions");

  for (const act of actions) {
    const btn = document.createElement("button");
    btn.id = act.id;
    btn.type = "button";
    btn.className = "quick-btn";
    btn.title = act.title;
    btn.setAttribute("aria-label", act.ariaLabel);

    const iconSpan = document.createElement("span");
    iconSpan.className = "quick-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = act.icon;

    const labelSpan = document.createElement("span");
    labelSpan.className = "quick-label";
    labelSpan.textContent = act.label;

    btn.append(iconSpan, labelSpan);
    btn.addEventListener("click", () => {
      onTrigger(act.targetId);
    });

    bar.appendChild(btn);
  }

  mount.appendChild(bar);
  return bar;
}
