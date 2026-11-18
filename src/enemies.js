import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Audio } from './audio.js';
import { KINDS } from './weapons.js';

export const ENEMY_MAT = new THREE.MeshStandardMaterial({ color: 0xe8262b, roughness: 0.35, flatShading: true });
const HEIGHT = 1.8, RADIUS = 0.32, SPEED = 1.6;
// enemy weapons: bullet speed (game m/s), spread, first shot after seeing you, then the gap between shots
const ARMS = {
  pistol: { speed: 18, spread: THREE.MathUtils.degToRad(1.5), first: 1.2, gap: [1.8, 3.0], sound: 'enemyShot' },
  rifle: { speed: 26, spread: THREE.MathUtils.degToRad(0.8), first: 1.6, gap: [3.0, 4.0], sound: 'rifle' },
};
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const BONES = { thighL: /^thigh_l$|left.?up.?leg/i, thighR: /^thigh_r$|right.?up.?leg/i, calfL: /^calf_l$|left.?leg$/i, calfR: /^calf_r$|right.?leg$/i,
  spine: /^spine_02$|^spine1?$/i, head: /^head$/i, upperR: /^upperarm_r$|right.?arm$/i, lowerR: /^lowerarm_r$|right.?fore.?arm/i, handR: /^hand_r$|right.?hand$/i,
  upperL: /^upperarm_l$|left.?arm$/i, lowerL: /^lowerarm_l$|left.?fore.?arm/i, handL: /^hand_l$|left.?hand$/i };

function findBones(root) {
  const out = {};
  root.traverse(o => { if (!o.isBone) return; for (const k in BONES) if (!out[k] && BONES[k].test(o.name)) out[k] = o; });
  return out;
}

/** Rotate `bone` so the direction bone→child points along dirWorld. */
function pointBone(bone, child, dirWorld) {
  bone.updateWorldMatrix(true, true);
  const from = child.getWorldPosition(_a).sub(bone.getWorldPosition(_b)).normalize();
  const q = _q1.setFromUnitVectors(from, _c.copy(dirWorld).normalize());
  const world = bone.getWorldQuaternion(_q2).premultiply(q);
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentQ.multiply(world));
  bone.updateWorldMatrix(false, true);
}

/**
  Turn the loaded enemy model into a template: red flat material, 1.8 m tall, feet on y=0, facing +z,
  arms posed to aim, a pistol in the right hand. Falls back to a capsule if the model is missing or broken.
*/
export function makeEnemyTemplate(scene3d, prefabs, log) {
  const root = new THREE.Group(); root.name = 'enemy';
  let model = scene3d, ok = !!model;
  if (ok) {
    const drop = []; model.traverse(o => { if (o.isMesh && /eyebrow|eyelash|high-poly|eye/i.test(o.name)) drop.push(o); });
    drop.forEach(o => o.parent.remove(o)); // tiny face meshes: invisible at this size, they only cost draw calls
    model.traverse(o => { if (o.isMesh) { o.material = ENEMY_MAT; o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model, true), size = box.getSize(V());
    if (!isFinite(size.y) || size.y < 1e-3 || size.y > 1e4) { log('enemy model has zero or extreme bounds; using a capsule'); ok = false; }
    else {
      if (size.z > size.y * 1.3) { model.rotation.x = -Math.PI / 2; log('enemy model looked Z-up; rotated'); model.updateWorldMatrix(true, true); box.setFromObject(model, true); box.getSize(size); }
      const s = HEIGHT / size.y; model.scale.multiplyScalar(s);
      model.updateWorldMatrix(true, true); box.setFromObject(model, true);
      const c = box.getCenter(V()); model.position.x -= c.x; model.position.z -= c.z; model.position.y -= box.min.y;
      root.add(model); root.updateWorldMatrix(true, true);
    }
  }
  const bones = ok ? findBones(root) : {};
  if (ok) {
    // which way does it face? the right hand is on the -x side when facing +z
    if (bones.handR && bones.handR.getWorldPosition(V()).x > 0) { model.rotation.y += Math.PI; root.updateWorldMatrix(true, true); log('enemy model faced -z; turned'); }
    if (bones.upperR && bones.lowerR && bones.handR) {
      pointBone(bones.upperR, bones.lowerR, V().set(-0.05, 0.05, 1));
      pointBone(bones.lowerR, bones.handR, V().set(-0.08, 0.04, 1));
    }
    if (bones.upperL && bones.lowerL && bones.handL) {
      pointBone(bones.upperL, bones.lowerL, V().set(0.14, -1, 0.08));
      pointBone(bones.lowerL, bones.handL, V().set(0.06, -1, 0.2));
    }
    if (!bones.thighL) log('enemy model has no animations or leg bones; using a procedural bob only');
    else log('enemy model has no animations; using a procedural walk and sway');
  } else {
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), ENEMY_MAT);
    cap.position.y = 0.9; cap.castShadow = true; root.add(cap);
    const hand = new THREE.Object3D(); hand.position.set(-0.22, 1.35, 0.45); root.add(hand); bones.handR = hand;
  }
  // a pistol and a rifle in the right hand (one shown at a time): aim along +z, the prefabs' forward is -z
  root.updateWorldMatrix(true, true);
  const hand = bones.handR;
  for (const kind of ['pistol', 'rifle']) {
    const gun = prefabs[kind].clone(); gun.name = 'egun_' + kind;
    const hp = hand.getWorldPosition(V());
    _m1.compose(hp.add(V().set(0, -0.01, 0.04)), new THREE.Quaternion().setFromAxisAngle(V().set(0, 1, 0), Math.PI), V().set(1, 1, 1));
    _m2.copy(hand.matrixWorld).invert().multiply(_m1);
    _m2.decompose(gun.position, gun.quaternion, gun.scale);
    hand.add(gun);
  }
  // per-bone axes for the procedural walk: the root's x axis (pitch) and z axis (roll) in each bone's own frame
  const axes = {};
  for (const k of ['thighL', 'thighR', 'calfL', 'calfR', 'spine', 'head', 'upperR']) {
    const b = bones[k]; if (!b) continue;
    const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
    axes[k] = { x: V().set(1, 0, 0).applyQuaternion(inv), z: V().set(0, 0, 1).applyQuaternion(inv) };
  }
  root.userData = { skinned: ok, axes };
  return root;
}

class Enemy {
  constructor(template, scene, i) {
    this.root = SkeletonUtils.clone(template); // a plain .clone() breaks skinned meshes
    this.root.visible = false; scene.add(this.root);
    this.i = i; this.bones = findBones(this.root); this.axes = template.userData.axes;
    this.rest = {}; for (const k in this.axes) if (this.bones[k]) this.rest[k] = this.bones[k].quaternion.clone();
    this.guns = { pistol: this.root.getObjectByName('egun_pistol'), rifle: this.root.getObjectByName('egun_rifle') };
    this.weapon = 'pistol'; this.pos = V(); this.state = 'off';
  }

  get gun() { return this.guns[this.weapon]; }
  get muzzle() { return this.gun.getObjectByName('muzzle'); }
  showGun() { for (const k in this.guns) this.guns[k].visible = this.armed && k === this.weapon; }

  spawn(x, z, weapon = 'pistol', speedMul = 1) {
    this.weapon = ARMS[weapon] ? weapon : 'pistol'; this.speedMul = speedMul;
    this.pos.set(x, 0, z); this.ry = 0; this.phase = Math.random() * 6; this.state = 'walk'; this.armed = true; this.showGun();
    this.seen = false; this.shotT = ARMS[this.weapon].first; this.stunT = 0; this.punchT = 0; this.walkW = 0; this.lean = 0; this.root.visible = true;
    this.apply();
  }

  get alive() { return this.state !== 'off' && this.state !== 'dead'; }

  bend(k, ax, ang, mul = true) {
    const b = this.bones[k]; if (!b) return;
    if (!mul) b.quaternion.copy(this.rest[k]);
    b.quaternion.multiply(_q1.setFromAxisAngle(this.axes[k][ax], ang));
  }

  apply() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.ry, 0);
    const w = this.walkW, s = Math.sin(this.phase), bob = Math.abs(Math.cos(this.phase));
    if (this.bones.thighL) {
      this.bend('thighL', 'x', -s * 0.45 * w, false); this.bend('thighR', 'x', s * 0.45 * w, false);
      this.bend('calfL', 'x', Math.max(0, s) * 0.7 * w, false); this.bend('calfR', 'x', Math.max(0, -s) * 0.7 * w, false);
      this.bend('spine', 'z', Math.sin(this.phase * 0.5) * 0.04 + this.lean * 0.1, false); this.bend('spine', 'x', -this.lean * 0.5);
      this.bend('head', 'x', 0, false); this.bend('upperR', 'x', 0, false);
      this.root.position.y = this.pos.y + bob * 0.04 * w;
    } else {
      this.root.position.y = this.pos.y + bob * 0.05 * (w + 0.3);
      this.root.rotation.z = Math.sin(this.phase * 0.5) * 0.03 + this.lean * 0.1;
    }
  }

  /** Line-of-sight check from the chest to the player's chest. */
  canSee(ctx) { return ctx.level.los(_a.set(this.pos.x, 1.45, this.pos.z), _b.set(ctx.player.pos.x, 1.4, ctx.player.pos.z)); }

  update(dt, ctx) {
    if (!this.alive) return;
    const P = ctx.player.pos, dx = P.x - this.pos.x, dz = P.z - this.pos.z, dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    if (this.state === 'stun') {
      this.stunT -= dt; this.lean = Math.min(1, this.lean + dt * 4); this.walkW = Math.max(0, this.walkW - dt * 4);
      if (this.stunT <= 0) { this.state = 'walk'; this.shotT = ARMS[this.weapon].first; }
      this.apply(); return;
    }
    this.lean = Math.max(0, this.lean - dt * 3);
    let d = this.ry - want; d = Math.atan2(Math.sin(d), Math.cos(d)); this.ry -= d * Math.min(1, dt * 6);
    const see = this.canSee(ctx);
    let move = false;
    if (this.armed) {
      move = !see || dist > 15 || (dist > 8 && !this.seen);
      if (see && dist <= 15) {
        const A = ARMS[this.weapon];
        if (!this.seen) { this.seen = true; this.shotT = A.first; } // first shot comes a beat after acquiring the player
        if (dist <= 15 && dist >= 8) move = false;
        if (dist < 8) move = false;
        this.shotT -= dt;
        if (this.shotT <= 0 && Math.abs(d) < 0.25) { this.fire(ctx); this.shotT = A.gap[0] + Math.random() * (A.gap[1] - A.gap[0]); }
      } else if (!see) this.seen = false;
    } else { // disarmed: close in and punch
      move = dist > 0.9;
      if (!move) { this.punchT += dt; if (this.punchT > 0.6) { this.punchT = 0; ctx.punchPlayer(this); } } else this.punchT = Math.max(0, this.punchT - dt);
    }
    if (move) {
      let dir = Math.atan2(dx, dz);
      // feelers: if a box blocks the way, try angling around it
      for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
        const a = dir + off; _c.set(this.pos.x + Math.sin(a) * 1.1, 0, this.pos.z + Math.cos(a) * 1.1);
        if (!ctx.level.insideAny(_c.x, _c.z, RADIUS)) { dir = a; break; }
      }
      const sp = SPEED * (this.armed ? 1 : 1.35) * (this.speedMul || 1);
      this.pos.x += Math.sin(dir) * sp * dt; this.pos.z += Math.cos(dir) * sp * dt;
      ctx.level.collideCircle(this.pos, RADIUS);
      this.walkW = Math.min(1, this.walkW + dt * 4); this.phase += dt * sp * 4.2;
    } else { this.walkW = Math.max(0, this.walkW - dt * 4); this.phase += dt * 1.2; }
    this.apply();
  }

  fire(ctx) {
    this.root.updateWorldMatrix(true, true);
    const from = (this.muzzle || this.gun).getWorldPosition(V());
    const to = V().set(ctx.player.pos.x, ctx.player.eyeY - 0.25, ctx.player.pos.z);
    const dir = to.sub(from).normalize(), A = ARMS[this.weapon];
    // a small cone of spread
    const perp = V().crossVectors(dir, Math.abs(dir.y) < 0.9 ? V().set(0, 1, 0) : V().set(1, 0, 0)).normalize();
    perp.applyAxisAngle(dir, Math.random() * Math.PI * 2);
    dir.applyAxisAngle(perp, Math.random() * A.spread);
    ctx.weapons.fire('enemy', from, dir, A.speed);
    Audio.play(A.sound);
  }

  handWorld() { this.root.updateWorldMatrix(true, true); return this.gun.getWorldPosition(V()); }

  dropGun(ctx) {
    if (!this.armed) return;
    const p = this.handWorld(); this.armed = false; this.showGun();
    ctx.weapons.dropPickup(this.weapon, p, KINDS[this.weapon].ammo);
  }

  stun(ctx, secs = 1) { if (!this.alive) return; this.dropGun(ctx); this.state = 'stun'; this.stunT = Math.max(this.stunT || 0, secs); Audio.play('thud'); }

  kill(ctx, dir) {
    if (!this.alive) return;
    this.dropGun(ctx);
    this.state = 'dead'; this.root.visible = false;
    ctx.fx.burst(this.pos, { count: 40, color: 0xe8262b, speed: [2, 6], size: [0.05, 0.15], height: [0.15, 1.75], radius: 0.25, life: 3, dir });
    Audio.play('shatter');
    ctx.onKill && ctx.onKill(this);
  }

  /** Swept test of segment a→b against this enemy's capsule. Returns the hit parameter t or -1. */
  hitTest(a, b, r = RADIUS) {
    if (!this.alive) return -1;
    return segCapsule(a, b, this.pos.x, 0.12, this.pos.z, 1.72, r);
  }
}

/** Closest approach of segment a→b to a vertical capsule; returns t along a→b when within r, else -1. */
export function segCapsule(a, b, cx, y0, cz, y1, r) {
  // segment vs segment closest points (capsule axis is vertical)
  const d1x = b.x - a.x, d1y = b.y - a.y, d1z = b.z - a.z, d2y = y1 - y0;
  const rx = a.x - cx, ry = a.y - y0, rz = a.z - cz;
  const A = d1x * d1x + d1y * d1y + d1z * d1z, E = d2y * d2y, F = d2y * ry;
  let s, t;
  if (A < 1e-12) { s = 0; t = Math.min(1, Math.max(0, F / E)); }
  else {
    const C = d1x * rx + d1y * ry + d1z * rz, B = d1y * d2y, den = A * E - B * B;
    s = den > 1e-12 ? Math.min(1, Math.max(0, (B * F - C * E) / den)) : 0;
    t = (B * s + F) / E;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -C / A)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (B - C) / A)); }
  }
  const px = a.x + d1x * s - cx, py = a.y + d1y * s - (y0 + d2y * t), pz = a.z + d1z * s - cz;
  return px * px + py * py + pz * pz <= r * r ? s : -1;
}

export class Enemies {
  constructor(scene, template, count = 8) {
    this.list = Array.from({ length: count }, (_, i) => new Enemy(template, scene, i));
    this.queue = []; this.wave = 0;
  }

  start(level) {
    this.L = level; this.wave = -1; this.queue = []; this.t = 0;
    for (const e of this.list) { e.state = 'off'; e.root.visible = false; }
    this.used = 0; this.nextWave();
  }

  nextWave() {
    this.wave++;
    let w = this.L.waves[this.wave];
    if (this.L.gauntlet) { // endless: each wave is bigger, quicker to arrive, faster and better armed
      const n = this.wave, count = Math.min(14, 2 + n), gap = Math.max(0.5, 1.8 - n * 0.1), sp = this.L.spawns;
      w = Array.from({ length: count }, (_, i) => ({ s: Math.floor(Math.random() * sp.length), d: i * gap, w: Math.random() < Math.min(0.45, 0.06 * n) ? 'rifle' : 'pistol' }));
      this.speedMul = Math.min(1.6, 1 + n * 0.05);
      this.onWave && this.onWave(n);
    }
    if (!w) return false;
    this.t = 0; this.queue = w.map(x => ({ s: x.s, d: x.d || 0, w: x.w || 'pistol' })).sort((a, b) => a.d - b.d);
    return true;
  }

  get done() { return !this.L.gauntlet && this.wave >= this.L.waves.length; }

  update(dt, ctx) {
    this.t += dt;
    while (this.queue.length && this.queue[0].d <= this.t) {
      const e = this.list.find(x => !x.alive); if (!e) break; // all bodies busy: the rest wait their turn
      const q = this.queue.shift(), sp = this.L.spawns[q.s];
      e.spawn(sp[0], sp[1], q.w, this.L.gauntlet ? this.speedMul : 1); e.ry = Math.atan2(ctx.player.pos.x - sp[0], ctx.player.pos.z - sp[1]); e.apply();
      ctx.fx.burst(e.pos, { count: 10, color: 0xe8262b, speed: [0.3, 1], size: [0.03, 0.07], height: [0, 1.8], radius: 0.35, life: 0.8, up: 0.2 });
    }
    for (const e of this.list) e.update(dt, ctx);
    // keep them from stacking up
    for (let i = 0; i < this.list.length; i++) for (let j = i + 1; j < this.list.length; j++) {
      const a = this.list[i], b = this.list[j]; if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), m = RADIUS * 2;
      if (d < m && d > 1e-4) { const k = (m - d) / d / 2; a.pos.x -= dx * k; a.pos.z -= dz * k; b.pos.x += dx * k; b.pos.z += dz * k; }
    }
    if (!this.queue.length && !this.list.some(e => e.alive) && !this.done) this.nextWave();
  }

  get aliveCount() { return this.list.filter(e => e.alive).length; }

  /** Nearest enemy hit by segment a→b: {e, t} or null. */
  hit(a, b, r) {
    let best = null;
    for (const e of this.list) { const t = e.hitTest(a, b, r); if (t >= 0 && (!best || t < best.t)) best = { e, t }; }
    return best;
  }

  snapshot() { return this.list.map(e => [e.pos.x, e.pos.z, e.ry, e.phase, e.walkW, e.lean, e.alive ? 1 : 0, e.armed ? (e.weapon === 'rifle' ? 2 : 1) : 0]); }

  restore(snap) {
    snap.forEach((s, i) => { const e = this.list[i]; e.pos.set(s[0], 0, s[1]); e.ry = s[2]; e.phase = s[3]; e.walkW = s[4]; e.lean = s[5]; e.root.visible = !!s[6]; e.armed = !!s[7]; e.weapon = s[7] === 2 ? 'rifle' : 'pistol'; e.showGun(); if (s[6]) e.apply(); });
  }
}
