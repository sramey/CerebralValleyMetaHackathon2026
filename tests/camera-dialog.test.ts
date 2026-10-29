import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIALOG_METRICS,
  PROMISE_SCREENS,
  dialogCssVars,
  dialogLayout,
  fitInside,
  photoFindMessage,
  photoWorkSize,
  stageHeight,
  stageHint,
  defaultAction,
  wantsCameraStream,
} from "../src/client/camera-dialog";
import type { DialogPhase } from "../src/client/camera-dialog";

const PHASES: DialogPhase[] = ["idle", "stream", "preview"];
const root = process.cwd();

describe("camera dialog fits the demo screens (bead jd1)", () => {
  for (const screen of PROMISE_SCREENS) {
    it(`fits ${screen.w}x${screen.h} before, during and after the stream`, () => {
      for (const phase of PHASES) {
        const l = dialogLayout(screen, phase);
        expect(l.fits, `${phase} at ${screen.w}x${screen.h}: ${l.height} > ${l.maxHeight}`).toBe(true);
        expect(l.height).toBeLessThanOrEqual(l.maxHeight);
        expect(l.slack).toBeGreaterThan(0);
        expect(l.labelTopInViewport + l.rows[2]).toBeLessThanOrEqual(screen.h);
      }
    });
  }

  it("keeps every row identical in all three phases, so nothing can shift", () => {
    for (const screen of PROMISE_SCREENS) {
      const base = dialogLayout(screen, "idle");
      for (const phase of PHASES) {
        const l = dialogLayout(screen, phase);
        expect(l.rows).toEqual(base.rows);
        expect(l.height).toBe(base.height);
        expect(l.labelTop).toBe(base.labelTop);
        expect(l.labelTopInViewport).toBe(base.labelTopInViewport);
      }
    }
  });

  it("reserves a real video box before a stream exists", () => {
    for (const screen of PROMISE_SCREENS) {
      const idle = dialogLayout(screen, "idle");
      expect(idle.stage).toBe(stageHeight(screen.h));
      expect(idle.stage).toBeGreaterThanOrEqual(DIALOG_METRICS.stageMin);
      expect(idle.stage).toBe(dialogLayout(screen, "stream").stage);
      // A mug needs room: at the shortest promised screen the stage is still a third of it.
      expect(idle.stage).toBeGreaterThanOrEqual(Math.round(screen.h * 0.3));
    }
  });

  it("keeps the label out of the way of the stage at every height", () => {
    for (const h of [600, 720, 854, 1080, 1440]) {
      const l = dialogLayout({ w: 1280, h });
      expect(l.labelTop).toBe(DIALOG_METRICS.padding + DIALOG_METRICS.head + DIALOG_METRICS.gap + l.stage + DIALOG_METRICS.gap);
      expect(l.labelTop).toBeGreaterThan(l.stage);
    }
  });

  it("caps the stage instead of growing past the screen", () => {
    expect(stageHeight(100)).toBe(DIALOG_METRICS.stageMin);
    expect(stageHeight(40000)).toBe(DIALOG_METRICS.stageMax);
    expect(stageHeight(800)).toBeLessThanOrEqual(DIALOG_METRICS.stageMax);
    expect(stageHeight(854)).toBeGreaterThan(stageHeight(720));
  });
});

describe("the dialog's CSS contract", () => {
  const css = readFileSync(join(root, "src", "client", "style.css"), "utf8");
  const html = readFileSync(join(root, "index.html"), "utf8");

  it("gets every row height from the model, not from the stylesheet", () => {
    const vars = dialogCssVars(dialogLayout({ w: 1280, h: 720 }));
    expect(Object.keys(vars)).toEqual(
      expect.arrayContaining([
        "--cam-row-head", "--cam-row-stage", "--cam-row-label", "--cam-row-options",
        "--cam-row-actions", "--cam-row-status", "--cam-row-confirm", "--cam-max-h",
      ]),
    );
    for (const value of Object.values(vars)) expect(value).toMatch(/^\d+px$/);
    expect(vars["--cam-row-stage"]).toBe(`${stageHeight(720)}px`);
    const card = css.slice(css.indexOf(".camera-card"));
    const rows = card.slice(0, card.indexOf("}"));
    for (const name of ["--cam-row-head", "--cam-row-stage", "--cam-row-label", "--cam-row-options", "--cam-row-actions", "--cam-row-status", "--cam-row-confirm"]) {
      expect(rows).toContain(`var(${name}`);
    }
    expect(rows).toContain("grid-template-rows");
  });

  it("no longer sizes the video or the preview against the viewport", () => {
    // The old rules (max-height: 46vh / 40vh + a 92vh scrolling card) are what let the
    // dialog grow past 854 px and shift the label under the pointer.
    expect(css).not.toMatch(/#camera-video[^}]*vh/);
    expect(css).not.toMatch(/#camera-preview[^}]*vh/);
    expect(css).not.toMatch(/\.camera-card[^}]*overflow-y:\s*auto/);
  });

  it("ships the stage, the fixed label row and the upload button in the markup", () => {
    expect(html).toContain('id="camera-stage"');
    expect(html).toContain('id="camera-label"');
    expect(html).toMatch(/<button id="camera-upload-btn"[^>]*>Upload a photo</);
    expect(html).toMatch(/id="camera-upload-btn"[^>]*class="primary"/);
    // Status and the bring button are always in the flow (no hidden toggling), so showing
    // a message can never push the button down.
    expect(html).toMatch(/<p id="camera-status"><\/p>/);
    expect(html).toMatch(/<button id="camera-confirm" type="button" disabled>/);
    // ...and the bring button is only highlighted when it is the next step (preview).
    expect(css).toContain("#camera-confirm.primary");
    expect(html).not.toMatch(/id="camera-confirm"[^>]*class="primary"/);
  });
});

describe("upload is the default path (bead jd1)", () => {
  it("only the Use camera button may turn the webcam on", () => {
    expect(wantsCameraStream("open")).toBe(false);
    expect(wantsCameraStream("use-camera")).toBe(true);
  });

  it("puts the obvious next step in front of the person in each phase", () => {
    expect(defaultAction("idle")).toBe("upload");
    expect(defaultAction("stream")).toBe("capture");
    expect(defaultAction("preview")).toBe("confirm");
  });

  it("always has something to say about the reserved stage", () => {
    for (const phase of PHASES) {
      expect(stageHint(phase, false).length).toBeGreaterThan(10);
      expect(stageHint(phase, true).length).toBeGreaterThan(10);
    }
    expect(stageHint("idle", false)).toContain("Upload");
  });

  it("sends the upload as a photoFind with the scaled still", () => {
    const msg = photoFindMessage("photo-1", "data:image/jpeg;base64,AAA", "coffee mug");
    expect(msg).toEqual({ kind: "photoFind", key: "photo-1", image: "data:image/jpeg;base64,AAA", prompt: "coffee mug" });
  });
});

describe("still fitting and scaling", () => {
  it("never distorts the still, and fills the stage without overflowing it", () => {
    const wide = fitInside({ w: 1600, h: 900 }, { w: 528, h: 300 });
    expect(wide.h).toBeLessThanOrEqual(300);
    expect(wide.w).toBeLessThanOrEqual(528);
    expect(Math.abs(wide.w / wide.h - 1600 / 900)).toBeLessThan(0.02);
    const tall = fitInside({ w: 720, h: 1280 }, { w: 528, h: 300 });
    expect(tall.h).toBe(300);
    expect(tall.w).toBe(169);
    // A small upload is blown up to the stage, never squashed...
    expect(fitInside({ w: 200, h: 100 }, { w: 528, h: 300 })).toEqual({ w: 528, h: 264 });
    // ...and the square corner of the box still holds the picture.
    const small = fitInside({ w: 200, h: 100 }, { w: 528, h: 300 });
    expect(small.w / small.h).toBeCloseTo(2, 2);
  });

  it("survives a zero-sized box or still", () => {
    expect(fitInside({ w: 0, h: 0 }, { w: 0, h: 0 })).toEqual({ w: 1, h: 1 });
  });

  it("scales an upload to the 768 px the server accepts, never up", () => {
    expect(photoWorkSize({ w: 480, h: 360 })).toEqual({ w: 480, h: 360 });
    expect(photoWorkSize({ w: 4000, h: 3000 })).toEqual({ w: 768, h: 576 });
    expect(photoWorkSize({ w: 3000, h: 4000 })).toEqual({ w: 576, h: 768 });
    expect(photoWorkSize({ w: 768, h: 768 })).toEqual({ w: 768, h: 768 });
  });
});

