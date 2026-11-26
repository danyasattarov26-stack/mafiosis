/*
  The voxel world on the page: streams chunks in and out around the player, keeps their block data for
  collisions and ray casts, records every block change (so worlds can be saved and shared in co-op) and
  draws each chunk as one opaque mesh plus one water mesh using a single atlas shader.
*/
import * as THREE from 'three';
import { CS, CH, SEA, idx, TerrainGen } from './gen';
import { BLOCKS } from '../shared/blocks';
import { BLOCK_TILES } from './tiles';

export interface Chunk { cx: number; cz: number; data: Uint8Array; solid: THREE.Mesh | null; water: THREE.Mesh | null; dirty: boolean; meshing: boolean; seq: number; lastSeq: number }
export interface Hit { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number; dist: number }

const VERT = `
attribute vec2 tex; attribute float tile; attribute vec2 light;
varying vec2 vTex; varying float vTile; varying vec2 vLight; varying float vFog;
uniform float uTime; uniform float uWave;
void main() {
  vTex = tex; vTile = tile; vLight = light;
  vec3 p = position;
  p.y += uWave * (sin(p.x * 0.9 + uTime * 1.6) + cos(p.z * 0.8 + uTime * 1.3)) * 0.04 - uWave * 0.12;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D atlas; uniform float uSun; uniform vec3 uSunColor; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uAlpha; uniform float uTime; uniform float uWave;
varying vec2 vTex; varying float vTile; varying vec2 vLight; varying float vFog;
void main() {
  float col = mod(vTile, 16.0), row = floor(vTile / 16.0);
  vec2 f = fract(vTex + uWave * vec2(uTime * 0.03, uTime * 0.02));
  vec2 uv = vec2((col + f.x) / 16.0, (row + 1.0 - f.y) / 32.0);
  vec4 c = texture2D(atlas, uv);
  if (c.a < 0.45) discard;
  float sky = vLight.x * uSun, blk = vLight.y;
  vec3 L = max(uSunColor * pow(sky, 1.6), vec3(1.0, 0.78, 0.5) * pow(blk, 1.4)) + 0.035;
  vec3 rgb = c.rgb * L;
  float fog = smoothstep(uFogNear, uFogFar, vFog);
  gl_FragColor = vec4(mix(rgb, uFogColor, fog), uAlpha);
  #include <colorspace_fragment>
}`;

export class World {
  chunks = new Map<string, Chunk>();
  edits = new Map<string, Map<number, number>>();   // chunk → (block index → id), the player-made changes
  gen: TerrainGen;
  group = new THREE.Group();
  solidMat: THREE.ShaderMaterial; waterMat: THREE.ShaderMaterial;
  uniforms: Record<string, THREE.IUniform>;
  private worker: Worker;
  private inFlightGen = 0; private inFlightMesh = 0;
  private wanted: [number, number][] = [];
  onBlockChange: (x: number, y: number, z: number, id: number, old: number) => void = () => {};
  onChunkReady: (c: Chunk) => void = () => {};
  center = { cx: 0, cz: 0 };

  constructor(public seed: number, atlas: THREE.Texture, public renderDist = 6) {
    this.gen = new TerrainGen(seed);
    this.uniforms = {
      atlas: { value: atlas }, uSun: { value: 1 }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uFogColor: { value: new THREE.Color('#b8d4ea') },
      uFogNear: { value: 40 }, uFogFar: { value: 90 }, uTime: { value: 0 },
    };
    this.solidMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...this.uniforms, uAlpha: { value: 1 }, uWave: { value: 0 } } });
    this.waterMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...this.uniforms, uAlpha: { value: 0.72 }, uWave: { value: 1 } }, transparent: true, depthWrite: false });
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => this.onWorker(e.data);
    this.worker.postMessage({ t: 'init', seed });
  }
  /** tell the worker about custom blocks and their textures, then redraw everything */
  syncTables(baseCount: number) {
    const extra = BLOCKS.slice(baseCount).map(b => ({ render: b.render, transparent: b.transparent, light: b.light, key: b.key }));
    this.worker.postMessage({ t: 'tables', extra, tiles: BLOCK_TILES });
    for (const c of this.chunks.values()) c.dirty = true;
  }
  setRenderDist(r: number) { this.renderDist = r; const far = r * CS; this.uniforms.uFogNear.value = far * 0.55; this.uniforms.uFogFar.value = far * 0.95; }

  private k(cx: number, cz: number) { return `${cx},${cz}`; }
  chunkAt(x: number, z: number) { return this.chunks.get(this.k(Math.floor(x / CS), Math.floor(z / CS))); }

  get(x: number, y: number, z: number) {
    if (y < 0) return 1; if (y >= CH) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = this.chunks.get(this.k(cx, cz));
    if (!c) return -1;   // not loaded
    return c.data[idx(x - cx * CS, y, z - cz * CS)];
  }
  set(x: number, y: number, z: number, id: number, fromNet = false) {
    if (y < 1 || y >= CH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), ck = this.k(cx, cz), c = this.chunks.get(ck);
    const lx = x - cx * CS, lz = z - cz * CS, i = idx(lx, y, lz);
    let em = this.edits.get(ck); if (!em) { em = new Map(); this.edits.set(ck, em); }
    em.set(i, id);
    if (!c) return true;
    const old = c.data[i]; if (old === id) return false;
    c.data[i] = id;
    this.worker.postMessage({ t: 'set', x, y, z, id });
    this.markDirty(cx, cz);
    // light and border faces can change next door too
    if (lx === 0) this.markDirty(cx - 1, cz); if (lx === CS - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1); if (lz === CS - 1) this.markDirty(cx, cz + 1);
    if (LIGHTY(id, old)) { this.markDirty(cx - 1, cz); this.markDirty(cx + 1, cz); this.markDirty(cx, cz - 1); this.markDirty(cx, cz + 1); }
    if (!fromNet) this.onBlockChange(x, y, z, id, old);
    return true;
  }
  private markDirty(cx: number, cz: number) { const c = this.chunks.get(this.k(cx, cz)); if (c) c.dirty = true; }

  /** top-most solid block at a column (for spawning and the map) */
  surface(x: number, z: number) {
    const c = this.chunkAt(x, z);
    if (!c) return this.gen.column(x, z).h;
    const lx = x - c.cx * CS, lz = z - c.cz * CS;
    for (let y = CH - 1; y > 0; y--) { const id = c.data[idx(lx, y, lz)]; if (id && BLOCKS[id].solid !== false) return y; }
    return 0;
  }

  /** stream chunks around the player; returns how many nearby chunks are still missing */
  update(px: number, pz: number, dt: number) {
    this.uniforms.uTime.value += dt;
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS), R = this.renderDist;
    if (pcx !== this.center.cx || pcz !== this.center.cz || !this.wanted.length) {
      this.center = { cx: pcx, cz: pcz };
      this.wanted = [];
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) if (dx * dx + dz * dz <= (R + 1.5) ** 2) this.wanted.push([pcx + dx, pcz + dz]);
      this.wanted.sort((a, b) => ((a[0] - pcx) ** 2 + (a[1] - pcz) ** 2) - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
      // unload far chunks (keep their edits)
      for (const [ck, c] of this.chunks) {
        if ((c.cx - pcx) ** 2 + (c.cz - pcz) ** 2 > (R + 3) ** 2) this.unload(ck, c);
      }
    }
    let missing = 0;
    for (const [cx, cz] of this.wanted) {
      const ck = this.k(cx, cz);
      if (!this.chunks.has(ck) && !this.pending.has(ck)) {
        missing++;
        if (this.inFlightGen < 3) { this.pending.add(ck); this.inFlightGen++; this.worker.postMessage({ t: 'gen', cx, cz, edits: [...(this.edits.get(ck) ?? [])] }); }
      }
    }
    // mesh chunks whose neighbours are all here, nearest first
    for (const [cx, cz] of this.wanted) {
      if (this.inFlightMesh >= 2) break;
      const c = this.chunks.get(this.k(cx, cz));
      if (!c || !c.dirty || c.meshing) continue;
      if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > (R + 0.5) ** 2) continue;
      if (!this.chunks.has(this.k(cx - 1, cz)) || !this.chunks.has(this.k(cx + 1, cz)) || !this.chunks.has(this.k(cx, cz - 1)) || !this.chunks.has(this.k(cx, cz + 1))) continue;
      c.dirty = false; c.meshing = true; c.seq++; this.inFlightMesh++;
      this.worker.postMessage({ t: 'mesh', cx, cz, seq: c.seq });
    }
    return missing;
  }
  private pending = new Set<string>();
  private unload(ck: string, c: Chunk) {
    for (const m of [c.solid, c.water]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    this.chunks.delete(ck); this.worker.postMessage({ t: 'drop', cx: c.cx, cz: c.cz });
  }

  private onWorker(m: any) {
    if (m.t === 'chunk') {
      this.inFlightGen--; const ck = this.k(m.cx, m.cz); this.pending.delete(ck);
      if ((m.cx - this.center.cx) ** 2 + (m.cz - this.center.cz) ** 2 > (this.renderDist + 3) ** 2) { this.worker.postMessage({ t: 'drop', cx: m.cx, cz: m.cz }); return; }
      const c: Chunk = { cx: m.cx, cz: m.cz, data: m.data, solid: null, water: null, dirty: true, meshing: false, seq: 0, lastSeq: 0 };
      this.chunks.set(ck, c);
      // neighbours may now be meshable, and their border faces need redoing
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = this.chunks.get(this.k(m.cx + dx, m.cz + dz)); if (n && (n.solid || n.meshing)) n.dirty = true; }
      this.onChunkReady(c);
    } else if (m.t === 'mesh') {
      this.inFlightMesh--;
      const c = this.chunks.get(this.k(m.cx, m.cz)); if (!c) return;
      c.meshing = false;
      if (m.seq < c.lastSeq) return; c.lastSeq = m.seq;
      c.solid = this.apply(c.solid, m.solid, this.solidMat, c);
      c.water = this.apply(c.water, m.water, this.waterMat, c);
    }
  }
  private apply(old: THREE.Mesh | null, d: any, mat: THREE.Material, c: Chunk) {
    if (old) { this.group.remove(old); old.geometry.dispose(); }
    if (!d.index.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('tex', new THREE.BufferAttribute(d.tex, 2));
    g.setAttribute('tile', new THREE.BufferAttribute(d.tile, 1));
    g.setAttribute('light', new THREE.BufferAttribute(d.light, 2));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(CS, CH, CS));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CS / 2, 80, CS / 2), 140);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(c.cx * CS, 0, c.cz * CS);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  /** step through the voxel grid along a ray (Amanatides & Woo) */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number, hitLiquid = false): Hit | null {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
    let tx = (sx > 0 ? x + 1 - o.x : o.x - x) * tdx, ty = (sy > 0 ? y + 1 - o.y : o.y - y) * tdy, tz = (sz > 0 ? z + 1 - o.z : o.z - z) * tdz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 200 && t <= max; i++) {
      const id = this.get(x, y, z);
      if (id > 0 && (BLOCKS[id].render !== 'liquid' || hitLiquid)) return { x, y, z, nx, ny, nz, id, dist: t };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  stats() { let tris = 0, meshes = 0; for (const c of this.chunks.values()) for (const m of [c.solid, c.water]) if (m) { meshes++; tris += (m.geometry.index!.count / 3); } return { chunks: this.chunks.size, meshes, tris }; }
  dispose() { this.worker.terminate(); for (const [ck, c] of this.chunks) this.unload(ck, c); }
  saveEdits() { const o: Record<string, [number, number][]> = {}; for (const [k, m] of this.edits) if (m.size) o[k] = [...m]; return o; }
  loadEdits(o: Record<string, [number, number][]>) { this.edits.clear(); for (const [k, list] of Object.entries(o || {})) this.edits.set(k, new Map(list)); }
  static SEA = SEA;
}
const LIGHTY = (a: number, b: number) => !!(BLOCKS[a]?.light || BLOCKS[b]?.light);
