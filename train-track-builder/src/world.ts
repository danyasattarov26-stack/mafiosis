/* Regions (each with its own ground, sky, scenery and gravity), model loading and scenery that stays off the track. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Track } from './track';

// ---------- models ----------
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const models = new Map<string, GLTF>();
export async function loadModels(names: string[], progress: (k: number) => void) {
  let done = 0;
  await Promise.all(names.map(n => loader.loadAsync(`/models/${n}.glb`).then(g => {
    g.scene.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    models.set(n, g);
  }).catch(e => console.warn('model', n, e)).finally(() => progress(++done / names.length))));
}
export function model(name: string): THREE.Object3D {
  const g = models.get(name);
  if (!g) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#f0f' })); m.position.y = 0.5; const o = new THREE.Group(); o.add(m); return o; }
  return g.scene.clone(true);
}

// ---------- regions ----------
export interface Region {
  id: string; name: string; emoji: string; blurb: string;
  ground: string; ground2: string; sky: string; horizon: string; fog: [number, number]; sun: string; hills: string;
  gravity: number; props: { m: string; n: number; s: [number, number]; tint?: string }[];
  snow?: boolean; stars?: boolean; earth?: boolean;
}
export const REGIONS: Region[] = [
  { id: 'valley', name: 'Green Valley', emoji: '🌳', blurb: 'Rolling hills, trees and flowers.', ground: '#7cc16b', ground2: '#68ad5a', sky: '#7ec8ff', horizon: '#d7f0ff', fog: [120, 420], sun: '#fff6e0', hills: '#5c9e55', gravity: 9.8,
    props: [{ m: 'tree_default', n: 70, s: [1.4, 2.2] }, { m: 'tree_oak', n: 50, s: [1.4, 2.2] }, { m: 'tree_detailed', n: 40, s: [1.4, 2] }, { m: 'plant_bush', n: 60, s: [1.2, 2] }, { m: 'flower_redA', n: 80, s: [1.2, 1.8] }, { m: 'rock_largeA', n: 20, s: [1, 2] }, { m: 'mushroom_red', n: 25, s: [1.5, 2.5] }] },
  { id: 'desert', name: 'Sunny Desert', emoji: '🌵', blurb: 'Hot sand, cactuses and red rocks.', ground: '#e9c98b', ground2: '#ddb877', sky: '#8fd3ff', horizon: '#ffe7c2', fog: [140, 460], sun: '#fff1cf', hills: '#d08c55', gravity: 9.8,
    props: [{ m: 'cactus_tall', n: 70, s: [1.6, 2.6] }, { m: 'cactus_short', n: 70, s: [1.6, 2.6] }, { m: 'rock_largeA', n: 40, s: [1.5, 3.5], tint: '#d9895b' }, { m: 'rock_largeB', n: 30, s: [1.5, 3.5], tint: '#c97848' }, { m: 'stone_tallA', n: 25, s: [2, 4], tint: '#c97848' }] },
  { id: 'snow', name: 'Snowy Peaks', emoji: '❄️', blurb: 'Snow, pine forests and icy mountains.', ground: '#eef5fb', ground2: '#dfeaf4', sky: '#b9d9f2', horizon: '#f2f8ff', fog: [90, 360], sun: '#ffffff', hills: '#ffffff', gravity: 9.8, snow: true,
    props: [{ m: 'tree_pineDefaultA', n: 90, s: [1.5, 2.6], tint: '#e8f2ff' }, { m: 'tree_pineRoundA', n: 60, s: [1.5, 2.4] }, { m: 'tree_pineTallA', n: 50, s: [1.5, 2.6], tint: '#e8f2ff' }, { m: 'tree_cone', n: 40, s: [1.4, 2.2] }, { m: 'rock_largeA', n: 25, s: [1, 2.5], tint: '#b9c6d6' }] },
  { id: 'moon', name: 'Moon Base', emoji: '🌙', blurb: 'Low gravity! Big jumps, craters and stars.', ground: '#9a9aa3', ground2: '#86868f', sky: '#05030f', horizon: '#120c2c', fog: [200, 600], sun: '#ffffff', hills: '#6e6e78', gravity: 1.62, stars: true, earth: true,
    props: [{ m: 'craterLarge', n: 70, s: [3, 7], tint: '#8a8a94' }, { m: 'crater', n: 90, s: [2, 5], tint: '#8a8a94' }, { m: 'rock_largeA', n: 40, s: [1, 3], tint: '#8d8d96' }, { m: 'rock_smallA', n: 60, s: [1.5, 3], tint: '#a0a0aa' }] },
];
export const PROP_MODELS = [...new Set(REGIONS.flatMap(r => r.props.map(p => p.m)))];

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export class World {
  group = new THREE.Group();
  sun = new THREE.DirectionalLight('#fff', 2.2);
  hemi = new THREE.HemisphereLight('#ffffff', '#6b8f71', 1.3);
  region: Region = REGIONS[0];
  private props: { o: THREE.Object3D; x: number; z: number; r: number }[] = [];
  private snow: THREE.Points | null = null;

  constructor(public scene: THREE.Scene) {
    scene.add(this.group, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera; c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 200;
    this.sun.shadow.bias = -0.0004;
  }

  setRegion(r: Region) {
    this.region = r;
    this.group.traverse((o: any) => { if (o.isMesh || o.isPoints) { o.geometry.dispose(); } });
    this.group.clear(); this.props = []; this.snow = null;
    const sc = this.scene;
    sc.background = skyTexture(r.sky, r.horizon);
    sc.fog = new THREE.Fog(r.horizon, r.fog[0], r.fog[1]);
    this.sun.color.set(r.sun); this.hemi.color.set(r.sky); this.hemi.groundColor.set(r.ground2);
    this.hemi.intensity = r.stars ? 0.7 : 1.3; this.sun.intensity = r.stars ? 2.6 : 2.2;
    // ground: a big disc with a soft checker of two tones
    const gt = groundTexture(r.ground, r.ground2); gt.repeat.set(60, 60);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 64), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.group.add(ground);
    // distant hills / mountains / mesas
    const R = rng(r.id.length * 999 + 7);
    const hillGeo = r.id === 'desert' ? new THREE.CylinderGeometry(0.8, 1, 1, 7) : new THREE.ConeGeometry(1, 1, 7);
    const hillMat = new THREE.MeshStandardMaterial({ color: r.hills, roughness: 1, flatShading: true });
    const hills = new THREE.InstancedMesh(hillGeo, hillMat, 60);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 + R() * 0.1, d = 300 + R() * 160, w = 40 + R() * 70, h = (r.id === 'desert' ? 20 : 40) + R() * (r.id === 'snow' ? 90 : 50);
      m.compose(new THREE.Vector3(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), new THREE.Vector3(w, h, w));
      hills.setMatrixAt(i, m);
    }
    this.group.add(hills);
    if (r.id === 'snow') { // snow caps
      const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true }), 60);
      for (let i = 0; i < 60; i++) { hills.getMatrixAt(i, m); const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); m.compose(p.clone().setY(p.y + s.y * 0.3), q, s.clone().multiplyScalar(0.42)); caps.setMatrixAt(i, m); }
      hillMat.color.set('#8fa3b8'); this.group.add(caps);
    }
    // scenery
    for (const pr of r.props) for (let i = 0; i < pr.n; i++) {
      const a = R() * Math.PI * 2, d = 12 + Math.pow(R(), 0.8) * 200;
      const o = model(pr.m);
      const s = pr.s[0] + R() * (pr.s[1] - pr.s[0]);
      o.scale.setScalar(s); o.rotation.y = R() * 6.28;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      o.position.set(x, 0, z);
      if (pr.tint) o.traverse((n: any) => { if (n.isMesh) { n.material = n.material.clone(); n.material.color.lerp(new THREE.Color(pr.tint), 0.55); } });
      this.group.add(o); this.props.push({ o, x, z, r: 1.2 * s });
    }
    if (r.stars) this.group.add(stars());
    if (r.earth) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(28, 32, 16), new THREE.MeshBasicMaterial({ map: earthTexture(), fog: false }));
      e.position.set(-260, 170, -380); this.group.add(e);
    }
    if (r.snow) { this.snow = snowfall(); this.group.add(this.snow); }
  }

  /** hide scenery that would poke through the track near the ground */
  clearAround(track: Track) {
    const near: { x: number; z: number }[] = [];
    for (const s of track.all()) if (s.p.y < 9) near.push({ x: s.p.x, z: s.p.z });
    const cell = (x: number, z: number) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
    const grid = new Set(near.map(p => cell(p.x, p.z)));
    for (const p of this.props) {
      let hit = false;
      const cx = Math.floor(p.x / 4), cz = Math.floor(p.z / 4);
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dz = -1; dz <= 1 && !hit; dz++) if (grid.has(`${cx + dx},${cz + dz}`)) hit = near.some(n => Math.abs(n.x - p.x) < 3 + p.r && Math.abs(n.z - p.z) < 3 + p.r);
      // also keep the station platform clear
      if (Math.abs(p.x + 3) < 6 && p.z > -24 && p.z < -2) hit = true;
      p.o.visible = !hit;
    }
  }

  update(dt: number, focus: THREE.Vector3) {
    // the sun's shadow box follows what you're looking at
    this.sun.position.copy(focus).add(new THREE.Vector3(40, 70, 25));
    this.sun.target.position.copy(focus);
    if (this.snow) {
      const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) - dt * 3; if (y < 0) y += 60; pos.setY(i, y); }
      pos.needsUpdate = true;
      this.snow.position.set(Math.round(focus.x / 10) * 10, 0, Math.round(focus.z / 10) * 10);
    }
  }
}

function skyTexture(top: string, bottom: string) {
  const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
  const c = cv.getContext('2d')!; const g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(0.75, bottom); g.addColorStop(1, bottom);
  c.fillStyle = g; c.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function groundTexture(a: string, b: string) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d')!; c.fillStyle = a; c.fillRect(0, 0, 64, 64);
  c.fillStyle = b; c.fillRect(0, 0, 32, 32); c.fillRect(32, 32, 32, 32);
  for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; c.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.anisotropy = 8; return t;
}
function stars() {
  const n = 1500, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.9 + 0.05; v.normalize().multiplyScalar(550); p.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false }));
}
function snowfall() {
  const n = 1800, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) p.set([(Math.random() - 0.5) * 120, Math.random() * 60, (Math.random() - 0.5) * 120], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.22, transparent: true, opacity: 0.9 }));
}
function earthTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const c = cv.getContext('2d')!; c.fillStyle = '#2a6fdb'; c.fillRect(0, 0, 256, 128);
  c.fillStyle = '#4caf50'; for (let i = 0; i < 14; i++) { c.beginPath(); c.ellipse(Math.random() * 256, 20 + Math.random() * 88, 10 + Math.random() * 30, 6 + Math.random() * 18, Math.random() * 3, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 20; i++) { c.beginPath(); c.ellipse(Math.random() * 256, Math.random() * 128, 8 + Math.random() * 20, 3 + Math.random() * 5, 0, 0, Math.PI * 2); c.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
