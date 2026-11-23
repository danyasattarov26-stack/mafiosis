/*
  "Finish loop": searches for a chain of simple pieces (straight, left, right, up, down) that leads from the end
  of the track back into the station, heading the right way. Everything snaps to a 4 m grid and 3 m levels,
  so it's an A* search over (x, z, level, heading), steering clear of track that's already there.
*/
import * as THREE from 'three';
import { Track, samplePiece, type PieceId } from './track';

const MOVES: PieceId[] = ['straight', 'left', 'right', 'up', 'down'];
interface Move { id: PieceId; dx: number; dz: number; dl: number; dh: number; cells: [number, number, number][] }

// each move measured once from the real piece shapes (in grid units, facing +z)
let moves: Move[] | null = null;
function getMoves(): Move[] {
  if (moves) return moves;
  const frame = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  moves = MOVES.map(id => {
    const seg = samplePiece(id, frame, 0);
    const e = seg.end, f = new THREE.Vector3(0, 0, 1).applyQuaternion(e.q);
    const dh = Math.round(Math.atan2(f.x, f.z) / (Math.PI / 2));          // quarter turns (+1 = towards +x)
    const cells = new Map<string, [number, number, number]>();
    for (const s of seg.samples) { const c: [number, number, number] = [Math.round(s.p.x / 4), Math.round(s.p.z / 4), Math.round(s.p.y / 3)]; cells.set(c.join(), c); }
    return { id, dx: Math.round(e.p.x / 4), dz: Math.round(e.p.z / 4), dl: Math.round(e.p.y / 3), dh, cells: [...cells.values()] };
  });
  return moves;
}
// heading h: 0 = +z, 1 = +x, 2 = -z, 3 = -x ; rotate a local (x, z) offset into the world
const rot = (h: number, x: number, z: number): [number, number] => {
  switch (((h % 4) + 4) % 4) { case 0: return [x, z]; case 1: return [z, -x]; case 2: return [-x, -z]; default: return [-z, x]; }
};

export function findWayHome(track: Track, maxNodes = 60000): PieceId[] | null {
  const end = track.end, start = track.start;
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(end.q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(end.q);
  if (u.y < 0.99) return null;                                          // only from an upright, level end
  const gx = (v: number) => Math.round(v / 4), gl = (y: number) => Math.round((y - start.p.y) / 3);
  if (Math.abs(end.p.x / 4 - gx(end.p.x)) > 0.01 || Math.abs((end.p.z - start.p.z) / 4 - Math.round((end.p.z - start.p.z) / 4)) > 0.01) return null;
  const h0 = ((Math.round(Math.atan2(f.x, f.z) / (Math.PI / 2)) % 4) + 4) % 4;
  // cells the track already uses (keep a margin), except right where we start
  const used = new Set<string>();
  const total = track.length;
  for (const s of track.all()) {
    if (s.s > total - 6) continue;
    const cx = gx(s.p.x), cz = gx(s.p.z), cl = gl(s.p.y);
    for (let dl = -1; dl <= 1; dl++) used.add(`${cx},${cz},${cl + dl}`);
  }
  // goal: arrive one tile behind the station start, heading +z, at ground level; then a final straight joins it
  const goal = { x: gx(start.p.x), z: gx(start.p.z) - 1, l: 0, h: 0 };
  const sx = gx(end.p.x), sz = gx(end.p.z), sl = gl(end.p.y);
  type Node = { x: number; z: number; l: number; h: number; g: number; f: number; prev: Node | null; move: PieceId | null };
  const key = (n: { x: number; z: number; l: number; h: number }) => `${n.x},${n.z},${n.l},${n.h}`;
  const hfun = (n: { x: number; z: number; l: number; h: number }) => Math.abs(n.x - goal.x) + Math.abs(n.z - goal.z) + Math.abs(n.l - goal.l) * 2 + (n.h === goal.h ? 0 : 2);
  const open: Node[] = [{ x: sx, z: sz, l: sl, h: h0, g: 0, f: 0, prev: null, move: null }];
  open[0].f = hfun(open[0]);
  const best = new Map<string, number>([[key(open[0]), 0]]);
  const ms = getMoves();
  let count = 0;
  while (open.length && count++ < maxNodes) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const n = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (n.x === goal.x && n.z === goal.z && n.l === goal.l && n.h === goal.h) {
      const out: PieceId[] = ['straight'];
      for (let c: Node | null = n; c && c.move; c = c.prev) out.unshift(c.move);
      return out;
    }
    for (const m of ms) {
      const [ox, oz] = rot(n.h, m.dx, m.dz);
      const nx = { x: n.x + ox, z: n.z + oz, l: n.l + m.dl, h: (((n.h + m.dh) % 4) + 4) % 4 };
      if (nx.l < 0 || nx.l > 12 || Math.abs(nx.x) > 55 || Math.abs(nx.z) > 55) continue;
      // would it hit existing track?
      let blocked = false;
      for (const [cx, cz, cl] of m.cells) {
        const [wx, wz] = rot(n.h, cx, cz);
        const c = `${n.x + wx},${n.z + wz},${n.l + cl}`;
        if (used.has(c)) { blocked = true; break; }
      }
      if (blocked) continue;
      const g = n.g + (m.id === 'straight' ? 1 : m.id === 'up' || m.id === 'down' ? 2.2 : 2.1);
      const k = key(nx);
      if ((best.get(k) ?? Infinity) <= g) continue;
      best.set(k, g);
      open.push({ ...nx, g, f: g + hfun(nx) * 1.1, prev: n, move: m.id });
    }
  }
  return null;
}
