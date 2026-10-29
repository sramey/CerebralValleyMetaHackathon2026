// Short-term memory per session (ADR 0016): the last commands and the mods
import { detectMoodCommand } from "../src/ontology";
// most recently created or touched, so "make them faster" and "make it huge"
// resolve to the thing the player just meant.

export interface Recent { commands: string[]; touched: string[] }

export const newRecent = (): Recent => ({ commands: [], touched: [] });

const KEEP_COMMANDS = 5;
const KEEP_TOUCHED = 4;

export function noteCommand(r: Recent, text: string): void {
  r.commands.push(text.slice(0, 200));
  if (r.commands.length > KEEP_COMMANDS) r.commands.shift();
}

/** Mark a mod id as the most recently touched. */
export function noteTouched(r: Recent, id: string): void {
  r.touched = [id, ...r.touched.filter((t) => t !== id)].slice(0, KEEP_TOUCHED);
}

export function forget(r: Recent, id: string): void {
  r.touched = r.touched.filter((t) => t !== id);
}

/** Text block for the router and writer prompts. Empty when there is nothing to remember. */
export function recentText(r: Recent): string {
  if (r.touched.length === 0 && r.commands.length === 0) return "";
  const lines: string[] = [];
  if (r.touched.length > 0) lines.push(`Most recently touched mods, newest first: ${r.touched.join(", ")}. "it", "them", "that" and "those" mean the newest unless the request says otherwise.`);
  if (r.commands.length > 0) lines.push(`Previous commands, oldest first: ${r.commands.map((c) => `"${c}"`).join("; ")}.`);
  return lines.join("\n");
}

const PRONOUN = /\b(it|its|them|their|they|that|those|these|him|her)\b/i;

/** Id a pronoun command refers to, if the command uses one and something was touched. */
export function resolvePronoun(command: string, r: Recent): string | undefined {
  if (detectMoodCommand(command)) return undefined;
  const cleaned = command.replace(/\bmake\s+it\s+(?:rain|snow|hail|storm)\b/gi, " ");
  return PRONOUN.test(cleaned) ? r.touched[0] : undefined;
}
