// Cold-start gate (bead q2s). The client opens its websocket before the slow asset work
// (Pixi init, sprite sheets), but the socket's handlers read state declared further down
// `main.ts`. `ready` resolves once that module has finished evaluating; every handler
// awaits it first, so a frame that arrives during asset loading is delayed, never dropped,
// and never run against half-built module state.
export interface BootGate {
  /** Resolves when the module is fully evaluated. Safe to await many times. */
  readonly ready: Promise<void>;
  /** Release everyone waiting. Idempotent. */
  markReady(): void;
}

export function createBootGate(): BootGate {
  let release: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return {
    ready,
    markReady(): void {
      release?.();
      release = null;
    },
  };
}
