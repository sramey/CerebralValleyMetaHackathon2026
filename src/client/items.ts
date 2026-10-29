// Usable items and weapons helper (ADR 0023).
// Provides keybinding bindings (B / F / E / X / J), command routing for usable gear,
// and HUD keybinding indicators. Pure logic with client integration.
import type { Entity, ModDefinition } from "../contract";
import gunMod from "../mods/gun";
import basketballMod from "../mods/basketball";

export { gunMod, basketballMod };

export const ITEM_USE_KEYS = ["KeyB", "KeyF", "KeyE", "KeyX", "KeyJ"] as const;

export function isItemUseKey(code: string): boolean {
  return code === "KeyB" || code === "KeyF" || code === "KeyE" || code === "KeyX" || code === "KeyJ";
}

/** Anything that asks for a basketball / hoop / backboard, as long as it is not asking for a creature. */
const SPORTS_BALL_RE = /basketball|basket-ball|\bbasket\b|hoop|backboard|dunk|free-?throw/;
const CREATURE_RE = /\b(player|ninja|guy|man|woman|kid|child|character|monster|robot|dog|cat|team|mascot)\b/;

/**
 * Normalizes user text and returns the built-in item/weapon mod if matched.
 * Examples: "gun", "give me a gun", "hand cannon", "blaster", "weapon",
 * "add a basketball I can shoot with B", "add a basketball goal", "a hoop".
 */
export function resolveItemMod(command: string): ModDefinition | undefined {
  let n = command.trim().toLowerCase().replace(/[.!?,;:]+$/, "").trim().replace(/\s+/g, " ");
  // Strip common voice/chat prefixes
  n = n.replace(/^(?:add|make|create|spawn|build|give|put|equip|wield)\s+/, "");
  while (/^(?:a|an|the|some|me)\s+/.test(n)) {
    n = n.replace(/^(?:a|an|the|some|me)\s+/, "");
  }

  if (SPORTS_BALL_RE.test(n) && !CREATURE_RE.test(n)) return basketballMod;

  if (
    n === "gun" ||
    n === "hand cannon" ||
    n === "cannon" ||
    n === "blaster" ||
    n === "pistol" ||
    n === "rifle" ||
    n === "weapon" ||
    n === "guns" ||
    n === "laser gun"
  ) {
    return gunMod;
  }

  return undefined;
}

/**
 * Checks if the player currently has an equipped/held weapon or item.
 */
export function getHeldItem(entities: readonly Entity[]): Entity | undefined {
  return entities.find((e) => e.data.heldByPlayer === true || e.data.equipped === true);
}
