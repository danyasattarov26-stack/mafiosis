/*
  Soft-body physics. Every car is a cloud of point masses joined by beams. Each step:
  beams pull/push (and dent or snap past their limits), tyres grip the ground, then everything is integrated
  and pushed out of the ground, boxes and other cars. Runs ~1200 times a second inside a worker.
*/
import { buildCar, type CarDef } from '../cars/build';
import { SPEC } from '../cars/specs';
import { heightAt, surfAt, GRIP, boxMatrix, type MapDef, type Box } from './maps';

export const DT = 1 / 1200;
const G = 9.81;

export interface Input { throttle: number; brake: number; steer: number; hand: number }
export interface SimEvent { t: 'glass' | 'light' | 'part' | 'spark' | 'crash' | 'engine' | 'tyre' | 'scrape'; car: string; id?: string; x?: number; y?: number; z?: number; v?: number }

interface WBox extends Box { M: number[] }

export class Car {
  def: CarDef; n: number;
  pos: Float64Array; vel: Float64Array; frc: Float64Array; im: Float64Array; mass: Float64Array; rad: Float64Array; fr: Float64Array; part: Int8Array;
  nb: number; ba: Int32Array; bb: Int32Array; rest: Float64Array; rest0: Float64Array; bk: Float64Array; bd: Float64Array; bdef: Float64Array; bbrk: Float64Array; broken: Uint8Array; spring: Uint8Array;
  w: { omega: number; angle: number; steer: number; flat: boolean; lost: boolean; contact: number; slip: number; R: number; kappa: number; tcs: number }[];
  aids = true;
  input: Input = { throttle: 0, brake: 0, steer: 0, hand: 0 };
  gear = 1; rev = false; rpm = 800; shiftT = 0; revT = 0; health = 1; engineDead = false;
  speed = 0; fwd = [0, 0, 1]; up = [0, 1, 0]; com = [0, 0, 0];
  brokenWindows = new Set<string>(); brokenLights = new Set<string>(); lostParts = new Set<string>();
  powerMul = 1; gripMul = 1; strengthMul = 1;
  totalMass = 0; damage = 0; lastDamage = 0;
  aabb = [0, 0, 0, 0, 0, 0];
  ai: AIDriver | null = null;
  constructor(public key: string, specId: string, public sim: Sim) {
    this.def = buildCar(SPEC[specId]);
    const d = this.def, n = (this.n = d.nodes.length), nb = (this.nb = d.beams.length);
    this.pos = new Float64Array(n * 3); this.vel = new Float64Array(n * 3); this.frc = new Float64Array(n * 3);
    this.im = new Float64Array(n); this.mass = new Float64Array(n); this.rad = new Float64Array(n); this.fr = new Float64Array(n); this.part = new Int8Array(n);
    d.nodes.forEach((q, i) => { this.mass[i] = q.m; this.im[i] = 1 / q.m; this.rad[i] = q.r; this.fr[i] = q.f; this.part[i] = q.part; this.totalMass += q.m; });
    this.ba = new Int32Array(nb); this.bb = new Int32Array(nb); this.rest = new Float64Array(nb); this.rest0 = new Float64Array(nb);
    this.bk = new Float64Array(nb); this.bd = new Float64Array(nb); this.bdef = new Float64Array(nb); this.bbrk = new Float64Array(nb); this.broken = new Uint8Array(nb); this.spring = new Uint8Array(nb);
    d.beams.forEach((b, i) => {
      this.ba[i] = b.a; this.bb[i] = b.b; this.bk[i] = b.k; this.bd[i] = b.d; this.bdef[i] = b.def; this.bbrk[i] = b.brk; this.spring[i] = b.spring ? 1 : 0;
      const A = d.nodes[b.a], B = d.nodes[b.b];
      this.rest0[i] = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) + (b.pre || 0);
    });
    this.w = d.wheels.map(w => ({ omega: 0, angle: 0, steer: 0, flat: false, lost: false, contact: 0, slip: 0, R: w.R, kappa: 0, tcs: 1 }));
  }

  /** put the car (undamaged) at x, z facing yaw */
  place(x: number, z: number, yaw: number, repair = true, drop = 0) {
    const d = this.def, c = Math.cos(yaw), s = Math.sin(yaw);
    let minY = Infinity;
    const lift = (() => { let h = -Infinity; for (const [dx, dz] of [[-2, -2], [2, 2], [-2, 2], [2, -2], [0, 0]]) h = Math.max(h, heightAt(this.sim.map, x + dx, z + dz)); return h; })();
    d.nodes.forEach((q, i) => {
      this.pos[i * 3] = x + q.x * c + q.z * s; this.pos[i * 3 + 1] = q.y + lift + 0.12 + drop; this.pos[i * 3 + 2] = z - q.x * s + q.z * c;
      minY = Math.min(minY, q.y);
    });
    this.vel.fill(0);
    if (repair) {
      this.rest.set(this.rest0); this.broken.fill(0);
      this.brokenWindows.clear(); this.brokenLights.clear(); this.lostParts.clear();
      this.health = 1; this.engineDead = false; this.damage = 0;
      for (let i = 0; i < this.nb; i++) this.bdef[i] = this.def.beams[i].def * this.strengthMul;
      this.w.forEach((w, i) => { w.flat = false; w.lost = false; w.R = this.def.wheels[i].R; w.omega = 0; });
    }
    this.gear = 1; this.rev = false;
  }
  /** fix everything where it stands (keeps position and heading) */
  repairHere() {
    const f = this.fwd, yaw = Math.atan2(f[0], f[2]);
    this.place(this.com[0], this.com[2], yaw, true);
  }

  /** frame vectors and centre of mass */
  updateFrame() {
    const p = this.pos, F = this.def.frame;
    const fx = p[F.front * 3] - p[F.rear * 3], fy = p[F.front * 3 + 1] - p[F.rear * 3 + 1], fz = p[F.front * 3 + 2] - p[F.rear * 3 + 2];
    const fl = Math.hypot(fx, fy, fz) || 1; this.fwd = [fx / fl, fy / fl, fz / fl];
    const lx = p[F.left * 3] - p[F.right * 3], ly = p[F.left * 3 + 1] - p[F.right * 3 + 1], lz = p[F.left * 3 + 2] - p[F.right * 3 + 2];
    const f = this.fwd; let ux = f[1] * lz - f[2] * ly, uy = f[2] * lx - f[0] * lz, uz = f[0] * ly - f[1] * lx;
    const ul = Math.hypot(ux, uy, uz) || 1; this.up = [ux / ul, uy / ul, uz / ul];
    let mx = 0, my = 0, mz = 0, vx = 0, vy = 0, vz = 0, M = 0;
    const b = this.aabb; b[0] = b[1] = b[2] = Infinity; b[3] = b[4] = b[5] = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.part[i] >= 0 && this.lostParts.has(this.def.parts[this.part[i]].id)) continue;
      const m = this.mass[i], x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      mx += x * m; my += y * m; mz += z * m; vx += this.vel[i * 3] * m; vy += this.vel[i * 3 + 1] * m; vz += this.vel[i * 3 + 2] * m; M += m;
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z; if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
    }
    this.com = [mx / M, my / M, mz / M];
    this.speed = (vx * f[0] + vy * f[1] + vz * f[2]) / M;
  }
}

// ---------------- AI ----------------
export class AIDriver {
  idx = 0; target = 14;
  constructor(public path: [number, number][], public car: Car) {
    let best = 0, bd = Infinity; const c = car.com;
    path.forEach((p, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
    this.idx = best;
  }
  drive(others: Car[]) {
    const c = this.car, P = this.path, n = P.length;
    while (true) { const p = P[this.idx % n]; if ((p[0] - c.com[0]) ** 2 + (p[1] - c.com[2]) ** 2 < 100) this.idx = (this.idx + 1) % n; else break; }
    const look = P[(this.idx + 2) % n];
    const dx = look[0] - c.com[0], dz = look[1] - c.com[2];
    const f = c.fwd, fl = Math.hypot(f[0], f[2]) || 1;
    const cross = (f[0] * dz - f[2] * dx) / fl, dot = (f[0] * dx + f[2] * dz) / fl;
    const ang = Math.atan2(cross, dot);
    // corner speed from how much the road bends ahead
    const a = P[this.idx % n], b = P[(this.idx + 4) % n], e = P[(this.idx + 8) % n];
    const bend = Math.abs(Math.atan2((b[0] - a[0]) * (e[1] - b[1]) - (b[1] - a[1]) * (e[0] - b[0]), (b[0] - a[0]) * (e[0] - b[0]) + (b[1] - a[1]) * (e[1] - b[1])));
    let want = this.target * (1 - Math.min(0.6, bend * 1.5));
    // slow down for cars ahead
    for (const o of others) {
      if (o === c) continue;
      const ox = o.com[0] - c.com[0], oz = o.com[2] - c.com[2], dist = Math.hypot(ox, oz);
      if (dist < 22 && (ox * f[0] + oz * f[2]) / fl > 3 && Math.abs((ox * f[2] - oz * f[0]) / fl) < 3) want = Math.min(want, (dist - 8) * 0.6);
    }
    const flipped = c.up[1] < 0.3;
    c.input.steer = flipped ? 0 : Math.max(-1, Math.min(1, ang * 2.2));
    const err = want - c.speed;
    c.input.throttle = flipped ? 0 : Math.max(0, Math.min(1, err * 0.25));
    c.input.brake = err < -2 ? Math.min(1, -err * 0.2) : 0;
    c.input.hand = 0;
  }
}

// ---------------- world ----------------
export class Sim {
  cars: Car[] = [];
  boxes: WBox[] = [];
  events: SimEvent[] = [];
  gravity = G;
  private sparkT = new Map<string, number>();
  constructor(public map: MapDef) { this.setBoxes(map.boxes); }
  setBoxes(list: Box[]) { this.boxes = list.map(b => ({ ...b, M: boxMatrix(b) })); }
  addBox(b: Box) { this.boxes.push({ ...b, M: boxMatrix(b) }); }

  spawn(key: string, specId: string, x: number, z: number, yaw: number) {
    this.remove(key);
    const c = new Car(key, specId, this); c.place(x, z, yaw); c.updateFrame(); this.cars.push(c); return c;
  }
  remove(key: string) { this.cars = this.cars.filter(c => c.key !== key); }
  car(key: string) { return this.cars.find(c => c.key === key); }

  /** advance by `time` seconds in fixed steps */
  run(time: number) {
    const steps = Math.max(1, Math.round(time / DT));
    for (const c of this.cars) { c.updateFrame(); if (c.ai) c.ai.drive(this.cars); }
    const boxSets = this.cars.map(c => this.nearBoxes(c));
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.cars.length; i++) this.stepCar(this.cars[i], boxSets[i], s === 0);
      for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) this.collideCars(this.cars[i], this.cars[j]);
      if ((s & 15) === 15) for (const c of this.cars) c.updateFrame();
    }
    for (const c of this.cars) { c.updateFrame(); this.checkDamage(c); }
  }

  private nearBoxes(c: Car): WBox[] {
    const b = c.aabb, m = 6;
    return this.boxes.filter(x => {
      const r = Math.hypot(x.h[0], x.h[1], x.h[2]);
      return x.c[0] + r > b[0] - m && x.c[0] - r < b[3] + m && x.c[1] + r > b[1] - m && x.c[1] - r < b[4] + m && x.c[2] + r > b[2] - m && x.c[2] - r < b[5] + m;
    });
  }

  private stepCar(c: Car, boxes: WBox[], first: boolean) {
    const n = c.n, p = c.pos, v = c.vel, F = c.frc, im = c.im;
    // gravity + air drag
    const spd = Math.hypot(c.speed, 0), drag = 0.5 * 1.2 * (c.def.spec.style === 'bus' || c.def.spec.style === 'truck' ? 6.5 : 0.7) / c.totalMass;
    for (let i = 0; i < n; i++) {
      const m = c.mass[i];
      F[i * 3] = -drag * m * spd * v[i * 3]; F[i * 3 + 1] = -m * this.gravity - drag * m * spd * v[i * 3 + 1]; F[i * 3 + 2] = -drag * m * spd * v[i * 3 + 2];
    }
    // beams
    const ba = c.ba, bb = c.bb, rest = c.rest;
    for (let k = 0; k < c.nb; k++) {
      if (c.broken[k]) continue;
      const a = ba[k] * 3, b = bb[k] * 3;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const nx = dx / L, ny = dy / L, nz = dz / L;
      const r0 = c.rest0[k];
      if (!c.spring[k]) {
        const def = c.bdef[k], strain = (L - rest[k]) / r0;
        if (def > 0 && (strain > def || strain < -def)) {
          const old = rest[k];
          rest[k] = L - (strain > 0 ? def : -def) * r0;      // it stays bent
          const dd = Math.abs(rest[k] - old); c.damage += dd;
        }
        if (Math.abs(L - r0) / r0 > c.bbrk[k]) { c.broken[k] = 1; continue; }
      }
      const rv = (v[b] - v[a]) * nx + (v[b + 1] - v[a + 1]) * ny + (v[b + 2] - v[a + 2]) * nz;
      let f = c.bk[k] * (L - rest[k]) + c.bd[k] * rv;
      if (c.spring[k] && L < r0 * 0.55) f += c.bk[k] * 20 * (L - r0 * 0.55);   // bump stop
      F[a] += f * nx; F[a + 1] += f * ny; F[a + 2] += f * nz;
      F[b] -= f * nx; F[b + 1] -= f * ny; F[b + 2] -= f * nz;
    }
    this.tyres(c, boxes, first);
    // integrate
    for (let i = 0; i < n; i++) {
      const w = im[i] * DT, j = i * 3;
      v[j] += F[j] * w; v[j + 1] += F[j + 1] * w; v[j + 2] += F[j + 2] * w;
      p[j] += v[j] * DT; p[j + 1] += v[j + 1] * DT; p[j + 2] += v[j + 2] * DT;
    }
    // ground + boxes
    const map = this.map;
    for (let i = 0; i < n; i++) {
      const j = i * 3, r = c.rad[i];
      const x = p[j], z = p[j + 2];
      const h = heightAt(map, x, z);
      if (p[j + 1] < h + r + 0.6) {
        const e = 0.5, hx = heightAt(map, x + e, z) - heightAt(map, x - e, z), hz = heightAt(map, x, z + e) - heightAt(map, x, z - e);
        let gx = -hx, gy = 2 * e, gz = -hz; const gl = Math.hypot(gx, gy, gz); gx /= gl; gy /= gl; gz /= gl;
        const pen = (h + r - p[j + 1]) * gy;
        if (pen > 0) {
          p[j] += gx * pen; p[j + 1] += gy * pen; p[j + 2] += gz * pen;
          this.contact(c, i, gx, gy, gz, c.fr[i] * GRIP[surfAt(map, x, z)]);
        }
      }
      for (const bx of boxes) this.nodeBox(c, i, bx);
    }
  }

  /** remove velocity into a surface and apply friction */
  private contact(c: Car, i: number, nx: number, ny: number, nz: number, mu: number) {
    const v = c.vel, j = i * 3;
    const vn = v[j] * nx + v[j + 1] * ny + v[j + 2] * nz;
    if (vn >= 0) return;
    v[j] -= vn * nx * 1.05; v[j + 1] -= vn * ny * 1.05; v[j + 2] -= vn * nz * 1.05;
    const tx = v[j], ty = v[j + 1], tz = v[j + 2], vt = Math.hypot(tx, ty, tz);
    if (vt > 1e-6) {
      const drop = Math.min(vt, -vn * mu * 1.2) / vt;
      v[j] -= tx * drop; v[j + 1] -= ty * drop; v[j + 2] -= tz * drop;
    }
    // sparks: metal scraping fast
    if (c.part[i] !== -2 && vt > 6 && -vn < 3) {
      const t = this.sparkT.get(c.key) || 0;
      if (t <= 0) { this.events.push({ t: 'spark', car: c.key, x: c.pos[j], y: c.pos[j + 1], z: c.pos[j + 2], v: vt }); this.sparkT.set(c.key, 18); }
      else this.sparkT.set(c.key, t - 1);
    }
  }

  private nodeBox(c: Car, i: number, b: WBox) {
    const p = c.pos, j = i * 3, M = b.M, r = c.rad[i];
    const dx = p[j] - b.c[0], dy = p[j + 1] - b.c[1], dz = p[j + 2] - b.c[2];
    const lx = M[0] * dx + M[3] * dy + M[6] * dz, ly = M[1] * dx + M[4] * dy + M[7] * dz, lz = M[2] * dx + M[5] * dy + M[8] * dz;
    const ox = b.h[0] + r - Math.abs(lx), oy = b.h[1] + r - Math.abs(ly), oz = b.h[2] + r - Math.abs(lz);
    if (ox <= 0 || oy <= 0 || oz <= 0) return;
    let nx: number, ny: number, nz: number, d: number;
    if (ox < oy && ox < oz) { const s = Math.sign(lx) || 1; nx = M[0] * s; ny = M[3] * s; nz = M[6] * s; d = ox; }
    else if (oy < oz) { const s = Math.sign(ly) || 1; nx = M[1] * s; ny = M[4] * s; nz = M[7] * s; d = oy; }
    else { const s = Math.sign(lz) || 1; nx = M[2] * s; ny = M[5] * s; nz = M[8] * s; d = oz; }
    p[j] += nx * d; p[j + 1] += ny * d; p[j + 2] += nz * d;
    this.contact(c, i, nx, ny, nz, 0.5);
  }

  // ---------------- tyres, engine, brakes ----------------
  private tyres(c: Car, boxes: WBox[], first: boolean) {
    const spec = c.def.spec, p = c.pos, v = c.vel, F = c.frc, up = c.up;
    const nDrive = c.def.wheels.filter((w, i) => w.drive && !c.w[i].lost).length || 1;
    // engine
    let avgW = 0, cnt = 0;
    c.def.wheels.forEach((w, i) => { if (w.drive && !c.w[i].lost) { avgW += c.w[i].omega; cnt++; } });
    avgW = cnt ? avgW / cnt : 0;
    const ratio = c.rev ? -spec.reverse * spec.final : spec.gears[c.gear - 1] * spec.final;
    c.rpm = Math.max(spec.idleRpm, Math.min(spec.maxRpm * 1.05, (Math.abs(avgW * ratio) * 60) / (2 * Math.PI)));
    const peakT = (spec.power * 1000) / (0.75 * spec.maxRpm * 2 * Math.PI / 60) * c.powerMul;
    const curve = c.rpm > spec.maxRpm ? 0 : 0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, c.rpm / spec.maxRpm));
    let thr = c.rev ? c.input.brake : c.input.throttle, brk = c.rev ? c.input.throttle : c.input.brake;
    if (c.engineDead) thr = 0;
    const engT = peakT * curve * thr * (0.3 + 0.7 * c.health) * ratio * 0.9 / nDrive;
    const engBrake = thr < 0.05 ? -Math.sign(avgW) * Math.min(Math.abs(avgW) * 2, peakT * 0.12 * Math.abs(ratio) / nDrive) : 0;
    // gearbox (once per frame)
    if (first) {
      c.shiftT -= 1 / 60;
      const f = c.speed;
      const roadRpm = (Math.abs(f) / spec.wheelR) * spec.gears[c.gear - 1] * spec.final * 60 / (2 * Math.PI);
      if (!c.rev) {
        if (c.shiftT <= 0 && Math.max(roadRpm, c.rpm * 0.9) > spec.maxRpm * 0.9 && c.gear < spec.gears.length) { c.gear++; c.shiftT = 0.45; }
        else if (c.shiftT <= 0 && roadRpm < spec.maxRpm * 0.4 && c.gear > 1) { c.gear--; c.shiftT = 0.45; }
        if (c.input.brake > 0.1 && c.input.throttle < 0.05 && Math.abs(f) < 0.6) { c.revT += 1 / 60; if (c.revT > 0.25) { c.rev = true; c.revT = 0; } } else c.revT = 0;
      } else if (c.input.throttle > 0.1 && Math.abs(f) < 0.6) { c.rev = false; c.gear = 1; }
    }
    const steerMax = spec.steerMax * Math.max(0.3, 1 - Math.abs(c.speed) / 45);
    c.def.wheels.forEach((wd, i) => {
      const ws = c.w[i];
      const a = wd.hIn * 3, b = wd.hOut * 3;
      const cx = (p[a] + p[b]) / 2, cy = (p[a + 1] + p[b + 1]) / 2, cz = (p[a + 2] + p[b + 2]) / 2;
      let ax = p[b] - p[a], ay = p[b + 1] - p[a + 1], az = p[b + 2] - p[a + 2];
      const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
      // which way the tyre rolls: perpendicular to the axle, in the car's (or the world's) up plane
      const U = ws.lost ? [0, 1, 0] : up;
      let fx = (ay * U[2] - az * U[1]) * wd.side, fy = (az * U[0] - ax * U[2]) * wd.side, fz = (ax * U[1] - ay * U[0]) * wd.side;
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      if (wd.steer && !ws.lost) {
        const th = -c.input.steer * steerMax; ws.steer = th;
        const cs = Math.cos(th), sn = Math.sin(th);
        const kx = U[0], ky = U[1], kz = U[2];
        const crx = ky * fz - kz * fy, cry = kz * fx - kx * fz, crz = kx * fy - ky * fx, kd = kx * fx + ky * fy + kz * fz;
        fx = fx * cs + crx * sn + kx * kd * (1 - cs); fy = fy * cs + cry * sn + ky * kd * (1 - cs); fz = fz * cs + crz * sn + kz * kd * (1 - cs);
      }
      // contact: ground or a box, whichever pushes in deepest
      const R = ws.R;
      let pen = -1, nx = 0, ny = 1, nz = 0, mu = 1;
      const h = heightAt(this.map, cx, cz);
      if (cy - R < h + 0.5) {
        const e = 0.5, hx = heightAt(this.map, cx + e, cz) - heightAt(this.map, cx - e, cz), hz = heightAt(this.map, cx, cz + e) - heightAt(this.map, cx, cz - e);
        let gx = -hx, gy = 2 * e, gz = -hz; const gl = Math.hypot(gx, gy, gz); gx /= gl; gy /= gl; gz /= gl;
        const pd = R - (cy - h) * gy;
        if (pd > pen) { pen = pd; nx = gx; ny = gy; nz = gz; mu = GRIP[surfAt(this.map, cx, cz)]; }
      }
      for (const bx of boxes) {
        const M = bx.M, dx = cx - bx.c[0], dy = cy - bx.c[1], dz = cz - bx.c[2];
        const lx = M[0] * dx + M[3] * dy + M[6] * dz, ly = M[1] * dx + M[4] * dy + M[7] * dz, lz = M[2] * dx + M[5] * dy + M[8] * dz;
        const qx = Math.max(-bx.h[0], Math.min(bx.h[0], lx)), qy = Math.max(-bx.h[1], Math.min(bx.h[1], ly)), qz = Math.max(-bx.h[2], Math.min(bx.h[2], lz));
        const ex = lx - qx, ey = ly - qy, ez = lz - qz, dist = Math.hypot(ex, ey, ez);
        if (dist > 1e-4 && R - dist > pen) {
          pen = R - dist;
          nx = (M[0] * ex + M[1] * ey + M[2] * ez) / dist; ny = (M[3] * ex + M[4] * ey + M[5] * ez) / dist; nz = (M[6] * ex + M[7] * ey + M[8] * ez) / dist;
          mu = 0.95;
        }
      }
      // spin: engine, brakes, handbrake
      const I = 0.7 * c.mass[wd.hIn] * 2 * R * R;
      let T = 0;
      if (wd.drive && !ws.lost) {
        // traction control: ease off when this tyre spins
        if (c.aids) ws.tcs = Math.max(0.08, Math.min(1, ws.tcs + (ws.contact ? Math.max(-6, Math.min(3, (0.14 - Math.abs(ws.kappa)) * 12)) : 3) * DT));
        T += engT * (c.aids ? ws.tcs : 1) + engBrake;
      }
      let Tb = brk * c.totalMass * G * R * 0.32 * (c.aids && ws.contact && ws.kappa < -0.2 ? 0.35 : 1);   // ABS
      if (wd.hand && c.input.hand > 0.5) Tb += c.totalMass * G * R * 0.5;
      ws.contact = 0;
      let Fx = 0;
      if (pen > 0) {
        ws.contact = 1;
        const vx = (v[a] + v[b]) / 2, vy = (v[a + 1] + v[b + 1]) / 2, vz = (v[a + 2] + v[b + 2]) / 2;
        const vn = vx * nx + vy * ny + vz * nz;
        const kt = (c.totalMass * 9.81) / c.def.wheels.length / 0.025, ct = 2 * 0.35 * Math.sqrt(kt * c.mass[wd.hIn] * 2);
        const Fz = Math.max(0, kt * pen - ct * vn);
        // tyre directions on the contact plane
        let lx = fx - nx * (fx * nx + fy * ny + fz * nz), ly = fy - ny * (fx * nx + fy * ny + fz * nz), lz = fz - nz * (fx * nx + fy * ny + fz * nz);
        const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
        const sx = ny * lz - nz * ly, sy = nz * lx - nx * lz, sz = nx * ly - ny * lx;
        const vlon = vx * lx + vy * ly + vz * lz, vlat = vx * sx + vy * sy + vz * sz;
        const grip = mu * spec.tyreGrip * c.gripMul * (ws.flat ? 0.55 : 1);
        const kappa = (ws.omega * R - vlon) / Math.max(Math.abs(vlon), 1.5); ws.kappa = kappa;
        const alpha = Math.atan2(vlat, Math.max(Math.abs(vlon), 1.5));
        const pac = (x: number, B: number, C: number) => Math.sin(C * Math.atan(B * x));
        Fx = Fz * grip * 1.2 * pac(kappa, 9, 1.65);
        let Fy = -Fz * grip * pac(alpha, 7, 1.35);
        const lim = Fz * grip * 1.15, tot = Math.hypot(Fx, Fy);
        if (tot > lim) { Fx *= lim / tot; Fy *= lim / tot; }
        ws.slip = Math.max(Math.abs(kappa), Math.abs(alpha));
        const Fxw = Fx * lx + Fy * sx + Fz * nx, Fyw = Fx * ly + Fy * sy + Fz * ny, Fzw = Fx * lz + Fy * sz + Fz * nz;
        F[a] += Fxw / 2; F[a + 1] += Fyw / 2; F[a + 2] += Fzw / 2;
        F[b] += Fxw / 2; F[b + 1] += Fyw / 2; F[b + 2] += Fzw / 2;
      }
      ws.omega += ((T - Fx * R) / I) * DT;
      const db = (Tb / I) * DT;
      ws.omega = Math.abs(ws.omega) <= db ? 0 : ws.omega - Math.sign(ws.omega) * db;
      ws.angle += ws.omega * DT;
    });
  }

  // ---------------- car vs car ----------------
  private collideCars(A: Car, B: Car) {
    const a = A.aabb, b = B.aabb, m = 0.3;
    if (a[3] + m < b[0] || b[3] + m < a[0] || a[4] + m < b[1] || b[4] + m < a[1] || a[5] + m < b[2] || b[5] + m < a[2]) return;
    this.nodesVsHull(A, B); this.nodesVsHull(B, A);
  }
  private nodesVsHull(A: Car, B: Car) {
    const pa = A.pos, pb = B.pos, va = A.vel, vb = B.vel, bb = B.aabb, R = 0.14;
    const hull = B.def.hull;
    for (let i = 0; i < A.n; i++) {
      const j = i * 3, x = pa[j], y = pa[j + 1], z = pa[j + 2];
      if (x < bb[0] - R || x > bb[3] + R || y < bb[1] - R || y > bb[4] + R || z < bb[2] - R || z > bb[5] + R) continue;
      let best = 1e9, bi = -1, bu = 0, bv = 0, bw = 0, bnx = 0, bny = 0, bnz = 0;
      for (let t = 0; t < hull.length; t++) {
        const [i0, i1, i2] = hull[t];
        const ax = pb[i0 * 3], ay = pb[i0 * 3 + 1], az = pb[i0 * 3 + 2];
        const e1x = pb[i1 * 3] - ax, e1y = pb[i1 * 3 + 1] - ay, e1z = pb[i1 * 3 + 2] - az;
        const e2x = pb[i2 * 3] - ax, e2y = pb[i2 * 3 + 1] - ay, e2z = pb[i2 * 3 + 2] - az;
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const nl = Math.hypot(nx, ny, nz); if (nl < 1e-8) continue; nx /= nl; ny /= nl; nz /= nl;
        const qx = x - ax, qy = y - ay, qz = z - az;
        const s = qx * nx + qy * ny + qz * nz;
        if (s > R || s < -0.45) continue;
        // barycentric of the projection
        const d00 = e1x * e1x + e1y * e1y + e1z * e1z, d01 = e1x * e2x + e1y * e2y + e1z * e2z, d11 = e2x * e2x + e2y * e2y + e2z * e2z;
        const d20 = qx * e1x + qy * e1y + qz * e1z, d21 = qx * e2x + qy * e2y + qz * e2z, den = d00 * d11 - d01 * d01;
        if (Math.abs(den) < 1e-10) continue;
        const vv = (d11 * d20 - d01 * d21) / den, ww = (d00 * d21 - d01 * d20) / den, uu = 1 - vv - ww;
        if (uu < -0.02 || vv < -0.02 || ww < -0.02) continue;
        const depth = R - s;
        if (depth < best) { best = depth; bi = t; bu = uu; bv = vv; bw = ww; bnx = nx; bny = ny; bnz = nz; }
      }
      if (bi < 0) continue;
      const [i0, i1, i2] = hull[bi];
      const wA = A.im[i], wB = B.im[i0] * bu * bu + B.im[i1] * bv * bv + B.im[i2] * bw * bw, wt = wA + wB;
      const corr = Math.min(best, 0.004) / wt;   // push out gently: big jumps make the soft bodies explode
      pa[j] += bnx * corr * wA; pa[j + 1] += bny * corr * wA; pa[j + 2] += bnz * corr * wA;
      for (const [k, wk] of [[i0, bu], [i1, bv], [i2, bw]] as const) { const s = corr * B.im[k] * wk; pb[k * 3] -= bnx * s; pb[k * 3 + 1] -= bny * s; pb[k * 3 + 2] -= bnz * s; }
      // momentum: stop them moving into each other, a little friction
      const rvx = va[j] - (vb[i0 * 3] * bu + vb[i1 * 3] * bv + vb[i2 * 3] * bw);
      const rvy = va[j + 1] - (vb[i0 * 3 + 1] * bu + vb[i1 * 3 + 1] * bv + vb[i2 * 3 + 1] * bw);
      const rvz = va[j + 2] - (vb[i0 * 3 + 2] * bu + vb[i1 * 3 + 2] * bv + vb[i2 * 3 + 2] * bw);
      const vn = rvx * bnx + rvy * bny + rvz * bnz;
      if (vn < 0) {
        const jn = -vn / wt;
        let ix = jn * bnx, iy = jn * bny, iz = jn * bnz;
        const tx = rvx - vn * bnx, ty = rvy - vn * bny, tz = rvz - vn * bnz, tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-6) { const jt = Math.min(tl / wt, jn * 0.35); ix -= (tx / tl) * jt; iy -= (ty / tl) * jt; iz -= (tz / tl) * jt; }
        va[j] += ix * wA; va[j + 1] += iy * wA; va[j + 2] += iz * wA;
        for (const [k, wk] of [[i0, bu], [i1, bv], [i2, bw]] as const) { const s = B.im[k] * wk; vb[k * 3] -= ix * s; vb[k * 3 + 1] -= iy * s; vb[k * 3 + 2] -= iz * s; }
        if (-vn > 4 && Math.random() < 0.05) this.events.push({ t: 'crash', car: A.key, v: -vn, x, y, z });
      }
    }
  }

  // ---------------- damage bookkeeping (once per frame) ----------------
  private checkDamage(c: Car) {
    const p = c.pos;
    const strainOf = (k: number) => {
      if (c.broken[k]) return 1;
      const a = c.ba[k] * 3, b = c.bb[k] * 3;
      return Math.abs(Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]) / c.rest0[k] - 1);
    };
    for (const w of c.def.windows) if (!c.brokenWindows.has(w.id) && w.beams.some(k => strainOf(k) > 0.045)) {
      c.brokenWindows.add(w.id);
      const k = w.beams[0], a = c.ba[k] * 3;
      this.events.push({ t: 'glass', car: c.key, id: w.id, x: p[a], y: p[a + 1], z: p[a + 2] });
    }
    for (const l of c.def.lights) if (!c.brokenLights.has(l.id) && l.beams.some(k => strainOf(k) > 0.07)) { c.brokenLights.add(l.id); this.events.push({ t: 'light', car: c.key, id: l.id }); }
    for (const part of c.def.parts) if (!c.lostParts.has(part.id) && part.attach.every(k => c.broken[k])) { c.lostParts.add(part.id); this.events.push({ t: 'part', car: c.key, id: part.id }); }
    // wheels: flat after a hard knock to the suspension, lost when the arms are gone
    c.def.wheels.forEach((w, i) => {
      const ws = c.w[i];
      const hub = new Set([w.hIn, w.hOut, w.hUp]);
      const arms: number[] = [];
      for (let k = 0; k < c.nb; k++) if (hub.has(c.ba[k]) !== hub.has(c.bb[k])) arms.push(k);
      if (!ws.lost && arms.every(k => c.broken[k] || c.spring[k])) { ws.lost = true; this.events.push({ t: 'part', car: c.key, id: 'wheel' }); }
      if (!ws.flat && !ws.lost) {
        const bent = arms.reduce((s, k) => s + (c.spring[k] ? 0 : Math.abs(c.rest[k] - c.rest0[k])), 0);
        if (bent > 0.09) { ws.flat = true; ws.R = w.R * 0.86; this.events.push({ t: 'tyre', car: c.key }); }
      }
    });
    // engine
    let ed = 0; for (const k of c.def.engine) ed += c.broken[k] ? 0.3 : Math.abs(c.rest[k] - c.rest0[k]) / c.rest0[k];
    const h = Math.max(0, 1 - ed / (c.def.engine.length * 0.15));
    if (h < c.health - 0.01) { c.health = h; if (h < 0.15 && !c.engineDead) { c.engineDead = true; this.events.push({ t: 'engine', car: c.key, id: 'dead' }); } }
    if (c.damage - c.lastDamage > 0.05) this.events.push({ t: 'crash', car: c.key, v: Math.min(40, (c.damage - c.lastDamage) * 30), x: c.com[0], y: c.com[1], z: c.com[2] });
    c.lastDamage = c.damage;
  }
}
