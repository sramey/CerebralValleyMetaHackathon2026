// Live stats refresh policy (ADR 0027 follow-up): the impact numbers used to move only on the
// panel's 20 s poll, so the build a judge just watched land was missing from the tiles. Now a
// "live" message (a stage that settles, or the command's timing) asks for a fresh read; this
// module is the pure half that decides which messages count and how often the panel may ask.
// Slugging the endpoint with one GET per stage message would be rude and pointless: the log
// cannot grow twice in a millisecond.

/** Minimum gap between two reads of the build log. */
export const MIN_REFRESH_GAP_MS = 1_500;

/**
 * Does this server message mean the build log may have grown? Two kinds count:
 * - `timing` is the last message of every command and the server logs the build just before
 *   sending it (`server/index.ts`), so the line is already on disk.
 * - a `stage` of `done` (hot-loaded) or `failed` (attempt logged) settles a build. `done`
 *   is sent a moment BEFORE the log line is written, which is why the panel retries after the
 *   gap instead of only reading once.
 */
export function isLiveBuildMsg(msg: { kind: string; stage?: string }): boolean {
  if (msg.kind === "timing") return true;
  return msg.kind === "stage" && (msg.stage === "done" || msg.stage === "failed");
}

/** How long the panel must still wait before reading again: 0 means "now". */
export function refreshDelay(lastStartedAt: number | null, now: number, gap: number = MIN_REFRESH_GAP_MS): number {
  if (lastStartedAt === null) return 0;
  return Math.max(0, lastStartedAt + gap - now);
}
