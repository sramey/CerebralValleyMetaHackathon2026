// Broad phase for World.step (engine review, ADR 0057): a uniform grid over the solids
// that cannot move during the physics pass, so a mover only tests the solids near it.
// Pure and deterministic: queries return solid indices in ascending order, so collision
// resolves against the same solids in the same order as a full scan would.

type Box = { x: number; y: number; w: number; h: number };

const CELL = 128;
/** A solid spanning more cells than this on either axis is tested on every query instead. */
const MAX_SPAN = 64;

export class SolidGrid {
  private cells = new Map<number, number[]>();
  /** Solids tested on every query: movers (gravity), huge or non-finite boxes. Ascending. */
  private always: number[] = [];
  private solids: readonly Box[] = [];
  /** Cell range each gridded solid was filed under, so a moved solid can be re-filed. */
  private filed: ({ x0: number; x1: number; y0: number; y1: number } | null)[] = [];

  /** Index `solids` at their current positions. */
  build(solids: readonly Box[]): void {
    this.cells.clear();
    this.always = [];
    this.filed = [];
    this.solids = solids;
    for (let i = 0; i < solids.length; i++) this.file(i);
  }

  /** Re-file solid `i` after it moved, so later queries in the same pass see where it is now. */
  update(i: number): void {
    const r = this.filed[i];
    if (r) {
      for (let cx = r.x0; cx <= r.x1; cx++) for (let cy = r.y0; cy <= r.y1; cy++) {
        const list = this.cells.get(key(cx, cy));
        if (list) { const at = list.indexOf(i); if (at >= 0) list.splice(at, 1); }
      }
    } else {
      const at = this.always.indexOf(i);
      if (at >= 0) this.always.splice(at, 1);
    }
    this.file(i);
  }

  private file(i: number): void {
    const s = this.solids[i];
    this.filed[i] = null;
    if (!Number.isFinite(s.x + s.y + s.w + s.h)) { insertSorted(this.always, i); return; }
    const x0 = Math.floor(s.x / CELL), x1 = Math.floor((s.x + s.w) / CELL);
    const y0 = Math.floor(s.y / CELL), y1 = Math.floor((s.y + s.h) / CELL);
    if (x1 - x0 > MAX_SPAN || y1 - y0 > MAX_SPAN) { insertSorted(this.always, i); return; }
    this.filed[i] = { x0, x1, y0, y1 };
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = key(cx, cy);
      const list = this.cells.get(k);
      if (list) list.push(i); else this.cells.set(k, [i]);
    }
  }

  /** Indices (ascending) of every solid that could overlap `b`: a superset, callers still test overlap. */
  query(b: Box): number[] {
    if (!Number.isFinite(b.x + b.y + b.w + b.h)) return this.solids.map((_, i) => i);
    const x0 = Math.floor(b.x / CELL), x1 = Math.floor((b.x + b.w) / CELL);
    const y0 = Math.floor(b.y / CELL), y1 = Math.floor((b.y + b.h) / CELL);
    if (x1 - x0 > MAX_SPAN || y1 - y0 > MAX_SPAN) return this.solids.map((_, i) => i);
    const out: number[] = [...this.always];
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const list = this.cells.get(key(cx, cy));
      if (list) for (const i of list) out.push(i);
    }
    out.sort((a, b2) => a - b2);
    let n = 0;
    for (let i = 0; i < out.length; i++) if (i === 0 || out[i] !== out[i - 1]) out[n++] = out[i];
    out.length = n;
    return out;
  }
}

function insertSorted(a: number[], v: number): void {
  let at = a.length;
  while (at > 0 && a[at - 1] > v) at--;
  a.splice(at, 0, v);
}

function key(cx: number, cy: number): number {
  return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
}
