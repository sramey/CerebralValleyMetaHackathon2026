// Per-build art ordering (bead 852). One build can introduce several new subjects at once
// ("add a dragon, a knight and a treasure chest"), so every drawable creature or prop type
// gets its own sheet: cached sheets are reused (never re-ordered), missing ones are all
// drawn in parallel and each lands as its own `art` message (ADR 0008).
// Pure apart from the injected cache/spend/draw callbacks, so a headless test can mock them.
import type { ArtSheet } from "../src/contract";
import type { ArtOrder } from "./art";

/** A sheet ready to attach or send: what the client keys its frames by. */
export type { ArtSheet } from "../src/contract";

export interface ArtPlan {
  /** The sheet carried inline on the mod message: the first cached one, if any. */
  art?: ArtSheet;
  /** Other cached sheets, sent as their own `art` messages after the mod lands. */
  extra: ArtSheet[];
  /** Key the client marks as pending (the first of `artPendingList`, for older clients). */
  artPending?: string;
  /** Every key still being drawn: the client shows a placeholder for each. */
  artPendingList?: string[];
  /** Sheets still to draw, all in parallel. */
  pending: ArtOrder[];
}

/**
 * Split a build's art orders into cached sheets and sheets to draw.
 * `spend()` is called once per missing sheet before it is queued, so the kill switch and
 * any host-set `BUDGET_*` limit still apply; the first refusal stops the rest.
 */
export function planBuildArt(orders: ArtOrder[], deps: { cached: (key: string) => string | null; spend: () => boolean }): ArtPlan {
  const plan: ArtPlan = { extra: [], pending: [] };
  for (const order of orders) {
    const url = deps.cached(order.key);
    if (url) {
      const sheet: ArtSheet = { key: order.key, url, ...(order.scenery ? { scenery: true } : {}) };
      if (plan.art) plan.extra.push(sheet);
      else plan.art = sheet;
    } else if (deps.spend()) {
      plan.pending.push(order);
    } else {
      break;
    }
  }
  if (plan.pending.length > 0) {
    plan.artPending = plan.pending[0]!.key;
    plan.artPendingList = plan.pending.map((o) => o.key);
  }
  return plan;
}

/**
 * Draw every pending sheet in parallel. `onResult` fires as each one lands (url null on
 * failure); nothing here ever throws, so a failed sheet never breaks a build.
 */
export function drawPendingArt(
  pending: ArtOrder[],
  draw: (order: ArtOrder) => Promise<string | null>,
  onResult: (order: ArtOrder, url: string | null, ms: number) => void,
): void {
  for (const order of pending) {
    const t0 = performance.now();
    const done = (url: string | null): void => {
      try { onResult(order, url, Math.round(performance.now() - t0)); } catch { /* art never breaks a build */ }
    };
    draw(order).then(done, () => done(null));
  }
}
