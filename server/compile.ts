// Forbidden-token check + esbuild TS->ESM transform for Wonder-written mods.
import { transformSync } from "esbuild";
import { FORBIDDEN_MOD_TOKENS } from "../src/contract";

export const FORBIDDEN = FORBIDDEN_MOD_TOKENS as readonly string[];

export interface CompileResult {
  ok: boolean;
  errors: string[];
  js: string;
}

/** Layer 0: reject banned tokens before compiling. Returns error strings (empty = clean). */
export function checkForbidden(source: string): string[] {
  const hits: string[] = [];
  for (const tok of FORBIDDEN) {
    if (source.includes(tok)) hits.push(`forbidden token: ${tok}`);
  }
  return hits;
}

/** Compile Wonder's TypeScript mod source to ESM JavaScript. Never throws. */
export function compileMod(source: string): CompileResult {
  const forbidden = checkForbidden(source);
  if (forbidden.length > 0) return { ok: false, errors: forbidden, js: "" };
  try {
    const out = transformSync(source, {
      loader: "ts",
      format: "esm",
    });
    // Note: esbuild rewrites `export default X` to `export { ... as default }`.
    if (!out.code || !/export\s*(default|\{)/.test(out.code)) {
      return { ok: false, errors: ["compiled output has no default export"], js: "" };
    }
    return { ok: true, errors: [], js: out.code };
  } catch (err) {
    return { ok: false, errors: [`compile error: ${err instanceof Error ? err.message : String(err)}`], js: "" };
  }
}
