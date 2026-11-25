/* Inventory: 9 hotbar slots + 36 backpack slots, 4 armour slots and an off-hand slot. Crafting checks and uses it. */
import { ITEM, RECIPES, type Recipe } from '../shared/items';

export interface Stack { k: string; n: number; d?: number }   // item key, count, durability used
export const HOTBAR = 9, MAIN = 36, SLOTS = HOTBAR + MAIN;
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const;

export class Inventory {
  slots: (Stack | null)[] = new Array(SLOTS).fill(null);   // 0..8 hotbar, 9..44 backpack
  armor: (Stack | null)[] = [null, null, null, null];
  offhand: Stack | null = null;
  sel = 0;
  onChange: () => void = () => {};

  held() { return this.slots[this.sel]; }
  /** add items; returns how many didn't fit */
  add(k: string, n = 1): number {
    const def = ITEM[k]; if (!def) return n;
    const max = def.stack;
    for (let i = 0; i < SLOTS && n > 0; i++) { const s = this.slots[i]; if (s && s.k === k && s.n < max && !s.d) { const m = Math.min(n, max - s.n); s.n += m; n -= m; } }
    for (let i = 0; i < SLOTS && n > 0; i++) if (!this.slots[i]) { const m = Math.min(n, max); this.slots[i] = { k, n: m }; n -= m; }
    this.onChange();
    return n;
  }
  /** how many of an item (or "#tag") you carry */
  count(k: string) {
    let c = 0;
    for (const s of this.slots) if (s && matches(s.k, k)) c += s.n;
    return c;
  }
  remove(k: string, n: number) {
    for (let i = SLOTS - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i]; if (!s || !matches(s.k, k)) continue;
      const m = Math.min(n, s.n); s.n -= m; n -= m; if (s.n <= 0) this.slots[i] = null;
    }
    this.onChange();
    return n === 0;
  }
  canCraft(r: Recipe) { return Object.entries(r.in).every(([k, n]) => this.count(k) >= n); }
  craft(r: Recipe, times = 1) {
    let made = 0;
    for (let t = 0; t < times; t++) {
      if (!this.canCraft(r)) break;
      for (const [k, n] of Object.entries(r.in)) this.remove(k, n);
      const left = this.add(r.out, r.n);
      if (left) { /* the caller drops what didn't fit */ (this as any).overflow = { k: r.out, n: left }; }
      made++;
    }
    return made;
  }
  /** use up durability on the held tool; breaks it at the end */
  wear(amount = 1) {
    const s = this.held(); const def = s && ITEM[s.k]; if (!s || !def?.tool) return;
    s.d = (s.d ?? 0) + amount;
    if (s.d >= def.tool.durability) this.slots[this.sel] = null;
    this.onChange();
  }
  takeOne(i: number) { const s = this.slots[i]; if (!s) return null; s.n--; const out = { k: s.k, n: 1, d: s.d }; if (s.n <= 0) this.slots[i] = null; this.onChange(); return out; }
  all(): Stack[] { return [...this.slots, ...this.armor, this.offhand].filter(Boolean) as Stack[]; }
  clear() { this.slots.fill(null); this.armor = [null, null, null, null]; this.offhand = null; this.onChange(); }
  armorValue() { return this.armor.reduce((a, s) => a + (s ? ITEM[s.k]?.armor?.defense ?? 0 : 0), 0); }
  warmth() { return this.armor.reduce((a, s) => a + (s ? ITEM[s.k]?.armor?.warmth ?? 0 : 0), 0); }
  toJSON() { return { slots: this.slots, armor: this.armor, offhand: this.offhand, sel: this.sel }; }
  load(o: any) { if (!o) return; this.slots = (o.slots ?? []).concat(new Array(SLOTS).fill(null)).slice(0, SLOTS); this.armor = o.armor ?? [null, null, null, null]; this.offhand = o.offhand ?? null; this.sel = o.sel ?? 0; this.onChange(); }
}
export function matches(itemKey: string, want: string) {
  if (!want.startsWith('#')) return itemKey === want;
  return !!ITEM[itemKey]?.tags?.includes(want.slice(1));
}
export const recipesAt = (stations: Set<string>) => RECIPES.filter(r => stations.has(r.at));
