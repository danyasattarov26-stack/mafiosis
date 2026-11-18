import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Audio } from './audio.js';
import { Time } from './time.js';

export const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.45, metalness: 0.2, flatShading: true });
const LEN = 0.25, MAXB = 64, TRAIL = 1.5, PLAYER_SPEED = 40, AMMO = 6;
const V = () => new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V(), _p = V(), _a = V(), _b = V(), UP = new THREE.Vector3(0, 1, 0);

/** Bake every mesh of a loaded scene into one float geometry (one draw call, no quantized attributes). */
function bakeScene(root) {
  root.updateWorldMatrix(true, true);
  const geos = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = new THREE.BufferGeometry(), src = o.geometry, pa = src.attributes.position, n = pa.count;
    const P = new Float32Array(n * 3), v = V();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); P.set([v.x, v.y, v.z], i * 3); }
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (src.index) g.setIndex(Array.from(src.index.array));
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  const merged = mergeGeometries(geos); merged.computeVertexNormals(); // non-indexed: flat facets
  return merged;
}

/**
  The pistol prefab: 0.25 m long, muzzle along -z, origin at the grip, black material.
  Uses the loaded model, or a box pistol if it is missing or broken.
*/
export function makeGunPrefab(scene3d, log) {
  const g = new THREE.Group(); g.name = 'gun';
  let geo = null;
  if (scene3d) {
    try {
      geo = bakeScene(scene3d); geo.computeBoundingBox();
      const s = geo.boundingBox.getSize(V());
      if (!isFinite(s.x) || Math.max(s.x, s.y, s.z) < 1e-4) { log('pistol model has zero-size bounds; using a box pistol'); geo = null; }
      else {
        // the barrel runs along the longest horizontal axis; turn it onto -z
        if (s.x >= s.z) geo.rotateY(Math.PI / 2); else geo.rotateY(Math.PI);
        if (s.y > Math.max(s.x, s.z) * 1.2) log('pistol model is taller than long; check orientation');
        geo.computeBoundingBox(); const b = geo.boundingBox, len = b.max.z - b.min.z, k = LEN / len;
        geo.scale(k, k, k); geo.computeBoundingBox();
        const bb = geo.boundingBox, h = bb.max.y - bb.min.y;
        // origin at the grip: back third of the gun, lower half
        geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + h * 0.45), -(bb.max.z - (bb.max.z - bb.min.z) * 0.22));
      }
    } catch (e) { log('pistol model failed to bake: ' + e.message); geo = null; }
  }
  if (!geo) { // primitive stand-in
    const body = new THREE.BoxGeometry(0.035, 0.035, 0.22); body.translate(0, 0.05, -0.08);
    const grip = new THREE.BoxGeometry(0.03, 0.11, 0.045); grip.rotateX(0.25); grip.translate(0, -0.01, 0);
    geo = mergeGeometries([body.toNonIndexed(), grip.toNonIndexed()]); geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, GUN_MAT); mesh.castShadow = true; g.add(mesh);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle';
  muzzle.position.set(0, geo.boundingBox.max.y - 0.02, geo.boundingBox.min.z); g.add(muzzle);
  return g;
}

export class Weapons {
  constructor(scene, camera, prefab, fx) {
    this.scene = scene; this.camera = camera; this.prefab = prefab; this.fx = fx;
    // bullets: dark slugs and red tapering trails, two instanced meshes
    const slugGeo = new THREE.CapsuleGeometry(0.022, 0.07, 2, 6);
    const trailGeo = new THREE.ConeGeometry(0.018, 1, 6, 1, true);
    this.slugs = new THREE.InstancedMesh(slugGeo, new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), MAXB);
    this.trails = new THREE.InstancedMesh(trailGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85, depthWrite: false }), MAXB);
    for (const m of [this.slugs, this.trails]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    this.b = Array.from({ length: MAXB }, () => ({ p: V(), d: V(), speed: 0, owner: '', travel: 0 }));
    this.n = 0;
    // pickups and thrown guns are pooled clones of the prefab
    this.pick = Array.from({ length: 16 }, () => { const o = prefab.clone(); o.visible = false; scene.add(o); return { o, on: false, ammo: 0, spin: Math.random() * 6 }; });
    this.thrown = Array.from({ length: 4 }, () => { const o = prefab.clone(); o.visible = false; scene.add(o); return { o, on: false, v: V(), w: V(), ammo: 0 }; });
    // first-person view model: the held gun and a fist
    this.vm = new THREE.Group(); camera.add(this.vm);
    this.vmGun = prefab.clone(); this.vmGun.traverse(o => { o.castShadow = false; }); this.vm.add(this.vmGun);
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.flash.visible = false; this.vmGun.getObjectByName('muzzle').add(this.flash);
    this.fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, flatShading: true, roughness: 0.6 }));
    this.fist.scale.set(1, 0.85, 1.25); this.fist.visible = false; this.vm.add(this.fist);
    this.vmBase = new THREE.Vector3(0.16, -0.2, -0.5);
    this.reset();
  }

  reset(armed = true) {
    this.n = 0; this.slugs.count = 0; this.trails.count = 0;
    for (const p of this.pick) { p.on = false; p.o.visible = false; }
    for (const t of this.thrown) { t.on = false; t.o.visible = false; }
    this.ammo = armed ? AMMO : 0; this.armed = armed; this.recoil = 0; this.punchT = 0; this.flashT = 0; this.cool = 0;
    this.vmGun.visible = armed;
  }

  /** Fire a bullet. Speeds are game-time m/s. */
  fire(owner, from, dir, speed) {
    if (this.n >= MAXB) return;
    const b = this.b[this.n++]; b.p.copy(from); b.d.copy(dir).normalize(); b.speed = speed; b.owner = owner; b.travel = 0;
  }

  /** Player pulls the trigger. aimPoint: what the crosshair is on. */
  shoot(ctx) {
    if (!this.armed) return this.punch(ctx);
    if (this.cool > 0) return;
    Time.kick(0.15);
    if (this.ammo <= 0) { Audio.play('dry'); this.cool = 0.15; return; }
    this.ammo--; this.cool = 0.12; this.recoil = 1; this.flashT = 0.05;
    const muzzle = this.vmGun.getObjectByName('muzzle').getWorldPosition(V());
    const dir = ctx.aimPoint().sub(muzzle).normalize();
    this.fire('player', muzzle, dir, PLAYER_SPEED);
    Audio.play('shot');
  }

  throwGun(ctx) {
    if (!this.armed) return;
    const t = this.thrown.find(x => !x.on); if (!t) return;
    Time.kick(0.15);
    const fwd = this.camera.getWorldDirection(V());
    this.vmGun.getWorldPosition(t.o.position); t.o.quaternion.copy(this.camera.getWorldQuaternion(_q));
    t.v.copy(fwd).multiplyScalar(15).add(V().set(0, 1.2, 0)); t.w.set(8 + Math.random() * 4, Math.random() * 2, 0);
    t.on = true; t.o.visible = true; t.ammo = this.ammo;
    this.armed = false; this.ammo = 0; this.vmGun.visible = false;
    Audio.play('whoosh');
  }

  punch(ctx) {
    if (this.punchT > 0) return;
    Time.kick(0.15);
    this.punchT = 0.24; this.fist.visible = true;
    const r = ctx.punch(1.5);
    Audio.play(r ? 'punch' : 'whoosh');
  }

  /** Drop a pistol at p; it falls to floorY (the floor, or the top of a box). */
  dropPickup(p, ammo, floorY = 0.03) {
    const k = this.pick.find(x => !x.on) || this.pick[0];
    k.on = true; k.ammo = ammo; k.o.visible = true; k.floor = floorY; k.o.position.set(p.x, floorY, p.z); k.o.rotation.set(0, Math.random() * 6, Math.PI / 2);
    k.fall = Math.max(0, p.y - floorY);
  }

  /** Grab a pistol off the floor when walking over it, if unarmed or out of ammo. */
  tryPickup(pos, radius = 0.9) {
    if (this.armed && this.ammo > 0) return false;
    for (const k of this.pick) {
      if (!k.on || k.fall > 0) continue;
      if (Math.hypot(k.o.position.x - pos.x, k.o.position.z - pos.z) < radius) {
        k.on = false; k.o.visible = false; this.armed = true; this.ammo = k.ammo; this.vmGun.visible = true; this.recoil = -0.6;
        Audio.play('pickup'); return true;
      }
    }
    return false;
  }

  update(dt, realDt, ctx) {
    this.cool -= realDt;
    // bullets
    for (let i = this.n - 1; i >= 0; i--) {
      const b = this.b[i], step = b.speed * dt;
      _a.copy(b.p); _b.copy(b.p).addScaledVector(b.d, step);
      let end = false, hitT = 1;
      const wall = ctx.level.segHit(_a, _b);
      if (wall) hitT = wall.t;
      if (b.owner === 'player') {
        const h = ctx.enemies.hit(_a, _b);
        if (h && h.t <= hitT) { h.e.kill(ctx, b.d); end = true; }
      } else if (ctx.hitPlayer(_a, _b, hitT)) { end = true; }
      if (!end && wall) {
        _p.copy(_a).lerp(_b, wall.t);
        this.fx.burst(_p, { count: 6, color: 0x9a9a9a, speed: [0.5, 2.5], size: [0.02, 0.05], life: 1.2, up: 0.5, dir: b.d.clone().negate() });
        end = true;
      }
      b.p.copy(_b); b.travel += step;
      if (end || b.travel > 90) { const last = --this.n; if (i !== last) { const t = this.b[i]; this.b[i] = this.b[last]; this.b[last] = t; } }
    }
    this.writeBullets();
    // thrown guns
    for (const t of this.thrown) {
      if (!t.on) continue;
      t.v.y -= 9.8 * dt; _a.copy(t.o.position); _b.copy(_a).addScaledVector(t.v, dt);
      const h = ctx.enemies.hit(_a, _b, 0.4);
      if (h) { // stuns the enemy and breaks
        h.e.stun(ctx); t.on = false; t.o.visible = false;
        this.fx.burst(_b, { count: 14, color: 0x141414, speed: [1, 3], size: [0.02, 0.05], life: 2 });
        continue;
      }
      const w = ctx.level.segHit(_a, _b);
      if (w) {
        const top = w.box !== 'floor' && _a.y >= w.box.max[1] - 0.02;
        t.on = false; t.o.visible = false; Audio.play('thud');
        this.dropPickup(_a, t.ammo, top ? w.box.max[1] + 0.03 : 0.03);
        continue;
      }
      t.o.position.copy(_b); t.o.rotation.x += t.w.x * dt; t.o.rotation.y += t.w.y * dt;
    }
    // pickups settle and turn slowly
    for (const k of this.pick) {
      if (!k.on) continue;
      if (k.fall > 0) { k.fall = Math.max(0, k.fall - dt * 3); k.o.position.y = k.floor + k.fall; }
      k.o.rotation.y += dt * 0.6;
    }
    // view model: bob, recoil and the fist, in real time so it always feels responsive
    this.recoil *= Math.exp(-14 * realDt);
    this.flashT -= realDt; this.flash.visible = this.flashT > 0;
    const bob = ctx.player.bob;
    this.vmGun.position.set(this.vmBase.x + Math.sin(bob) * 0.008, this.vmBase.y + Math.abs(Math.cos(bob)) * 0.008 + this.recoil * 0.012, this.vmBase.z + this.recoil * 0.06);
    this.vmGun.rotation.set(this.recoil * 0.35, 0, 0);
    if (this.punchT > 0) {
      this.punchT -= realDt; const k = Math.sin(Math.max(0, this.punchT) / 0.24 * Math.PI);
      this.fist.position.set(0.12 - k * 0.08, -0.17 + k * 0.04, -0.3 - k * 0.32);
      if (this.punchT <= 0) this.fist.visible = false;
    }
  }

  writeBullets() {
    for (let i = 0; i < this.n; i++) {
      const b = this.b[i], len = Math.min(TRAIL, b.travel + 0.02);
      _q.setFromUnitVectors(UP, b.d);
      this.slugs.setMatrixAt(i, _m.compose(b.p, _q, _s.set(1, 1, 1)));
      _q.setFromUnitVectors(UP, _p.copy(b.d).negate());
      this.trails.setMatrixAt(i, _m.compose(_a.copy(b.p).addScaledVector(b.d, -len / 2), _q, _s.set(1, len, 1)));
    }
    this.slugs.count = this.trails.count = this.n;
    this.slugs.instanceMatrix.needsUpdate = this.trails.instanceMatrix.needsUpdate = true;
  }

  snapshot() { const out = []; for (let i = 0; i < this.n; i++) { const b = this.b[i]; out.push(b.p.x, b.p.y, b.p.z, b.d.x, b.d.y, b.d.z, b.travel); } return out; }

  restore(s) {
    this.n = Math.min(MAXB, s.length / 7);
    for (let i = 0; i < this.n; i++) { const b = this.b[i], k = i * 7; b.p.set(s[k], s[k + 1], s[k + 2]); b.d.set(s[k + 3], s[k + 4], s[k + 5]); b.travel = s[k + 6]; }
    this.writeBullets();
  }

  /** Test hook: how far has bullet i travelled. */
  bulletTravel(i = 0) { return this.n > i ? this.b[i].travel : -1; }
}
