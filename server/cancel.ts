// Cancelling a build that is still running (ADR 0060). The player clicks the small x on a
// build chip, the client sends {kind:"cancel", command}, and this registry aborts every
// build still in flight under that command text - the same key the client stamps on its
// chip, so cancelling one lane of a compound command leaves its siblings running.
//
// The build itself does the rest: every model call on its path takes `job.signal`, and the
// build re-checks `job.cancelled` before it touches the world, so a reply that lands after
// the click is dropped instead of hot-loaded. Aborting is best-effort by nature (a fetch
// that already returned cannot be un-returned), which is exactly why the cancelled flag,
// not the signal, is what the pipeline trusts.
//
// Dependency-free and clock-free, so the tests drive it headless with no model call.

/** The stage detail that means "the player cancelled this" (src/client/builds.ts paints it as "cancelled"). */
export const CANCEL_DETAIL = "cancelled";

/** One build, from the moment it starts until its timing message closes it. */
export interface CancelJob {
  /** The command text this build was keyed by (the server's own truncated copy of what was typed). */
  readonly command: string;
  /** Aborted on cancel. Pass it to every model call on the build's path. */
  readonly signal: AbortSignal;
  /** True once the player cancelled. Check it before compiling, hot-loading or speaking. */
  readonly cancelled: boolean;
}

export interface CancelRegistry {
  /** Start one build. Its entry closes on cancel() or done(command). */
  begin(command: string): CancelJob;
  /** Abort every build still running for `command`. Returns how many were stopped (0 = none). */
  cancel(command: string): number;
  /** The build for `command` is over: stop counting it as in flight. Idempotent. */
  done(command: string): void;
  /** Commands with a build running right now (for logs and tests). */
  running(): string[];
}

export function createCancelRegistry(): CancelRegistry {
  interface Entry { ctrl: AbortController; cancelled: boolean }
  const live = new Map<string, Set<Entry>>();

  function begin(command: string): CancelJob {
    const entry: Entry = { ctrl: new AbortController(), cancelled: false };
    let set = live.get(command);
    if (!set) { set = new Set(); live.set(command, set); }
    set.add(entry);
    return {
      command,
      signal: entry.ctrl.signal,
      // A getter, not a snapshot: the job is read long after it was handed out.
      get cancelled() { return entry.cancelled; },
    };
  }

  function cancel(command: string): number {
    const set = live.get(command);
    if (!set) return 0;
    live.delete(command);
    for (const entry of set) {
      entry.cancelled = true;
      entry.ctrl.abort();
    }
    return set.size;
  }

  function done(command: string): void {
    live.delete(command);
  }

  function running(): string[] {
    return [...live.keys()];
  }

  return { begin, cancel, done, running };
}

/**
 * One signal that aborts when any of the given ones does. The build paths already carry a
 * signal of their own (the sketch and paper deadlines, ADR 0054), and a cancel has to win
 * that race too: this joins them without assuming `AbortSignal.any` exists.
 */
export function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  if (live.some((s) => s.aborted)) return AbortSignal.abort();
  const ctrl = new AbortController();
  const stop = (): void => { ctrl.abort(); };
  for (const s of live) s.addEventListener("abort", stop, { once: true });
  return ctrl.signal;
}
