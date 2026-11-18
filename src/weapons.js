import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Audio } from './audio.js';
import { Time } from './time.js';

export const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.45, metalness: 0.2, flatShading: true });

/*
  Everything the player can hold. Guns shoot; the katana cuts enemies and bullets; the rest are for throwing.
  Any held item can be thrown: guns and the katana with right click / E, throwables with either button.
*/
export const KINDS = {
  pistol:       { label: 'PISTOL', gun: true, ammo: 6, speed: 40, cool: 0.12, recoil: 1 },
  rifle:        { label: 'RIFLE', gun: true, ammo: 3, speed: 65, cool: 0.6, recoil: 2.2, pierce: true },
  katana:       { label: 'KATANA', melee: true, reach: 2.2 },
  bottle:       { label: 'BOTTLE', throwable: true, stun: 1, breaks: true },
  glass:        { label: 'GLASS', throwable: true, stun: 1, breaks: true },
  extinguisher: { label: 'EXTINGUISHER', throwable: true, stun: 2.2 },
};

// How each model is normalised: which way its front points in the file, its length (or height when upright),
// and where the hand goes (fraction from the back, fraction from the bottom).
const SHAPE = {
  pistol: { fwd: '+x', len: 0.25, grip: [0.22, 0.45] },
  rifle: { fwd: '+x', len: 1.1, grip: [0.25, 0.4] },
  katana: { fwd: '+y', len: 1.0, grip: [0.12, 0.5] },
  bottle: { up: true, len: 0.24 },
  glass: { up: true, len: 0.1 },
  extinguisher: { up: true, len: 0.5 },
};

// First-person pose of each item: position and rotation in camera space.
const VIEW = {
  pistol: { p: [0.16, -0.2, -0.5], r: [0, 0, 0] },
  rifle: { p: [0.17, -0.22, -0.4], r: [0, 0, 0] },
  katana: { p: [0.3, -0.36, -0.46], r: [0.95, 0.2, -0.4] },
  bottle: { p: [0.2, -0.27, -0.45], r: [0.15, 0, 0.1] },
  glass: { p: [0.2, -0.23, -0.42], r: [0.15, 0, 0] },
  extinguisher: { p: [0.24, -0.4, -0.6], r: [0.1, 0, 0] },
};

const MAXB = 64, TRAIL = 1.5;
const V = () => new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V(), _p = V(), _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), UP = new THREE.Vector3(0, 1, 0);

/** Bake every mesh of a loaded scene into one float, non-indexed geometry (one draw call, flat facets). */
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
  if (!geos.length) throw new Error('no meshes');
  const merged = mergeGeometries(geos); merged.computeVertexNormals();
  return merged;
}

function fallbackGeometry(kind) {
  const parts = [];
  const box = (sx, sy, sz, x, y, z) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x, y, z); parts.push(b.toNonIndexed()); };
  if (kind === 'pistol') { box(0.035, 0.035, 0.22, 0, 0.05, -0.08); box(0.03, 0.11, 0.045, 0, -0.01, 0); }
  else if (kind === 'rifle') { box(0.03, 0.04, 0.8, 0, 0.03, -0.35); box(0.04, 0.12, 0.3, 0, -0.02, 0.15); }
  else if (kind === 'katana') { box(0.03, 0.006, 0.75, 0, 0, -0.5); box(0.08, 0.012, 0.08, 0, 0, -0.12); box(0.03, 0.03, 0.25, 0, 0, 0); }
  else { const c = new THREE.CylinderGeometry(0.03, 0.035, SHAPE[kind].len, 10); parts.push(c.toNonIndexed()); }
  const g = mergeGeometries(parts); g.computeVertexNormals(); return g;
}

/** A held/thrown/pickup prefab for one kind, black, with marker objects: muzzle (guns), guard and tip (katana). */
export function makePrefab(kind, scene3d, log) {
  const sh = SHAPE[kind], g = new THREE.Group(); g.name = kind;
  let geo = null;
  if (scene3d) {
    try {
      geo = bakeScene(scene3d); geo.computeBoundingBox();
      const s0 = geo.boundingBox.getSize(V());
      if (!isFinite(s0.x) || Math.max(s0.x, s0.y, s0.z) < 1e-4) throw new Error('zero-size bounds');
      if (sh.fwd === '+x') geo.rotateY(Math.PI / 2); else if (sh.fwd === '+y') geo.rotateX(-Math.PI / 2);
      geo.computeBoundingBox(); let b = geo.boundingBox;
      const L = sh.up ? b.max.y - b.min.y : b.max.z - b.min.z, k = sh.len / L;
      geo.scale(k, k, k); geo.computeBoundingBox(); b = geo.boundingBox;
      if (sh.up) geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
      else { const h = b.max.y - b.min.y, l = b.max.z - b.min.z; geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + h * sh.grip[1]), -(b.max.z - l * sh.grip[0])); }
    } catch (e) { log(`${kind} model unusable (${e.message}); using a primitive stand-in`); geo = null; }
  } else log(`${kind} model missing; using a primitive stand-in`);
  if (!geo) geo = fallbackGeometry(kind);
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, GUN_MAT); mesh.castShadow = true; g.add(mesh);
  const b = geo.boundingBox, mark = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); g.add(o); };
  if (KINDS[kind].gun) { // muzzle: the centre of whatever geometry is at the very front
    const pa = geo.attributes.position; let sy = 0, n = 0;
    for (let i = 0; i < pa.count; i++) if (pa.getZ(i) < b.min.z + 0.015) { sy += pa.getY(i); n++; }
    mark('muzzle', 0, n ? sy / n : b.max.y, b.min.z);
  }
  if (kind === 'katana') { mark('guard', 0, 0, b.min.z * 0.17); mark('tip', 0, 0, b.min.z); }
  return g;
}

/** Squared distance between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segSegDist2(p1, q1, p2, q2) {
  const d1 = _a.subVectors(q1, p1), d2 = _b.subVectors(q2, p2), r = _c.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), cl = THREE.MathUtils.clamp;
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) return r.lengthSq();
  if (a <= 1e-12) { s = 0; t = cl(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) { t = 0; s = cl(-c / a, 0, 1); }
    else {
      const bb = d1.dot(d2), den = a * e - bb * bb;
      s = den !== 0 ? cl((bb * f - c * e) / den, 0, 1) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = cl(-c / a, 0, 1); } else if (t > 1) { t = 1; s = cl((bb - c) / a, 0, 1); }
    }
  }
  const cx = p1.x + d1.x * s - (p2.x + d2.x * t), cy = p1.y + d1.y * s - (p2.y + d2.y * t), cz = p1.z + d1.z * s - (p2.z + d2.z * t);
  return cx * cx + cy * cy + cz * cz;
}

export class Weapons {
  constructor(scene, camera, prefabs, fx) {
    this.scene = scene; this.camera = camera; this.prefabs = prefabs; this.fx = fx;
    // bullets: dark slugs and red tapering trails, two instanced meshes
    this.slugs = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.022, 0.07, 2, 6), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), MAXB);
    this.trails = new THREE.InstancedMesh(new THREE.ConeGeometry(0.018, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85, depthWrite: false }), MAXB);
    for (const m of [this.slugs, this.trails]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    this.b = Array.from({ length: MAXB }, () => ({ p: V(), d: V(), speed: 0, owner: '', travel: 0, pierce: false, hits: 0 }));
    this.n = 0;
    this.pick = []; this.thrown = []; // pooled, created per kind on demand
    // first-person view models, one per kind, and a fist
    this.vm = new THREE.Group(); camera.add(this.vm);
    this.vmItems = {};
    for (const k in KINDS) { const o = prefabs[k].clone(); o.traverse(c => { c.castShadow = false; }); o.visible = false; this.vm.add(o); this.vmItems[k] = o; }
    for (const k of ['pistol', 'rifle']) {
      const f = new THREE.Mesh(new THREE.OctahedronGeometry(k === 'rifle' ? 0.06 : 0.035, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      f.visible = false; f.name = 'flash'; this.vmItems[k].getObjectByName('muzzle').add(f);
    }
    this.fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, flatShading: true, roughness: 0.6 }));
    this.fist.scale.set(1, 0.85, 1.25); this.fist.visible = false; this.vm.add(this.fist);
    this.shots = 0; this.reset('pistol');
  }

  get armed() { return !!this.held; }
  get kind() { return this.held ? KINDS[this.held] : null; }

  reset(kind = 'pistol') {
    this.n = 0; this.slugs.count = 0; this.trails.count = 0;
    for (const p of this.pick) { p.on = false; p.o.visible = false; }
    for (const t of this.thrown) { t.on = false; t.o.visible = false; }
    this.recoil = 0; this.punchT = 0; this.swingT = 0; this.flashT = 0; this.cool = 0; this.shots = 0;
    this.setHeld(kind, kind && KINDS[kind].gun ? KINDS[kind].ammo : 0);
  }

  setHeld(kind, ammo = 0) {
    this.held = kind || null; this.ammo = ammo;
    for (const k in this.vmItems) this.vmItems[k].visible = k === this.held;
  }

  placeProps(props = []) { for (const pr of props) this.dropPickup(pr.k, V().set(pr.p[0], pr.p[1], pr.p[2]), KINDS[pr.k].gun ? KINDS[pr.k].ammo : 0, pr.p[1] + 0.03); }

  /** Fire a bullet. Speeds are game-time m/s. */
  fire(owner, from, dir, speed, pierce = false) {
    if (this.n >= MAXB) return;
    const b = this.b[this.n++]; b.p.copy(from); b.d.copy(dir).normalize(); b.speed = speed; b.owner = owner; b.travel = 0; b.pierce = pierce; b.hits = 0;
  }

  /** Left click: shoot, swing, punch or throw, depending on what is in hand. */
  primary(ctx) {
    const K = this.kind;
    if (!K) return this.punch(ctx);
    if (K.melee) return this.swing();
    if (K.throwable) return this.throwHeld();
    if (this.cool > 0) return;
    Time.kick(0.15);
    if (this.ammo <= 0) { Audio.play('dry'); this.cool = 0.15; return; }
    this.ammo--; this.shots++; this.cool = K.cool; this.recoil = K.recoil; this.flashT = 0.05;
    const muzzle = this.vmItems[this.held].getObjectByName('muzzle').getWorldPosition(V());
    const dir = ctx.aimPoint().sub(muzzle).normalize();
    this.fire('player', muzzle, dir, K.speed, !!K.pierce);
    Audio.play(this.held === 'rifle' ? 'rifle' : 'shot');
  }

  swing() {
    if (this.swingT > 0) return;
    Time.kick(0.3); this.swingT = 0.3; Audio.play('swish');
  }

  /** Destroy enemy bullets that pass within r of segment a→b (the blade). Returns how many were cut. */
  sliceSegment(a, b, r = 0.07) {
    let cut = 0;
    for (let i = this.n - 1; i >= 0; i--) {
      const bl = this.b[i]; if (bl.owner === 'player') continue;
      _d.copy(bl.p).addScaledVector(bl.d, -0.2); _e.copy(bl.p);
      if (segSegDist2(a, b, _d, _e) < r * r) { this.cutBullet(i); cut++; }
    }
    return cut;
  }

  cutBullet(i) {
    const bl = this.b[i];
    this.fx.burst(bl.p, { count: 8, color: 0xffffff, speed: [1.5, 4], size: [0.015, 0.04], life: 1, up: 0.3 });
    this.fx.burst(bl.p, { count: 4, color: 0x1a1a1a, speed: [0.5, 2], size: [0.02, 0.04], life: 1.5, up: 0.2 });
    Audio.play('clang');
    this.removeBullet(i);
    this.cuts = (this.cuts || 0) + 1;
  }

  removeBullet(i) { const last = --this.n; if (i !== last) { const t = this.b[i]; this.b[i] = this.b[last]; this.b[last] = t; } }

  throwHeld() {
    if (!this.held) return;
    Time.kick(0.15);
    const fwd = this.camera.getWorldDirection(V()), o = this.vmItems[this.held];
    const pos = o.getWorldPosition(V()), quat = this.camera.getWorldQuaternion(new THREE.Quaternion());
    this.throwItem(this.held, this.ammo, pos, quat, fwd.multiplyScalar(this.held === 'extinguisher' ? 12 : 15).add(V().set(0, 1.2, 0)));
    this.setHeld(null);
  }

  /** Launch any item from pos with velocity vel (also used by VR hands). */
  throwItem(kind, ammo, pos, quat, vel) {
    let t = this.thrown.find(x => !x.on && x.kind === kind);
    if (!t) { t = { o: this.prefabs[kind].clone(), kind, on: false, v: V(), w: V(), ammo: 0 }; this.scene.add(t.o); this.thrown.push(t); }
    t.o.position.copy(pos); t.o.quaternion.copy(quat); t.v.copy(vel);
    t.w.set(kind === 'katana' ? 3 : 8 + Math.random() * 4, kind === 'katana' ? 10 : Math.random() * 2, 0);
    t.on = true; t.o.visible = true; t.ammo = ammo;
    Audio.play('whoosh');
  }

  punch(ctx) {
    if (this.punchT > 0) return;
    Time.kick(0.15);
    this.punchT = 0.24; this.fist.visible = true;
    Audio.play(ctx.punch(1.5) ? 'punch' : 'whoosh');
  }

  /** Put an item down at p; it settles at floorY (the floor, or the top of a box). */
  dropPickup(kind, p, ammo, floorY = 0.03) {
    let k = this.pick.find(x => !x.on && x.kind === kind);
    if (!k) { k = { o: this.prefabs[kind].clone(), kind, on: false, ammo: 0 }; this.scene.add(k.o); this.pick.push(k); }
    const up = SHAPE[kind].up, lift = up ? SHAPE[kind].len / 2 - 0.03 : 0;
    k.on = true; k.ammo = ammo; k.o.visible = true; k.floor = floorY + lift;
    k.o.position.set(p.x, k.floor, p.z);
    if (up) k.o.rotation.set(0, Math.random() * 6, 0); // bottles, glasses and extinguishers stand up
    else if (kind === 'pistol') k.o.rotation.set(0, Math.random() * 6, Math.PI / 2); // a pistol lies on its side
    else k.o.rotation.set(0, Math.random() * 6, 0); // the rifle and katana lie flat
    k.fall = Math.max(0, p.y - k.floor);
  }

  /** Walking over an item takes it when the hands are empty or the gun is empty. */
  tryPickup(pos, radius = 0.9) {
    if (this.held && !(this.kind.gun && this.ammo <= 0)) return false;
    const k = this.grab(pos, radius, true); if (!k) return false;
    this.setHeld(k.kind, k.ammo); this.recoil = -0.6; return true;
  }

  /** Take the nearest pickup within radius (x/z distance when flat). Returns {kind, ammo} or null. */
  grab(pos, radius, flat = false) {
    let best = null, bd = radius;
    for (const k of this.pick) {
      if (!k.on || k.fall > 0) continue;
      const d = flat ? Math.hypot(k.o.position.x - pos.x, k.o.position.z - pos.z) : k.o.position.distanceTo(pos);
      if (d < bd) { bd = d; best = k; }
    }
    if (!best) return null;
    best.on = false; best.o.visible = false; Audio.play('pickup');
    return { kind: best.kind, ammo: best.ammo };
  }

  breakItem(t, at) {
    t.on = false; t.o.visible = false;
    const glassy = t.kind === 'bottle' || t.kind === 'glass';
    this.fx.burst(at, { count: glassy ? 22 : 14, color: 0x141414, speed: [1, 3.5], size: glassy ? [0.01, 0.035] : [0.02, 0.05], life: 2 });
    Audio.play(glassy ? 'glass' : 'thud');
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
        if (b.pierce) { // rifle rounds go through every enemy on the line
          for (const e of ctx.enemies.list) { const t = e.hitTest(_a, _b); if (t >= 0 && t <= hitT && !(b.hits & (1 << e.i))) { b.hits |= 1 << e.i; e.kill(ctx, b.d); } }
        } else { const h = ctx.enemies.hit(_a, _b); if (h && h.t <= hitT) { h.e.kill(ctx, b.d); end = true; } }
      } else if (ctx.hitPlayer(_a, _b, hitT)) end = true;
      if (!end && wall) {
        _p.copy(_a).lerp(_b, wall.t);
        this.fx.burst(_p, { count: 6, color: 0x9a9a9a, speed: [0.5, 2.5], size: [0.02, 0.05], life: 1.2, up: 0.5, dir: b.d.clone().negate() });
        end = true;
      }
      b.p.copy(_b); b.travel += step;
      if (end || b.travel > 90) this.removeBullet(i);
    }
    // the katana in first person: cut bullets and enemies in front for the length of the swing
    if (this.swingT > 0) {
      this.swingT -= realDt;
      const eye = this.camera.getWorldPosition(V()), fwd = this.camera.getWorldDirection(V());
      for (let i = this.n - 1; i >= 0; i--) {
        const bl = this.b[i]; if (bl.owner === 'player') continue;
        _p.subVectors(bl.p, eye); const d = _p.length();
        if (d < 2.0 && _p.normalize().dot(fwd) > 0.2) this.cutBullet(i);
      }
      ctx.slash(KINDS.katana.reach);
    }
    // thrown items
    for (const t of this.thrown) {
      if (!t.on) continue;
      t.v.y -= 9.8 * dt; _a.copy(t.o.position); _b.copy(_a).addScaledVector(t.v, dt);
      const h = ctx.enemies.hit(_a, _b, 0.4);
      if (h) {
        if (t.kind === 'katana') { h.e.kill(ctx, t.v.clone().normalize()); t.on = false; t.o.visible = false; this.dropPickup('katana', _b, 0); continue; }
        h.e.stun(ctx, KINDS[t.kind].stun || 1);
        if (t.kind === 'extinguisher') { t.on = false; t.o.visible = false; Audio.play('thud'); this.dropPickup(t.kind, _b, 0); }
        else this.breakItem(t, _b);
        continue;
      }
      const w = ctx.level.segHit(_a, _b);
      if (w) {
        if (KINDS[t.kind].breaks) { this.breakItem(t, _p.copy(_a).lerp(_b, w.t)); continue; }
        const top = w.box !== 'floor' && _a.y >= w.box.max[1] - 0.02;
        t.on = false; t.o.visible = false; Audio.play('thud');
        this.dropPickup(t.kind, _a, t.ammo, top ? w.box.max[1] + 0.03 : 0.03);
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
    this.writeBullets();
    this.updateView(realDt, ctx);
  }

  /** First-person pose, recoil, swing and fist, in real time so it always feels responsive. */
  updateView(realDt, ctx) {
    this.recoil *= Math.exp(-12 * realDt);
    this.flashT -= realDt;
    for (const k of ['pistol', 'rifle']) this.vmItems[k].getObjectByName('flash').visible = this.flashT > 0 && this.held === k;
    if (this.held) {
      const o = this.vmItems[this.held], v = VIEW[this.held], bob = ctx.player.bob, r = this.recoil;
      o.position.set(v.p[0] + Math.sin(bob) * 0.008, v.p[1] + Math.abs(Math.cos(bob)) * 0.008 + r * 0.012, v.p[2] + r * 0.06);
      o.rotation.set(v.r[0] + r * 0.3, v.r[1], v.r[2]);
      if (this.held === 'katana' && this.swingT > 0) { // a flat cut from upper right to lower left
        const k = Math.sin((1 - this.swingT / 0.3) * Math.PI);
        o.rotation.set(v.r[0] - 1.25 * k, v.r[1] + 1.3 * k, v.r[2] - 0.7 * k);
        o.position.x -= 0.25 * k; o.position.y += 0.08 * k;
      }
    }
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
