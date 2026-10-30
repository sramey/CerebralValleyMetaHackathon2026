// Forbidden-token check + esbuild TS->ESM transform for Wonder-written mods, then loop guards (ADR 0056).
import { transformSync } from "esbuild";
import ts from "typescript";
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
    return { ok: true, errors: [], js: guardLoops(out.code) };
  } catch (err) {
    return { ok: false, errors: [`compile error: ${err instanceof Error ? err.message : String(err)}`], js: "" };
  }
}

/** Iterations one loop may run per entry before the guard throws. Far above any honest per-tick loop over 500 entities. */
export const LOOP_LIMIT = 100_000;

/**
 * Give every loop in compiled mod JS an iteration guard (ADR 0056): a counter that throws once a
 * single run of the loop passes LOOP_LIMIT. A `while (true)` Wonder wrote then fails the
 * verifier (or is quarantined live) instead of hanging the server and the browser tab. Uses the
 * TypeScript compiler's AST, so strings, regexes and comments are never mistaken for loops.
 */
export function guardLoops(js: string): string {
  const f = ts.factory;
  let n = 0;
  const guardFor = (name: string): ts.Statement =>
    f.createIfStatement(
      f.createBinaryExpression(
        f.createPrefixUnaryExpression(ts.SyntaxKind.PlusPlusToken, f.createIdentifier(name)),
        ts.SyntaxKind.GreaterThanToken,
        f.createNumericLiteral(LOOP_LIMIT),
      ),
      f.createThrowStatement(f.createNewExpression(f.createIdentifier("Error"), undefined, [
        f.createStringLiteral(`a loop ran more than ${LOOP_LIMIT} times (infinite loop?)`),
      ])),
    );
  const withGuard = (body: ts.Statement, name: string): ts.Statement =>
    ts.isBlock(body) ? f.updateBlock(body, [guardFor(name), ...body.statements]) : f.createBlock([guardFor(name), body], true);
  const guardedLoop = (loop: ts.IterationStatement, name: string): ts.Statement => {
    if (ts.isForStatement(loop)) return f.updateForStatement(loop, loop.initializer, loop.condition, loop.incrementor, withGuard(loop.statement, name));
    if (ts.isWhileStatement(loop)) return f.updateWhileStatement(loop, loop.expression, withGuard(loop.statement, name));
    if (ts.isDoStatement(loop)) return f.updateDoStatement(loop, withGuard(loop.statement, name), loop.expression);
    if (ts.isForInStatement(loop)) return f.updateForInStatement(loop, loop.initializer, loop.expression, withGuard(loop.statement, name));
    if (ts.isForOfStatement(loop)) return f.updateForOfStatement(loop, loop.awaitModifier, loop.initializer, loop.expression, withGuard(loop.statement, name));
    return loop;
  };
  /** `{ let __mbLoopN = 0; <label:> loop }`: the counter restarts every time the loop is entered. */
  const counted = (stmt: ts.Statement, name: string): ts.Statement =>
    f.createBlock([
      f.createVariableStatement(undefined, f.createVariableDeclarationList(
        [f.createVariableDeclaration(name, undefined, undefined, f.createNumericLiteral(0))], ts.NodeFlags.Let)),
      stmt,
    ], true);
  const transformer: ts.TransformerFactory<ts.SourceFile> = (ctx) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isLabeledStatement(node)) {
        // Keep the label on the loop itself so `continue label` stays valid; the counter goes outside it.
        let inner: ts.Statement = node;
        const labels: ts.Identifier[] = [];
        while (ts.isLabeledStatement(inner)) { labels.push(inner.label); inner = inner.statement; }
        if (ts.isIterationStatement(inner, false)) {
          const name = `__mbLoop${++n}`;
          let out: ts.Statement = guardedLoop(ts.visitEachChild(inner, visit, ctx) as ts.IterationStatement, name);
          for (let i = labels.length - 1; i >= 0; i--) out = f.createLabeledStatement(labels[i], out);
          return counted(out, name);
        }
      }
      if (ts.isIterationStatement(node, false)) {
        const name = `__mbLoop${++n}`;
        return counted(guardedLoop(ts.visitEachChild(node, visit, ctx) as ts.IterationStatement, name), name);
      }
      return ts.visitEachChild(node, visit, ctx);
    };
    return (sf) => ts.visitNode(sf, visit) as ts.SourceFile;
  };
  const sf = ts.createSourceFile("mod.js", js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const result = ts.transform(sf, [transformer]);
  const printed = ts.createPrinter().printFile(result.transformed[0]);
  result.dispose();
  return printed;
}
