/*
  Grid crafting. Tools and armour have a shape (a pickaxe is three of the material across the top and
  two sticks down the middle); everything else only cares about which items are in the grid.
  Grid crafting. You lay items in a 2×2 grid (3×3 at a workbench or other station) and whatever recipe
  those items make shows up as the result. Recipes don't care about the pattern, only what's in the grid
  and how much: put in exactly the ingredients (or a whole multiple of them) and nothing else.
  When several recipes fit the same items (4 planks: sticks or a workbench), you pick which one.
*/
import { RECIPES, ITEM, type Recipe } from '../shared/items';
import { matches, type Stack } from './inventory';

export interface Match { r: Recipe; times: number }

/** the grid as 3 rows of 3, trimmed to the squares in use */
function trimmed(grid: (Stack | null)[]) {
  const cell = (r: number, c: number) => grid[r * 3 + c] ?? null;
  let r0 = 3, r1 = -1, c0 = 3, c1 = -1;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (cell(r, c)) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
  if (r1 < 0) return null;
  const rows: (Stack | null)[][] = [];
  for (let r = r0; r <= r1; r++) { const row: (Stack | null)[] = []; for (let c = c0; c <= c1; c++) row.push(cell(r, c)); rows.push(row); }
  return rows;
}
const fits = (k: string, want: string) => k === want || (want.startsWith('#') && matches(k, want));
/** does the grid hold this recipe's shape (as drawn, or mirrored)? returns how many times it can be made */
function shapeFits(rows: (Stack | null)[][], r: Recipe) {
  const shape = r.shape!, h = shape.length, w = Math.max(...shape.map(x => x.length));
  if (rows.length !== h || rows[0].length !== w) return 0;
  for (const mirror of [false, true]) {
    let ok = true, times = Infinity;
    for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) {
      const ch = shape[y][mirror ? w - 1 - x : x] ?? ' ', st = rows[y][x];
      if (ch === ' ') { if (st) ok = false; continue; }
      if (!st || !fits(st.k, r.key![ch])) ok = false; else times = Math.min(times, st.n);
    }
    if (ok) return times;
  }
  return 0;
}

/** every recipe the grid can make right now, best fits first */
export function matchGrid(grid: (Stack | null)[], stations: Set<string>): Match[] {
  const have = new Map<string, number>();
  for (const s of grid) if (s) have.set(s.k, (have.get(s.k) ?? 0) + s.n);
  if (!have.size) return [];
  const out: Match[] = [], rows = trimmed(grid);
  for (const r of RECIPES) {
    if (r.at === 'furnace' || !stations.has(r.at)) continue;
    if (r.shape) { const times = rows ? shapeFits(rows, r) : 0; if (times) out.push({ r, times }); continue; }
    const ins = Object.entries(r.in);
    if (ins.length > have.size) continue;
    // give each item type in the grid to one ingredient (exact names before tags)
    const sum = new Array(ins.length).fill(0);
    let ok = true;
    for (const [k, n] of have) {
      let i = ins.findIndex(([want]) => want === k);
      if (i < 0) i = ins.findIndex(([want]) => want.startsWith('#') && matches(k, want));
      if (i < 0) { ok = false; break; }
      sum[i] += n;
    }
    if (!ok || sum.some(v => v === 0)) continue;
    const times = Math.min(...ins.map(([, n], i) => Math.floor(sum[i] / n)));
    if (times < 1) continue;
    out.push({ r, times });
  }
  // exact single batches first, then the ones that use more of the grid
  const used = (m: Match) => Object.values(m.r.in).reduce((a, n) => a + n, 0) * m.times;
  const total = [...have.values()].reduce((a, b) => a + b, 0);
  return out.sort((a, b) => Number(used(b) === total) - Number(used(a) === total) || used(b) - used(a) || a.times - b.times);
}

/** take one batch of a recipe out of the grid; returns false if it no longer fits */
export function consume(grid: (Stack | null)[], r: Recipe) {
  if (r.shape) {
    // one from every square in use
    if (!grid.some(Boolean)) return false;
    for (let i = 0; i < grid.length; i++) { const st = grid[i]; if (!st) continue; st.n--; if (st.n <= 0) grid[i] = null; }
    return true;
  }
  const need = Object.entries(r.in).map(([k, n]) => ({ k, n }));
  for (const want of need) {
    for (let i = 0; i < grid.length && want.n > 0; i++) {
      const s = grid[i]; if (!s || !(s.k === want.k || (want.k.startsWith('#') && matches(s.k, want.k)))) continue;
      const m = Math.min(s.n, want.n); s.n -= m; want.n -= m; if (s.n <= 0) grid[i] = null;
    }
    if (want.n > 0) return false;
  }
  return true;
}

/** for the recipe book: which item to use for each ingredient, picking what you have most of */
export function pickIngredients(r: Recipe, count: (k: string) => number, all: () => Stack[]) {
  return Object.entries(r.in).map(([k, n]) => {
    if (!k.startsWith('#')) return { k, n, have: count(k) };
    const best = new Map<string, number>();
    for (const s of all()) if (matches(s.k, k)) best.set(s.k, (best.get(s.k) ?? 0) + s.n);
    const top = [...best].sort((a, b) => b[1] - a[1])[0];
    return { k: top?.[0] ?? k, n, have: top?.[1] ?? 0 };
  });
}
export const isItem = (k: string) => !!ITEM[k];

/** for the recipe book: where each item goes for a shaped recipe (3×3 grid positions), using what you carry */
export function shapedLayout(r: Recipe, count: (k: string) => number, all: () => Stack[]) {
  const pick: Record<string, string> = {};
  for (const [ch, want] of Object.entries(r.key!)) {
    if (!want.startsWith('#')) { pick[ch] = want; continue; }
    const best = new Map<string, number>();
    for (const st of all()) if (matches(st.k, want)) best.set(st.k, (best.get(st.k) ?? 0) + st.n);
    pick[ch] = [...best].sort((a, b) => b[1] - a[1])[0]?.[0] ?? want;
  }
  const cells: { i: number; k: string }[] = [];
  r.shape!.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') cells.push({ i: y * 3 + x, k: pick[ch] }); }));
  void count;
  return cells;
}
