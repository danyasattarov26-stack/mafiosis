/* Geometry of the shop and of placed objects: footprints, use spots, seats, the door, the delivery zone. */
import { EXPANSIONS, DELIVERY_ZONE } from '../config/economy';
import { ITEM, FIXED, type ItemDef } from '../config/items';
import type { PlacedObject, SaveData } from '../core/save';
import { reservedZones } from './building';

export const CELL = 0.5;
export const DOOR = { x: 0, w: 1.8, inside: { x: 0, z: -0.8 }, outside: { x: 0, z: 1.2 } };
export const SIDEWALK_Z = 1.3;
export const WALL_H = 3.2;

export function shopSize(s: { expansion: number }) { const e = EXPANSIONS[Math.min(s.expansion, EXPANSIONS.length - 1)]; return { w: e.w, d: e.d }; }
export function deliveryZone(s: { expansion: number }) {
  const { w } = shopSize(s);
  return { x0: -w / 2 + 0.25, x1: -w / 2 + 0.25 + DELIVERY_ZONE.w, z0: -0.25 - DELIVERY_ZONE.d, z1: -0.25 };
}

export interface V2 { x: number; z: number }
export interface Spot extends V2 { ry: number; fl?: number }

export function defSize(item: string): [number, number] {
  if (item === 'office') return FIXED.office.size;
  return ITEM[item]?.size || [1, 1];
}
export const rotAngle = (rot: number) => (rot & 3) * Math.PI / 2;

/** local (object space, front = +Z) → world */
export function toWorld(o: { x: number; z: number; rot: number }, lx: number, lz: number): V2 {
  const a = rotAngle(o.rot), c = Math.cos(a), s = Math.sin(a);
  return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
}
export function worldRy(o: { rot: number }, localRy: number) { return rotAngle(o.rot) + localRy; }

/** footprint rectangle in world space */
export function footprint(item: string, x: number, z: number, rot: number) {
  const [w, d] = defSize(item);
  const ww = (rot & 1 ? d : w) * CELL, dd = (rot & 1 ? w : d) * CELL;
  return { x0: x - ww / 2, x1: x + ww / 2, z0: z - dd / 2, z1: z + dd / 2 };
}

/** snap a desired centre so the footprint lies on grid lines */
export function snapCenter(item: string, x: number, z: number, rot: number) {
  const [w, d] = defSize(item);
  const cw = rot & 1 ? d : w, cd = rot & 1 ? w : d;
  const sx = (v: number, n: number) => (n % 2 ? Math.floor(v / CELL) * CELL + CELL / 2 : Math.round(v / CELL) * CELL);
  return { x: sx(x, cw), z: sx(z, cd) };
}

const overlap = (a: any, b: any, m = 0.001) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m;

/** can this item be placed here? returns null when fine, otherwise the reason */
export function placeBlocked(s: SaveData, item: string, x: number, z: number, rot: number, ignoreId?: string, fl = 0): string | null {
  const def = ITEM[item];
  const f = footprint(item, x, z, rot);
  const { w, d } = shopSize(s);
  if (f.x0 < -w / 2 - 0.001 || f.x1 > w / 2 + 0.001 || f.z0 < -d - 0.001 || f.z1 > 0.001) return 'Must be inside the shop';
  if (fl >= (s.floors || 1)) return 'Build that floor first';
  for (const z of reservedZones(s, fl)) if (overlap(f, z.r)) return z.why;
  if (def?.walkable) return null;
  if (fl === 0) {
    const door = { x0: -1.2, x1: 1.2, z0: -1.6, z1: 0 };
    if (overlap(f, door)) return 'Keep the doorway clear';
    const dz = deliveryZone(s);
    if (overlap(f, { x0: dz.x0, x1: dz.x1, z0: dz.z0, z1: dz.z1 })) return 'That’s the delivery zone';
  }
  for (const o of s.objects) {
    if (o.id === ignoreId || o.wall || (o.fl || 0) !== fl) continue;
    const od = ITEM[o.item];
    if (od?.walkable) continue;
    if (overlap(f, footprint(o.item, o.x, o.z, o.rot))) return 'Something is in the way';
  }
  // the front of stations / shelves needs a free tile to use them
  for (const u of useSpots({ item, x, z, rot } as PlacedObject)) {
    if (u.x < -w / 2 || u.x > w / 2 || u.z < -d || u.z > 0) return 'Leave room in front to use it';
    for (const zz of reservedZones(s, fl)) if (u.x > zz.r.x0 && u.x < zz.r.x1 && u.z > zz.r.z0 && u.z < zz.r.z1) return 'Leave room in front to use it';
    for (const o of s.objects) {
      if (o.id === ignoreId || o.wall || ITEM[o.item]?.walkable || (o.fl || 0) !== fl) continue;
      const g = footprint(o.item, o.x, o.z, o.rot);
      if (u.x > g.x0 && u.x < g.x1 && u.z > g.z0 && u.z < g.z1) return 'Leave room in front to use it';
    }
  }
  return null;
}

/** where a customer/staff stands to use the object (world) */
export function useSpots(o: PlacedObject): Spot[] {
  const def: ItemDef | undefined = ITEM[o.item];
  const [, dc] = defSize(o.item);
  const front = (dc * CELL) / 2;
  const mk = (lx: number, lz: number, lry = Math.PI): Spot => ({ ...toWorld(o, lx, lz), ry: worldRy(o, lry), fl: o.fl || 0 });
  if (o.item === 'office') return [mk(0, front + 0.35)];
  if (!def) return [];
  switch (def.kind) {
    case 'station': return def.build === 'console' ? [mk(-0.45, front + 0.3), mk(0.45, front + 0.3)] : [mk(0, front + 0.3)];
    case 'arcade': return [mk(0, front + 0.35)];
    case 'shelf': return def.size![1] >= 4 ? [mk(0, front + 0.35), mk(0, -front - 0.35, 0)] : [mk(0, front + 0.35)];
    case 'fridge': case 'bin': return [mk(0, front + 0.35)];
    case 'foodbar': return [mk(0.35, front + 0.4), mk(0, -front - 0.4, 0)];
    case 'counter': return [mk(0, front + 0.35)];
    default: return [];
  }
}

/** seat transforms for stations (where the hips go), facing the screen */
export function seats(o: PlacedObject): (Spot & { y: number })[] {
  return seatsLocal(o).map(p => ({ ...p, fl: o.fl || 0 }));
}
function seatsLocal(o: PlacedObject): (Spot & { y: number })[] {
  const def = ITEM[o.item];
  if (!def || def.kind !== 'station') return [];
  const at = (lz: number, y = 0) => ({ ...toWorld(o, 0, lz), ry: worldRy(o, Math.PI), y });
  switch (def.build) {
    case 'console': return [-0.45, 0.45].map(lx => ({ ...toWorld(o, lx, 0.62), ry: worldRy(o, Math.PI), y: 0 }));
    case 'pod': return [at(POD.seatZ)];
    case 'racing': return [at(RIG.seatZ)];
    case 'vr': return [at(0.15)];
    default: return [at(0.18)];
  }
}

/** shared measurements of the bigger stations (local space) */
export const POD = { W: 2.0, D: 2.5, H: 2.35, shift: -0.25, seatZ: -0.07 };
export const RIG = { seatZ: 0.42, wheelZ: -0.12, wheelY: 0.74 };

/** snack bar: where customers line up to order and where the cook stands */
export function foodSpots(o: PlacedObject) {
  const [, dc] = defSize(o.item);
  const front = (dc * CELL) / 2;
  return {
    cook: { ...toWorld(o, 0, -front - 0.4), ry: worldRy(o, 0), fl: o.fl || 0 },
    queue: (i: number) => ({ ...toWorld(o, 0.35, front + 0.4 + i * 0.75), ry: worldRy(o, Math.PI), fl: o.fl || 0 }),
  };
}

/** checkout: where the cashier stands and where the queue forms */
export function counterSpots(o: PlacedObject) {
  const [, dc] = defSize(o.item);
  const front = (dc * CELL) / 2;
  return {
    cashier: { ...toWorld(o, 0, -front - 0.45), ry: worldRy(o, 0), fl: o.fl || 0 },
    queue: (i: number) => ({ ...toWorld(o, 0.2, front + 0.45 + i * 0.75), ry: worldRy(o, Math.PI), fl: o.fl || 0 }),
    itemsAt: (i: number, n: number) => toWorld(o, -0.5 + (n <= 1 ? 0.5 : i / Math.max(1, n - 1)) * 0.9, front - 0.35),
    topY: 1.0,
  };
}

export function objectAt(s: SaveData, x: number, z: number, fl = 0): PlacedObject | null {
  for (const o of s.objects) {
    if (o.wall || (o.fl || 0) !== fl) continue;
    const f = footprint(o.item, o.x, o.z, o.rot);
    if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) return o;
  }
  return null;
}

export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
