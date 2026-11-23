/* Sparks, glass shards, smoke puffs and skid marks. */
import * as THREE from 'three';

function dotTexture(soft: boolean) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(soft ? 0.35 : 0.6, soft ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

class Particles {
  pts: THREE.Points; pos: Float32Array; col: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; fade: Float32Array; next = 0;
  constructor(public n: number, size: number, additive: boolean, soft: boolean, public grav: number, public drag: number, opacity = 1) {
    this.pos = new Float32Array(n * 3).fill(-9999); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.fade = new Float32Array(n);
    geo.setAttribute('f', new THREE.BufferAttribute(this.fade, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: dotTexture(soft) }, size: { value: size }, grow: { value: soft ? 1.8 : 0 }, op: { value: opacity }, scale: { value: 600 } },
      vertexShader: 'attribute vec3 color; attribute float f; varying vec3 vc; varying float vf; uniform float size, grow, scale; void main(){ vc=color; vf=f; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=size*(1.0+grow*(1.0-f))*scale/max(0.5,-mv.z); }',
      fragmentShader: 'uniform sampler2D map; uniform float op; varying vec3 vc; varying float vf; void main(){ vec4 t=texture2D(map,gl_PointCoord); float a=t.a*op*vf; if(a<0.01) discard; gl_FragColor=vec4(vc*t.rgb,a); }',
    });
    this.pts = new THREE.Points(geo, mat);
    this.pts.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.fade[i] = 1;
  }
  update(dt: number, ground: (x: number, z: number) => number) {
    const p = this.pos, v = this.vel, k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) { p[j + 1] = -9999; this.fade[i] = 0; continue; }
      v[j] *= k; v[j + 1] = v[j + 1] * k - this.grav * dt; v[j + 2] *= k;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (this.grav > 0) { const h = ground(p[j], p[j + 2]) + 0.02; if (p[j + 1] < h) { p[j + 1] = h; v[j + 1] *= -0.3; v[j] *= 0.5; v[j + 2] *= 0.5; } }
      this.fade[i] = Math.min(1, (this.life[i] / this.max[i]) * 1.6);
    }
    (this.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.pts.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.pts.geometry.getAttribute('f') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** a ring buffer of dark quads left behind by sliding tyres */
class Skids {
  mesh: THREE.Mesh; pos: Float32Array; alpha: Float32Array; next = 0;
  last = new Map<string, THREE.Vector3>();
  constructor(public n: number) {
    this.pos = new Float32Array(n * 4 * 3).fill(-9999); this.alpha = new Float32Array(n * 4);
    const idx: number[] = []; for (let i = 0; i < n; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('a', new THREE.BufferAttribute(this.alpha, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: 'attribute float a; varying float va; void main(){ va=a; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying float va; void main(){ gl_FragColor=vec4(0.05,0.05,0.06,va*0.55); }',
    });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false;
  }
  add(key: string, p: THREE.Vector3, side: THREE.Vector3, w: number, strength: number) {
    const prev = this.last.get(key);
    if (!prev || prev.distanceToSquared(p) > 4) { this.last.set(key, p.clone()); return; }
    if (prev.distanceToSquared(p) < 0.04) return;
    const i = this.next; this.next = (this.next + 1) % this.n;
    const hw = w / 2, a = this.pos, o = i * 12;
    const put = (k: number, v: THREE.Vector3, s: number) => { a[o + k * 3] = v.x + side.x * hw * s; a[o + k * 3 + 1] = v.y + 0.03; a[o + k * 3 + 2] = v.z + side.z * hw * s; };
    put(0, prev, -1); put(1, prev, 1); put(2, p, 1); put(3, p, -1);
    for (let k = 0; k < 4; k++) this.alpha[i * 4 + k] = Math.min(1, strength);
    prev.copy(p);
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('a') as THREE.BufferAttribute).needsUpdate = true;
  }
  lift(key: string) { this.last.delete(key); }
  clear() { this.pos.fill(-9999); this.last.clear(); (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true; }
}

export class FX {
  sparks: Particles; shards: Particles; smoke: Particles; dust: Particles; skids: Skids;
  group = new THREE.Group();
  constructor(low: boolean) {
    this.sparks = new Particles(low ? 200 : 500, 0.14, true, false, 9, 1.5);
    this.shards = new Particles(low ? 200 : 500, 0.07, false, false, 9.8, 0.6);
    this.smoke = new Particles(low ? 90 : 220, 1.7, false, true, -0.6, 1.2, 0.3);
    this.dust = new Particles(low ? 60 : 160, 1.6, false, true, -0.2, 2, 0.45);
    this.skids = new Skids(low ? 700 : 2000);
    this.group.add(this.sparks.pts, this.shards.pts, this.smoke.pts, this.dust.pts, this.skids.mesh);
  }
  spark(x: number, y: number, z: number, v: number, n = 14) {
    for (let i = 0; i < n; i++) this.sparks.emit(x, y, z, (Math.random() - 0.5) * v * 0.6, Math.random() * v * 0.35 + 1, (Math.random() - 0.5) * v * 0.6, 0.25 + Math.random() * 0.45, 1, 0.75 + Math.random() * 0.2, 0.3);
  }
  glass(x: number, y: number, z: number, vx = 0, vz = 0, n = 40) {
    for (let i = 0; i < n; i++) this.shards.emit(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.6, vx * 0.5 + (Math.random() - 0.5) * 4, Math.random() * 3 + 0.5, vz * 0.5 + (Math.random() - 0.5) * 4, 1.5 + Math.random() * 2.5, 0.75, 0.9, 1);
  }
  debris(x: number, y: number, z: number, r: number, g: number, b: number, n = 12) {
    for (let i = 0; i < n; i++) this.shards.emit(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, 2 + Math.random() * 2, r, g, b);
  }
  puff(x: number, y: number, z: number, dark: number, vx = 0, vz = 0) {
    const c = 0.66 - dark * 0.52;
    this.smoke.emit(x, y, z, vx * 0.3 + (Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.6, vz * 0.3 + (Math.random() - 0.5) * 0.8, 1.6 + Math.random() * 1.4, c, c, c * 1.02);
  }
  kick(x: number, y: number, z: number, r: number, g: number, b: number) {
    this.dust.emit(x, y + 0.2, z, (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), r, g, b);
  }
  setScale(px: number) { for (const p of [this.sparks, this.shards, this.smoke, this.dust]) (p.pts.material as THREE.ShaderMaterial).uniforms.scale.value = px; }
  update(dt: number, ground: (x: number, z: number) => number) {
    this.sparks.update(dt, ground); this.shards.update(dt, ground); this.smoke.update(dt, ground); this.dust.update(dt, ground);
  }
}
