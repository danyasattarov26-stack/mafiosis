/*
  Rowing boats. Put one on water, climb in, and row wherever you look. They float and bob on any
  water (sea, rivers, lakes), stop at the shore, and stay where you leave them (saved with the world,
  shared in co-op: whoever rows a boat moves it for everyone).
*/
import * as THREE from 'three';
import type { World } from '../world/world';
import { B } from '../shared/blocks';

export interface Boat { id: string; pos: THREE.Vector3; yaw: number; speed: number; mesh: THREE.Group; oars: THREE.Object3D[]; row: number; rider: string | null; target?: THREE.Vector3; targetYaw?: number }
export interface BoatSave { id: string; x: number; y: number; z: number; yaw: number }

let next = 1;
const planks = new THREE.MeshLambertMaterial({ color: '#9a6e3e' }), dark = new THREE.MeshLambertMaterial({ color: '#6b4a2b' }), rim = new THREE.MeshLambertMaterial({ color: '#5a3a1e' });

function buildBoat() {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.y = ry; g.add(o); return o; };
  box(1.1, 0.1, 2.2, dark, 0, 0.05, 0);                               // floor
  for (const s of [-1, 1]) { box(0.08, 0.38, 2.2, planks, s * 0.6, 0.24, 0); box(0.1, 0.06, 2.24, rim, s * 0.6, 0.45, 0); }
  box(1.25, 0.38, 0.08, planks, 0, 0.24, -1.12); box(1.25, 0.38, 0.08, planks, 0, 0.24, 1.12);
  // a pointed bow at the front (−z)
  for (const s of [-1, 1]) box(0.08, 0.38, 0.62, planks, s * 0.36, 0.24, -1.38, s * 0.65);
  box(1.0, 0.06, 0.3, rim, 0, 0.3, 0.2);                               // seat
  const oars: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.62, 0.45, 0.1);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.04), dark); shaft.position.x = s * 0.45; piv.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.16), planks); blade.position.x = s * 1.05; piv.add(blade);
    piv.rotation.z = s * -0.35; g.add(piv); oars.push(piv);
  }
  return { g, oars };
}

export class Boats {
  list: Boat[] = [];
  group = new THREE.Group();
  onMove: (b: Boat) => void = () => {};
  constructor(public world: World) {}

  add(x: number, y: number, z: number, yaw: number, id?: string) {
    const { g, oars } = buildBoat();
    const b: Boat = { id: id ?? `b${Date.now().toString(36)}${next++}`, pos: new THREE.Vector3(x, y, z), yaw, speed: 0, mesh: g, oars, row: 0, rider: null };
    g.position.copy(b.pos); g.rotation.y = yaw; this.group.add(g); this.list.push(b);
    return b;
  }
  remove(b: Boat) { this.group.remove(b.mesh); this.list = this.list.filter(q => q !== b); }
  clear() { for (const b of [...this.list]) this.remove(b); }

  /** the top of the water at a column near height y, or null if there's none */
  waterTop(x: number, z: number, y: number) {
    const fx = Math.floor(x), fz = Math.floor(z);
    for (let yy = Math.floor(y) + 2; yy > Math.floor(y) - 4; yy--) if (this.world.get(fx, yy, fz) === B.water && this.world.get(fx, yy + 1, fz) !== B.water) return yy + 1;
    return null;
  }
  /** the boat you're pointing at */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, reach: number) {
    let best: Boat | null = null, bt = reach;
    for (const b of this.list) {
      const c = b.pos.clone().setY(b.pos.y + 0.3), oc = c.sub(o), t = oc.dot(d);
      if (t < 0 || t > bt) continue;
      if (oc.lengthSq() - t * t < 1.1 * 1.1) { best = b; bt = t; }
    }
    return best;
  }
  /** row towards `dir` (flat, normalised; zero to coast) */
  steer(b: Boat, dir: THREE.Vector3, fast: boolean, dt: number) {
    const want = dir.lengthSq() > 0.01 ? (fast ? 7.5 : 5) : 0;
    b.speed += (want - b.speed) * Math.min(1, dt * (want ? 1.4 : 0.8));
    if (dir.lengthSq() > 0.01) { const ty = Math.atan2(-dir.x, -dir.z), d = Math.atan2(Math.sin(ty - b.yaw), Math.cos(ty - b.yaw)); b.yaw += d * Math.min(1, dt * 2.5); }
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const nx = b.pos.x + fx * b.speed * dt, nz = b.pos.z + fz * b.speed * dt;
    // the shore stops you; check a little ahead of the bow too
    const ok = this.waterTop(nx, nz, b.pos.y) != null && this.waterTop(nx + fx * 1.2, nz + fz * 1.2, b.pos.y) != null;
    if (ok) { b.pos.x = nx; b.pos.z = nz; } else b.speed *= -0.25;
    b.row += dt * (Math.abs(b.speed) > 0.3 ? 5 : 0);
  }
  update(dt: number, time: number) {
    for (const b of this.list) {
      if (b.target) { b.pos.lerp(b.target, Math.min(1, dt * 8)); const d = Math.atan2(Math.sin(b.targetYaw! - b.yaw), Math.cos(b.targetYaw! - b.yaw)); b.yaw += d * Math.min(1, dt * 8); }
      const top = this.waterTop(b.pos.x, b.pos.z, b.pos.y);
      if (top != null) b.pos.y += (top - 0.18 - b.pos.y) * Math.min(1, dt * 4);
      const bob = Math.sin(time * 1.6 + b.pos.x * 0.3) * 0.04;
      b.mesh.position.set(b.pos.x, b.pos.y + bob, b.pos.z);
      b.mesh.rotation.set(Math.sin(time * 1.1 + b.pos.z) * 0.03, b.yaw, Math.sin(time * 1.3) * 0.03 + (b.rider ? 0 : 0));
      const r = b.row;
      b.oars[0].rotation.set(0, Math.sin(r) * 0.6, -0.35 + Math.max(0, Math.cos(r)) * 0.25);
      b.oars[1].rotation.set(0, -Math.sin(r) * 0.6, 0.35 - Math.max(0, Math.cos(r)) * 0.25);
    }
  }
  save(): BoatSave[] { return this.list.map(b => ({ id: b.id, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), yaw: +b.yaw.toFixed(2) })); }
  load(list: BoatSave[] | undefined) { for (const s of list ?? []) this.add(s.x, s.y, s.z, s.yaw, s.id); }
}
