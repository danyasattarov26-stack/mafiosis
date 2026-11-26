/*
  Grid crafting. You lay items in a 2×2 grid (3×3 at a workbench or other station) and whatever recipe
  those items make shows up as the result. Recipes don't care about the pattern, only what's in the grid
  and how much: put in exactly the ingredients (or a whole multiple of them) and nothing else.
  When several recipes fit the same items (4 planks: sticks or a workbench), you pick which one.
*/
import { RECIPES, ITEM, type Recipe } from '../shared/items';
import { matches, type Stack } from './inventory';

export interface Match { r: Recipe; times: number }

/** every recipe the grid can make right now, best fits first */
export function matchGrid(grid: (Stack | null)[], stations: Set<string>): Match[] {
  const have = new Map<string, number>();
  for (const s of grid) if (s) have.set(s.k, (have.get(s.k) ?? 0) + s.n);
  if (!have.size) return [];
  const out: Match[] = [];
  for (const r of RECIPES) {
    if (r.at === 'furnace' || !stations.has(r.at)) continue;
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
