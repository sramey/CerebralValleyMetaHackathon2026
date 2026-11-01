// A photo object's readable type must still draw its cut-out (ADR 0082). The renderer reads meaning
// from words inside a type name: "speak-spell-toy" contains "peak" and was drawn as a far mountain
// layer, so the toy was invisible. A slug any of those filters would claim keeps the photo-N type.
import type { Entity } from "../contract";
import { canUseSpriteSheet } from "../ontology";
import { isParallaxOrSkyEntity } from "./parallax";
import { isSetPiece } from "./setpieces";
import { isTetherGear, kindOf } from "./shapes";

/** True when an entity typed `slug` would be drawn with the photo's own cut-out texture. */
export function slugDrawsAsPhoto(slug: string): boolean {
  const e = { type: slug, solid: false, data: {} } as unknown as Entity;
  return canUseSpriteSheet(slug) && !kindOf(slug) && !isParallaxOrSkyEntity(e) && !isSetPiece(e) && !isTetherGear(e);
}
