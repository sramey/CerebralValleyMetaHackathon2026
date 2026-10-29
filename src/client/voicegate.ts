// Gating for push-to-talk (bug ahv): a hold that outlives any real utterance is a stuck key, and a lone stray word
// from room audio is never a command. Pure so it can be unit tested.

/** A real utterance is a few seconds; a longer hold means the key state got stuck (focus change, lost keyup). */
export const HOLD_MAX_MS = 20_000;

/** One-word commands we do accept (the recognizer's keyword list and the quick-action vocabulary). */
const ONE_WORD_OK = new Set(["undo", "redo", "rain", "coins", "spooky", "faster", "slower", "bigger", "smaller", "reset"]);

export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Whether a final transcript may be submitted as a command. */
export function voiceTextOk(text: string): boolean {
  const w = wordsOf(text);
  if (w.length >= 2) return true;
  return w.length === 1 && ONE_WORD_OK.has(w[0]);
}

/** Shift is reported up by the event itself: a key event without it while we think Shift is held means we missed the keyup. */
export function shiftStillHeld(e: { shiftKey: boolean }): boolean {
  return e.shiftKey;
}
