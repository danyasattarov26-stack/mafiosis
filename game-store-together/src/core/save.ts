/*
  The save file. Versioned: every structural change bumps SAVE_VERSION and adds a migration,
  so old saves (local or cloud) are upgraded step by step when loaded.
*/
import { ECON, EXPANSIONS } from '../config/economy';
import { uid, store, storeSet } from './util';
import { rollGoals, type DailyGoal } from '../config/goals';

export const SAVE_VERSION = 5;

export interface PlacedObject {
  id: string;
  item: string;           // ItemDef id or 'office'
  x: number; z: number;   // world position of footprint centre (wall items: point on the wall)
  rot: number;            // 0..3 quarter turns
  fl?: number;            // floor (0 = ground)
  y?: number;             // wall items height
  wall?: boolean;
  // stations
  mon?: number; chair?: number; desk?: number;
  broken?: boolean;
  // shelves / fridges
  product?: string | null;
  stock?: number;
  sessions?: number;
}
export interface Box { id: string; item: string; count: number; x: number; z: number; y?: number; fl?: number; ry: number; at?: number; carrier?: string | null; product?: boolean; empty?: boolean }
export interface Trash { id: string; kind: 'trash' | 'spill'; x: number; z: number; ry: number; fl?: number }
export interface Review { stars: number; text: string; day: number; who: string }
export interface DayStats {
  sessions: number; sessionRev: number; sales: number; salesRev: number; arcadeRev: number; tips: number; spentStock: number; spentItems: number;
  served: number; lost: number; satSum: number; satN: number; xp: number; thefts: number;
  meals: number; foodRev: number; cleaned: number; repaired: number; fiveStar: number; streams: number; regulars: number; streak: number; streakNow: number; members: number; bonus: number;
}
export interface Lifetime { revenue: number; customers: number; days: number; sessions: number; meals: number; cleaned: number; caught: number; fiveStar: number; streams: number }
/** a named regular's friendship with the shop */
export interface RegularState { love: number; visits: number; vip?: boolean; gift?: boolean; wish?: boolean; lastDay: number }
export interface StaffMember { id: string; role: string; name: string; body: 'male' | 'female'; lvl?: number; xp?: number }

export interface SaveData {
  v: number;
  id: string;
  createdAt: number;
  updatedAt: number;
  shopName: string;
  money: number;
  xp: number;
  level: number;
  day: number;
  time: number;            // minutes since midnight
  open: boolean;
  dayOver: boolean;
  expansion: number;
  floor: string; wall: string; light: string;
  ownedStyles: string[];
  objects: PlacedObject[];
  inventory: Record<string, number>;
  boxes: Box[];
  trash: Trash[];
  prices: Record<string, number>;
  sessionPrice: number;
  staff: StaffMember[];
  licenses: string[];
  services: string[];
  perks: string[];
  pendingPerks: number;
  reviews: Review[];
  today: DayStats;
  lifetime: Lifetime;
  tutorial: number;
  regulars: Record<string, RegularState>;
  goals: DailyGoal[];
  achievements: string[];
  floors: number;          // storeys built (1–4, up to 7 after a rebirth)
  elevator: boolean;
  rebirths: number;
}

export const emptyDay = (): DayStats => ({ sessions: 0, sessionRev: 0, sales: 0, salesRev: 0, arcadeRev: 0, tips: 0, spentStock: 0, spentItems: 0, served: 0, lost: 0, satSum: 0, satN: 0, xp: 0, thefts: 0,
  meals: 0, foodRev: 0, cleaned: 0, repaired: 0, fiveStar: 0, streams: 0, regulars: 0, streak: 0, streakNow: 0, members: 0, bonus: 0 });
export const emptyLifetime = (): Lifetime => ({ revenue: 0, customers: 0, days: 0, sessions: 0, meals: 0, cleaned: 0, caught: 0, fiveStar: 0, streams: 0 });

/** centre of the manager's office room (back-right corner) */
export function officeSpot(expansion: number) {
  const e = EXPANSIONS[expansion];
  return { x: e.w / 2 - 1.75, z: -e.d + 1.5 };
}

export function newSave(shopName: string): SaveData {
  const o = officeSpot(0);
  const s: SaveData = {
    v: SAVE_VERSION, id: uid('s'), createdAt: Date.now(), updatedAt: Date.now(),
    shopName: shopName || 'Game Store Together',
    money: ECON.startMoney, xp: 0, level: 1, day: 1, time: ECON.dayStart, open: false, dayOver: false,
    expansion: 0, floor: 'wood', wall: 'cream', light: 'warm', ownedStyles: ['wood', 'cream', 'warm'],
    objects: [
      { id: 'office', item: 'office', x: o.x, z: o.z, rot: 0 },
      { id: uid('o'), item: 'st_laptop', x: -0.75, z: -4, rot: 0, mon: 0, chair: 0, desk: 0, sessions: 0 },
    ],
    inventory: {}, boxes: [], trash: [],
    prices: {}, sessionPrice: ECON.sessionBase,
    staff: [], licenses: [], services: [], perks: [], pendingPerks: 0,
    reviews: [], today: emptyDay(), lifetime: emptyLifetime(), tutorial: 0,
    regulars: {}, goals: [], achievements: [],
    floors: 1, elevator: false, rebirths: 0,
  };
  s.goals = rollGoals(s);
  return s;
}

// ---------- migrations: index n upgrades a v(n) save to v(n+1) ----------
const MIGRATIONS: Record<number, (s: any) => any> = {
  // v1 (early test builds) had a single "style" field and no services
  1: s => ({ ...s, floor: s.style?.floor || 'wood', wall: s.style?.wall || 'cream', light: 'warm', ownedStyles: ['wood', 'cream', 'warm'], services: s.services || [], v: 2 }),
  // v2 → v3: perks became pick-on-level-up, plus lifetime stats and the tutorial step
  2: s => ({ ...s, pendingPerks: s.pendingPerks || 0, lifetime: s.lifetime || { revenue: 0, customers: 0, days: s.day || 0 }, tutorial: s.tutorial ?? 99, v: 3 }),
  // v3 → v4: regulars, daily goals and achievements, plus more lifetime counters
  3: s => ({ ...s, regulars: s.regulars || {}, goals: s.goals || [], achievements: s.achievements || [], lifetime: { ...emptyLifetime(), ...s.lifetime }, v: 4 }),
  // v4 → v5: the office became a room (bigger, new spot), plus floors, the elevator and rebirths.
  // Anything standing where the room now is goes back to the inventory when the game loads (see clearReserved).
  4: s => {
    const o = officeSpot(s.expansion || 0);
    const objects = (s.objects || []).map((x: any) => x.item === 'office' ? { ...x, x: o.x, z: o.z, rot: 0 } : x);
    return { ...s, objects, floors: s.floors || 1, elevator: !!s.elevator, rebirths: s.rebirths || 0, v: 5 };
  },
};

export function migrate(raw: any): SaveData {
  if (!raw || typeof raw !== 'object') throw new Error('not a save');
  let s = { ...raw };
  if (!s.v) s.v = 1;
  while (s.v < SAVE_VERSION) {
    const m = MIGRATIONS[s.v];
    if (!m) throw new Error('no migration from v' + s.v);
    s = m(s);
  }
  // fill anything missing with defaults so newer fields never crash older saves
  const d = newSave(s.shopName);
  for (const k of Object.keys(d) as (keyof SaveData)[]) if (s[k] === undefined) (s as any)[k] = (d as any)[k];
  s.today = { ...emptyDay(), ...s.today };
  s.lifetime = { ...emptyLifetime(), ...s.lifetime };
  if (!s.goals?.length) s.goals = rollGoals(s);
  return s as SaveData;
}

// ---------- local storage ----------
const KEY = 'gst-save';
export function loadLocal(): SaveData | null {
  try { const raw = localStorage.getItem(KEY); return raw ? migrate(JSON.parse(raw)) : null; } catch (e) { console.warn('save load failed', e); return null; }
}
export function saveLocal(s: SaveData) { s.updatedAt = Date.now(); storeSet(KEY, s); }
export function clearLocal() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
export const hasLocal = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };

export { store };
