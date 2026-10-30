// Small line diff for the "What it has learned" fix cards (ADR 0069): the reviewer patch
// reduced to a few hunks of removed and added lines. Pure; mod source only, never a prompt.

export interface DiffHunk {
  /** 1-based line in the original where the hunk starts. */
  at: number;
  del: string[];
  add: string[];
}

const MAX_HUNKS = 5;
const MAX_LINES = 8;
const MAX_LINE = 110;

const clip = (s: string): string => {
  const t = s.replace(/\s+$/, "");
  return t.length > MAX_LINE ? t.slice(0, MAX_LINE - 1) + "…" : t;
};

/** Line-level diff via LCS, grouped into hunks and capped so a log row stays small. */
export function diffHunks(before: string, after: string): DiffHunk[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  // Trim the shared prefix and suffix first: patches usually touch a small window.
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const x = a.slice(lo, ea);
  const y = b.slice(lo, eb);
  if (x.length * y.length > 250_000) return [{ at: lo + 1, del: x.slice(0, MAX_LINES).map(clip), add: y.slice(0, MAX_LINES).map(clip) }];
  const n = x.length;
  const m = y.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  const flush = (): void => { if (cur && (cur.del.length || cur.add.length)) hunks.push(cur); cur = null; };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { flush(); i++; j++; continue; }
    if (!cur) cur = { at: lo + i + 1, del: [], add: [] };
    if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) cur.add.push(y[j++]);
    else cur.del.push(x[i++]);
  }
  flush();
  return hunks.slice(0, MAX_HUNKS).map((h) => ({ at: h.at, del: h.del.slice(0, MAX_LINES).map(clip), add: h.add.slice(0, MAX_LINES).map(clip) }));
}
