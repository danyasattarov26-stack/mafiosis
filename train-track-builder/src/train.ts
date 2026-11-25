/* The train: an engine and the carriages you hooked on, riding the track with simple physics
   (engine, weight, gravity, drag, brakes, boosters), and flying off the rails when a bend is taken too fast. */
import * as THREE from 'three';
import { model } from './world';
import type { Track, Sample } from './track';

export type Horn = 'steam' | 'diesel' | 'tram' | 'chime';
export interface Engine {
  id: string; name: string; emoji: string; model: string; scale: number;
  power: number; horn: Horn; smoke?: boolean; grippy?: boolean; blurb: string; cars: string[];
}
export interface CarType { id: string; name: string; emoji: string; model: string; scale: number; weight: number; flip?: boolean }

const K = 0.46;        // Kenney's train kit at track scale
export const CAR_TYPES: CarType[] = [
  { id: 'pass-a', name: 'Passenger', emoji: '🧑‍🤝‍🧑', model: 'train-locomotive-passenger-a', scale: K, weight: 0.12 },
  { id: 'pass-b', name: 'Blue coach', emoji: '🚃', model: 'train-locomotive-passenger-b', scale: K, weight: 0.12 },
  { id: 'box', name: 'Open wagon', emoji: '🪣', model: 'train-carriage-box', scale: K, weight: 0.14 },
  { id: 'coal', name: 'Coal', emoji: '⚫', model: 'train-carriage-coal', scale: K, weight: 0.2 },
  { id: 'dirt', name: 'Dirt', emoji: '🟫', model: 'train-carriage-dirt', scale: K, weight: 0.2 },
  { id: 'wood', name: 'Wood', emoji: '🪵', model: 'train-carriage-wood', scale: K, weight: 0.18 },
  { id: 'lumber', name: 'Logs', emoji: '🌲', model: 'train-carriage-lumber', scale: K, weight: 0.18 },
  { id: 'flat-wood', name: 'Flatbed', emoji: '🟧', model: 'train-carriage-flatbed-wood', scale: K, weight: 0.08 },
  { id: 'flat', name: 'Steel flat', emoji: '⬜', model: 'train-carriage-flatbed', scale: K, weight: 0.08 },
  { id: 'cont-red', name: 'Red box', emoji: '🟥', model: 'train-carriage-container-red', scale: K, weight: 0.16 },
  { id: 'cont-blue', name: 'Blue box', emoji: '🟦', model: 'train-carriage-container-blue', scale: K, weight: 0.16 },
  { id: 'cont-green', name: 'Green box', emoji: '🟩', model: 'train-carriage-container-green', scale: K, weight: 0.16 },
  { id: 'tank', name: 'Red tank', emoji: '🛢️', model: 'train-carriage-tank', scale: K, weight: 0.22 },
  { id: 'tank-big', name: 'Yellow tank', emoji: '🟡', model: 'train-carriage-tank-large', scale: K, weight: 0.24 },
  { id: 'bullet-mid', name: 'Bullet coach', emoji: '🚅', model: 'train-electric-bullet-b', scale: K, weight: 0.1 },
  { id: 'bullet-end', name: 'Bullet tail', emoji: '🏁', model: 'train-electric-bullet-c', scale: K, weight: 0.1 },
  { id: 'metro-mid', name: 'Metro coach', emoji: '🚇', model: 'train-electric-subway-b', scale: K, weight: 0.11 },
  { id: 'metro-end', name: 'Metro tail', emoji: '🔚', model: 'train-electric-subway-c', scale: K, weight: 0.11 },
  { id: 'tram-classic', name: 'Old tram', emoji: '🚋', model: 'train-tram-classic', scale: 0.42, weight: 0.12 },
  { id: 'tram-round', name: 'Round tram', emoji: '🚎', model: 'train-tram-round', scale: 0.42, weight: 0.12 },
  { id: 'coaster', name: 'Coaster seats', emoji: '🎢', model: 'coaster-train', scale: 1.2, weight: 0.05 },
  { id: 'moon-pass', name: 'Moon coach', emoji: '👩‍🚀', model: 'monorail_trainPassenger', scale: 1.4, weight: 0.08 },
  { id: 'moon-cargo', name: 'Moon cargo', emoji: '📦', model: 'monorail_trainCargo', scale: 1.4, weight: 0.08 },
  { id: 'moon-box', name: 'Moon box', emoji: '🛸', model: 'monorail_trainBox', scale: 1.4, weight: 0.08 },
  { id: 'moon-end', name: 'Moon tail', emoji: '🔭', model: 'monorail_trainEnd', scale: 1.4, weight: 0.08 },
];
export const CAR = Object.fromEntries(CAR_TYPES.map(c => [c.id, c])) as Record<string, CarType>;

export const ENGINES: Engine[] = [
  { id: 'steam', name: 'Steam Express', emoji: '🚂', model: 'train-locomotive-a', scale: K, power: 9, horn: 'steam', smoke: true, blurb: 'Puffs of steam, chuff chuff!', cars: ['pass-a', 'pass-a'] },
  { id: 'freight', name: 'Freight Hauler', emoji: '🚃', model: 'train-locomotive-b', scale: K, power: 12, horn: 'steam', smoke: true, blurb: 'Strong enough for a long line.', cars: ['coal', 'box', 'cont-red', 'lumber'] },
  { id: 'comet', name: 'Blue Comet', emoji: '💙', model: 'train-locomotive-c', scale: K, power: 10, horn: 'steam', smoke: true, blurb: 'A shiny blue steam engine.', cars: ['pass-b', 'pass-b', 'pass-b'] },
  { id: 'diesel', name: 'Big Diesel', emoji: '🟠', model: 'train-diesel-a', scale: K, power: 13, horn: 'diesel', blurb: 'Pulls anything you hook on.', cars: ['cont-blue', 'cont-red', 'cont-green', 'tank', 'tank-big'] },
  { id: 'shunter', name: 'Little Shunter', emoji: '🔴', model: 'train-diesel-b', scale: K, power: 9, horn: 'diesel', blurb: 'Small, red and busy.', cars: ['flat-wood', 'dirt'] },
  { id: 'bullet', name: 'Bullet Train', emoji: '🚄', model: 'train-electric-bullet-a', scale: K, power: 15, horn: 'chime', blurb: 'The fastest train of all!', cars: ['bullet-mid', 'bullet-mid', 'bullet-end'] },
  { id: 'metro', name: 'City Metro', emoji: '🚇', model: 'train-electric-subway-a', scale: K, power: 12, horn: 'chime', blurb: 'Next stop: the loop!', cars: ['metro-mid', 'metro-mid', 'metro-end'] },
  { id: 'tram', name: 'Speedy Tram', emoji: '🚋', model: 'train-tram-modern', scale: 0.42, power: 11, horn: 'tram', blurb: 'Ding ding!', cars: [] },
  { id: 'coaster', name: 'Roller Coaster', emoji: '🎢', model: 'coaster-train-front', scale: 1.2, power: 11, horn: 'tram', grippy: true, blurb: 'Locked to the rails: it never flies off!', cars: ['coaster', 'coaster', 'coaster', 'coaster'] },
  { id: 'moon', name: 'Moon Shuttle', emoji: '🚀', model: 'monorail_trainFront', scale: 1.4, power: 11, horn: 'chime', blurb: 'Space train from the Moon Base.', cars: ['moon-pass', 'moon-cargo', 'moon-box', 'moon-end'] },
];
export const MAX_CARS = 12;
export const TRAIN_MODELS = [...new Set([...ENGINES.map(e => e.model), ...CAR_TYPES.map(c => c.model)])];

const MAX_SPEED = 48;
const GAP = 0.35;
/** sideways push (m/s²) a bend can take before the train flies off, and when the warning starts */
export const DERAIL_AT = 80, WARN_AT = 58;

interface Car { o: THREE.Group; len: number; vel: THREE.Vector3; spin: THREE.Vector3 }
const mkSample = (): Sample => ({ p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), s: 0, boost: false });

export class Train {
  group = new THREE.Group();
  cars: Car[] = [];
  s = 2;            // distance of the front of the train along the track (keeps growing round a circuit)
  v = 0;            // speed (m/s), negative = backwards
  throttle = 0;     // -1..1 (negative = reverse)
  brake = false;
  onBoost = false;
  bumped = 0;       // >0 right after hitting a buffer stop
  lateral = 0;      // sideways push in the bend right now (m/s²)
  derailed = 0;     // seconds since flying off the rails (0 = on the rails)
  derailOn = true;
  engine: Engine = ENGINES[0];
  consist: string[] = [];
  mass = 1;
  private tmp = mkSample(); private tmp2 = mkSample(); private tmp3 = mkSample();

  setTrain(e: Engine, cars: string[]) {
    this.engine = e; this.consist = cars.filter(c => CAR[c]).slice(0, MAX_CARS);
    this.group.clear(); this.cars = [];
    const parts: { model: string; scale: number; flip?: boolean }[] = [{ model: e.model, scale: e.scale }, ...this.consist.map(c => CAR[c])];
    for (const p of parts) {
      const o = new THREE.Group();
      const m = model(p.model); m.scale.setScalar(p.scale);
      if (p.flip) m.rotation.y = Math.PI;
      const bb = new THREE.Box3().setFromObject(m);
      m.position.y = -bb.min.y + 0.12;           // wheels on the rails
      m.position.z = -(bb.max.z + bb.min.z) / 2;
      o.add(m); this.group.add(o);
      this.cars.push({ o, len: bb.max.z - bb.min.z, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    this.mass = 1 + this.consist.reduce((a, c) => a + CAR[c].weight, 0);
  }
  get length() { return this.cars.reduce((a, c) => a + c.len + GAP, 0); }
  get carCount() { return this.consist.length; }

  reset(track: Track) {
    this.s = Math.min(track.length, this.length + 2.5); this.v = 0; this.throttle = 0; this.bumped = 0; this.derailed = 0; this.lateral = 0;
    this.place(track);
  }

  update(dt: number, track: Track, gravity: number) {
    if (this.derailed) { this.tumble(dt, gravity); return; }
    const L = track.length, len = this.length;
    // forces along the track, averaged over the whole train
    let slope = 0; const n = Math.min(8, 2 + this.cars.length);
    for (let i = 0; i < n; i++) { track.at(this.s - (len * i) / (n - 1), this.tmp); slope += this.tmp.f.y; }
    slope /= n;
    track.at(this.s - len / 2, this.tmp);
    this.onBoost = this.tmp.boost;
    let a = (this.throttle * this.engine.power) / this.mass - gravity * slope;
    a -= 0.0025 * this.v * Math.abs(this.v);                 // air
    if (Math.abs(this.v) > 0.05) a -= 0.25 * Math.sign(this.v);   // rolling
    if (this.onBoost) a += this.v >= 0 ? 22 : -10;
    this.v += a * dt;
    if (this.brake) { const b = 14 * dt; this.v = Math.abs(this.v) <= b ? 0 : this.v - Math.sign(this.v) * b; }
    if (!this.onBoost && Math.abs(this.v) < 0.05 && Math.abs(this.throttle) < 0.01 && Math.abs(slope) < 0.02) this.v = 0;
    this.v = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.v));
    this.s += this.v * dt;
    // ends of an open line
    this.bumped = Math.max(0, this.bumped - dt);
    if (!track.closed) {
      const max = L - 0.6, min = len + 0.6;
      if (this.s > max) { this.s = max; if (this.v > 3) this.bumped = 0.6; this.v = Math.min(0, -this.v * 0.15); }
      if (this.s < min) { this.s = min; if (this.v < -3) this.bumped = 0.6; this.v = Math.max(0, -this.v * 0.15); }
    }
    // how hard the bend pushes the engine sideways
    const mid = this.s - (this.cars[0]?.len || 4) / 2;
    this.lateral = 0;
    if (track.isBend(mid)) {
      const a1 = track.at(mid + 1, this.tmp2), a0 = track.at(mid - 1, this.tmp3), c = track.at(mid, this.tmp);
      const k = a1.f.clone().sub(a0.f).multiplyScalar(0.5).dot(c.r);
      this.lateral = this.v * this.v * k;
    }
    this.place(track);
    if (this.derailOn && !this.engine.grippy && Math.abs(this.lateral) > DERAIL_AT) this.derail(track);
  }

  /** put every car on the rails: positioned and turned by its two bogies */
  place(track: Track) {
    let s = this.s;
    const m = new THREE.Matrix4();
    for (const c of this.cars) {
      const half = c.len / 2, bogie = half * 0.65;
      const a = track.at(s - half + bogie, this.tmp), b = track.at(s - half - bogie, this.tmp2);
      const pos = a.p.clone().add(b.p).multiplyScalar(0.5);
      const f = a.p.clone().sub(b.p); if (f.lengthSq() < 1e-6) f.copy(a.f); f.normalize();
      const u = a.u.clone().add(b.u).normalize();
      const r = u.clone().cross(f).normalize(); u.copy(f).cross(r).normalize();
      m.makeBasis(r, u, f);
      c.o.quaternion.setFromRotationMatrix(m);
      c.o.position.copy(pos);
      s -= c.len + GAP;
    }
  }

  /** off the rails! every car flies on with its own speed and spin */
  derail(track: Track) {
    this.derailed = 1e-3;
    const out = Math.sign(this.lateral) || 1;
    let s = this.s;
    this.cars.forEach((c, i) => {
      const smp = track.at(s - c.len / 2, this.tmp);
      const sv = this.v * (1 - i * 0.03);
      c.vel.copy(smp.f).multiplyScalar(sv).addScaledVector(smp.r, -out * (4 + Math.random() * 5)).add(new THREE.Vector3(0, 3 + Math.random() * 4, 0));
      c.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5, -out * (2 + Math.random() * 5));
      s -= c.len + GAP;
    });
    this.v = 0;
  }
  private tumble(dt: number, gravity: number) {
    this.derailed += dt;
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const c of this.cars) {
      c.vel.y -= gravity * dt;
      c.vel.multiplyScalar(1 - 0.15 * dt);
      c.o.position.addScaledVector(c.vel, dt);
      e.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt); q.setFromEuler(e); c.o.quaternion.multiply(q);
      if (c.o.position.y < 0.4) {
        c.o.position.y = 0.4;
        if (c.vel.y < 0) c.vel.y = -c.vel.y * 0.35;
        c.vel.x *= 0.82; c.vel.z *= 0.82; c.spin.multiplyScalar(0.8);
      }
    }
  }

  /** where the chimney is, for smoke puffs */
  chimney(out: THREE.Vector3) {
    const c = this.cars[0]; if (!c) return out.set(0, -99, 0);
    return out.set(0, 2.25, c.len * 0.3).applyQuaternion(c.o.quaternion).add(c.o.position);
  }
  get kmh() { return Math.round(Math.abs(this.v) * 3.6); }
}
