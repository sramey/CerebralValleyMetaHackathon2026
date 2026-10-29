// Impact numbers the game can show about itself (ADR 0026).
//
// `GET /api/stats` answers with the aggregate of logs/builds.jsonl that `npm run stats`
// publishes, reduced to an allow-list of NUMBERS (see StatsFeed in src/contract.ts).
// The log holds every player command, so it never leaves this machine as text: the
// response can only carry counts, percentages and durations. The aggregation itself is
// server/stats.ts — one implementation, two front doors (panel + markdown page).
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { StatsFeed } from "../src/contract";
import { aggregate, parseLog } from "./stats";
import type { LogRow } from "./stats";

export const STATS_PATH = "/api/stats";

/** landed / attempts as a 0..1 fraction rounded to 3 decimals, or null when the base is empty. */
function ratio(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 1000 : null;
}

function ms(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

/** Pure: log rows in, panel numbers out. No clock, no filesystem. */
export function statsFeed(rows: LogRow[], malformed = 0): StatsFeed {
  const s = aggregate(rows, malformed);
  return {
    window: { first: s.window.first, last: s.window.last, days: s.window.days },
    lines: s.lines,
    malformed: s.malformed,
    builds: {
      total: s.requests,
      attempts: s.attempts,
      landed: s.landed,
      failed: s.failed,
      landedPct: ratio(s.landed, s.attempts),
      firstPass: s.firstPass,
      firstPassPct: ratio(s.firstPass, s.landed),
      fixSaves: s.fixSaves,
      fixAttempts: s.fixAttempts,
      medianMs: ms(s.latency.medianMs),
      p90Ms: ms(s.latency.p90Ms),
    },
    mods: { distinct: s.distinctMods, edits: s.edits },
  };
}

/** The feed for an empty (or unreadable) log: zeros and nulls, never NaN. */
export function emptyFeed(): StatsFeed {
  return statsFeed([], 0);
}

/**
 * Read a JSONL creation log and aggregate it. A missing or unreadable file is an
 * empty feed, not an error: a fresh checkout simply has no builds yet.
 */
export function readStatsFeed(logFile: string): StatsFeed {
  try {
    if (!existsSync(logFile)) return emptyFeed();
    const { rows, malformed } = parseLog(readFileSync(logFile, "utf8"));
    return statsFeed(rows, malformed);
  } catch {
    return emptyFeed();
  }
}

export interface StatsRouteOptions {
  /** Where the creation log is right now (createlog's activeLogFile(), so tests can redirect it). */
  logFile: () => string;
}

/**
 * Handle `GET /api/stats`. Returns true when the request was answered, so the static
 * handler never sees it. CORS is open because the body is aggregate numbers only; the
 * dev page runs on Vite's port while this endpoint lives on the game server's.
 */
export function createStatsHandler(opts: StatsRouteOptions) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== STATS_PATH) return false;
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    if (req.method !== "GET") {
      res.writeHead(405, { ...headers, allow: "GET" }).end();
      return true;
    }
    res.writeHead(200, headers).end(JSON.stringify(readStatsFeed(opts.logFile())));
    return true;
  };
}
