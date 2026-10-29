// Film-ready layout for the camera-import dialog (bead jd1).
//
// Draft take beat 7: as soon as the webcam started, the dialog grew taller than the
// 854 px viewport, everything below the video slid down, and clicks landed somewhere
// new. This module is the one place that says how tall the dialog is: the stage box is
// reserved from the viewport *before* a stream exists, every other row is a fixed
// height, and the numbers are applied to the CSS as custom properties so the stylesheet
// and the model cannot drift apart. `main.ts` reads it; `tests/camera-dialog.test.ts`
// proves it fits the two screens the demo is filmed on.
//
// Pure on purpose (no DOM, no timers): the model has to be checkable headless.

import type { ClientMsg } from "../contract";

/** The screens the demo is filmed on (acceptance: 1920x854 and 1280x720). */
export const PROMISE_SCREENS: readonly { w: number; h: number }[] = [
  { w: 1920, h: 854 },
  { w: 1280, h: 720 },
];

export interface Viewport {
  w: number;
  h: number;
}

/**
 * Every number the stylesheet uses, in px, at the shipped font sizes. Keep in sync with
 * `src/client/style.css` through `dialogCssVars` (the CSS never hard-codes a row height).
 */
export const DIALOG_METRICS = {
  /** `#camera-modal` padding on all four sides. */
  gutter: 16,
  /** `.camera-card` padding on all four sides. */
  padding: 16,
  /** `.camera-card` row gap. */
  gap: 10,
  /** Card border, top + bottom. */
  border: 2,
  /** Title line (13px, 1 line). */
  head: 20,
  /** The label text field: 10px pad + 14px text + 10px pad + 2px border, rounded up. */
  label: 42,
  /** "Pixel-art style" + sensitivity on one line. */
  options: 22,
  /** Action buttons, one line; wraps instead of shifting the rows below only below 720 px width. */
  actions: 40,
  /** Two lines of status text, always reserved so a message never pushes the button down. */
  status: 38,
  /** "Bring it into the game", disabled until something is detected. */
  confirm: 40,
  /** The video / preview stage takes this share of the viewport height... */
  stageShare: 0.44,
  /** ...never smaller than this (a mug has to be visible)... */
  stageMin: 168,
  /** ...and never taller than this (it is a dialog, not a screen). */
  stageMax: 340,
} as const;

/** Which of the three looks the stage is showing. All three must be the same height. */
export type DialogPhase = "idle" | "stream" | "preview";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Height of the reserved stage box. Depends on the viewport only — never on the stream. */
export function stageHeight(viewportH: number): number {
  const m = DIALOG_METRICS;
  return Math.round(clamp(viewportH * m.stageShare, m.stageMin, m.stageMax));
}

export interface DialogLayout {
  phase: DialogPhase;
  /** Reserved stage height (video *or* preview *or* placeholder). */
  stage: number;
  /** Every row of the card, top to bottom: head, stage, label, options, actions, status, confirm. */
  rows: readonly number[];
  /** Sum of the rows. */
  rowsHeight: number;
  /** Card box height: rows + gaps + padding + border. */
  height: number;
  /** Tallest the card may be inside the modal gutter. */
  maxHeight: number;
  /** Room left over; negative means the dialog would overflow the viewport. */
  slack: number;
  fits: boolean;
  /** Distance from the card's top edge to the label field. Identical in every phase. */
  labelTop: number;
  /** Where the label field sits in the viewport, so a take can assert clicks land. */
  labelTopInViewport: number;
}

/**
 * The dialog's geometry for a viewport. The rows are identical in all three phases by
 * construction — that is the whole fix: nothing is added or removed, only swapped inside
 * the reserved stage box.
 */
export function dialogLayout(viewport: Viewport, phase: DialogPhase = "idle"): DialogLayout {
  const m = DIALOG_METRICS;
  const stage = stageHeight(viewport.h);
  const rows = [m.head, stage, m.label, m.options, m.actions, m.status, m.confirm] as const;
  const rowsHeight = rows.reduce((a, b) => a + b, 0);
  const gaps = (rows.length - 1) * m.gap;
  const height = rowsHeight + gaps + m.padding * 2 + m.border;
  const maxHeight = viewport.h - m.gutter * 2;
  const labelTop = m.padding + m.head + m.gap + stage + m.gap;
  return {
    phase,
    stage,
    rows,
    rowsHeight,
    height,
    maxHeight,
    slack: maxHeight - height,
    fits: height <= maxHeight,
    labelTop,
    labelTopInViewport: Math.round((viewport.h - Math.min(height, maxHeight)) / 2) + labelTop,
  };
}

/** CSS custom properties for `#camera-modal`; the stylesheet reads all of these and no literals. */
export function dialogCssVars(layout: DialogLayout): Record<string, string> {
  const m = DIALOG_METRICS;
  const [head, stage, label, options, actions, status, confirm] = layout.rows;
  return {
    "--cam-pad": `${m.padding}px`,
    "--cam-gap": `${m.gap}px`,
    "--cam-row-head": `${head}px`,
    "--cam-row-stage": `${stage}px`,
    "--cam-row-label": `${label}px`,
    "--cam-row-options": `${options}px`,
    "--cam-row-actions": `${actions}px`,
    "--cam-row-status": `${status}px`,
    "--cam-row-confirm": `${confirm}px`,
    "--cam-max-h": `${layout.maxHeight}px`,
  };
}

/**
 * Fit a still (or a video frame) inside the reserved stage without distorting it and
 * without ever scaling up. Returns whole px, at least 1x1, so the box overlaps the
 * visible picture exactly and the percent-positioned cut box lands where the pointer did.
 */
export function fitInside(natural: Viewport, box: Viewport): Viewport {
  const nw = natural.w > 0 ? natural.w : 1;
  const nh = natural.h > 0 ? natural.h : 1;
  const bw = box.w > 0 ? box.w : 1;
  const bh = box.h > 0 ? box.h : 1;
  const scale = Math.min(bw / nw, bh / nh);
  return {
    w: Math.max(1, Math.round(nw * scale)),
    h: Math.max(1, Math.round(nh * scale)),
  };
}

// --- which path the dialog opens on -----------------------------------------
// The upload path is the default (bead jd1): the dialog never touches a camera on its
// own. That keeps the beat testable headless and keeps the webcam a deliberate choice —
// a person presses "Use camera", nobody else.

export type CameraAsk = "open" | "use-camera";

/** Only an explicit press of "Use camera" may call getUserMedia. */
export function wantsCameraStream(ask: CameraAsk): boolean {
  return ask === "use-camera";
}

export const UPLOAD_LABEL = "Upload a photo";
export const CAMERA_LABEL = "Use camera";
export const CAPTURE_LABEL = "Capture";

/** The button Enter presses / that takes focus: the obvious next step for the phase. */
export function defaultAction(phase: DialogPhase): "upload" | "capture" | "confirm" {
  if (phase === "stream") return "capture";
  if (phase === "preview") return "confirm";
  return "upload";
}

/** The one-line hint under the title, so the empty stage explains itself. */
export function stageHint(phase: DialogPhase, hasCamera: boolean): string {
  if (phase === "stream") return "Hold your object up, then press Capture.";
  if (phase === "preview") return "Click your object if the green box picked something else, then bring it in.";
  return hasCamera
    ? "Upload a photo, or turn the camera on."
    : "Upload a photo of something you are holding — no camera needed.";
}

/**
 * The upload path in one place: a photo picked from disk is scaled to at most 768 px on
 * its long edge before it travels (server/validate.ts rejects anything bigger), then it
 * is sent as `photoFind`, and the cut itself is done client-side from the same canvas.
 */
export const PHOTO_MAX_EDGE = 768;

export function photoWorkSize(natural: Viewport): Viewport {
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(natural.w, natural.h, 1));
  return {
    w: Math.max(1, Math.round(natural.w * scale)),
    h: Math.max(1, Math.round(natural.h * scale)),
  };
}

/** The message the upload path sends first; SAM answers with the box the green outline shows. */
export function photoFindMessage(key: string, image: string, prompt: string): ClientMsg {
  return { kind: "photoFind", key, image, prompt };
}
