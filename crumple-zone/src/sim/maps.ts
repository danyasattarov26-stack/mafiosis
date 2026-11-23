/*
  The three places to drive. Each map is generated the same way in the physics worker and in the renderer:
  a height grid (terrain), what the ground is made of, solid boxes (walls, ramps, buildings, tree trunks),
  roads, spawn points, AI routes and race checkpoints.
*/
export interface Box { c: [number, number, number]; h: [number, number, number]; yaw: number; pitch: number; kind: string; color?: string; m?: number[] }
export interface Road { pts: [number, number][]; width: number; closed: boolean; lines: boolean }
export interface MapDef {
  id: string; name: string; blurb: string; emoji: string;
  half: number; res: number; n: number; grid: Float32Array; surf: Uint8Array;   // surf: 0 grass, 1 asphalt, 2 concrete, 3 dirt
  boxes: Box[]; roads: Road[]; trees: [number, number, number][];
  spawns: { x: number; z: number; yaw: number }[];
  ai: [number, number][][];                      // routes AI cars follow (loops)
  checkpoints?: { x: number; z: number; yaw: number; w: number }[];
  sky: 'day' | 'dusk' | 'lab';
  lab?: { launch: { x: number; z: number; yaw: number }[] };
}
export const MAP_LIST = [
  { id: 'valley', name: 'Hillside Valley', emoji: '⛰️', blurb: 'Free roam: hills, a town, a ring road, a ramp park and traffic.' },
  { id: 'lab', name: 'Crash Lab', emoji: '🧪', blurb: 'Walls, poles, barriers and ramps. Launch cars at any speed.' },
  { id: 'race', name: 'Ridge Raceway', emoji: '🏁', blurb: 'A race circuit with checkpoints and lap times.' },
];

// ---------- helpers ----------
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
function noise2(seed: number) {
  const R = rng(seed), P = new Float32Array(512); for (let i = 0; i < 512; i++) P[i] = R();
  const h = (x: number, z: number) => P[((x * 73856093) ^ (z * 19349663)) & 511];
  return (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}
export function boxMatrix(b: Box) {
  // columns: local x, y, z axes in world space (yaw about y, then pitch about the local x)
  const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw), cp = Math.cos(b.pitch), sp = Math.sin(b.pitch);
  const X = [cy, 0, -sy], Y = [sy * sp, cp, cy * sp], Z = [sy * cp, -sp, cy * cp];
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];   // row-major 3x3, world = M · local
}

function makeGrid(half: number, res: number) { const n = Math.round((half * 2) / res); return { n, grid: new Float32Array((n + 1) * (n + 1)), surf: new Uint8Array((n + 1) * (n + 1)) }; }
export function heightAt(m: MapDef, x: number, z: number) {
  const gx = (x + m.half) / m.res, gz = (z + m.half) / m.res;
  if (gx < 0 || gz < 0 || gx >= m.n || gz >= m.n) return 0;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, N = m.n + 1, g = m.grid;
  const a = g[j * N + i], b = g[j * N + i + 1], c = g[(j + 1) * N + i], d = g[(j + 1) * N + i + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function surfAt(m: MapDef, x: number, z: number) {
  const i = Math.round((x + m.half) / m.res), j = Math.round((z + m.half) / m.res);
  if (i < 0 || j < 0 || i > m.n || j > m.n) return 0;
  return m.surf[j * (m.n + 1) + i];
}
export const GRIP = [0.72, 1.0, 0.95, 0.65];

/** flatten the terrain along a road and mark it as asphalt */
function layRoad(m: MapDef, road: Road, smooth = 12) {
  const pts = road.pts, n = pts.length;
  const hs = pts.map(([x, z]) => heightAt(m, x, z));
  // smooth the road's height so it doesn't follow every bump
  const sm = hs.map((_, i) => { let s = 0, c = 0; for (let k = -smooth; k <= smooth; k++) { const j = road.closed ? (i + k + n) % n : Math.max(0, Math.min(n - 1, i + k)); s += hs[j]; c++; } return s / c; });
  const N = m.n + 1, w = road.width / 2, edge = 6;
  const best = new Float32Array(N * N).fill(1e9), bh = new Float32Array(N * N);
  const segs = road.closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[(s + 1) % n], ha = sm[s], hb = sm[(s + 1) % n];
    const x0 = Math.min(ax, bx) - w - edge, x1 = Math.max(ax, bx) + w + edge, z0 = Math.min(az, bz) - w - edge, z1 = Math.max(az, bz) + w + edge;
    const i0 = Math.max(0, Math.floor((x0 + m.half) / m.res)), i1 = Math.min(m.n, Math.ceil((x1 + m.half) / m.res));
    const j0 = Math.max(0, Math.floor((z0 + m.half) / m.res)), j1 = Math.min(m.n, Math.ceil((z1 + m.half) / m.res));
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -m.half + i * m.res, z = -m.half + j * m.res;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      const k = j * N + i;
      if (d < best[k]) { best[k] = d; bh[k] = ha + (hb - ha) * t; }
    }
  }
  for (let k = 0; k < N * N; k++) {
    const d = best[k]; if (d > w + edge) continue;
    const t = d <= w ? 1 : 1 - (d - w) / edge, s = t * t * (3 - 2 * t);
    m.grid[k] = m.grid[k] * (1 - s) + (bh[k] - 0.02) * s;
    if (d <= w) m.surf[k] = 1;
  }
}

function circle(cx: number, cz: number, r: number, n: number, wob = 0, seed = 1): [number, number][] {
  const R = rng(seed); const ph = R() * 6;
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const rr = r + wob * Math.sin(a * 3 + ph) + wob * 0.5 * Math.sin(a * 5 + ph * 2); return [cx + Math.cos(a) * rr, cz + Math.sin(a) * rr] as [number, number]; });
}
function line(ax: number, az: number, bx: number, bz: number, step = 4): [number, number][] {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / step)); return Array.from({ length: n + 1 }, (_, i) => [ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n] as [number, number]);
}
/** Catmull-Rom through control points, closed */
function spline(ctrl: [number, number][], per = 12): [number, number][] {
  const out: [number, number][] = [], n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
const offsetPath = (pts: [number, number][], off: number, closed: boolean): [number, number][] => pts.map((p, i) => {
  const a = pts[closed ? (i - 1 + pts.length) % pts.length : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % pts.length : Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  return [p[0] - (dz / L) * off, p[1] + (dx / L) * off];
});

// ---------- maps ----------
const cache = new Map<string, MapDef>();
export function getMap(id: string): MapDef { if (!cache.has(id)) cache.set(id, id === 'lab' ? lab() : id === 'race' ? race() : valley()); return cache.get(id)!; }

function valley(): MapDef {
  const half = 400, res = 2;
  const { n, grid, surf } = makeGrid(half, res);
  const m: MapDef = { id: 'valley', name: 'Hillside Valley', blurb: '', emoji: '⛰️', half, res, n, grid, surf, boxes: [], roads: [], trees: [], spawns: [], ai: [], sky: 'day' };
  const n1 = noise2(11), n2 = noise2(23), N = n + 1;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -half + i * res, z = -half + j * res, r = Math.hypot(x, z);
    let h = n1(x / 90, z / 90) * 34 + n2(x / 35, z / 35) * 8 - 18;
    const flat = Math.max(0, Math.min(1, (r - 110) / 80));          // flat town in the middle
    h = h * flat * flat + (r > 360 ? (r - 360) * 0.8 : 0);          // hills rise at the edge
    grid[j * N + i] = h; surf[j * N + i] = 0;
  }
  // roads: a wobbly ring road, two crossing avenues, a dirt track up into the hills
  const ring: Road = { pts: circle(0, 0, 230, 160, 25, 3), width: 11, closed: true, lines: true };
  const ns: Road = { pts: line(0, -330, 0, 330), width: 12, closed: false, lines: true };
  const ew: Road = { pts: line(-330, 0, 330, 0), width: 12, closed: false, lines: true };
  const town: Road[] = [-60, 60].flatMap(v => [{ pts: line(v, -100, v, 100), width: 9, closed: false, lines: false }, { pts: line(-100, v, 100, v), width: 9, closed: false, lines: false }]);
  const dirt: Road = { pts: spline([[230, -40], [300, -120], [260, -230], [170, -280], [120, -200], [190, -120]], 14), width: 8, closed: true, lines: false };
  m.roads = [ring, ns, ew, ...town, dirt];
  for (const r of m.roads) layRoad(m, r, r === dirt ? 4 : 14);
  for (let k = 0; k < N * N; k++) if (surf[k] === 0) { /* paint the dirt track */ }
  for (const p of dirt.pts) { const i = Math.round((p[0] + half) / res), j = Math.round((p[1] + half) / res); for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const k = (j + dj) * N + i + di; if (k >= 0 && k < N * N) surf[k] = 3; } }
  // town buildings on the blocks between roads
  const R = rng(77);
  const blocks = [[-100, -60], [-60, 60], [60, 100]];
  for (const [x0, x1] of blocks) for (const [z0, z1] of blocks) {
    if (x0 === -60 && z0 === -60) { // park with the ramp in the town square
      m.boxes.push({ c: [0 + 30, 0.6, 30], h: [4, 0.3, 7], yaw: 0, pitch: -0.2, kind: 'ramp' }); continue;
    }
    for (let bx = x0 + 10; bx < x1 - 8; bx += 16) for (let bz = z0 + 10; bz < z1 - 8; bz += 16) {
      if (Math.abs(bx) < 12 || Math.abs(bz) < 12) continue;
      const hgt = 6 + R() * 22, wx = 5 + R() * 2.5, wz = 5 + R() * 2.5;
      m.boxes.push({ c: [bx, hgt / 2, bz], h: [wx, hgt / 2, wz], yaw: 0, pitch: 0, kind: 'building', color: ['#e9c46a', '#e76f51', '#a8dadc', '#f1faee', '#cdb4db', '#90be6d'][Math.floor(R() * 6)] });
    }
  }
  // ramp park in the south-west
  const park = (x: number, z: number, len: number, pitch: number, yaw = 0) => {
    const hy = 0.4, y = Math.sin(pitch) * len - Math.cos(pitch) * hy;
    m.boxes.push({ c: [x, heightAt(m, x, z) + y * 0.5, z], h: [3.5, hy, len], yaw, pitch: -pitch, kind: 'ramp' });
  };
  for (let i = 0; i < 4; i++) park(-150 + i * 14, 150, 6 + i * 1.5, 0.18 + i * 0.07, Math.PI / 2);
  park(-150, 190, 9, 0.35, -Math.PI / 2);
  for (let i = 0; i < 8; i++) m.boxes.push({ c: [-120 + i * 3.5, heightAt(m, -120 + i * 3.5, 215) + 0.5, 215], h: [0.8, 0.5, 2.5], yaw: 0, pitch: 0, kind: 'barrier' });
  // trees on grass away from roads, each with a trunk you can hit
  for (let i = 0; i < 700; i++) {
    const x = (R() - 0.5) * 2 * (half - 20), z = (R() - 0.5) * 2 * (half - 20);
    if (Math.hypot(x, z) < 110 || surfAt(m, x, z) !== 0) continue;
    let nearRoad = false; for (let dx = -8; dx <= 8 && !nearRoad; dx += 4) for (let dz = -8; dz <= 8; dz += 4) if (surfAt(m, x + dx, z + dz) !== 0) { nearRoad = true; break; }
    if (nearRoad || (x < -100 && x > -180 && z > 120 && z < 240)) continue;
    const y = heightAt(m, x, z), s = 0.8 + R() * 0.7;
    m.trees.push([x, y, z]);
    m.boxes.push({ c: [x, y + 2, z], h: [0.22 * s, 2, 0.22 * s], yaw: 0, pitch: 0, kind: 'trunk' });
    if (m.trees.length > 260) break;
  }
  m.spawns = [{ x: 3, z: -20, yaw: 0 }, { x: 230, z: 4, yaw: 0 }];
  // AI drive on the right-hand lane of the ring road, both ways
  m.ai = [offsetPath(ring.pts, -2.8, true), offsetPath([...ring.pts].reverse(), -2.8, true)];
  return m;
}

function lab(): MapDef {
  const half = 220, res = 4;
  const { n, grid, surf } = makeGrid(half, res);
  surf.fill(2);
  const m: MapDef = { id: 'lab', name: 'Crash Lab', blurb: '', emoji: '🧪', half, res, n, grid, surf, boxes: [], roads: [], trees: [], spawns: [{ x: 0, z: -60, yaw: 0 }], ai: [], sky: 'lab' };
  // targets in a row at z = 80: a wall, a pole, a barrier line, a soft tyre wall, a ramp pair
  m.boxes.push({ c: [0, 2, 90], h: [10, 2, 1], yaw: 0, pitch: 0, kind: 'concrete' });
  m.boxes.push({ c: [-30, 4, 90], h: [0.22, 4, 0.22], yaw: 0, pitch: 0, kind: 'metal' });
  for (let i = 0; i < 5; i++) m.boxes.push({ c: [30 + (i - 2) * 1.7, 0.45, 90], h: [0.8, 0.45, 0.3], yaw: 0, pitch: 0, kind: 'barrier' });
  m.boxes.push({ c: [-60, 0.6, 90], h: [6, 0.6, 0.8], yaw: 0, pitch: 0, kind: 'tire' });
  for (const [x, p] of [[60, 0.22], [72, 0.38]] as const) { const len = 7, hy = 0.4; m.boxes.push({ c: [x, Math.sin(p) * len * 0.5 - 0.3, 70], h: [3.5, hy, len], yaw: 0, pitch: -p, kind: 'ramp' }); }
  // offset wall (half of the car hits it) and a high step
  m.boxes.push({ c: [-90, 1.5, 90], h: [4, 1.5, 1], yaw: 0, pitch: 0, kind: 'concrete' });
  m.boxes.push({ c: [95, 0.35, 90], h: [6, 0.35, 4], yaw: 0, pitch: 0, kind: 'concrete' });
  // a perimeter wall
  for (const [x, z, hx, hz] of [[0, half - 5, half, 1], [0, -half + 5, half, 1], [half - 5, 0, 1, half], [-half + 5, 0, 1, half]]) m.boxes.push({ c: [x, 1.5, z], h: [hx, 1.5, hz], yaw: 0, pitch: 0, kind: 'concrete' });
  m.lab = { launch: [{ x: 0, z: -60, yaw: 0 }, { x: -30, z: -60, yaw: 0 }, { x: 30, z: -60, yaw: 0 }, { x: -60, z: -60, yaw: 0 }, { x: 62, z: -60, yaw: 0 }, { x: -92, z: -60, yaw: 0 }] };
  return m;
}

function race(): MapDef {
  const half = 300, res = 2;
  const { n, grid, surf } = makeGrid(half, res);
  const m: MapDef = { id: 'race', name: 'Ridge Raceway', blurb: '', emoji: '🏁', half, res, n, grid, surf, boxes: [], roads: [], trees: [], spawns: [], ai: [], sky: 'dusk' };
  const n1 = noise2(5), N = n + 1;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = -half + i * res, z = -half + j * res; grid[j * N + i] = n1(x / 80, z / 80) * 14 - 7 + Math.max(0, Math.hypot(x, z) - 250) * 0.6; }
  const ctrl: [number, number][] = [[0, -160], [120, -170], [190, -110], [170, -20], [90, 10], [60, 80], [150, 140], [110, 200], [-20, 190], [-80, 110], [-40, 40], [-150, 30], [-200, -60], [-150, -150], [-70, -150]];
  const track: Road = { pts: spline(ctrl, 14), width: 13, closed: true, lines: false };
  m.roads = [track];
  layRoad(m, track, 18);
  const pts = track.pts, L = pts.length;
  // tyre walls on the outside of corners
  for (let i = 0; i < L; i += 3) {
    const a = pts[(i - 3 + L) % L], b = pts[i], c = pts[(i + 3) % L];
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn) < 6) continue;
    const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz) || 1, side = turn > 0 ? 1 : -1;
    const ox = (-dz / len) * side * -12, oz = (dx / len) * side * -12;
    const x = b[0] + ox, z = b[1] + oz;
    m.boxes.push({ c: [x, heightAt(m, x, z) + 0.5, z], h: [2.2, 0.5, 0.6], yaw: Math.atan2(dx, dz), pitch: 0, kind: 'tire' });
  }
  // checkpoints every ~1/12 of the lap
  m.checkpoints = [];
  for (let k = 0; k < 12; k++) { const i = Math.floor((k / 12) * L), a = pts[i], b = pts[(i + 1) % L]; m.checkpoints.push({ x: a[0], z: a[1], yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), w: 16 }); }
  const s = pts[2], s2 = pts[3], yaw = Math.atan2(s2[0] - s[0], s2[1] - s[1]);
  m.spawns = [{ x: s[0], z: s[1], yaw }];
  m.ai = [offsetPath(pts, 0, true)];
  const R = rng(9);
  for (let i = 0; i < 400 && m.trees.length < 160; i++) {
    const x = (R() - 0.5) * 2 * (half - 15), z = (R() - 0.5) * 2 * (half - 15);
    let ok = true; for (let dx = -16; dx <= 16 && ok; dx += 8) for (let dz = -16; dz <= 16; dz += 8) if (surfAt(m, x + dx, z + dz) === 1) { ok = false; break; }
    if (!ok) continue;
    const y = heightAt(m, x, z); m.trees.push([x, y, z]); m.boxes.push({ c: [x, y + 2, z], h: [0.25, 2, 0.25], yaw: 0, pitch: 0, kind: 'trunk' });
  }
  return m;
}
