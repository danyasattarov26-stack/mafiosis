/*
  Draws a soft-body car. The body is a smooth skin stretched over the physics nodes: every vertex is a
  point on one of the node quads (bilinear in u, v) pushed out along that quad's normal, so when the
  physics dents a quad, the paint dents with it. Glass, lights, trim, bumpers and wheels follow the same nodes.
*/
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarDef } from '../cars/build';

const UV5 = [0, 0.1, 0.5, 0.9, 1];

/** a quad of four node ids: A (u0 v0), B (u1 v0), C (u1 v1), D (u0 v1) */
type Quad = [number, number, number, number];
interface Sample { q: Quad; u: number; v: number; bulge: number; lift: number }

/** writes the skinned point for a sample into out[o..o+2]; also returns the quad normal in nrm */
const nrm = new Float32Array(3);
function samplePoint(P: ArrayLike<number>, s: Sample, out: Float32Array, o: number) {
  const [A, B, C, D] = s.q, u = s.u, v = s.v;
  const a = A * 3, b = B * 3, c = C * 3, d = D * 3;
  const w0 = (1 - u) * (1 - v), w1 = u * (1 - v), w2 = u * v, w3 = (1 - u) * v;
  let x = P[a] * w0 + P[b] * w1 + P[c] * w2 + P[d] * w3;
  let y = P[a + 1] * w0 + P[b + 1] * w1 + P[c + 1] * w2 + P[d + 1] * w3;
  let z = P[a + 2] * w0 + P[b + 2] * w1 + P[c + 2] * w2 + P[d + 2] * w3;
  const off = s.bulge + s.lift;
  if (off !== 0) {
    const dux = (1 - v) * (P[b] - P[a]) + v * (P[c] - P[d]), duy = (1 - v) * (P[b + 1] - P[a + 1]) + v * (P[c + 1] - P[d + 1]), duz = (1 - v) * (P[b + 2] - P[a + 2]) + v * (P[c + 2] - P[d + 2]);
    const dvx = (1 - u) * (P[d] - P[a]) + u * (P[c] - P[b]), dvy = (1 - u) * (P[d + 1] - P[a + 1]) + u * (P[c + 1] - P[b + 1]), dvz = (1 - u) * (P[d + 2] - P[a + 2]) + u * (P[c + 2] - P[b + 2]);
    let nx = duy * dvz - duz * dvy, ny = duz * dvx - dux * dvz, nz = dux * dvy - duy * dvx;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-9) { nx /= l; ny /= l; nz /= l; x += nx * off; y += ny * off; z += nz * off; nrm[0] = nx; nrm[1] = ny; nrm[2] = nz; }
  }
  out[o] = x; out[o + 1] = y; out[o + 2] = z;
}

let crackTex: THREE.Texture | null = null;
function cracks() {
  if (crackTex) return crackTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(30,40,46,0.55)'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(235,245,255,0.9)'; g.lineWidth = 1.2;
  let seed = 7; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 3; k++) {
    const cx = 20 + R() * 88, cy = 20 + R() * 88;
    for (let i = 0; i < 11; i++) {
      let x = cx, y = cy, a = R() * Math.PI * 2;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 6; s++) { a += (R() - 0.5) * 0.7; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
      g.stroke();
    }
    for (let r = 6; r < 40; r += 9) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  }
  crackTex = new THREE.CanvasTexture(c); crackTex.colorSpace = THREE.SRGBColorSpace;
  return crackTex;
}

export interface CarState {
  pos: Float32Array; wheels: Float32Array; fwd: number[]; up: number[]; com: number[];
  windows: string[]; lights: string[]; parts: string[]; health: number; speed: number; brake: number;
}

const BIG = new Set(['bus', 'truck']);

export class CarView {
  group = new THREE.Group();
  comRest: THREE.Vector3;
  private body: THREE.Mesh; private bodyS: Sample[] = [];
  private under: THREE.Mesh; private underS: Sample[] = [];
  private glass: THREE.Mesh; private broken: THREE.Mesh; private glassS: Sample[] = []; private glassWin: number[] = [];
  private decal: THREE.Mesh; private decalS: Sample[] = [];
  private lamps: THREE.Mesh; private lampS: Sample[] = []; private lampInfo: { id: string; front: boolean; n: number }[] = [];
  private bumpers: { mesh: THREE.Mesh; nodes: number[] }[] = [];
  private wheelObjs: THREE.Group[] = [];
  private interior = new THREE.Group();
  private paint: THREE.MeshStandardMaterial;
  private brokenSet = new Set<string>();
  private lightsBroken = new Set<string>();
  readonly windowIds: string[];

  constructor(public def: CarDef, color: string, env: THREE.Texture | null, shadows: boolean) {
    const spec = def.spec, S = def.ring.length, ring = def.ring, big = BIG.has(spec.style);
    let mx = 0, my = 0, mz = 0, M = 0;
    for (const n of def.nodes) { mx += n.x * n.m; my += n.y * n.m; mz += n.z * n.m; M += n.m; }
    this.comRest = new THREE.Vector3(mx / M, my / M, mz / M);
    this.paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.35, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.9 });

    // ---- painted skin over the five upper edges (b+ → belt+ → top+ → top− → belt− → b−) ----
    const winAt = new Map<string, number>();
    def.windows.forEach((w, wi) => { for (const [i, e] of w.quads) winAt.set(`${i},${e}`, wi); });
    const bulgeOf = [0, big ? 0.025 : 0.06, big ? 0.01 : 0.02, big ? 0.02 : 0.045, big ? 0.01 : 0.02, big ? 0.025 : 0.06, 0];
    const taper = (i: number) => (i === 0 || i === S - 1 ? 0 : i === 1 || i === S - 2 ? 0.7 : 1);
    const sideQuad = (i: number, e: number): Quad => [ring[i][e], ring[i][(e + 1) % 7], ring[i + 1][(e + 1) % 7], ring[i + 1][e]];
    const rows = (S - 1) * 4 + 1, cols = 5 * 4 + 1;
    for (let r = 0; r < rows; r++) {
      const seg = Math.min(Math.floor(r / 4), S - 2), v = UV5[r - seg * 4];
      for (let c = 0; c < cols; c++) {
        const ei = Math.min(Math.floor(c / 4), 4), u = UV5[c - ei * 4], e = ei + 1;
        const tp = taper(seg) * (1 - v) + taper(seg + 1) * v;
        this.bodyS.push({ q: sideQuad(seg, e), u, v, bulge: bulgeOf[e] * Math.sin(Math.PI * u) * tp, lift: 0 });
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const seg = Math.floor(r / 4), e = 1 + Math.floor(c / 4), lr = r % 4, lc = c % 4;
      if (winAt.has(`${seg},${e}`) && (lr === 1 || lr === 2) && (lc === 1 || lc === 2)) continue;   // window opening
      const a = r * cols + c, b = a + 1, cc = a + cols + 1, d = a + cols;
      idx.push(a, b, cc, a, cc, d);
    }
    // ---- nose and tail caps (lower panel, upper panel, bottom wedge) ----
    const capQuads = (front: boolean) => {
      const R = front ? ring[S - 1] : ring[0];
      const lo: Quad = front ? [R[6], R[1], R[2], R[5]] : [R[1], R[6], R[5], R[2]];
      const hi: Quad = front ? [R[5], R[2], R[3], R[4]] : [R[2], R[5], R[4], R[3]];
      return { lo, hi };
    };
    const capSamples = (q: Quad, bulge: number, U: number[], V: number[]) => {
      const base = this.bodyS.length;
      for (const v of V) for (const u of U) this.bodyS.push({ q, u, v, bulge: bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), lift: 0 });
      for (let j = 0; j < V.length - 1; j++) for (let i = 0; i < U.length - 1; i++) {
        const a = base + j * U.length + i, b = a + 1, c = a + U.length + 1, d = a + U.length;
        idx.push(a, b, c, a, c, d);
      }
    };
    const CU = [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1], CV = [0, 0.33, 0.66, 1];
    for (const front of [true, false]) {
      const { lo, hi } = capQuads(front);
      capSamples(lo, big ? 0.03 : 0.09, CU, CV);
      capSamples(hi, big ? 0.02 : 0.05, CU, CV);
    }
    this.body = this.makeMesh(this.bodyS, idx, this.paint);
    this.body.castShadow = shadows;

    // ---- underside (dark) ----
    const uidx: number[] = [];
    for (let i = 0; i < S; i++) for (const k of [6, 0, 1]) this.underS.push({ q: [ring[i][k], ring[i][k], ring[i][k], ring[i][k]], u: 0, v: 0, bulge: 0, lift: 0 });
    for (let i = 0; i < S - 1; i++) for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = a + 1, c = a + 4, d = a + 3; uidx.push(a, d, c, a, c, b); }
    for (const [i] of [[0], [S - 1]]) { const a = i * 3; uidx.push(a, a + 1, a + 2); }
    this.under = this.makeMesh(this.underS, uidx, new THREE.MeshStandardMaterial({ color: '#1b1b1f', roughness: 0.9, side: THREE.DoubleSide }));

    // ---- glass ----
    const G3 = [0.1, 0.5, 0.9], gidx: number[] = [], guv: number[] = [];
    def.windows.forEach((w, wi) => {
      const [i, e] = w.quads[0], q = sideQuad(i, e);
      const base = this.glassS.length;
      const tp0 = taper(i), tp1 = taper(i + 1);
      for (const v of G3) for (const u of G3) {
        const tp = tp0 * (1 - v) + tp1 * v;
        this.glassS.push({ q, u, v, bulge: bulgeOf[e] * Math.sin(Math.PI * u) * tp, lift: 0.006 });
        this.glassWin.push(wi); guv.push((u - 0.1) / 0.8, (v - 0.1) / 0.8);
      }
      for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) { const a = base + j * 3 + k; gidx.push(a, a + 1, a + 4, a, a + 4, a + 3); }
    });
    this.windowIds = def.windows.map(w => w.id);
    const glassMat = new THREE.MeshStandardMaterial({ color: '#16242c', roughness: 0.06, metalness: 0.7, envMap: env, envMapIntensity: 1.3 });
    const brokenMat = new THREE.MeshStandardMaterial({ map: cracks(), transparent: true, roughness: 0.4, metalness: 0.2, depthWrite: false });
    this.glass = this.makeMesh(this.glassS, gidx, glassMat, guv);
    this.broken = this.makeMesh(this.glassS, gidx, brokenMat, guv);
    this.broken.renderOrder = 2;

    // ---- trim decals (grille, plate, stripes) and lamps ----
    const didx: number[] = [], dcol: number[] = [];
    const front = capQuads(true), rear = capQuads(false);
    const capBulge = (u: number, v: number, b: number) => b * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    // cap decals need the cap's two-way bulge, so add them by hand
    const capRect = (list: Sample[], ids: number[], cols: number[], q: Quad, b: number, u0: number, u1: number, v0: number, v1: number, color: string, lift = 0.012) => {
      const base = list.length, col = new THREE.Color(color);
      const U = [u0, (u0 + u1) / 2, u1];
      for (const v of [v0, v1]) for (const u of U) { list.push({ q, u, v, bulge: capBulge(u, v, b), lift }); cols.push(col.r, col.g, col.b); }
      for (let k = 0; k < 2; k++) { const a = base + k; ids.push(a, a + 1, a + 4, a, a + 4, a + 3); }
    };
    const loB = big ? 0.03 : 0.09;
    const trim = spec.style === 'muscle' ? '#c9ccd1' : '#141416';
    if (spec.engineAt === 'front') capRect(this.decalS, didx, dcol, front.lo, loB, 0.33, 0.67, 0.25, 0.8, trim);
    else capRect(this.decalS, didx, dcol, rear.lo, loB, 0.3, 0.7, 0.15, 0.55, '#141416');
    capRect(this.decalS, didx, dcol, rear.lo, loB, 0.41, 0.59, big ? 0.6 : 0.3, big ? 0.75 : 0.62, '#f2f2e6');   // number plate
    if (spec.style !== 'bus') capRect(this.decalS, didx, dcol, front.lo, loB, 0.41, 0.59, 0.05, 0.22, '#f2f2e6');
    const stripe = spec.colors[1] === color ? spec.colors[4] : (spec.style === 'muscle' ? '#f5f5f5' : spec.colors[1]);
    for (let i = 0; i < S - 1; i++) {
      const s = spec.stations[i];
      const tp0 = taper(i), tp1 = taper(i + 1);
      if (spec.style === 'muscle' && !s.top) for (const [u0, u1] of [[0.36, 0.45], [0.55, 0.64]]) addStripe(this.decalS, didx, dcol, sideQuad(i, 3), u0, u1, bulgeOf[3], tp0, tp1, stripe);
      if (spec.style === 'coupe') for (const e of [1, 5]) addStripe(this.decalS, didx, dcol, sideQuad(i, e), e === 1 ? 0.62 : 0.28, e === 1 ? 0.72 : 0.38, bulgeOf[e], tp0, tp1, stripe);
      if (spec.style === 'bus') for (const e of [1, 5]) addStripe(this.decalS, didx, dcol, sideQuad(i, e), e === 1 ? 0.7 : 0.2, e === 1 ? 0.8 : 0.3, bulgeOf[e], tp0, tp1, stripe);
      if (spec.style === 'truck' && !s.side && i > 0 && i < 5) for (const e of [2, 4]) addStripe(this.decalS, didx, dcol, sideQuad(i, e), 0.3, 0.55, bulgeOf[e], tp0, tp1, stripe);
    }
    function addStripe(list: Sample[], ids: number[], cols: number[], q: Quad, u0: number, u1: number, b: number, tp0: number, tp1: number, color: string) {
      const base = list.length, col = new THREE.Color(color);
      for (const v of [0, 1]) for (const u of [u0, (u0 + u1) / 2, u1]) { list.push({ q, u, v, bulge: b * Math.sin(Math.PI * u) * (tp0 * (1 - v) + tp1 * v), lift: 0.008 }); cols.push(col.r, col.g, col.b); }
      for (let k = 0; k < 2; k++) { const a = base + k; ids.push(a, a + 1, a + 4, a, a + 4, a + 3); }
    }
    this.decal = this.makeMesh(this.decalS, didx, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide, envMap: env }), undefined, dcol);

    const lidx: number[] = [], lcol: number[] = [];
    for (const l of def.lights) {
      const q = l.front ? front.lo : rear.lo;
      // which end of the cap is this side: the front cap runs b− → b+, the tail cap b+ → b−
      const plusEnd = l.front ? l.side > 0 : l.side < 0;
      const [u0, u1] = plusEnd ? [0.74, 0.93] : [0.07, 0.26];
      const [v0, v1] = big ? [0.12, 0.32] : [0.4, 0.95];
      const n0 = this.lampS.length;
      capRect(this.lampS, lidx, lcol, q, loB, u0, u1, v0, v1, l.front ? '#fff6d8' : '#ff2a2a', 0.016);
      this.lampInfo.push({ id: l.id, front: l.front, n: n0 });
    }
    this.lamps = this.makeMesh(this.lampS, lidx, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), undefined, lcol);

    // ---- bumpers ----
    for (const part of def.parts) {
      const n = part.nodes;   // index = xi*4 + yi*2 + zi  (x: +w,−w; y: low,high; z: outer,inner)
      const faces = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 1, 3, 2], [4, 6, 7, 5], [2, 3, 7, 6], [0, 4, 5, 1]];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      const fi: number[] = []; faces.forEach((_, k) => fi.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3));
      geo.setIndex(fi);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: spec.style === 'muscle' ? '#d8dbe0' : '#232327', roughness: spec.style === 'muscle' ? 0.15 : 0.6, metalness: spec.style === 'muscle' ? 0.9 : 0.1, side: THREE.DoubleSide, envMap: env }));
      mesh.castShadow = shadows; mesh.frustumCulled = false;
      (mesh.userData as any).faces = faces.flat().map(k => n[k]);
      this.bumpers.push({ mesh, nodes: n });
      this.group.add(mesh);
    }

    // ---- wheels ----
    for (const w of def.wheels) {
      const g = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(w.R, w.R, w.W, 22, 1).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.92 }));
      const rimR = w.R * (big ? 0.55 : 0.64);
      const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(rimR, rimR, w.W + 0.012, 16, 1).rotateZ(Math.PI / 2)];
      for (let k = 0; k < 5; k++) parts.push(new THREE.BoxGeometry(w.W + 0.03, rimR * 1.7, rimR * 0.22).rotateX((k * Math.PI * 2) / 5));
      const hubcap = new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.3, w.W + 0.05, 10).rotateZ(Math.PI / 2); parts.push(hubcap);
      const rim = new THREE.Mesh(mergeGeometries(parts.map(p => p.toNonIndexed()))!, new THREE.MeshStandardMaterial({ color: big ? '#c8ccd2' : spec.style === 'muscle' ? '#e0e3e8' : '#7d838c', roughness: 0.25, metalness: 0.85, envMap: env }));
      tyre.castShadow = shadows;
      g.add(tyre, rim); g.matrixAutoUpdate = false;
      this.wheelObjs.push(g); this.group.add(g);
    }

    // ---- dashboard, firewall and steering wheel (rigid, so the cockpit view looks like a cockpit) ----
    const wi = Math.max(0, spec.stations.findIndex(s => s.top === 'front')), cowl = spec.stations[Math.min(S - 1, wi + 1)], low0 = spec.stations[wi];
    const dashMat = new THREE.MeshStandardMaterial({ color: '#202126', roughness: 0.85 });
    const dw = Math.min(cowl.wl, cowl.wb) * 0.96, top = cowl.yt - 0.03, bot = low0.yb + 0.04, depth = Math.min(0.6, (cowl.z - low0.z) * 0.8);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(dw * 2, top - bot, depth), dashMat);
    dash.position.set(0, (top + bot) / 2, cowl.z - depth / 2 - 0.02);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(big ? 0.24 : 0.18, 0.025, 8, 24), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }));
    const d = spec.driver, wz = Math.min(cowl.z - depth - 0.05, d.z + (big ? 0.55 : 0.45));
    wheel.position.set(d.x, d.y - (big ? 0.4 : 0.28), wz); wheel.rotation.x = big ? -1.0 : -0.35;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Math.max(0.1, dash.position.z - depth / 2 - wz + 0.1), 6).rotateX(Math.PI / 2), dashMat);
    col.position.set(d.x, wheel.position.y - 0.06, (wz + dash.position.z - depth / 2) / 2 + 0.05);
    this.interior.add(dash, wheel, col);
    this.interior.matrixAutoUpdate = false;
    this.group.add(this.body, this.under, this.glass, this.broken, this.decal, this.lamps, this.interior);
  }

  setColor(c: string) { this.paint.color.set(c); }

  private makeMesh(S: Sample[], idx: number[], mat: THREE.Material, uv?: number[], col?: number[]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S.length * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(S.length * 3), 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
  }

  private skin(mesh: THREE.Mesh, S: Sample[], P: Float32Array, hide?: (i: number) => boolean) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute, arr = pos.array as Float32Array;
    for (let i = 0; i < S.length; i++) {
      if (hide && hide(i)) { arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 0; continue; }
      samplePoint(P, S[i], arr, i * 3);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  /** move everything to the latest physics state */
  update(st: CarState, dtv: number) {
    const P = st.pos;
    this.skin(this.body, this.bodyS, P);
    this.skin(this.under, this.underS, P);
    this.skin(this.decal, this.decalS, P);
    // glass: intact panes on one mesh, shattered on the other
    if (st.windows.length !== this.brokenSet.size) { this.brokenSet = new Set(st.windows); }
    const isBroken = (i: number) => this.brokenSet.has(this.windowIds[this.glassWin[i]]);
    this.skin(this.glass, this.glassS, P, i => isBroken(i));
    this.broken.visible = this.brokenSet.size > 0;
    if (this.broken.visible) this.skin(this.broken, this.glassS, P, i => !isBroken(i));
    // lamps: dark when smashed, brighter when braking
    this.skin(this.lamps, this.lampS, P);
    const lc = this.lamps.geometry.getAttribute('color') as THREE.BufferAttribute;
    if (st.lights.length !== this.lightsBroken.size || st.brake > 0.1 !== (this.lamps.userData.brake ?? false)) {
      this.lightsBroken = new Set(st.lights); this.lamps.userData.brake = st.brake > 0.1;
      for (const L of this.lampInfo) {
        const c = this.lightsBroken.has(L.id) ? [0.12, 0.12, 0.13] : L.front ? [1, 0.97, 0.85] : st.brake > 0.1 ? [1, 0.1, 0.08] : [0.55, 0.04, 0.04];
        for (let k = 0; k < 6; k++) lc.setXYZ(L.n + k, c[0], c[1], c[2]);
      }
      lc.needsUpdate = true;
    }
    // bumpers
    for (const b of this.bumpers) {
      const ids = (b.mesh.userData as any).faces as number[];
      const pos = b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute, arr = pos.array as Float32Array;
      ids.forEach((n, k) => { arr[k * 3] = P[n * 3]; arr[k * 3 + 1] = P[n * 3 + 1]; arr[k * 3 + 2] = P[n * 3 + 2]; });
      pos.needsUpdate = true; b.mesh.geometry.computeVertexNormals();
    }
    // rigid interior follows the body frame
    {
      const f = new THREE.Vector3(...st.fwd), u = new THREE.Vector3(...st.up), l = new THREE.Vector3().crossVectors(u, f).normalize();
      const M = this.interior.matrix.makeBasis(l, u, f);
      const o = this.comRest.clone().applyMatrix4(M);
      M.setPosition(st.com[0] - o.x, st.com[1] - o.y, st.com[2] - o.z);
      this.interior.matrixWorldNeedsUpdate = true;
    }
    // wheels
    const W = st.wheels, x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3(), c = new THREE.Vector3();
    const m = new THREE.Matrix4(), r = new THREE.Matrix4();
    this.def.wheels.forEach((wd, i) => {
      const g = this.wheelObjs[i];
      const a = wd.hIn * 3, b = wd.hOut * 3, u = wd.hUp * 3;
      c.set((P[a] + P[b]) / 2, (P[a + 1] + P[b + 1]) / 2, (P[a + 2] + P[b + 2]) / 2);
      x.set(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]).normalize().multiplyScalar(wd.side);
      y.set(P[u] - P[a], P[u + 1] - P[a + 1], P[u + 2] - P[a + 2]);
      y.addScaledVector(x, -y.dot(x)).normalize();
      z.crossVectors(x, y);
      m.makeBasis(x, y, z).setPosition(c);
      m.multiply(r.makeRotationY(W[i * 6 + 1]));
      m.multiply(r.makeRotationX(W[i * 6]));
      const s = W[i * 6 + 5] / wd.R;
      if (s < 0.999) m.multiply(r.makeScale(1, s, s));
      g.matrix.copy(m); g.matrixWorldNeedsUpdate = true;
    });
    void dtv;
  }

  /** world point for a spot given in the car's rest layout (for cameras, smoke, the driver's seat) */
  toWorld(st: CarState, local: THREE.Vector3, out = new THREE.Vector3()) {
    const f = new THREE.Vector3(...st.fwd), u = new THREE.Vector3(...st.up), l = new THREE.Vector3().crossVectors(u, f).normalize();
    const d = local.clone().sub(this.comRest);
    return out.set(st.com[0], st.com[1], st.com[2]).addScaledVector(l, d.x).addScaledVector(u, d.y).addScaledVector(f, d.z);
  }
  basis(st: CarState) {
    const f = new THREE.Vector3(...st.fwd), u = new THREE.Vector3(...st.up), l = new THREE.Vector3().crossVectors(u, f).normalize();
    return new THREE.Matrix4().makeBasis(l, u, f);
  }
  /** centre of the wheel i and its contact point */
  wheelPos(st: CarState, i: number, out = new THREE.Vector3()) {
    const wd = this.def.wheels[i], P = st.pos, a = wd.hIn * 3, b = wd.hOut * 3;
    return out.set((P[a] + P[b]) / 2, (P[a + 1] + P[b + 1]) / 2, (P[a + 2] + P[b + 2]) / 2);
  }
  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()); });
  }
}
