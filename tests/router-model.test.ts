import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openConfig, routerChat } from "../server/router-model";

const MSGS = [{ role: "user" as const, content: "add a player" }];
let mock: Server | undefined;
let seen: { auth?: string; body?: any; hits: number };

/** Local stand-in for Baseten's OpenAI-compatible endpoint. */
async function startMock(handler: (res: import("node:http").ServerResponse) => void): Promise<string> {
  seen = { hits: 0 };
  mock = createServer((req, res) => {
    seen.hits++;
    seen.auth = req.headers.authorization;
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { seen.body = JSON.parse(b); } catch { /* ignore */ } handler(res); });
  });
  await new Promise<void>((r) => mock!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
}

beforeEach(() => {
  process.env.MODEL_API_KEY = "test-key-not-real";
  delete process.env.BASETEN_API_KEY;
  delete process.env.BASETEN_BASE_URL;
  delete process.env.BASETEN_MODEL;
  delete process.env.BASETEN_TIMEOUT_MS;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (mock) await new Promise((r) => mock!.close(r));
  mock = undefined;
});

/** Hosted Spark stub: records that it was used. */
function stubHosted(): { calls: number } {
  const state = { calls: 0 };
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init: any) => {
    if (String(url).startsWith("https://api.meta.ai/")) {
      state.calls++;
      return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { content: "hosted" } }] }), text: async () => "" });
    }
    return real(url, init);
  });
  return state;
}

describe("router model (ADR 0032)", () => {
  it("is off without BASETEN_API_KEY: hosted Spark, no Baseten call", async () => {
    expect(openConfig()).toBeNull();
    const hosted = stubHosted();
    const r = await routerChat(MSGS);
    expect(r).toMatchObject({ text: "hosted", model: "muse-spark-1.2", open: false, fellBack: false });
    expect(hosted.calls).toBe(1);
  });

  it("uses open weights when the key is set: bearer auth, model slug, minimal reasoning", async () => {
    process.env.BASETEN_BASE_URL = await startMock((res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"new"}' } }] }));
    });
    process.env.BASETEN_API_KEY = "baseten-test";
    const hosted = stubHosted();
    const r = await routerChat(MSGS);
    expect(r).toMatchObject({ text: '{"action":"new"}', model: "muse-spark-open-1026", open: true, fellBack: false });
    expect(seen.auth).toBe("Bearer baseten-test");
    expect(seen.body.model).toBe("meta-models/muse-spark-open-1026");
    expect(seen.body.reasoning_effort).toBe("minimal");
    expect(hosted.calls).toBe(0);
  });

  it("falls back to hosted Spark on an HTTP error", async () => {
    process.env.BASETEN_BASE_URL = await startMock((res) => { res.statusCode = 503; res.end("down"); });
    process.env.BASETEN_API_KEY = "baseten-test";
    const hosted = stubHosted();
    const r = await routerChat(MSGS);
    expect(r).toMatchObject({ text: "hosted", open: false, fellBack: true });
    expect(hosted.calls).toBe(1);
  });

  it("falls back on timeout", async () => {
    process.env.BASETEN_BASE_URL = await startMock(() => { /* never answers */ });
    process.env.BASETEN_API_KEY = "baseten-test";
    process.env.BASETEN_TIMEOUT_MS = "150";
    const hosted = stubHosted();
    const t0 = performance.now();
    const r = await routerChat(MSGS);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ open: false, fellBack: true });
    expect(hosted.calls).toBe(1);
  });

  it("falls back on an empty reply", async () => {
    process.env.BASETEN_BASE_URL = await startMock((res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "" } }] }));
    });
    process.env.BASETEN_API_KEY = "baseten-test";
    const hosted = stubHosted();
    expect((await routerChat(MSGS)).fellBack).toBe(true);
    expect(hosted.calls).toBe(1);
  });
});
