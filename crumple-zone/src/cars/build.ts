/*
  Turns a blueprint into a soft-body: nodes (point masses) and beams (springs that dent and snap),
  plus wheels on swinging arms with a spring/damper, bolt-on bumpers that can tear off, and the beam
  groups that decide when a window shatters, a light breaks or the engine gets hurt.
  Pure numbers: used by the physics worker and by the renderer (which skins the body to the same nodes).
*/
import type { Spec } from './specs';

export interface NodeD { x: number; y: number; z: number; m: number; r: number; f: number; part: number }
export interface BeamD { a: number; b: number; k: number; d: number; def: number; brk: number; spring: boolean; pre?: number }
export interface WheelD { hIn: number; hOut: number; hUp: number; R: number; W: number; drive: boolean; steer: boolean; hand: boolean; side: 1 | -1; z: number }
export interface Window { id: string; beams: number[]; quads: [number, number][] }   // quads: [span, edge]
export interface Part { id: string; nodes: number[]; attach: number[] }
export interface CarDef {
  spec: Spec;
  nodes: NodeD[]; beams: BeamD[]; wheels: WheelD[];
  ring: number[][];                // station → 7 node ids [bottomC, b+, belt+, top+, top−, belt−, b−]
  hull: [number, number, number][];// outward triangles, for car-vs-car collisions
  windows: Window[];
  lights: { id: string; beams: number[]; front: boolean; side: 1 | -1 }[];
  parts: Part[];
  engine: number[];                // beams around the engine
  frame: { rear: number; front: number; left: number; right: number };
  bumpers: { front: number[]; rear: number[] };
}

// stiffness (rad/s), damping ratio, dent strain, snap strain
const CAT = {
  floor: [230, 0.1, 0.022, 0.45], side: [190, 0.1, 0.014, 0.4], top: [160, 0.1, 0.011, 0.45], diag: [170, 0.1, 0.014, 0.42],
  arm: [250, 0.15, 0.07, 0.34], hub: [250, 0.2, 0, 99], bumper: [230, 0.1, 0.04, 0.6], attach: [190, 0.1, 0.05, 0.17],
} as const;
type Cat = keyof typeof CAT;

export function buildCar(spec: Spec): CarDef {
  const nodes: NodeD[] = [], beams: BeamD[] = [];
  const pair = new Map<string, number>();
  const st = spec.stations, S = st.length;
  const node = (x: number, y: number, z: number, part = -1, r = 0.06, f = 0.5) => { nodes.push({ x, y, z, m: 0, r, f, part }); return nodes.length - 1; };
  const beam = (a: number, b: number, cat: Cat, strength = spec.strength) => {
    if (a === b) return -1;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (pair.has(key)) return pair.get(key)!;
    const [w, z, def, brk] = CAT[cat];
    beams.push({ a, b, k: w, d: z, def: def * strength, brk: brk * Math.sqrt(strength), spring: false });   // k/d hold ω/ζ until masses are known
    pair.set(key, beams.length - 1);
    return beams.length - 1;
  };
  const beamOf = (a: number, b: number) => pair.get(a < b ? `${a},${b}` : `${b},${a}`) ?? -1;

  // ---- body rings ----
  const ring: number[][] = st.map(s => [
    node(0, s.yb, s.z), node(s.wb, s.yb, s.z), node(s.wl, s.yl, s.z), node(s.wt, s.yt, s.z),
    node(-s.wt, s.yt, s.z), node(-s.wl, s.yl, s.z), node(-s.wb, s.yb, s.z),
  ]);
  const catOfEdge = (e: number): Cat => (e === 0 || e === 6 ? 'floor' : e === 3 ? 'top' : 'side');
  for (let i = 0; i < S; i++) {
    const R = ring[i];
    for (let e = 0; e < 7; e++) beam(R[e], R[(e + 1) % 7], catOfEdge(e));
    beam(R[1], R[6], 'floor'); beam(R[2], R[5], 'side');
    beam(R[1], R[5], 'diag'); beam(R[6], R[2], 'diag'); beam(R[2], R[4], 'diag'); beam(R[5], R[3], 'diag');
    beam(R[0], R[2], 'diag'); beam(R[0], R[5], 'diag'); beam(R[0], R[3], 'diag'); beam(R[0], R[4], 'diag');
    if (i < S - 1) {
      const N = ring[i + 1];
      for (let k = 0; k < 7; k++) {
        beam(R[k], N[k], k === 0 || k === 1 || k === 6 ? 'floor' : k === 3 || k === 4 ? 'top' : 'side');
        beam(R[k], N[(k + 1) % 7], 'diag'); beam(R[(k + 1) % 7], N[k], 'diag');
      }
      beam(R[1], N[4], 'diag'); beam(R[6], N[3], 'diag'); beam(R[3], N[6], 'diag'); beam(R[4], N[1], 'diag');
      beam(R[2], N[5], 'diag'); beam(R[5], N[2], 'diag');
    }
    if (i < S - 2) { const N2 = ring[i + 2]; for (const k of [0, 1, 6]) beam(R[k], N2[k], 'floor'); for (const k of [2, 5]) beam(R[k], N2[k], 'side'); }
  }

  // ---- bumpers (bolted on, can tear off) ----
  const parts: Part[] = [];
  const bumper = (front: boolean) => {
    const s = front ? st[S - 1] : st[0], R = front ? ring[S - 1] : ring[0], P = front ? ring[S - 2] : ring[1];
    const dir = front ? 1 : -1, big = spec.style === 'bus' || spec.style === 'truck';
    const ylo = s.yb + 0.02, yhi = s.yb + (big ? 0.32 : 0.24), w = Math.max(s.wb, s.wl) * 0.98;
    const id = parts.length, ids: number[] = [];
    for (const x of [w, -w]) for (const y of [ylo, yhi]) for (const dz of [0.1, -0.08]) ids.push(node(x, y, s.z + dir * dz, id));
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) beam(ids[a], ids[b], 'bumper');
    const inner = ids.filter((_, i) => i % 2 === 1);
    const attach: number[] = [];
    for (const n of inner) for (const t of [R[0], R[1], R[6], R[2], R[5], P[1], P[6]]) {
      const dx = nodes[n].x - nodes[t].x, dy = nodes[n].y - nodes[t].y, dz = nodes[n].z - nodes[t].z;
      if (Math.hypot(dx, dy, dz) < 1.4) attach.push(beam(n, t, 'attach'));
    }
    parts.push({ id: front ? 'front bumper' : 'rear bumper', nodes: ids, attach });
    return ids;
  };
  const bumpers = { front: bumper(true), rear: bumper(false) };

  // ---- wheels on swinging arms ----
  const wheels: WheelD[] = [];
  const mr = new Map<number, number>();
  const near = (z: number) => { let best = 0; for (let i = 0; i < S; i++) if (Math.abs(st[i].z - z) < Math.abs(st[best].z - z)) best = i; return best; };
  for (const ax of spec.axles) {
    const i = near(ax.z);
    const iA = Math.max(0, i - 1), iB = Math.min(S - 1, i + 1);
    for (const side of [1, -1] as const) {
      const cx = side * spec.track / 2;
      const hIn = node(cx - side * (spec.wheelW / 2 + 0.03), spec.wheelR, ax.z, -2, 0.1, 0.4);
      const hOut = node(cx + side * (spec.wheelW / 2 + 0.03), spec.wheelR, ax.z, -2, 0.1, 0.4);
      // a third point above the axle makes the hub a rigid upright, so the wheel can't flop sideways
      const hUp = node(cx - side * (spec.wheelW / 2 + 0.03), spec.wheelR + 0.3, ax.z, -2, 0.08, 0.4);
      beam(hIn, hOut, 'hub'); beam(hIn, hUp, 'hub'); beam(hOut, hUp, 'hub');
      for (const h of [hIn, hOut, hUp]) { beam(h, ring[iA][0], 'arm'); beam(h, ring[iB][0], 'arm'); }
      const top = ring[i][side > 0 ? 2 : 5];
      const sp = beam(hIn, top, 'arm'); beams[sp].spring = true;
      // motion ratio: how much the spring moves per unit of wheel travel (the arms pivot on the floor centre line)
      const pv = nodes[ring[i][0]], hi = nodes[hIn], tp = nodes[top];
      const dx = tp.x - hi.x, dy = tp.y - hi.y, dl = Math.hypot(dx, dy);
      const springArm = Math.abs((hi.x - pv.x) * (dy / dl) - (hi.y - pv.y) * (dx / dl));
      mr.set(hIn, springArm / Math.abs(cx - pv.x));
      wheels.push({ hIn, hOut, hUp, R: spec.wheelR, W: spec.wheelW, drive: ax.drive, steer: ax.steer, hand: ax.hand, side, z: ax.z });
    }
  }

  // ---- masses: body evenly, engine at one end, hubs as wheels ----
  const hubMass = spec.mass > 4000 ? 80 : 30;
  const body = nodes.filter(n => n.part !== -2);
  const tops = beams.filter(b => b.spring).map(b => b.b);            // spring mounts carry real weight (strut towers)
  const towerMass = spec.mass * 0.035;
  const bodyMass = spec.mass - spec.engineMass - hubMass * wheels.length * 2 - towerMass * tops.length;
  for (const n of body) n.m = bodyMass / body.length;
  for (const t of tops) nodes[t].m += towerMass;
  const eng = spec.engineAt === 'front' ? [S - 3, S - 2, S - 1] : [0, 1, 2];
  const engNodes = eng.flatMap(i => [ring[i][0], ring[i][1], ring[i][6], ring[i][2], ring[i][5]]);
  for (const n of engNodes) nodes[n].m += spec.engineMass / engNodes.length;
  for (const n of nodes) if (n.part === -2) n.m = hubMass;
  for (const w of wheels) nodes[w.hUp].m = hubMass * 0.5;

  // ---- beam stiffness from masses (keeps the explicit integrator stable) ----
  for (const b of beams) {
    const ma = nodes[b.a].m, mb = nodes[b.b].m, m = (2 * ma * mb) / (ma + mb);
    const w = b.k, z = b.d;
    b.k = m * w * w; b.d = 2 * z * Math.sqrt(b.k * m);
  }
  // suspension springs: soft, tuned per axle load, pre-loaded so the car sits at its design height
  const zCom = nodes.reduce((a, n) => a + n.z * n.m, 0) / nodes.reduce((a, n) => a + n.m, 0);
  const [zr, zf] = [spec.axles[0].z, spec.axles[spec.axles.length - 1].z];
  for (const w of wheels) {
    const front = Math.abs(w.z - zf) < Math.abs(w.z - zr);
    const share = front ? (zCom - zr) / (zf - zr) : (zf - zCom) / (zf - zr);
    const corner = (spec.mass * share) / 2;
    const ratio = mr.get(w.hIn) || 0.5;
    const kw = corner * (2 * Math.PI * spec.springHz) ** 2;       // wanted rate at the wheel
    const k = kw / (ratio * ratio);                                 // spring rate that gives it through the lever
    const sp = beams.find(b => b.spring && b.a === w.hIn)!;
    void 0;
    const hm = Math.min(nodes[w.hIn].m, nodes[sp.b].m);
    sp.k = Math.min(k, hm * 380 * 380);                             // stay inside what the integrator can handle
    sp.d = Math.min((2 * spec.damping * Math.sqrt(kw * corner)) / (ratio * ratio), hm * 1200 * 0.45); sp.def = 0; sp.brk = 99;
    sp.pre = ((corner * 9.81) / ratio) / sp.k * 1.05;            // pre-load so it holds the car at design height
  }

  // ---- outward hull triangles (car vs car) ----
  const hull: [number, number, number][] = [];
  const cen = (i: number) => { const s = st[i]; return [0, (s.yb + s.yt) / 2, s.z]; };
  const orient = (a: number, b: number, c: number, cx: number[]) => {
    const A = nodes[a], B = nodes[b], C = nodes[c];
    const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = (A.x - cx[0]) * nx + (A.y - cx[1]) * ny + (A.z - cx[2]) * nz;
    hull.push(out >= 0 ? [a, b, c] : [a, c, b]);
  };
  for (let i = 0; i < S - 1; i++) for (let e = 0; e < 7; e++) {
    const a = ring[i][e], b = ring[i][(e + 1) % 7], c = ring[i + 1][(e + 1) % 7], d = ring[i + 1][e];
    const cx = cen(i).map((v, k) => (v + cen(i + 1)[k]) / 2);
    orient(a, b, c, cx); orient(a, c, d, cx);
  }
  for (const [i, dz] of [[0, -1], [S - 1, 1]] as const) for (let e = 1; e < 6; e++) { const c = cen(i); c[2] -= dz; orient(ring[i][0], ring[i][e], ring[i][e + 1], c); }

  // ---- windows, lights, engine ----
  const quadBeams = (i: number, e: number) => {
    const a = ring[i][e], b = ring[i][(e + 1) % 7], c = ring[i + 1][(e + 1) % 7], d = ring[i + 1][e];
    return [beamOf(a, b), beamOf(c, d), beamOf(a, d), beamOf(b, c), beamOf(a, c), beamOf(b, d)].filter(x => x >= 0);
  };
  const windows: Window[] = [];
  for (let i = 0; i < S - 1; i++) {
    const s = st[i];
    if (s.top) windows.push({ id: s.top === 'front' ? 'windshield' : 'rear window', beams: quadBeams(i, 3), quads: [[i, 3]] });
    if (s.side) for (const e of [2, 4]) windows.push({ id: `side ${e === 2 ? 'R' : 'L'}${i}`, beams: quadBeams(i, e), quads: [[i, e]] });
  }
  const lights = ([[true, 1], [true, -1], [false, 1], [false, -1]] as const).map(([front, side]) => {
    const R = front ? ring[S - 1] : ring[0], P = front ? ring[S - 2] : ring[1];
    const ks = side > 0 ? [1, 2, 3] : [6, 5, 4];
    const ids: number[] = [];
    for (const k of ks) { ids.push(beamOf(R[k], P[k])); }
    ids.push(beamOf(R[ks[0]], R[ks[1]]), beamOf(R[ks[1]], R[ks[2]]));
    return { id: `${front ? 'head' : 'tail'}light ${side > 0 ? 'R' : 'L'}`, beams: ids.filter(x => x >= 0), front, side };
  });
  const engSet = new Set(engNodes);
  const engine = beams.map((b, i) => (engSet.has(b.a) && engSet.has(b.b) ? i : -1)).filter(i => i >= 0);
  const mid = Math.floor(S / 2);
  return {
    spec, nodes, beams, wheels, ring, hull, windows, lights, parts, engine, bumpers,
    frame: { rear: ring[1][0], front: ring[S - 2][0], left: ring[mid][1], right: ring[mid][6] },
  };
}
