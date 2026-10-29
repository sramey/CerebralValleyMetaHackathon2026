import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createStatsHandler, emptyFeed, readStatsFeed, statsFeed, STATS_PATH } from "../server/stats-feed";
import { parseLog } from "../server/stats";

// The same shape server/createlog.ts writes, with prompts, names, titles and Windows
// paths in it: the feed must carry none of that, only numbers.
const rows = [
  { ts: "2026-10-28T10:00:00.000Z", command: "add a windmill for Alice", route: "new", outcome: "mod", modId: "windmill", title: "Windmill", timings: { route: 200, write: 7000, compile: 300, verify: 500, total: 8000 }, verify: { ok: true, errors: [], msPerFrame: 0.002 }, fixAttempted: false, sourceFile: "C:\\Users\\alice\\logs\\mods\\windmill-v1.ts" },
  { ts: "2026-10-28T10:10:00.000Z", command: "add a flare", route: "new", outcome: "mod", modId: "signal-flare", timings: { route: 300, write: 22000, compile: 400, verify: 1300, total: 24000 }, verify: { ok: true, errors: [], msPerFrame: 0.003 }, fixAttempted: true },
  { ts: "2026-10-28T11:00:00.000Z", command: "make the player jump higher", route: "edit", outcome: "edit", modId: "player", timings: { route: 400, write: 29000, compile: 200, verify: 400, total: 30000 }, verify: { ok: true, errors: [], msPerFrame: 0.004 }, fixAttempted: false },
  { ts: "2026-10-28T12:00:00.000Z", command: "edit the horse per Alice's notes", route: "edit", outcome: "failed", timings: { route: 500, write: 9000, compile: 100, verify: 0, total: 10000 }, verify: { ok: false, errors: ["compile error: C:\\Users\\alice\\src\\mod.ts:9:1 ERROR"], msPerFrame: 0 }, fixAttempted: true },
  { ts: "2026-10-28T14:01:00.000Z", command: "what can you do", route: "question", outcome: "say", timings: { route: 300, write: 0, compile: 0, verify: 0, total: 300 }, fixAttempted: false },
  { kind: "art", ts: "2026-10-28T10:00:05.000Z", subject: "windmill", file: "C:\\Users\\alice\\public\\art\\gen\\windmill.webp", ms: 22000, samOk: true },
  { kind: "mood", ts: "2026-10-28T16:00:00.000Z", mood: "spooky", ms: 900 },
];
const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n{bad json\n";

function feedOf(text = jsonl) {
  const { rows: parsed, malformed } = parseLog(text);
  return statsFeed(parsed, malformed);
}

function fakeRes() {
  const out = { code: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      out.code = code;
      out.headers = headers ?? {};
      return res;
    },
    end(body?: string) {
      out.body = body ?? "";
      return res;
    },
  };
  return { out, res: res as unknown as ServerResponse };
}

const req = (method: string, url: string) => ({ method, url }) as unknown as IncomingMessage;

describe("GET /api/stats (ADR 0027)", () => {
  it("returns the aggregate as numbers with the exact StatsFeed shape", () => {
    const feed = feedOf();
    expect(Object.keys(feed).sort()).toEqual(["builds", "lines", "malformed", "mods", "window"]);
    expect(Object.keys(feed.builds).sort()).toEqual([
      "attempts", "failed", "firstPass", "firstPassPct", "fixAttempts", "fixSaves",
      "landed", "landedPct", "medianMs", "p90Ms", "total",
    ]);
    expect(feed.builds).toMatchObject({
      total: 5, // every build line, including the question
      attempts: 4,
      landed: 3,
      failed: 1,
      landedPct: 0.75,
      firstPass: 2,
      firstPassPct: 0.667,
      fixSaves: 1,
      fixAttempts: 2,
      medianMs: 24000,
      p90Ms: 30000,
    });
    expect(feed.mods).toEqual({ distinct: 3, edits: 1 });
    expect(feed.window).toEqual({ first: "2026-10-28T10:00:00.000Z", last: "2026-10-28T16:00:00.000Z", days: 1 });
    expect(feed.lines).toBe(rows.length);
    expect(feed.malformed).toBe(1);
  });

  it("carries no prompt, title, mod id, error text or path", () => {
    const body = JSON.stringify(feedOf());
    for (const leak of ["alice", "Alice", "windmill", "Windmill", "flare", "horse", "what can you", "spooky", "compile error", "C:\\\\", "/logs/", "modId", "title", "command"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("is all zeros and nulls on an empty log, never NaN", () => {
    const feed = emptyFeed();
    expect(feed.builds).toMatchObject({ total: 0, attempts: 0, landed: 0, landedPct: null, firstPassPct: null, medianMs: null, p90Ms: null });
    expect(feed.window).toEqual({ first: null, last: null, days: 0 });
    const body = JSON.stringify(feed);
    expect(body).not.toContain("NaN");
    expect(body).not.toContain("null,\"landedPct\":0");
  });

  it("aggregates a log file from disk, and an empty feed for a missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "metabuild-feed-"));
    try {
      const file = join(dir, "builds.jsonl");
      writeFileSync(file, jsonl);
      expect(readStatsFeed(file)).toEqual(feedOf());
      expect(readStatsFeed(join(dir, "nope.jsonl"))).toEqual(emptyFeed());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers the route with JSON and lets every other path through", () => {
    const dir = mkdtempSync(join(tmpdir(), "metabuild-feed-"));
    try {
      const file = join(dir, "builds.jsonl");
      writeFileSync(file, jsonl);
      const handler = createStatsHandler({ logFile: () => file });

      const { out, res } = fakeRes();
      expect(handler(req("GET", STATS_PATH), res)).toBe(true);
      expect(out.code).toBe(200);
      expect(out.headers["content-type"]).toContain("application/json");
      expect(out.headers["access-control-allow-origin"]).toBe("*"); // the dev page is on Vite's port
      expect(out.headers["cache-control"]).toBe("no-store");
      expect(JSON.parse(out.body)).toEqual(feedOf());

      // Query strings still hit the route; other paths fall through to the static handler.
      expect(handler(req("GET", `${STATS_PATH}?t=1`), fakeRes().res)).toBe(true);
      expect(handler(req("GET", "/index.html"), fakeRes().res)).toBe(false);
      expect(handler(req("GET", "/api/other"), fakeRes().res)).toBe(false);

      const post = fakeRes();
      expect(handler(req("POST", STATS_PATH), post.res)).toBe(true);
      expect(post.out.code).toBe(405);
      expect(post.out.headers.allow).toBe("GET");
      expect(post.out.body).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
