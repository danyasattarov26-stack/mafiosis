import * as THREE from 'three';

/*
  All shards live in one pooled InstancedMesh of tetrahedra (one draw call).
  Enemy deaths burst ~40 red shards; bullet impacts and broken guns use small grey or black ones.
  Shards move in game time, bounce on the floor, and shrink away at the end of their life.
*/
const MAX = 720;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

export class FX {
  constructor(scene) {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.s = Array.from({ length: MAX }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), size: 0.1, life: 0, max: 1, col: new THREE.Color() }));
    this.n = 0; // live shards are packed into s[0..n)
    this.flashes = [];
  }

  /** Spawn shards. opts: {count, color, speed:[a,b], size:[a,b], life, height:[y0,y1], radius, dir (bias Vector3), up} */
  burst(center, o = {}) {
    const count = o.count || 40, sp = o.speed || [2, 6], sz = o.size || [0.05, 0.14], h = o.height || [0, 0], rad = o.radius || 0;
    const col = new THREE.Color(o.color ?? 0xe8262b);
    for (let i = 0; i < count; i++) {
      if (this.n >= MAX) this.recycle();
      const s = this.s[this.n++];
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * rad;
      s.p.set(center.x + Math.cos(a) * rr, center.y + h[0] + Math.random() * (h[1] - h[0]), center.z + Math.sin(a) * rr);
      // outward from the body axis, plus a random spread and a little lift
      s.v.set(s.p.x - center.x, 0, s.p.z - center.z);
      if (s.v.lengthSq() < 1e-6) s.v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      s.v.normalize().add(_p.set(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5));
      if (o.dir) s.v.addScaledVector(o.dir, 0.8);
      s.v.normalize().multiplyScalar(sp[0] + Math.random() * (sp[1] - sp[0]));
      s.v.y += o.up ?? 1;
      s.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      s.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      s.size = sz[0] + Math.random() * (sz[1] - sz[0]);
      s.max = (o.life || 3) * (0.85 + Math.random() * 0.3); s.life = s.max;
      s.col.copy(col).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
    }
  }

  recycle() { // pool full: drop the oldest-looking (shortest life) shard
    let k = 0; for (let i = 1; i < this.n; i++) if (this.s[i].life < this.s[k].life) k = i;
    this.kill(k);
  }

  kill(i) { const last = --this.n; if (i !== last) { const t = this.s[i]; this.s[i] = this.s[last]; this.s[last] = t; } }

  clear() { this.n = 0; this.mesh.count = 0; }

  update(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      const s = this.s[i];
      s.life -= dt; if (s.life <= 0) { this.kill(i); continue; }
      s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt); s.r.addScaledVector(s.w, dt);
      if (s.p.y < s.size * 0.6) { s.p.y = s.size * 0.6; if (s.v.y < 0) s.v.y *= -0.3; s.v.x *= 0.7; s.v.z *= 0.7; s.w.multiplyScalar(0.7); }
    }
    for (let i = 0; i < this.n; i++) {
      const s = this.s[i], k = Math.min(1, s.life / 0.7) * s.size;
      _q.setFromEuler(_e.set(s.r.x, s.r.y, s.r.z)); _m.compose(s.p, _q, _s.set(k, k, k));
      this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, s.col);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
