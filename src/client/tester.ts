// Family-test metrics (bead 3hu.1, ADR 0033): with ?tester=N the page reports a few anonymous events so the owner gets
// numbers without taking notes. N is an anonymous index (1..99), never a name. Events carry no text at all: only what
// happened (typed or spoken, landed, rejected, failed, a mood name the game picked) and which command of the session.
import type { ClientMsg } from "../contract";

type TesterMsg = Extract<ClientMsg, { kind: "tester" }>;

/** The tester index from the URL, or null when the page is not a test session. */
export function testerIndex(flags: URLSearchParams): number | null {
  const n = Number(flags.get("tester"));
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

/** A mood name as a short slug safe to log. */
export const moodSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

export interface Tester {
  readonly on: boolean;
  /** The socket just opened: say hello and send anything queued while it was down. */
  onOpen(): void;
  /** A command went to the server, typed or spoken. */
  attempt(via: "typed" | "voice", command: string): void;
  /** A build stage message arrived. */
  stage(stage: string, command: string | undefined): void;
  mood(name: string): void;
  close(): void;
}

export function createTester(flags: URLSearchParams, send: (m: ClientMsg) => boolean): Tester {
  const n = testerIndex(flags);
  const cids = new Map<string, number>();
  const queue: TesterMsg[] = [];
  const cidOf = (command: string): number => {
    const k = command.trim().toLowerCase();
    let c = cids.get(k);
    if (c === undefined) { c = cids.size; cids.set(k, c); }
    return c;
  };
  const emit = (m: Omit<TesterMsg, "kind" | "n">): void => {
    if (n === null) return;
    const msg: TesterMsg = { kind: "tester", n, ...m };
    if (!send(msg) && queue.length < 200) queue.push(msg);
  };
  return {
    on: n !== null,
    onOpen() {
      emit({ ev: "open" });
      while (queue.length && send(queue[0])) queue.shift();
    },
    attempt(via, command) { emit({ ev: via, cid: cidOf(command) }); },
    stage(stage, command) {
      const ev = stage === "done" ? "landed" : stage === "rejected" ? "rejected" : stage === "failed" ? "failed" : null;
      if (ev && command) emit({ ev, cid: cidOf(command) });
    },
    mood(name) { const m = moodSlug(name); if (m) emit({ ev: "mood", mood: m }); },
    close() { emit({ ev: "close" }); },
  };
}
