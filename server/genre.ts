// Genre change (ADR 0066): "turn this into a space shooter" reshapes the world through api.setScene.
// The verifier only WARNS when a build skips it, so a mild "make this a snow level" is never forced into
// full terrain removal. Pure functions: the server logs the notes on the build stage and in the build log.

const SUBJECT = String.raw`(?:this|it|the\s+(?:game|world|level)|everything)`;
const KIND = String.raw`(?:\w+[\s-]+){0,4}?(?:game|shooter|flyer|racer|racing|simulator|adventure|runner|puzzle|rpg|platformer)\b`;
const GENRE_CHANGE = new RegExp(String.raw`\b(?:(?:turn|change|convert|transform|make|remake)\s+${SUBJECT}\s+(?:in)?to\s+(?:a|an|the)?\s*|make\s+${SUBJECT}\s+(?:a|an)\s+)${KIND}`, "i");

/** True for "turn this into a 2d space flight game"-style requests. */
export function isGenreChange(command: string): boolean {
  return GENRE_CHANGE.test(command);
}

/** Heads-up notes for a finished mod; never a rejection. */
export function genreWarnings(command: string, source: string): string[] {
  const notes: string[] = [];
  const scene = /\.setScene\s*\??\.?\(/.test(source);
  if (isGenreChange(command) && !scene) notes.push("genre change without api.setScene: the platformer ground and scenery stay");
  if (/\bvisual\s*:\s*["']shape["']/.test(source)) notes.push('data.visual "shape" makes a subject a flat square; the engine draws named things from art');
  return notes;
}
