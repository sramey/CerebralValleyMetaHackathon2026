// Bounded parallel runner for compound commands (ADR 0016). Every item runs,
// at most `limit` at a time; one item throwing never stops the others.

export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<{ failed: number }> {
  let next = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try { await fn(items[i], i); } catch { failed++; }
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return { failed };
}
