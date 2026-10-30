// Which "faster" / "jump higher" asks the client may answer itself (bead 5w1, ADR 0058 note).
// The local shortcut sets the player's speed or jump with no server call, so it is only right when
// the ask is about the player. A pronoun ("make them faster") or a named thing ("make the slimes
// faster", "make the dragon slower") names a mod the server knows about, so it goes there: the
// route rules pick the mod, and the player is never sped up by mistake (bugs cps, 1e6).

/** Words that make an ask explicitly about the player. */
const ABOUT_PLAYER = /\b(?:me|my|mine|myself|i|player|character|hero|ninja|avatar)\b/;
/** "make/let <somebody other than me>": the ask has a subject the server has to resolve. */
const OTHER_SUBJECT = /\b(?:make|let)\s+(?!me\b|my\b|us\b|myself\b)[a-z]/;

export type LocalAsk = "speed" | "jump";

/**
 * The player-only shortcut this text asks for, or null when the server should read it.
 * With the server up, only an ask about the player (or with no subject at all, "jump higher",
 * "go faster") is local. Offline, anything that is not a pronoun ask stays local, as before.
 */
export function localRelativeAsk(text: string, serverUp: boolean): LocalAsk | null {
  const t = text.toLowerCase();
  const kind: LocalAsk | null = t.includes("jump higher") ? "jump" : t.includes("faster") ? "speed" : null;
  if (!kind) return null;
  if (ABOUT_PLAYER.test(t)) return kind;
  if (/\b(?:it|them|they|those|these|that)\b/.test(t)) return null; // a pronoun means the mod touched last
  if (serverUp && OTHER_SUBJECT.test(t)) return null;
  return kind;
}
