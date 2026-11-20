/*
  The building's vertical layout: storeys, the switchback stairs, the elevator shaft and the manager's office room.
  Pure geometry shared by the simulation (NPC routes), the player (what you stand on) and the visuals.

  Stairs live in the back-left corner as two side-by-side lanes. The flight from floor k to k+1 runs in lane A
  (going back) when k is even and lane B (coming forward) when k is odd, so every flight starts right next to
  where the previous one ended. Floor k (k ≥ 1) has a hole over the lane of the flight coming up from below.
*/
import type { SaveData, PlacedObject } from '../core/save';
import { STOREYS } from '../config/economy';
import { shopSize, toWorld, defSize, CELL, type V2 } from './layout';

export const FLOOR_H = 3.5;            // storey height: 3.2 m rooms + 0.3 m slab
export const SLAB = 0.3;
export const LANE = 1.15;               // stair lane width
export const RUN = 4.4;                 // horizontal length of one flight (≈38°)
export const LANDING = 1.0;             // free floor at each end of the flights

export const floorY = (fl: number) => fl * FLOOR_H;
export const floorOfY = (y: number) => Math.max(0, Math.floor((y + 0.6) / FLOOR_H));
export const maxFloors = (s: { rebirths?: number }) => ((s.rebirths || 0) > 0 ? 7 : 4);
export const nextStorey = (s: { floors?: number }) => STOREYS.find(f => f.n === (s.floors || 1) + 1) || null;

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Stairs {
  x0: number; zBack: number; zFront: number;
  laneX: (lane: 0 | 1) => [number, number];
  laneOf: (k: number) => 0 | 1;             // lane of the flight from floor k up to k+1
  zone: Rect;                               // reserved on every floor (flights + both landings)
  hole: (k: number) => Rect | null;         // opening in floor k's slab
  flightY: (k: number, z: number) => number;
  bottom: (k: number) => V2;                // where you step onto flight k (on floor k)
  top: (k: number) => V2;                   // where you step off flight k (on floor k+1)
  start: (k: number) => V2;                 // first point on the flight
  end: (k: number) => V2;                   // last point on the flight
}

export function stairs(s: SaveData): Stairs | null {
  if ((s.floors || 1) < 2) return null;
  const { w, d } = shopSize(s);
  const x0 = -w / 2;
  const zBack = -d + LANDING, zFront = zBack + RUN;
  const laneX = (lane: 0 | 1): [number, number] => [x0 + lane * LANE, x0 + (lane + 1) * LANE];
  const laneOf = (k: number) => (k % 2 === 0 ? 0 : 1) as 0 | 1;
  const cx = (lane: 0 | 1) => x0 + (lane + 0.5) * LANE;
  const goesBack = (k: number) => laneOf(k) === 0;
  return {
    x0, zBack, zFront, laneX, laneOf,
    zone: { x0, x1: x0 + 2 * LANE + 0.1, z0: -d, z1: zFront + LANDING },
    hole: k => { if (k < 1) return null; const [a, b] = laneX(laneOf(k - 1)); return { x0: a, x1: b, z0: zBack, z1: zFront }; },
    flightY: (k, z) => {
      const t = goesBack(k) ? (zFront - z) / RUN : (z - zBack) / RUN;
      return floorY(k) + Math.min(1, Math.max(0, t)) * FLOOR_H;
    },
    bottom: k => ({ x: cx(laneOf(k)), z: goesBack(k) ? zFront + 0.45 : zBack - 0.45 }),
    top: k => ({ x: cx(laneOf(k)), z: goesBack(k) ? zBack - 0.45 : zFront + 0.45 }),
    start: k => ({ x: cx(laneOf(k)), z: goesBack(k) ? zFront : zBack }),
    end: k => ({ x: cx(laneOf(k)), z: goesBack(k) ? zBack : zFront }),
  };
}

/** elevator shaft next to the stairs, against the back wall; the door faces the shop */
export function elevator(s: SaveData) {
  if (!s.elevator || (s.floors || 1) < 2) return null;
  const { w, d } = shopSize(s);
  const x0 = -w / 2 + 2 * LANE + 0.25, x1 = x0 + 1.5;
  const cx = (x0 + x1) / 2;
  return {
    shaft: { x0, x1, z0: -d, z1: -d + 1.5 } as Rect,
    zone: { x0, x1, z0: -d, z1: -d + 2.3 } as Rect,
    door: { x: cx, z: -d + 1.5 },
    inside: { x: cx, z: -d + 0.75 },
    entry: { x: cx, z: -d + 1.95 },
  };
}

const inRect = (x: number, z: number, r: Rect | null) => !!r && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 - 0.001 && a.x1 > b.x0 + 0.001 && a.z0 < b.z1 - 0.001 && a.z1 > b.z0 + 0.001;

/** zones nobody may build in on a given floor (stairs, elevator, the office on the ground floor) */
export function reservedZones(s: SaveData, fl: number): { r: Rect; why: string }[] {
  const out: { r: Rect; why: string }[] = [];
  const st = stairs(s); if (st) out.push({ r: st.zone, why: 'Keep the stairs clear' });
  const el = elevator(s); if (el) out.push({ r: el.zone, why: 'Keep the elevator clear' });
  void fl;
  return out;
}

/** the height you'd stand on at (x, z) when your feet are at y */
export function groundAt(s: SaveData, x: number, z: number, y: number): number {
  const floors = s.floors || 1;
  if (floors < 2) return 0;
  const { w, d } = shopSize(s);
  const insideBuilding = x > -w / 2 - 0.05 && x < w / 2 + 0.05 && z > -d - 0.05 && z < 0.05;
  if (!insideBuilding) return 0;
  const st = stairs(s)!;
  let best = 0;
  const take = (h: number) => { if (h <= y + 0.6 && h > best) best = h; };
  for (let k = 1; k < floors; k++) if (!inRect(x, z, st.hole(k))) take(floorY(k));
  if (z >= st.zBack - 0.01 && z <= st.zFront + 0.01) {
    for (let k = 0; k < floors - 1; k++) {
      const [a, b] = st.laneX(st.laneOf(k));
      if (x >= a && x <= b) take(st.flightY(k, z));
    }
  }
  return best;
}

/** the manager's office: a room in the back-right corner of the ground floor */
export const OFFICE = { w: 3.5, d: 3.0, door: [-1.6, -0.6] as [number, number], wall: 0.1 };
export function officeWalls(o: PlacedObject): Rect[] {
  const hw = OFFICE.w / 2, hd = OFFICE.d / 2, t = OFFICE.wall;
  const loc: Rect[] = [
    { x0: -hw, x1: OFFICE.door[0], z0: hd - t, z1: hd },          // front wall, left of the door
    { x0: OFFICE.door[1], x1: hw, z0: hd - t, z1: hd },           // front wall, right of the door
    { x0: -hw, x1: -hw + t, z0: -hd, z1: hd },                    // side wall facing the shop (with a window)
  ];
  // furniture you bump into: desk + chair, bookshelf, armchair, side table
  loc.push({ x0: -1.0, x1: 0.5, z0: -hd, z1: -0.6 }, { x0: hw - 0.55, x1: hw, z0: -1.15, z1: -0.3 }, { x0: hw - 1.1, x1: hw, z0: 0.0, z1: 0.9 }, { x0: 0.0, x1: 1.0, z0: hd - 0.55, z1: hd });
  return loc.map(r => {
    const a = toWorld(o, r.x0, r.z0), b = toWorld(o, r.x1, r.z1);
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
  });
}

/**
 * Objects standing where the stairs, elevator or office now go are put back in the inventory
 * (after an expansion, a new floor, the elevator or an old save). Returns how many moved.
 */
export function clearReserved(s: SaveData, returnItem: (o: PlacedObject) => void): number {
  let moved = 0;
  const office = s.objects.find(o => o.item === 'office');
  for (const o of [...s.objects]) {
    if (o.item === 'office' || o.wall) continue;
    const [cw, cd] = defSize(o.item);
    const ww = (o.rot & 1 ? cd : cw) * CELL, dd = (o.rot & 1 ? cw : cd) * CELL;
    const f = { x0: o.x - ww / 2, x1: o.x + ww / 2, z0: o.z - dd / 2, z1: o.z + dd / 2 };
    const fl = o.fl || 0;
    let hit = reservedZones(s, fl).some(z => overlaps(f, z.r));
    if (!hit && fl === 0 && office) {
      const [ow, od] = defSize('office');
      const of = { x0: office.x - ow * CELL / 2, x1: office.x + ow * CELL / 2, z0: office.z - od * CELL / 2, z1: office.z + od * CELL / 2 };
      hit = overlaps(f, of);
    }
    if (fl >= (s.floors || 1)) hit = true;
    if (hit) { s.objects.splice(s.objects.indexOf(o), 1); returnItem(o); moved++; }
  }
  return moved;
}

/** walking distance-ish between two spots that may be on different floors */
export const distF = (a: V2 & { fl?: number }, b: V2 & { fl?: number }) => Math.hypot(a.x - b.x, a.z - b.z) + Math.abs((a.fl || 0) - (b.fl || 0)) * 8;
