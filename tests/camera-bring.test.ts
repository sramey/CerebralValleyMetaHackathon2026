import { describe, it, expect } from "vitest";
import { isBoxTooLarge, isSelectionTooLarge } from "../src/client/camera-selection";

// Pure decision model for the Bring-it-in confirm action
// Mirrors the exact logic in cameraConfirm.addEventListener("click", ...) in src/client/main.ts
interface BringContext {
  pendingCapture: boolean;
  currentKey: string | null;
  serverOnline: boolean;
  isPaper: boolean;
  activeSelectionCount: number;
  totalPixels: number;
  foundBox: { w: number; h: number } | null;
  hasDiff: boolean;
  hasWand: boolean;
  clickPoint: { fx: number; fy: number } | null;
  labelValue: string;
  cutAspect: number | null;
}

interface BringResult {
  sentMessage: { kind: string; key?: string; prompt?: string; aspect?: number; image?: string } | null;
  statusMessage: string | null;
  modalClosed: boolean;
}

function processBringClick(ctx: BringContext): BringResult {
  if (ctx.isPaper) {
    if (!ctx.pendingCapture) {
      return { sentMessage: null, statusMessage: "Please upload or capture a drawing first.", modalClosed: false };
    }
    return {
      sentMessage: { kind: "paperLevel", prompt: ctx.labelValue },
      statusMessage: null,
      modalClosed: true,
    };
  }

  if (!ctx.pendingCapture || !ctx.currentKey) {
    return { sentMessage: null, statusMessage: "Upload or capture a photo first.", modalClosed: false };
  }

  if (!ctx.serverOnline) {
    return { sentMessage: null, statusMessage: "The server is offline — cannot bring objects into the game.", modalClosed: false };
  }

  const selectionTooLarge =
    (ctx.activeSelectionCount > 0 && isSelectionTooLarge(ctx.activeSelectionCount, ctx.totalPixels)) ||
    (ctx.foundBox !== null && isBoxTooLarge({ x: 0, y: 0, ...ctx.foundBox }));

  if (selectionTooLarge) {
    return {
      sentMessage: null,
      statusMessage: "That selected too much of the photo (over 60%). Click directly on the object to select it.",
      modalClosed: false,
    };
  }

  const hasActiveSelection = ctx.activeSelectionCount > 0;
  const hasDiff = ctx.hasDiff;
  const hasWand = ctx.hasWand;
  const hasBox = ctx.foundBox !== null;
  const hasClick = ctx.clickPoint !== null;

  if (!hasActiveSelection && !hasDiff && !hasWand && !hasBox && !hasClick) {
    return { sentMessage: null, statusMessage: "No object selected — click your object in the photo to select it.", modalClosed: false };
  }

  const prompt = ctx.labelValue.trim() || "object";
  const aspect = ctx.cutAspect ?? 1.0;

  return {
    sentMessage: { kind: "photoBringLocal", key: ctx.currentKey, prompt, aspect },
    statusMessage: null,
    modalClosed: true,
  };
}

describe("Bring it into the game click path (camfix)", () => {
  const baseContext: BringContext = {
    pendingCapture: true,
    currentKey: "photo-1",
    serverOnline: true,
    isPaper: false,
    activeSelectionCount: 5000,
    totalPixels: 100000, // 5% of frame
    foundBox: null,
    hasDiff: false,
    hasWand: false,
    clickPoint: null,
    labelValue: "electronic toy",
    cutAspect: 1.25,
  };

  it("sends photoBringLocal when a valid selection exists", () => {
    const res = processBringClick(baseContext);
    expect(res.sentMessage).not.toBeNull();
    expect(res.sentMessage?.kind).toBe("photoBringLocal");
    expect(res.sentMessage?.key).toBe("photo-1");
    expect(res.sentMessage?.prompt).toBe("electronic toy");
    expect(res.sentMessage?.aspect).toBe(1.25);
    expect(res.modalClosed).toBe(true);
    expect(res.statusMessage).toBeNull();
  });

  it("defaults empty prompt to 'object' and sends request", () => {
    const res = processBringClick({ ...baseContext, labelValue: "   " });
    expect(res.sentMessage).not.toBeNull();
    expect(res.sentMessage?.kind).toBe("photoBringLocal");
    expect(res.sentMessage?.prompt).toBe("object");
  });

  it("blocks Bring it in when selection exceeds 60% of frame and explains plainly", () => {
    const res = processBringClick({
      ...baseContext,
      activeSelectionCount: 65000,
      totalPixels: 100000, // 65% of frame
    });
    expect(res.sentMessage).toBeNull();
    expect(res.modalClosed).toBe(false);
    expect(res.statusMessage).toContain("over 60%");
    expect(res.statusMessage).toContain("Click directly on the object");
  });

  it("blocks Bring it in when SAM box exceeds 60% of frame area", () => {
    const res = processBringClick({
      ...baseContext,
      activeSelectionCount: 0,
      foundBox: { w: 1400, h: 1400 }, // ~76% of 1600x1600
    });
    expect(res.sentMessage).toBeNull();
    expect(res.modalClosed).toBe(false);
    expect(res.statusMessage).toContain("over 60%");
  });

  it("shows clear message when no photo has been uploaded or captured", () => {
    const res = processBringClick({ ...baseContext, pendingCapture: false, currentKey: null });
    expect(res.sentMessage).toBeNull();
    expect(res.statusMessage).toBe("Upload or capture a photo first.");
    expect(res.modalClosed).toBe(false);
  });

  it("shows clear message when server is disconnected", () => {
    const res = processBringClick({ ...baseContext, serverOnline: false });
    expect(res.sentMessage).toBeNull();
    expect(res.statusMessage).toContain("server is offline");
    expect(res.modalClosed).toBe(false);
  });

  it("shows clear message when nothing has been selected", () => {
    const res = processBringClick({
      ...baseContext,
      activeSelectionCount: 0,
      foundBox: null,
      hasDiff: false,
      hasWand: false,
      clickPoint: null,
    });
    expect(res.sentMessage).toBeNull();
    expect(res.statusMessage).toBe("No object selected — click your object in the photo to select it.");
    expect(res.modalClosed).toBe(false);
  });
});
