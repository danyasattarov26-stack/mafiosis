/* First-person player: walking, running, jumping, collisions, head bob, footsteps and the box in your hands. */
import * as THREE from 'three';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { settings } from '../core/settings';
import { clamp } from '../core/util';
import { instance } from '../engine/assets';
import type { AABB } from '../world/shop';

const EYE = 1.62, R = 0.3;
const BOUNDS = { x0: -42, x1: 42, z0: -26, z1: 30 };

export class Player {
  pos = new THREE.Vector3(0, 0, 3);
  vel = new THREE.Vector3();
  yaw = Math.PI;       // facing −Z (into the shop)
  pitch = -0.05;
  vy = 0;
  grounded = true;
  speedMul = 1;
  moving = false;
  frozen = false;
  private bob = 0;
  private stepT = 0;
  hand = new THREE.Group();
  private carryObj: THREE.Object3D | null = null;
  private carryKey = '';

  constructor(public camera: THREE.PerspectiveCamera) {
    camera.add(this.hand);
    this.hand.position.set(0, -0.42, -0.62);
  }

  setCarry(key: string | null, empty = false, labelTex?: THREE.Texture) {
    if ((key || '') === this.carryKey) return;
    this.carryKey = key || '';
    if (this.carryObj) { this.hand.remove(this.carryObj); this.carryObj = null; }
    if (!key) return;
    const g = new THREE.Group();
    const m = instance(empty ? 'cardboardBoxOpen' : 'cardboardBoxClosed');
    m.scale.setScalar(empty ? 0.6 : 0.8);
    m.traverse((o: any) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    g.add(m);
    if (labelTex && !empty) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.1), new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })); l.position.set(0, 0.3, 0.172); g.add(l); }
    g.position.y = -0.18;
    this.hand.add(g); this.carryObj = g;
  }

  look(dx: number, dy: number) {
    const s = 0.0022 * settings.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
  }

  update(dt: number, colliders: AABB[]) {
    if (!this.frozen) this.look(input.lookX, input.lookY);
    const mv = this.frozen ? { x: 0, y: 0 } : input.move;
    const run = input.run;
    const speed = (run ? 5.4 : 3.3) * this.speedMul;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is (−sin, −cos) because the camera looks down −Z at yaw 0
    const wx = (-sin * mv.y + cos * mv.x) * speed, wz = (-cos * mv.y - sin * mv.x) * speed;
    const k = this.grounded ? 14 : 3;
    this.vel.x += (wx - this.vel.x) * Math.min(1, dt * k);
    this.vel.z += (wz - this.vel.z) * Math.min(1, dt * k);
    if (!this.frozen && input.pressed('jump') && this.grounded) { this.vy = 4.6; this.grounded = false; }
    this.vy -= 13 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.grounded = true; }
    // move per axis and resolve collisions against boxes (circle vs AABB)
    this.pos.x += this.vel.x * dt; this.collide(colliders);
    this.pos.z += this.vel.z * dt; this.collide(colliders);
    this.pos.x = clamp(this.pos.x, BOUNDS.x0, BOUNDS.x1); this.pos.z = clamp(this.pos.z, BOUNDS.z0, BOUNDS.z1);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moving = hs > 0.5;
    if (this.moving && this.grounded) {
      this.bob += dt * hs * 2.2;
      this.stepT -= dt * hs;
      if (this.stepT <= 0) { this.stepT = 1.55; audio.play(this.pos.z < 0 ? 'stepCarpet' : 'step', { vol: 0.35 }); }
    }
    const bobY = this.grounded ? Math.sin(this.bob * 2) * 0.035 * Math.min(1, hs / 3) : 0;
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.hand.position.y = -0.42 + bobY * 0.6;
  }

  private collide(cs: AABB[]) {
    for (const c of cs) {
      if (c.y1 !== undefined && this.pos.y > c.y1 - 0.05) continue;
      const nx = clamp(this.pos.x, c.x0, c.x1), nz = clamp(this.pos.z, c.z0, c.z1);
      const dx = this.pos.x - nx, dz = this.pos.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), push = R - d; this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push; }
      else {
        // centre inside the box: push out the shortest way
        const l = this.pos.x - c.x0, r = c.x1 - this.pos.x, b = this.pos.z - c.z0, f = c.z1 - this.pos.z, m = Math.min(l, r, b, f);
        if (m === l) this.pos.x = c.x0 - R; else if (m === r) this.pos.x = c.x1 + R; else if (m === b) this.pos.z = c.z0 - R; else this.pos.z = c.z1 + R;
      }
    }
  }

  /** where the camera ray hits the floor (y = 0), if within reach */
  floorHit(maxDist = 6): THREE.Vector3 | null {
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    if (dir.y > -0.05) return null;
    const t = -this.camera.position.y / dir.y;
    if (t > maxDist) return null;
    return this.camera.position.clone().addScaledVector(dir, t);
  }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}
