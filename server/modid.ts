// An edit must keep its mod's id (ADR 0016): the client replaces the mod by id,
// so a rename shows up as a flash of two mods. Wonder is told to keep it but
// sometimes renames anyway, so the server patches the id in the source.

const ID_FIELD = /(\bid\s*:\s*)(["'`])([^"'`\n]+)\2/;

/** Rewrite the first `id: "..."` in a mod source (the ModDefinition id) to `id`. Returns the source unchanged if none is found. */
export function forceModId(source: string, id: string): string {
  return source.replace(ID_FIELD, (_m, pre: string, q: string) => `${pre}${q}${id}${q}`);
}
