/* Draws a map: terrain, roads, solid boxes (walls, ramps, buildings), trees, race gates, signs, sky and sun. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { heightAt, type MapDef, type Box } from '../sim/maps';

const TREES = ['tree_default', 'tree_oak', 'tree_pineTallA', 'tree_pineRoundA', 'tree_detailed'];
const treeParts = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[]>();
export async function loadTrees() {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(TREES.map(async n => {
    try {
      const g = await loader.loadAsync(`/models/${n}.glb`);
      g.scene.updateMatrixWorld(true);
      const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
      // keep each mesh's own transform (the files store quantised positions with a scale on the node)
      g.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        // repaint the kit's teal leaves into a natural green that suits the valley
        const src = o.material as THREE.MeshBasicMaterial, nm = (src.name || '').toLowerCase();
        const m = new THREE.MeshStandardMaterial({ color: src.color, roughness: 0.9, flatShading: true });   // the kit ships unlit: give it light and shade
        if (nm.includes('leaf')) m.color.set(nm.includes('dark') || n.includes('pine') ? '#2f6a35' : '#4c9a3c');
        else if (nm.includes('wood')) m.color.set('#7a5232');
        parts.push({ geo: o.geometry, mat: m, local: o.matrixWorld.clone() });
      });
      treeParts.set(n, parts);
    } catch (e) { console.warn('tree', n, e); }
  }));
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return t;
}
function noiseTex(lines: boolean) {
  return canvasTex(256, 256, g => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = 205 + Math.random() * 50; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3); }
    if (lines) { g.fillStyle = 'rgba(40,40,50,0.35)'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 0, 3, 256); g.fillStyle = 'rgba(40,40,50,0.15)'; g.fillRect(0, 127, 256, 2); g.fillRect(127, 0, 2, 256); }
  });
}

const SKY = {
  day: { top: '#5fa8e8', hor: '#d9ecfa', fog: '#cfe3f2', sun: '#fff4dd', ground: '#6b8f52', far: 520, sunDir: [60, 90, 30] },
  dusk: { top: '#3a4e8c', hor: '#f6b27a', fog: '#e3b08c', sun: '#ffd6a0', ground: '#6a6a4e', far: 480, sunDir: [-80, 45, 60] },
  lab: { top: '#7f8da0', hor: '#dfe5ec', fog: '#d9dfe6', sun: '#ffffff', ground: '#8d8f94', far: 420, sunDir: [40, 100, 20] },
};
const SURF = [new THREE.Color('#5f8f45'), new THREE.Color('#3a3b40'), new THREE.Color('#a6a8ad'), new THREE.Color('#8a6a45')];
const KIND: Record<string, string> = { concrete: '#b9b6ae', metal: '#f2c230', barrier: '#e63946', tire: '#1f1f22', ramp: '#f4a261', trunk: '#6b4a2b', building: '#e9c46a' };

export class WorldView {
  group = new THREE.Group();
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight;
  gates: THREE.Group[] = [];
  constructor(public map: MapDef, scene: THREE.Scene, low: boolean) {
    const sky = SKY[map.sky];
    scene.background = canvasTex(2, 256, g => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, sky.top); gr.addColorStop(0.7, sky.hor); gr.addColorStop(1, sky.hor); g.fillStyle = gr; g.fillRect(0, 0, 2, 256); }, false);
    scene.fog = new THREE.Fog(sky.fog, sky.far * 0.35, sky.far);
    this.hemi = new THREE.HemisphereLight(sky.top, sky.ground, 1.1);
    this.sun = new THREE.DirectionalLight(sky.sun, 2.3);
    this.sun.castShadow = true;
    const S = low ? 1024 : 2048; this.sun.shadow.mapSize.set(S, S);
    const cam = this.sun.shadow.camera; cam.left = cam.bottom = -40; cam.right = cam.top = 40; cam.near = 1; cam.far = 260;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    (this.sun.userData as any).dir = new THREE.Vector3(...sky.sunDir).normalize();
    this.group.add(this.hemi, this.sun, this.sun.target);

    this.group.add(this.terrain(low));
    for (const r of map.roads) this.group.add(this.road(r.pts, r.width, r.closed, r.lines));
    for (const o of [...this.boxes(map.boxes.filter(b => b.kind !== "trunk")), ...this.trees()]) this.group.add(o);
    if (map.checkpoints) this.raceGates();
    if (map.lab) this.labSigns();
    if (map.id === 'valley') this.rampSigns();
  }

  private terrain(low: boolean) {
    const m = this.map, step = low && m.res < 4 ? 2 : 1, n = Math.floor(m.n / step), N = n + 1;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
    const tmp = new THREE.Color();
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const gi = i * step, gj = j * step, k = j * N + i;
      const x = -m.half + gi * m.res, z = -m.half + gj * m.res, y = m.grid[gj * (m.n + 1) + gi];
      pos.set([x, y, z], k * 3); uv.set([x / 9, z / 9], k * 2);
      const s = m.surf[gj * (m.n + 1) + gi];
      tmp.copy(SURF[s]);
      if (s === 0) { const h = Math.sin(x * 0.05) * Math.cos(z * 0.043) * 0.08 + (Math.random() - 0.5) * 0.04; tmp.offsetHSL(h * 0.3, 0, h); if (y > 12) tmp.lerp(new THREE.Color('#8c8a6a'), Math.min(0.6, (y - 12) / 30)); }
      if (m.id === 'lab') tmp.set('#a9abb0');
      col.set([tmp.r, tmp.g, tmp.b], k * 3);
    }
    const idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * N + i, b = a + 1, c = a + N + 1, d = a + N; idx.push(a, d, c, a, c, b); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const tex = noiseTex(m.id === 'lab');
    if (m.id === 'lab') tex.repeat.set(9 / 10, 9 / 10);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.95 }));
    mesh.receiveShadow = true;
    // a skirt of far ground so the edge of the world isn't a cliff into nothing
    const skirt = new THREE.Mesh(new THREE.RingGeometry(m.half * 1.0, m.half * 6, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: SURF[m.id === 'lab' ? 2 : 0].clone().multiplyScalar(0.9), roughness: 1 }));
    skirt.position.y = -0.4; skirt.rotation.y = Math.PI / 4;
    const g = new THREE.Group(); g.add(mesh, skirt);
    return g;
  }

  private road(pts: [number, number][], width: number, closed: boolean, lines: boolean) {
    // resample every ~2.5 m so the ribbon follows the ground
    const P: [number, number][] = [];
    const segs = closed ? pts.length : pts.length - 1;
    for (let s = 0; s < segs; s++) {
      const a = pts[s], b = pts[(s + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / 2.5));
      for (let i = 0; i < k; i++) P.push([a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k]);
    }
    if (!closed) P.push(pts[pts.length - 1]); else P.push(P[0]);
    const across = [-1, -0.5, 0, 0.5, 1], A = across.length;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const linePos: number[] = [], lineIdx: number[] = [], altIdx: number[] = [];
    let dist = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[Math.min(P.length - 1, i + 1)], o = P[Math.max(0, i - 1)];
      let dx = q[0] - o[0], dz = q[1] - o[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const sx = -dz, sz = dx;
      if (i > 0) dist += Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]);
      for (const t of across) {
        const x = p[0] + sx * t * width / 2, z = p[1] + sz * t * width / 2;
        pos.push(x, heightAt(this.map, x, z) + 0.05, z); uv.push(t * width / 8, dist / 8);
      }
      // markings: dashed centre line, solid edges
      const per = lines ? 3 : 2;   // vertices are laid out per sample: `per` markings × 2 edges
      const mark = (off: number, w: number, on: boolean, alt = false) => {
        const base = linePos.length / 3;
        for (const s of [-1, 1]) { const x = p[0] + sx * (off + s * w / 2), z = p[1] + sz * (off + s * w / 2); linePos.push(x, heightAt(this.map, x, z) + 0.07, z); }
        const prev = base - per * 2;
        if (i > 0) (on ? lineIdx : alt ? altIdx : []).push(prev, prev + 1, base + 1, prev, base + 1, base);
      };
      if (lines) { mark(0, 0.15, Math.floor(dist / 3) % 2 === 0); mark(width / 2 - 0.35, 0.14, true); mark(-width / 2 + 0.35, 0.14, true); }
      else { const red = Math.floor(dist / 2) % 2 === 0; mark(width / 2 - 0.25, 0.5, red, true); mark(-width / 2 + 0.25, 0.5, red, true); }
    }
    for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < A - 1; k++) { const a = i * A + k, b = a + 1, c = a + A + 1, d = a + A; idx.push(a, b, c, a, c, d); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const asphalt = new THREE.MeshStandardMaterial({ color: '#4a4b52', map: noiseTex(false), roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    const mesh = new THREE.Mesh(geo, asphalt); mesh.receiveShadow = true;
    asphalt.side = THREE.DoubleSide;
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3)); lg.setIndex(lineIdx);
    const lmesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: lines ? '#f2f0e6' : '#e63946', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    // race kerbs alternate red and white
    const g = new THREE.Group(); g.add(mesh, lmesh);
    if (!lines) {
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', lg.getAttribute('position')); wg.setIndex(altIdx);
      g.add(new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: '#f4f4f4', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
    }
    return g;
  }

  private boxes(list: Box[]) {
    const out: THREE.Object3D[] = [];
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const plain = list.filter(b => b.kind !== 'building'), blds = list.filter(b => b.kind === 'building');
    const put = (arr: Box[], mat: THREE.Material) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      arr.forEach((b, i) => {
        e.set(b.pitch, b.yaw, 0, 'YXZ'); q.setFromEuler(e);
        m.compose(new THREE.Vector3(...b.c), q, new THREE.Vector3(...b.h));
        im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(b.color || KIND[b.kind] || '#999'));
      });
      im.castShadow = true; im.receiveShadow = true;
      out.push(im);
    };
    put(plain, new THREE.MeshStandardMaterial({ roughness: 0.75 }));
    // buildings get windows drawn from their world position
    const bmat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    bmat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vN;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (abs(vN.y) < 0.5) {
            float h = abs(vN.x) > 0.5 ? vW.z : vW.x;
            vec2 c = vec2(fract(h / 3.2), fract((vW.y - 0.6) / 3.4));
            float win = step(0.22, c.x) * step(c.x, 0.78) * step(0.3, c.y) * step(c.y, 0.8) * step(1.2, vW.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.3), win * 0.9);
          } else diffuseColor.rgb *= 0.7;`);
    };
    put(blds, bmat);
    return out;
  }

  private trees() {
    const out: THREE.Object3D[] = [], m = this.map;
    if (!m.trees.length || !treeParts.size) return out;
    const by = new Map<string, THREE.Matrix4[]>();
    m.trees.forEach(([x, y, z], i) => {
      const name = TREES[(i * 7 + Math.floor(Math.abs(x))) % TREES.length];
      const s = 1.9 + ((i * 37) % 10) / 12;
      const mat = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.1, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.4), new THREE.Vector3(s, s, s));
      if (!by.has(name)) by.set(name, []); by.get(name)!.push(mat);
    });
    for (const [name, mats] of by) for (const p of treeParts.get(name) || []) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, mats.length);
      mats.forEach((mm, i) => im.setMatrixAt(i, mm.clone().multiply(p.local)));
      im.castShadow = true; im.receiveShadow = false;
      out.push(im);
    }
    return out;
  }

  private label(text: string, color = '#ffffff', bg = 'rgba(20,24,32,0.82)') {
    const t = canvasTex(512, 128, g => {
      g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, 504, 120, 26); g.fill();
      g.fillStyle = color; g.font = 'bold 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 68);
    }, false);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
    s.scale.set(8, 2, 1);
    return s;
  }
  private labSigns() {
    const names: [number, number, string][] = [[0, 90, 'WALL'], [-30, 90, 'POLE'], [30, 90, 'BARRIERS'], [-60, 90, 'TYRE WALL'], [66, 70, 'RAMPS'], [-90, 90, 'OFFSET WALL'], [95, 90, 'STEP']];
    for (const [x, z, t] of names) { const s = this.label(t); s.position.set(x, 9, z + 2); this.group.add(s); }
    // launch lanes painted on the floor
    const mat = new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const l of this.map.lab!.launch) {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 120).rotateX(-Math.PI / 2), mat);
      for (const dx of [-1.6, 1.6]) { const c = lane.clone(); c.position.set(l.x + dx, 0.03, l.z + 60); this.group.add(c); }
    }
  }
  private rampSigns() {
    const s = this.label('RAMP PARK', '#ffd23f'); s.position.set(-150, 14, 150); this.group.add(s);
  }
  private raceGates() {
    const cps = this.map.checkpoints!;
    cps.forEach((cp, i) => {
      const g = new THREE.Group();
      const y = heightAt(this.map, cp.x, cp.z);
      const postMat = new THREE.MeshStandardMaterial({ color: i === 0 ? '#ffffff' : '#ffb400', emissive: i === 0 ? '#333' : '#4a3300' });
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 8), postMat); p.position.set(s * (cp.w / 2 + 1.2), 3, 0); g.add(p); }
      const banner = new THREE.Mesh(new THREE.BoxGeometry(cp.w + 2.6, 0.9, 0.2), new THREE.MeshStandardMaterial({ map: i === 0 ? canvasTex(64, 8, gg => { for (let k = 0; k < 64; k++) for (let r = 0; r < 8; r++) { gg.fillStyle = (k + r) % 2 ? '#111' : '#fff'; gg.fillRect(k, r, 1, 1); } }, false) : null, color: i === 0 ? '#ffffff' : '#ffb400' }));
      banner.position.y = 6; g.add(banner);
      g.position.set(cp.x, y, cp.z); g.rotation.y = cp.yaw;
      this.gates.push(g); this.group.add(g);
    });
  }
  /** brighten the next gate */
  setNextGate(i: number) {
    this.gates.forEach((g, k) => g.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m && m.emissive && k !== 0) m.emissive.set(k === i ? '#ff9900' : '#2a1d00'); }));
  }

  update(focus: THREE.Vector3) {
    const d = (this.sun.userData as any).dir as THREE.Vector3;
    this.sun.position.copy(focus).addScaledVector(d, 120);
    this.sun.target.position.copy(focus);
  }
}
