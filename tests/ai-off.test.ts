import { describe, it, expect } from "vitest";
import { AI_OFF } from "../src/ai-off";
import { NO_KEY_INFO } from "../src/client/nokey-modal";

describe("AI-off copy (keyless visitor)", () => {
  it("never invites a build and tells the visitor what still works", () => {
    for (const text of [AI_OFF.greeting, AI_OFF.placeholder, AI_OFF.panelPlaceholder, AI_OFF.worldOpened(4)]) {
      expect(text.toLowerCase()).not.toMatch(/tell me what to build|keep building|try: /);
      expect(text.toLowerCase()).toMatch(/ai is off|paused/);
    }
    expect(AI_OFF.greeting).toContain("demo world");
    expect(AI_OFF.worldOpened(4)).toContain("4 mods");
  });
  it("the modal still lists the drawing tool as playable (it builds from the boxes without AI)", () => {
    expect(NO_KEY_INFO.enabled.some((e) => e.title === "Level Drawing Tool")).toBe(true);
  });
});
