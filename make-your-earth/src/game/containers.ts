/*
  Things that hold items in the world: chests (27 slots) and furnaces (input, fuel, output).
  Each lives at a block position, is saved with the world and shared in co-op.
  A furnace smelts one item every few seconds while it has fuel; anything the old instant "furnace"
  recipes made with a single kind of input can be smelted.
*/
import { ITEM, RECIPES } from '../shared/items';
import { matches, type Stack } from './inventory';

export const CHEST_SLOTS = 27;
export const SMELT_TIME = 6;
export interface Chest { kind: 'chest'; slots: (Stack | null)[] }
export interface Furnace { kind: 'furnace'; input: Stack | null; fuel: Stack | null; out: Stack | null; burn: number; burnMax: number; cook: number }
export type Container = Chest | Furnace;

export const posKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
export const newChest = (): Chest => ({ kind: 'chest', slots: new Array(CHEST_SLOTS).fill(null) });
export const newFurnace = (): Furnace => ({ kind: 'furnace', input: null, fuel: null, out: null, burn: 0, burnMax: 0, cook: 0 });

/** what a stack smelts into (and how many it uses each time), or null */
export function smeltResult(k: string) {
  for (const r of RECIPES) {
    if (r.at !== 'furnace') continue;
    const ins = Object.entries(r.in);
    if (ins.length === 1 && matches(k, ins[0][0])) return { out: r.out, n: r.n, need: ins[0][1] };
  }
  return null;
}
export const fuelOf = (k: string) => ITEM[k]?.fuel ?? 0;

/** run a furnace for dt seconds; returns true if anything visible changed */
export function tickFurnace(f: Furnace, dt: number) {
  let changed = false;
  const res = f.input ? smeltResult(f.input.k) : null;
  const room = res && f.input!.n >= res.need && (!f.out || (f.out.k === res.out && f.out.n + res.n <= (ITEM[res.out]?.stack ?? 64)));
  if (f.burn <= 0 && room && f.fuel && fuelOf(f.fuel.k) > 0) {
    // light the next piece of fuel
    f.burnMax = f.burn = fuelOf(f.fuel.k);
    if (f.fuel.k === 'water_bucket') f.fuel = { k: 'bucket', n: 1 };
    else { f.fuel.n--; if (f.fuel.n <= 0) f.fuel = null; }
    changed = true;
  }
  if (f.burn > 0) { f.burn = Math.max(0, f.burn - dt); changed = true; }
  if (f.burn > 0 && room) {
    f.cook += dt;
    if (f.cook >= SMELT_TIME) {
      f.cook = 0;
      f.input!.n -= res!.need; if (f.input!.n <= 0) f.input = null;
      if (f.out) f.out.n += res!.n; else f.out = { k: res!.out, n: res!.n };
    }
  } else if (f.cook > 0) { f.cook = Math.max(0, f.cook - dt * 2); changed = true; }
  return changed;
}
/** everything inside (for dropping when it's broken) */
export function contents(c: Container): Stack[] {
  return (c.kind === 'chest' ? c.slots : [c.input, c.fuel, c.out]).filter(Boolean) as Stack[];
}
