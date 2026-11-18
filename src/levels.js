import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
  Levels are plain data. Units are metres, y is up, the player looks down -z at yaw 0.
  box: [cx, cz, sx, sz, h, y0?]  (centre x/z, size x/z, height, base height)
  spawns: [x, z]   waves: lists of { s: spawn index, d: delay in game seconds after the wave starts }
  A wave starts when every enemy of the one before it is dead; the level is clear after the last wave.
*/
export const LEVELS = [
  {
    name: 'Corridor', size: [8, 40], wall: 4, start: [0, 17, 0],
    boxes: [
      [-3.4, 8, 1.2, 1, 4], [3.4, 8, 1.2, 1, 4],
      [-3.4, 0, 1.2, 1, 4], [3.4, 0, 1.2, 1, 4],
      [-3.4, -8, 1.2, 1, 4], [3.4, -8, 1.2, 1, 4],
      [-1.4, 4, 1, 1, 1], [1.8, -4, 1.2, 0.8, 1.1], [-1.2, -12.5, 1.4, 0.8, 1.2],
    ],
    spawns: [[-2, -17.5], [2, -17.5], [0, -15]],
    waves: [[{ s: 0 }, { s: 1, d: 0.6 }, { s: 2, d: 2 }]],
  },
  {
    name: 'Bar', size: [20, 20], wall: 4, start: [0, 8, 0],
    boxes: [
      [0, -5, 12, 1.2, 1.1],            // bar counter
      [0, -9.4, 14, 0.8, 2.4],          // back shelves
      [-7, 0, 1, 1, 4], [7, 0, 1, 1, 4], // pillars
      [-5, 3, 1.2, 1.2, 1.2], [5, 2, 1.4, 1.4, 1], [-2, 1, 1, 1, 0.9], [3.5, -1.5, 1, 1, 1.3],
      [-4, 6.5, 1.6, 1.6, 0.8], [4.5, 6, 1.6, 1.6, 0.8], // tables
    ],
    spawns: [[-4, -7.5], [4, -7.5], [-8.5, -2.5], [8.5, -3]],
    waves: [[{ s: 0 }, { s: 1, d: 0.5 }, { s: 2, d: 1.2 }, { s: 3, d: 1.8 }]],
  },
  {
    name: 'Elevator lobby', size: [22, 18], wall: 4, start: [0, 7, 0],
    boxes: [
      [-7.5, -8, 0.6, 2, 4], [-2.5, -8, 0.6, 2, 4], [2.5, -8, 0.6, 2, 4], [7.5, -8, 0.6, 2, 4], // elevator bays
      [-5, -1, 1, 1, 4], [5, -1, 1, 1, 4], [-5, 3.5, 1, 1, 4], [5, 3.5, 1, 1, 4],
      [0, 1.5, 4, 1, 1.1],              // reception desk
      [-8.5, 5, 2.5, 0.7, 0.5], [8.5, 5, 2.5, 0.7, 0.5], // benches
    ],
    spawns: [[-5, -8], [0, -8], [5, -8], [-10, -3], [10, -3]],
    waves: [[{ s: 3 }, { s: 4, d: 0.5 }, { s: 1, d: 1.2 }], [{ s: 0 }, { s: 2, d: 0.8 }]],
  },
  {
    name: 'Rooftop', size: [30, 30], wall: 1.1, start: [0, 12, 0], open: true,
    boxes: [
      [-10, -10, 4, 4, 3],              // stair hut
      [4, -6, 2, 1.5, 1.4], [8, -6, 2, 1.5, 1.4], // AC units
      [10, 8, 3, 3, 3.5],               // water tank
      [-6, 4, 1, 1, 1], [0, -1, 3, 0.6, 1], [-11, 6, 1.5, 3, 1.2], [6, 3, 1.2, 1.2, 0.9],
    ],
    spawns: [[-10, -7.4], [12, -12], [-13, -13], [13, 0], [-13, 1], [6, -12]],
    waves: [[{ s: 0 }, { s: 3, d: 1.5 }, { s: 4, d: 3 }, { s: 1, d: 4.5 }, { s: 2, d: 6 }, { s: 5, d: 7.5 }]],
  },
  {
    name: 'Hall', size: [32, 24], wall: 4, start: [0, 10, 0],
    boxes: [
      [-10, -4, 1, 1, 4], [-5, -4, 1, 1, 4], [0, -4, 1, 1, 4], [5, -4, 1, 1, 4], [10, -4, 1, 1, 4],
      [-10, 4, 1, 1, 4], [-5, 4, 1, 1, 4], [0, 4, 1, 1, 4], [5, 4, 1, 1, 4], [10, 4, 1, 1, 4],
      [-7.5, 0, 2.4, 0.7, 0.6], [7.5, 0, 2.4, 0.7, 0.6], [0, 7.5, 3, 0.8, 1], [-2.5, -8, 1.2, 1.2, 1.2], [3, -8.5, 1.2, 1.2, 1.2],
    ],
    spawns: [[-14, -10], [14, -10], [0, -11], [-14, 0], [14, 0], [-8, -11], [8, -11], [0, -6]],
    waves: [[{ s: 0 }, { s: 1, d: 0.6 }, { s: 2, d: 1.2 }], [{ s: 3 }, { s: 4, d: 0.6 }, { s: 5, d: 1.4 }], [{ s: 6 }, { s: 7, d: 0.8 }]],
  },
];

export const PHRASES = ['CLEAN CUT', 'DEAD CALM', 'STILL LIFE', 'TIME SERVED', 'HOUR ZERO'];

const COL = { wall: new THREE.Color('#f2f2f2'), prop: new THREE.Color('#e6e6e6'), floor: new THREE.Color('#c4c4c4') };

/** Axis-aligned boxes used for collision, line of sight and bullets. */
export function levelBoxes(L) {
  const out = [];
  const add = (cx, cz, sx, sz, h, y0 = 0, kind = 'prop') => out.push({ min: [cx - sx / 2, y0, cz - sz / 2], max: [cx + sx / 2, y0 + h, cz + sz / 2], kind });
  const [w, d] = L.size, t = 0.6;
  add(0, -d / 2 - t / 2, w + 2 * t, t, L.wall, 0, 'wall'); add(0, d / 2 + t / 2, w + 2 * t, t, L.wall, 0, 'wall');
  add(-w / 2 - t / 2, 0, t, d, L.wall, 0, 'wall'); add(w / 2 + t / 2, 0, t, d, L.wall, 0, 'wall');
  for (const b of L.boxes) add(b[0], b[1], b[2], b[3], b[4], b[5] || 0, b[4] >= 3.9 ? 'wall' : 'prop');
  return out;
}

export class Level {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.boxes = []; }

  build(L) {
    this.dispose();
    this.data = L;
    this.boxes = levelBoxes(L);
    const geos = [];
    for (const b of this.boxes) {
      const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
      g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      const c = b.kind === 'wall' ? COL.wall : COL.prop, n = g.attributes.position.count, cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.deleteAttribute('uv');
      geos.push(g);
    }
    const merged = mergeGeometries(geos); geos.forEach(g => g.dispose());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    const [w, d] = L.size;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w + 40, d + 40), new THREE.MeshStandardMaterial({ color: COL.floor, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.group.add(floor);
    this.bounds = Math.max(w, d) / 2 + 2;
  }

  dispose() {
    for (const o of [...this.group.children]) { o.geometry.dispose(); o.material.dispose(); this.group.remove(o); }
  }

  /** Push a vertical capsule (circle in x/z) out of every box it overlaps between y0 and y1. */
  collideCircle(p, r, y0 = 0.1, y1 = 1.8) {
    for (let it = 0; it < 2; it++) for (const b of this.boxes) {
      if (b.max[1] < y0 + 0.25 || b.min[1] > y1) continue;
      const cx = Math.max(b.min[0], Math.min(p.x, b.max[0])), cz = Math.max(b.min[2], Math.min(p.z, b.max[2]));
      let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
      else { // centre inside the box: leave by the nearest face
        const e = [p.x - b.min[0], b.max[0] - p.x, p.z - b.min[2], b.max[2] - p.z], m = Math.min(...e), i = e.indexOf(m);
        if (i === 0) p.x = b.min[0] - r; else if (i === 1) p.x = b.max[0] + r; else if (i === 2) p.z = b.min[2] - r; else p.z = b.max[2] + r;
      }
    }
    return p;
  }

  /** First hit of segment a→b against the boxes and the floor: {t, box} or null. */
  segHit(a, b, floor = true) {
    let best = 1.0000001, hit = null;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z];
    for (const bx of this.boxes) {
      let t0 = 0, t1 = best, ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(d[k]) < 1e-9) { if (o[k] < bx.min[k] || o[k] > bx.max[k]) ok = false; continue; }
        let ta = (bx.min[k] - o[k]) / d[k], tb = (bx.max[k] - o[k]) / d[k];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) ok = false;
      }
      if (ok && t0 < best) { best = t0; hit = bx; }
    }
    if (floor && d[1] < 0 && a.y > 0) { const t = -a.y / d[1]; if (t < best) { best = t; hit = 'floor'; } }
    return hit ? { t: best, box: hit } : null;
  }

  los(a, b) { return !this.segHit(a, b, false); }

  insideAny(x, z, r) {
    return this.boxes.some(b => x > b.min[0] - r && x < b.max[0] + r && z > b.min[2] - r && z < b.max[2] + r);
  }
}

/** Static check used by the build verification: every level has a start, spawns, waves, and nothing spawns in geometry. */
export function validateLevels() {
  const problems = [];
  LEVELS.forEach((L, i) => {
    const boxes = levelBoxes(L), inside = (x, z, r) => boxes.some(b => x > b.min[0] - r && x < b.max[0] + r && z > b.min[2] - r && z < b.max[2] + r);
    if (!L.spawns.length) problems.push(`level ${i + 1}: no spawn points`);
    if (!L.waves.length || !L.waves.flat().length) problems.push(`level ${i + 1}: no waves, so no exit condition`);
    L.spawns.forEach((s, j) => { if (inside(s[0], s[1], 0.35)) problems.push(`level ${i + 1}: spawn ${j} is inside geometry`); });
    L.waves.flat().forEach(w => { if (!L.spawns[w.s]) problems.push(`level ${i + 1}: wave uses missing spawn ${w.s}`); });
    if (inside(L.start[0], L.start[1], 0.35)) problems.push(`level ${i + 1}: player start is inside geometry`);
  });
  return problems;
}
