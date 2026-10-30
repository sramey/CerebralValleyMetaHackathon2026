// Things you build answer you (ADR 0059): standing orders any creature obeys, and the
// action-key interaction with entities a mod marks data.interact. Pure and deterministic:
// entities in, velocities out. World owns the bookkeeping (src/sim/world.ts).
import type { CreatureOrder, Entity } from "../contract";
import { entityKind } from "../ontology";

/** How long each order lasts, in ticks. follow and stay hold until "free" or another order. */
export const ORDER_TICKS: Record<CreatureOrder, number> = {
  follow: Number.POSITIVE_INFINITY,
  stay: Number.POSITIVE_INFINITY,
  come: 600,
  flee: 240,
  free: 0,
};

/** The bubble the first creature to take an order shows, so the player sees it was heard. */
export function orderAck(order: CreatureOrder): string {
  return { follow: "Right behind you!", come: "Coming!", stay: "Staying put.", flee: "Eek!", free: "Okay!" }[order];
}

/** Living things take orders; the player, terrain, props, shots and gear held by the player do not. */
export function isOrderable(e: Entity): boolean {
  if (e.type === "player" || e.dead || (e.solid && e.gravityScale === 0)) return false;
  if (e.data.heldByPlayer === true || e.data.orders === false) return false;
  return (e.kind ?? entityKind(e)) === "creature";
}

/** How close a follower stops, centre to centre, in px. */
const FOLLOW_GAP = 64;

/**
 * Steer one creature under an order, after its mod's tick code ran this frame. Returns true when
 * the order is done (a "come" that arrived). Fliers also steer vertically to hover beside the player.
 */
export function steerByOrder(e: Entity, order: CreatureOrder, player: Entity): boolean {
  const own = typeof e.data.speed === "number" && Number.isFinite(e.data.speed) ? Math.abs(e.data.speed) : Math.abs(e.vx);
  const speed = Math.min(240, Math.max(80, own));
  const dx = (player.x + player.w / 2) - (e.x + e.w / 2);
  const dir = dx >= 0 ? 1 : -1;
  const flier = e.gravityScale === 0;
  const hover = (): void => {
    if (!flier) return;
    const dy = (player.y - 50) - e.y;
    e.vy = Math.max(-speed, Math.min(speed, dy * 2));
  };
  switch (order) {
    case "stay":
      e.vx = 0;
      if (flier) e.vy = 0;
      return false;
    case "flee":
      e.vx = -dir * speed * 1.2;
      e.facing = e.vx > 0 ? 1 : -1;
      return false;
    case "follow":
    case "come": {
      const near = Math.abs(dx) <= FOLLOW_GAP + (player.w + e.w) / 2;
      e.vx = near ? 0 : dir * speed;
      e.facing = dir > 0 ? 1 : -1;
      hover();
      return order === "come" && near;
    }
    default:
      return true;
  }
}

/** True when the player stands close enough to an interactable entity to use it. */
export function canInteract(player: Entity, e: Entity): boolean {
  const tag = e.data.interact;
  if (tag === undefined || tag === false || tag === "") return false;
  const dx = Math.abs((e.x + e.w / 2) - (player.x + player.w / 2));
  const dy = Math.abs((e.y + e.h / 2) - (player.y + player.h / 2));
  return dx <= (player.w + e.w) / 2 + 36 && dy <= (player.h + e.h) / 2 + 24;
}

/** The prompt text: data.interact as a short verb ("Talk", "Open", "Pet"), or "Talk" for true. */
export function interactLabel(e: Entity): string {
  const tag = e.data.interact;
  return typeof tag === "string" ? tag.slice(0, 16) : "Talk";
}
