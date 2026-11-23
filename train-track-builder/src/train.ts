/* The train: a locomotive and its carriages riding the track, with simple physics (engine, gravity, drag, brakes, boosters). */
import * as THREE from 'three';
import { model } from './world';
import type { Track, Sample } from './track';

export interface TrainType { id: string; name: string; emoji: string; cars: string[]; scale: number; power: number }
export const TRAINS: TrainType[] = [
  { id: 'steam', name: 'Steam Express', emoji: '🚂', cars: ['train-locomotive-a', 'train-locomotive-passenger-a', 'train-locomotive-passenger-a'], scale: 0.46, power: 7 },
  { id: 'freight', name: 'Freight Hauler', emoji: '🚃', cars: ['train-locomotive-a', 'train-carriage-box', 'train-carriage-container-red', 'train-carriage-box'], scale: 0.46, power: 8 },
  { id: 'tram', name: 'Speedy Tram', emoji: '🚋', cars: ['train-tram-modern'], scale: 0.42, power: 10 },
];
export const TRAIN_MODELS = [...new Set(TRAINS.flatMap(t => t.cars))];
/** which way each model faces: +1 if its front is +z */
const FACING: Record<string, number> = { 'train-locomotive-a': 1, 'train-locomotive-passenger-a': 1, 'train-carriage-box': 1, 'train-carriage-container-red': 1, 'train-tram-modern': 1 };

const MAX_SPEED = 48;

export class Train {
  group = new THREE.Group();
  cars: { o: THREE.Group; len: number }[] = [];
  s = 2;            // distance of the front of the train along the track
  v = 0;            // speed (m/s), negative = backwards
  throttle = 0;     // -1..1 (negative = reverse)
  brake = false;
  onBoost = false;
  bumped = 0;       // >0 right after hitting a buffer stop
  type: TrainType = TRAINS[0];
  private tmp: Sample = { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), s: 0, boost: false };
  private tmp2: Sample = { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), s: 0, boost: false };

  setType(t: TrainType) {
    this.type = t;
    this.group.clear(); this.cars = [];
    for (const name of t.cars) {
      const o = new THREE.Group();
      const m = model(name); m.scale.setScalar(t.scale);
      if ((FACING[name] ?? 1) < 0) m.rotation.y = Math.PI;
      const bb = new THREE.Box3().setFromObject(m);
      m.position.y = -bb.min.y + 0.12;           // wheels on the rails
      o.add(m); this.group.add(o);
      this.cars.push({ o, len: bb.max.z - bb.min.z });
    }
  }
  get length() { return this.cars.reduce((a, c) => a + c.len + 0.35, 0); }

  reset(track: Track) { this.s = Math.min(track.length, this.length + 2.5); this.v = 0; this.throttle = 0; this.bumped = 0; }

  update(dt: number, track: Track, gravity: number) {
    const L = track.length, len = this.length;
    // forces along the track, averaged over the whole train
    let slope = 0; const n = 4;
    for (let i = 0; i < n; i++) { track.at(this.s - (len * i) / (n - 1), this.tmp); slope += this.tmp.f.y; }
    slope /= n;
    track.at(this.s - len / 2, this.tmp);
    this.onBoost = this.tmp.boost;
    let a = this.throttle * this.type.power - gravity * slope;
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
    this.place(track);
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
      s -= c.len + 0.35;
    }
  }

  /** where the driver sits and which way the front faces */
  cab(track: Track, out: Sample) { return track.at(this.s - 0.9, out); }
  get kmh() { return Math.round(Math.abs(this.v) * 3.6); }
}
