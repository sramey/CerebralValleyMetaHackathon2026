import { describe, expect, it, vi, beforeEach } from "vitest";

describe("meta chat", () => {
  beforeEach(() => { process.env.MODEL_API_KEY = "test-key-not-real"; });

  it("sends reasoning_effort minimal by default (default effort empties mod replies)", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "export default {}" } }] }),
        text: async () => "",
      };
    }));
    const { chat, WONDER } = await import("../server/meta");
    const res = await chat(WONDER, [{ role: "user", content: "write a mod" }], 4096);
    expect(res.text).toBe("export default {}");
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.max_tokens).toBe(4096);
    vi.unstubAllGlobals();
  });
});
