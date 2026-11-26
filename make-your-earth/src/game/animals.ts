/*
  Animals and monsters. Animals spawn in herds by biome around the player, wander and graze, flee or attack
  depending on mood, swim if they're sea creatures, and drop meat, hides and bones when hunted.
  Monsters come out in the dark: on the surface at night and in unlit caves (torches keep them away).
  The undead burn in sunlight, skeleton archers keep their distance and shoot, bandits roam by day.
  Tamed animals follow their owner and fight for them; a saddled horse waits to be ridden.
  Models load the first time a species is needed. In co-op the host runs all of this; friends draw snapshots.
*/
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIMAL, ANIMALS, BIOMES, type Animal } from '../shared/biomes';
import { BLOCKS, B } from '../shared/blocks';
import type { World } from '../world/world';
import { SEA } from '../world/gen';

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const models = new Map<string, Promise<GLTF | null>>();
export function loadModel(name: string) {
  let p = models.get(name);
  if (!p) { p = loader.loadAsync(`/models/${name}.glb`).catch(e => { console.warn('model', name, e); return null; }); models.set(name, p); }
  return p;
}

type State = 'idle' | 'walk' | 'flee' | 'chase' | 'attack' | 'dead';
export interface Beast {
  id: string; def: Animal; obj: THREE.Group; mixer: THREE.AnimationMixer | null; actions: Record<string, THREE.AnimationAction>;
  pos: THREE.Vector3; yaw: number; hp: number; state: State; timer: number; target: THREE.Vector3; attackT: number; deadT: number;
  cur: string; mats: THREE.MeshStandardMaterial[]; flash: number; radius: number; height: number; soundT: number; remote?: boolean;
  model: string; kb: THREE.Vector3; hop: number; burning: number; animLock: number; shootT: number; provoked: boolean;
  owner: string | null; saddled: boolean; ridden: number; localRide?: boolean; glowing?: boolean;
  procAnim?: (b: Beast, dt: number, moving: boolean) => void;
  legs?: THREE.Object3D[]; legPhase: number; bar?: THREE.Sprite; barHp: number; saddle?: THREE.Object3D;
}
export interface PetSave { key: string; x: number; y: number; z: number; owner: string; saddled: boolean; hp: number }

let nextId = 1;
const tmp = new THREE.Vector3();

/** a giant spider made in code: a body, a head, red eyes and eight jointed legs that scuttle */
function buildSpider(tint?: string) {
  const g = new THREE.Group(), legs: THREE.Object3D[] = [];
  const body = new THREE.MeshStandardMaterial({ color: tint ?? '#2a2224', roughness: 0.8 });
  const hair = new THREE.MeshStandardMaterial({ color: tint ? new THREE.Color(tint).multiplyScalar(0.6) : '#16110f', roughness: 1 });
  const eye = new THREE.MeshStandardMaterial({ color: '#ff2a1a', emissive: '#ff2a1a', emissiveIntensity: 1.5 });
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), body); abdomen.scale.set(1, 0.8, 1.25); abdomen.position.set(0, 0.62, -0.42); g.add(abdomen);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), hair); stripe.scale.set(1, 0.5, 1.8); stripe.position.set(0, 0.9, -0.42); g.add(stripe);
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), body); thorax.scale.set(1, 0.75, 1.1); thorax.position.set(0, 0.55, 0.12); g.add(thorax);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hair); head.position.set(0, 0.55, 0.42); g.add(head);
  for (const [x, y] of [[-0.07, 0.62], [0.07, 0.62], [-0.12, 0.57], [0.12, 0.57]]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), eye); e.position.set(x, y, 0.56); g.add(e); }
  for (const s of [-1, 1]) {
    const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), hair); f1.position.set(s * 0.06, 0.46, 0.58); f1.rotation.x = 0.5; g.add(f1);
  }
  const upper = new THREE.BoxGeometry(0.06, 0.06, 0.55), lower = new THREE.BoxGeometry(0.05, 0.05, 0.7);
  upper.translate(0, 0, 0.27); lower.translate(0, 0, 0.35);
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1, k = i % 4;
    const hip = new THREE.Group(); hip.position.set(side * 0.18, 0.58, 0.28 - k * 0.15);
    hip.rotation.y = side * (Math.PI / 2) + (k - 1.5) * 0.45 * -side;
    const a = new THREE.Mesh(upper, hair); a.rotation.x = -0.6; hip.add(a);
    const knee = new THREE.Group(); knee.position.set(0, Math.sin(0.6) * 0.55, Math.cos(0.6) * 0.55); a.add(knee);
    knee.rotation.x = 1.75;
    knee.add(new THREE.Mesh(lower, hair));
    (hip as any).base = hip.rotation.y; (hip as any).k = i;
    g.add(hip); legs.push(hip);
  }
  return { g, legs, mats: [body, hair] };
}

/** recolour a vertex-coloured model: the main coat becomes `hex`, darker details (eyes, nose, hooves) stay dark */
const recolored = new Map<string, THREE.BufferGeometry>();
function recolorGeometry(geo: THREE.BufferGeometry, hex: string, cacheKey: string) {
  let g = recolored.get(cacheKey);
  if (g) return g;
  g = geo.clone();
  const col = g.getAttribute('color') as THREE.BufferAttribute, C = new THREE.Color(hex), n = col.count;
  const lum = new Float32Array(n); let mean = 0;
  for (let i = 0; i < n; i++) { lum[i] = 0.3 * col.getX(i) + 0.59 * col.getY(i) + 0.11 * col.getZ(i); mean += lum[i]; }
  mean /= Math.max(1, n);
  const out = new Float32Array(n * col.itemSize);
  for (let i = 0; i < n; i++) {
    const k = Math.max(0.12, Math.min(1.08, 0.95 + (lum[i] - mean) * 1.6));
    out[i * col.itemSize] = C.r * k; out[i * col.itemSize + 1] = C.g * k; out[i * col.itemSize + 2] = C.b * k; if (col.itemSize === 4) out[i * 4 + 3] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, col.itemSize));
  recolored.set(cacheKey, g);
  return g;
}

/** creatures made in code: a model plus a little animation that runs every frame */
interface Proc { g: THREE.Group; mats: THREE.MeshStandardMaterial[]; legs?: THREE.Object3D[]; anim?: (b: Beast, dt: number, moving: boolean) => void }
const std = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
const PROC: Record<string, (def: Animal) => Proc> = {
  'proc:spider': def => { const sp = buildSpider(def.tint); return { g: sp.g, legs: sp.legs, mats: sp.mats as THREE.MeshStandardMaterial[] }; },
  'proc:snake': () => {
    const g = new THREE.Group(), skin = std('#5a7a2a'), belly = std('#c8b860'), segs: THREE.Mesh[] = [];
    for (let i = 0; i < 9; i++) { const r = 0.09 - Math.abs(i - 2) * 0.006; const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.04, r), 8, 6), i % 2 ? skin : belly); m.scale.set(1, 0.8, 1.6); m.position.set(0, 0.08, 0.3 - i * 0.14); g.add(m); segs.push(m); }
    const eye = std('#ffd23a', { emissive: '#664400' }); for (const x of [-0.05, 0.05]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), eye); e.position.set(x, 0.13, 0.36); g.add(e); }
    return { g, mats: [skin, belly], anim: (b, dt, moving) => { (b as any).ph = ((b as any).ph ?? 0) + dt * (moving ? 9 : 2); segs.forEach((m, i) => { m.position.x = Math.sin((b as any).ph - i * 0.7) * (moving ? 0.09 : 0.03); }); } };
  },
  'proc:bat': () => {
    const g = new THREE.Group(), fur = std('#3a2e2e'), wing = std('#4a3838', { side: THREE.DoubleSide });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), fur); body.scale.set(1, 1, 1.3); body.position.y = 0.2; g.add(body);
    for (const x of [-0.045, 0.045]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 4), fur); ear.position.set(x, 0.32, 0.05); g.add(ear); }
    const wings: THREE.Object3D[] = [];
    for (const sgn of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(sgn * 0.07, 0.22, 0); const w = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.18), wing); w.rotation.x = -Math.PI / 2; w.position.x = sgn * 0.16; piv.add(w); g.add(piv); wings.push(piv); }
    return { g, mats: [fur, wing], anim: (b, dt) => { (b as any).ph = ((b as any).ph ?? Math.random() * 6) + dt * 22; wings.forEach((w, i) => { w.rotation.z = Math.sin((b as any).ph) * 0.9 * (i ? -1 : 1); }); } };
  },
  'proc:butterfly': () => {
    const g = new THREE.Group(), cols = ['#f2a020', '#4a8af2', '#f24a8a', '#f2e24a', '#8af24a'], c = cols[Math.floor(Math.random() * cols.length)];
    const wing = std(c, { side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.15 }), body = std('#2a2220');
    const b0 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5), body); b0.rotation.x = Math.PI / 2; b0.position.y = 0.15; g.add(b0);
    const wings: THREE.Object3D[] = [];
    for (const sgn of [-1, 1]) { const piv = new THREE.Group(); piv.position.y = 0.15; const w = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8), wing); w.rotation.x = -Math.PI / 2; w.position.x = sgn * 0.07; w.scale.set(1, 1.3, 1); piv.add(w); g.add(piv); wings.push(piv); }
    return { g, mats: [wing], anim: (b, dt) => { (b as any).ph = ((b as any).ph ?? Math.random() * 6) + dt * 14; wings.forEach((w, i) => { w.rotation.z = (0.3 + Math.sin((b as any).ph) * 0.9) * (i ? -1 : 1); }); } };
  },
  'proc:jellyfish': () => {
    const g = new THREE.Group(), jelly = std('#c08aff', { transparent: true, opacity: 0.7, emissive: '#8a4ad8', emissiveIntensity: 0.6 });
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), jelly); bell.position.y = 0.6; g.add(bell);
    const tent: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, t = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.6, 4), jelly); t.position.set(Math.cos(a) * 0.18, 0.3, Math.sin(a) * 0.18); g.add(t); tent.push(t); }
    return { g, mats: [jelly], anim: (b, dt) => { (b as any).ph = ((b as any).ph ?? Math.random() * 6) + dt * 2.5; const k = Math.sin((b as any).ph); bell.scale.set(1 + k * 0.12, 1 - k * 0.12, 1 + k * 0.12); tent.forEach((t, i) => { t.rotation.x = Math.sin((b as any).ph + i) * 0.25; }); } };
  },
  'proc:wisp': () => {
    const g = new THREE.Group(), core = std('#d8f4ff', { emissive: '#8ad8ff', emissiveIntensity: 2 }), halo = std('#8ad8ff', { transparent: true, opacity: 0.35, emissive: '#4aa8ff', emissiveIntensity: 1 });
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), core); c.position.y = 0.6; g.add(c);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), halo); h.position.y = 0.6; g.add(h);
    return { g, mats: [core, halo], anim: (b, dt) => { (b as any).ph = ((b as any).ph ?? Math.random() * 6) + dt * 4; h.scale.setScalar(1 + Math.sin((b as any).ph) * 0.2); c.position.y = h.position.y = 0.6 + Math.sin((b as any).ph * 0.7) * 0.1; } };
  },
  'proc:colossus': () => {
    // the guardian of the Sky Isles: a giant of stone and crystal, about 7 m tall
    const g = new THREE.Group(), rock = std('#6a6478', { roughness: 0.9 }), dark = std('#3e3a48'), crystal = std('#b07af0', { emissive: '#8a4ad8', emissiveIntensity: 1.2 });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parent.add(o); return o; };
    const hips = new THREE.Group(); hips.position.y = 2.6; g.add(hips);
    const legs: THREE.Object3D[] = [];
    for (const x of [-0.8, 0.8]) { const leg = new THREE.Group(); leg.position.set(x, 2.6, 0); box(0.9, 2.6, 1, dark, 0, -1.3, 0, leg); box(1.1, 0.4, 1.4, rock, 0, -2.45, 0.15, leg); g.add(leg); legs.push(leg); }
    box(2.8, 2.4, 1.8, rock, 0, 1.4, 0, hips); box(1.2, 1, 0.2, crystal, 0, 1.6, 0.92, hips);
    box(1.3, 1.1, 1.2, rock, 0, 3.2, 0.1, hips);
    for (const x of [-0.3, 0.3]) box(0.22, 0.16, 0.05, crystal, x, 3.3, 0.72, hips);
    const arms: THREE.Object3D[] = [];
    for (const x of [-1.8, 1.8]) { const arm = new THREE.Group(); arm.position.set(x, 2.3, 0); box(0.8, 2.6, 0.9, dark, 0, -1.2, 0, arm); box(1.1, 0.9, 1.1, rock, 0, -2.7, 0, arm); box(0.3, 0.6, 0.3, crystal, 0, 0.3, 0, arm); hips.add(arm); arms.push(arm); }
    for (const [x, z] of [[-1, -0.6], [0.9, -0.7], [0, -0.9]]) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 5), crystal); sp.position.set(x, 2.8, z); sp.rotation.x = -0.4; hips.add(sp); }
    return { g, mats: [rock, dark, crystal], anim: (b, dt, moving) => {
      (b as any).ph = ((b as any).ph ?? 0) + dt * (moving ? 3 : 0.8);
      const k = Math.sin((b as any).ph), slam = Math.max(0, b.animLock) / 0.9;
      legs[0].rotation.x = moving ? k * 0.4 : 0; legs[1].rotation.x = moving ? -k * 0.4 : 0;
      arms[0].rotation.x = slam > 0 ? -2.4 * Math.sin(slam * Math.PI) : -k * 0.25; arms[1].rotation.x = slam > 0 ? -2.4 * Math.sin(slam * Math.PI) : k * 0.25;
      hips.position.y = 2.6 + Math.abs(k) * 0.08;
    } };
  },
};

/** a bow or a sword in a hand bone */
function buildWeapon(kind: 'bow' | 'sword' | 'club') {
  const g = new THREE.Group();
  if (kind === 'bow') {
    const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2b' });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.022, 4, 12, Math.PI * 0.9), wood); arc.rotation.z = Math.PI / 2 + Math.PI * 0.05; g.add(arc);
    const str = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.62, 0.008), new THREE.MeshBasicMaterial({ color: '#ddd' })); str.position.x = -0.1; g.add(str);
    g.rotation.set(0, Math.PI / 2, 0);
  } else {
    const metal = new THREE.MeshStandardMaterial({ color: kind === 'sword' ? '#c8ccd2' : '#5a3e26', metalness: kind === 'sword' ? 0.6 : 0, roughness: 0.4 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), metal); blade.position.y = 0.38; g.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: '#6b4a2b' })); guard.position.y = 0.07; g.add(guard);
  }
  return g;
}

export class Animals {
  list: Beast[] = [];
  group = new THREE.Group();
  cap = 24; simDist = 64; spawnT = 0; monsterT = 3; banditT = 40;
  monsterCap = 12;
  host = true;                // false in co-op as a guest: positions come from the host
  sun = 1;                    // daylight 0..1 (set by the game each frame)
  onAttack: (b: Beast, dmg: number, target: THREE.Vector3, area?: boolean) => void = () => {};
  dim: 'earth' | 'sky' = 'earth';
  setWorld(w: World, dim: 'earth' | 'sky') { this.world = w; this.dim = dim; }
  onShoot: (b: Beast, from: THREE.Vector3, at: THREE.Vector3) => void = () => {};
  onSound: (key: string, pos: THREE.Vector3) => void = () => {};
  onFx: (kind: 'fire' | 'hearts' | 'smoke' | 'slam', pos: THREE.Vector3) => void = () => {};
  onPetKill: (drops: [string, number][], at: THREE.Vector3) => void = () => {};
  ownerPos: (owner: string) => THREE.Vector3 | null = () => null;
  constructor(public world: World) {}

  groundY(x: number, z: number, fromY: number) {
    const fx = Math.floor(x), fz = Math.floor(z);
    for (let y = Math.floor(fromY) + 2; y > Math.floor(fromY) - 8; y--) {
      const id = this.world.get(fx, y, fz);
      if (id < 0) return null;
      if (id > 0 && BLOCKS[id].solid !== false) return y + 1;
    }
    return null;
  }

  async spawn(key: string, x: number, y: number, z: number, id?: string, modelName?: string): Promise<Beast | null> {
    const def = ANIMAL[key]; if (!def) return null;
    const mname = modelName ?? (def.models ? def.models[Math.floor(Math.random() * def.models.length)] : def.model);
    const obj = new THREE.Group();
    let mats: THREE.MeshStandardMaterial[] = [], mixer: THREE.AnimationMixer | null = null, legs: THREE.Object3D[] | undefined;
    const actions: Record<string, THREE.AnimationAction> = {};
    let model: THREE.Object3D;
    let procAnim: Proc['anim'];
    if (PROC[mname]) {
      const sp = PROC[mname](def); model = sp.g; legs = sp.legs; mats = sp.mats; procAnim = sp.anim;
      model.scale.setScalar(def.scale);
    } else {
      const gltf = await loadModel(mname); if (!gltf) return null;
      model = cloneSkinned(gltf.scene) as THREE.Group;
      model.scale.setScalar(def.scale);
      model.traverse((o: any) => {
        if (!o.isMesh) return;
        o.castShadow = false; o.frustumCulled = false;
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        // vertex-coloured animals get properly recoloured (a white polar bear, not a pale brown one)
        if (def.tint && o.geometry.getAttribute('color')) o.geometry = recolorGeometry(o.geometry, def.tint, `${def.key}:${o.name}:${o.geometry.uuid}`);
        else if (def.tint) m.color.multiply(new THREE.Color(def.tint)).multiplyScalar(1.6);
        o.material = m; mats.push(m);
      });
      mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null;
      if (mixer) for (const clip of gltf.animations) {
        const n = clip.name.toLowerCase();
        const k = n.startsWith('idle') ? 'idle' : n.includes('fast') || n.startsWith('run') ? 'run' : n.startsWith('walk') || n.startsWith('swim') ? 'walk' : n.startsWith('attack') ? 'attack' : n.startsWith('death') ? 'death' : n;
        if (!actions[k] || (n.includes('folded') === false && key === 'parrot')) actions[k] = mixer.clipAction(clip);
      }
      for (const k of ['attack', 'death']) if (actions[k]) { actions[k].setLoop(THREE.LoopOnce, 1); actions[k].clampWhenFinished = true; }
      if (def.weapon) {
        let hand: THREE.Object3D | null = null;
        const want = def.weapon === 'bow' ? 'handslotl' : 'handslotr';
        model.traverse(o => { if (!hand && o.name.replace(/[^a-z]/gi, '').toLowerCase() === want) hand = o; });
        if (hand) (hand as THREE.Object3D).add(buildWeapon(def.weapon));
      }
    }
    obj.add(model);
    // bones must be in place before measuring a skinned model, or its box comes out too small
    model.updateMatrixWorld(true);
    model.traverse((o: any) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.boundingBox = null; } });
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    const b: Beast = {
      id: id ?? `a${nextId++}${Math.floor(Math.random() * 1000)}`, def, obj, mixer, actions, pos: new THREE.Vector3(x, y, z), yaw: Math.random() * Math.PI * 2, hp: def.hp,
      state: 'idle', timer: Math.random() * 3, target: new THREE.Vector3(x, y, z), attackT: 0, deadT: 0, cur: '', mats, flash: 0,
      radius: Math.max(size.x, size.z) * 0.5, height: size.y, soundT: 4 + Math.random() * 20,
      model: mname, kb: new THREE.Vector3(), hop: 0, burning: 0, animLock: 0, shootT: 1 + Math.random() * 2, provoked: false,
      owner: null, saddled: false, ridden: 0, legs, legPhase: Math.random() * 6, barHp: -1, procAnim,
    };
    if (def.monster || def.bandit) this.ensureBar(b);
    this.play(b, 'idle');
    obj.position.copy(b.pos);
    this.group.add(obj); this.list.push(b);
    return b;
  }
  private play(b: Beast, k: string) {
    if (b.cur === k || !b.mixer) return;
    // zombies only have a shamble: slow it right down to stand, a bit to walk (their own idle is arms-out)
    const shamble = b.def.key === 'zombie';
    const next = (shamble && k === 'idle' ? b.actions.walk : b.actions[k]) ?? b.actions.walk ?? b.actions.idle; if (!next) return;
    const prev = b.actions[b.cur];
    if (prev !== next) { next.reset().fadeIn(0.2).play(); if (prev) prev.fadeOut(0.2); }
    next.timeScale = shamble ? (k === 'idle' ? 0.12 : k === 'walk' ? 0.55 : 0.9) : k === 'run' ? 1.1 : 1;
    b.cur = k;
  }
  remove(b: Beast) { this.group.remove(b.obj); b.mixer?.stopAllAction(); this.list = this.list.filter(x => x !== b); }
  clear() { for (const b of [...this.list]) this.remove(b); }

  // ---------------- health bars ----------------
  private ensureBar(b: Beast) {
    if (b.bar) return;
    const c = document.createElement('canvas'); c.width = 64; c.height = 10;
    const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
    b.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false, transparent: true }));
    b.bar.scale.set(0.9, 0.14, 1); b.bar.renderOrder = 5; b.bar.visible = false;
    b.obj.add(b.bar);
  }
  private drawBar(b: Beast) {
    const sp = b.bar!, tex = (sp.material as THREE.SpriteMaterial).map as THREE.CanvasTexture, c = tex.image as HTMLCanvasElement, g = c.getContext('2d')!;
    const f = Math.max(0, b.hp / b.def.hp);
    g.clearRect(0, 0, 64, 10); g.fillStyle = 'rgba(10,10,14,0.8)'; g.fillRect(0, 0, 64, 10);
    g.fillStyle = b.owner ? '#5ad84a' : f > 0.5 ? '#e8c23a' : '#e23b3b'; if (b.def.monster || b.def.bandit) g.fillStyle = f > 0.35 ? '#d83a3a' : '#ff6a2a';
    g.fillRect(1, 1, 62 * f, 8);
    tex.needsUpdate = true; b.barHp = b.hp;
  }

  // ---------------- spawning ----------------
  /** is there a torch, lantern, fire or glowing block close by? (monsters don't spawn in light) */
  litNear(x: number, y: number, z: number, r = 7) {
    for (let dy = -3; dy <= 3; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const id = this.world.get(x + dx, y + dy, z + dz);
      if (id > 0 && (BLOCKS[id].light ?? 0) >= 9) return true;
    }
    return false;
  }
  private spotFree(x: number, y: number, z: number) {
    const below = this.world.get(x, y - 1, z), here = this.world.get(x, y, z), up = this.world.get(x, y + 1, z);
    return below > 0 && BLOCKS[below].solid !== false && below !== B.water && !BLOCKS[below].key.endsWith('_leaves') && (here === 0 || (here > 0 && BLOCKS[here].render === 'cross' && here !== B.torch)) && up === 0;
  }
  /** try to put a herd somewhere near the player that isn't on screen right next to them */
  private trySpawn(px: number, pz: number) {
    const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * (this.simDist - 26);
    const x = Math.floor(px + Math.cos(a) * r), z = Math.floor(pz + Math.sin(a) * r);
    const col = this.world.gen.column(x, z), biome = BIOMES[col.biome];
    const sy = this.world.surface(x, z);
    if (this.world.get(x, sy, z) < 0) return;
    const water = sy < SEA && this.world.get(x, SEA, z) === B.water;
    const pool = biome.animals.filter(k => !!ANIMAL[k].water === water);
    if (!pool.length) return;
    const key = pool[Math.floor(Math.random() * pool.length)], def = ANIMAL[key];
    const herd = 1 + Math.floor(Math.random() * (def.herd ?? 1));
    for (let i = 0; i < herd; i++) {
      const hx = x + (Math.random() - 0.5) * 6, hz = z + (Math.random() - 0.5) * 6;
      const y = water ? Math.min(SEA - 1, this.world.surface(Math.floor(hx), Math.floor(hz)) + 1 + Math.random() * Math.max(0, SEA - sy - 3)) : this.groundY(hx, hz, sy + 1);
      if (y == null) continue;
      if (!water && this.world.get(Math.floor(hx), Math.floor(y), Math.floor(hz)) === B.water) continue;
      if (def.day && this.sun < 0.4) continue;                       // butterflies only by day
      this.spawn(key, hx, y + (def.fly ? 1 + Math.random() * 2 : 0), hz);
    }
  }
  private pick(table: [string, number][]) { let r = Math.random() * table.reduce((a, t) => a + t[1], 0); for (const [k, w] of table) { r -= w; if (r <= 0) return k; } return table[0][0]; }
  /** monsters: on the surface when it's dark, and in caves whenever there's no light */
  private loading = 0;                         // monsters whose model is still loading (count them against the cap)
  private spawnM(key: string, x: number, y: number, z: number) { this.loading++; this.spawn(key, x, y, z).finally(() => this.loading--); }
  private trySpawnMonster(P: THREE.Vector3) {
    const monsters = this.loading + this.list.filter(b => b.def.monster && b.state !== 'dead').length;
    if (monsters >= this.monsterCap) return;
    if (this.dim === 'sky') {
      // the Sky Isles: only wisps, drifting over the islands
      if (monsters >= 5) return;
      const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 18;
      const x = Math.floor(P.x + Math.cos(a) * r), z = Math.floor(P.z + Math.sin(a) * r), sy = this.world.surface(x, z);
      if (sy > 60 && this.world.get(x, sy + 2, z) === 0) this.spawnM('wisp', x + 0.5, sy + 2, z + 0.5);
      return;
    }
    const night = this.sun < 0.3;
    const underground = this.world.surface(Math.floor(P.x), Math.floor(P.z)) > P.y + 5;
    const cave = underground || Math.random() < 0.5;
    if (!cave && !night) return;
    if (cave) {
      // a dark floor in a cave around the player's depth
      for (let t = 0; t < 6; t++) {
        const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 18;
        const x = Math.floor(P.x + Math.cos(a) * r), z = Math.floor(P.z + Math.sin(a) * r);
        const top = this.world.surface(x, z);
        for (let y = Math.floor(P.y) + 8; y > Math.floor(P.y) - 14 && y > 4; y--) {
          if (y > top - 5 || !this.spotFree(x, y, z)) continue;
          if (this.litNear(x, y, z)) return;
          const key = this.pick([['zombie', 25], ['skeleton', 25], ['skeleton_archer', 12], ['cave_spider', 18], ['giant_spider', 10], ['cave_beast', 7], ['bat', 16]]);
          this.spawnM(key, x + 0.5, y, z + 0.5);
          if (key === 'cave_spider' && Math.random() < 0.6) this.spawnM(key, x + 1.2, y, z + 0.3);
          return;
        }
      }
      return;
    }
    // night on the surface
    const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 26;
    const x = Math.floor(P.x + Math.cos(a) * r), z = Math.floor(P.z + Math.sin(a) * r);
    const sy = this.world.surface(x, z) + 1;
    if (sy <= SEA || !this.spotFree(x, sy, z) || this.litNear(x, sy, z)) return;
    const biome = BIOMES[this.world.gen.column(x, z).biome].key;
    const key = this.pick(biome === 'desert' || biome === 'tundra' ? [['zombie', 50], ['skeleton_archer', 35], ['giant_spider', 15]] : [['zombie', 45], ['skeleton_archer', 25], ['giant_spider', 30]]);
    this.spawnM(key, x + 0.5, sy, z + 0.5);
    if (key === 'zombie' && Math.random() < 0.4) this.spawnM(key, x + 1.5, sy, z + 0.5);
  }
  /** bandits: a small gang roaming the wilds by day */
  private trySpawnBandits(P: THREE.Vector3) {
    if (this.sun < 0.4 || this.list.some(b => b.def.bandit && b.state !== 'dead')) return;
    const a = Math.random() * Math.PI * 2, r = 34 + Math.random() * 18;
    const x = Math.floor(P.x + Math.cos(a) * r), z = Math.floor(P.z + Math.sin(a) * r);
    const biome = BIOMES[this.world.gen.column(x, z).biome].key;
    if (!['forest', 'savanna', 'desert', 'beach', 'mountains', 'jungle'].includes(biome)) return;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const hx = x + (Math.random() - 0.5) * 5, hz = z + (Math.random() - 0.5) * 5, sy = this.world.surface(Math.floor(hx), Math.floor(hz)) + 1;
      if (sy > SEA && this.spotFree(Math.floor(hx), sy, Math.floor(hz))) this.spawn('bandit', hx, sy, hz);
    }
  }

  update(dt: number, player: { pos: THREE.Vector3; downed: number }, others: THREE.Vector3[] = []) {
    const P = player.pos;
    if (this.host) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnT = 1.2; if (this.list.filter(b => !b.def.monster && !b.def.bandit && !b.owner).length < this.cap) this.trySpawn(P.x, P.z); }
      this.monsterT -= dt;
      if (this.monsterT <= 0) { this.monsterT = 1.6; this.trySpawnMonster(others.length && Math.random() < 0.5 ? others[Math.floor(Math.random() * others.length)] : P); }
      this.banditT -= dt;
      if (this.banditT <= 0) { this.banditT = 60 + Math.random() * 60; if (Math.random() < 0.35) this.trySpawnBandits(P); }
    }
    const now = performance.now();
    for (const b of [...this.list]) {
      let d = b.pos.distanceTo(P);
      for (const o of others) d = Math.min(d, b.pos.distanceTo(o));
      const keep = b.owner || b.saddled;
      if (this.host && !keep && d > this.simDist + 40 && b.state !== 'dead') { this.remove(b); continue; }
      if (this.host && b.ridden < now) this.think(b, dt, P, d, player.downed > 0, others);
      // draw
      b.obj.position.lerp(b.pos, b.remote && !b.localRide ? Math.min(1, dt * 10) : 1);
      if (b.hop > 0) { b.hop = Math.max(0, b.hop - dt); b.obj.position.y += Math.sin((b.hop / 0.3) * Math.PI) * 0.35; }
      const dy = b.yaw - b.obj.rotation.y; b.obj.rotation.y += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, dt * 8);
      if (b.state === 'dead' && !b.actions.death) { b.obj.rotation.z = Math.min(Math.PI / 2, b.obj.rotation.z + dt * 4); }
      if (b.flash > 0 || b.burning > 0 || b.glowing) {
        b.flash = Math.max(0, b.flash - dt);
        const burn = b.burning > 0 ? 0.35 + Math.random() * 0.3 : 0;
        for (const m of b.mats) m.emissive.setRGB(b.flash > 0 ? 0.6 : burn, b.flash > 0 ? 0 : burn * 0.45, 0);
        b.glowing = b.flash > 0 || b.burning > 0;
        if (b.burning > 0 && Math.random() < dt * 8) this.onFx('fire', tmp.copy(b.pos).setY(b.pos.y + b.height * 0.7));
      }
      if (d < this.simDist && (b.state !== 'dead' || b.actions.death)) b.mixer?.update(dt);
      if (b.legs) this.animateLegs(b, dt);
      if (b.procAnim && d < this.simDist) b.procAnim(b, dt, b.state === 'walk' || b.state === 'chase' || b.state === 'flee');
      if (b.bar) {
        b.bar.visible = b.state !== 'dead' && d < 24 && (b.hp < b.def.hp || (!!b.def.monster && d < 14));
        if (b.bar.visible && b.barHp !== b.hp) this.drawBar(b);
        b.bar.position.set(0, b.height + 0.3, 0);
      }
      b.obj.visible = d < this.simDist + 30;
    }
  }
  private animateLegs(b: Beast, dt: number) {
    const moving = b.cur === 'walk' || b.cur === 'run' || b.state === 'chase' || b.state === 'flee' || b.state === 'walk';
    b.legPhase += dt * (moving ? 14 : 1.5);
    for (const l of b.legs!) {
      const k = (l as any).k as number, ph = b.legPhase + (k % 2 ? Math.PI : 0) + (k < 4 ? 0 : Math.PI / 2);
      l.rotation.y = (l as any).base + Math.sin(ph) * (moving ? 0.35 : 0.05);
      l.rotation.x = Math.max(0, Math.cos(ph)) * (moving ? -0.25 : 0);
    }
    if (b.state === 'dead') for (const l of b.legs!) l.rotation.x = -0.9;
  }

  /** move one step along `dir` at `speed`, stepping up single blocks; returns false if blocked */
  step(b: Beast, dir: THREE.Vector3, speed: number, dt: number) {
    const nx = b.pos.x + dir.x * speed * dt, nz = b.pos.z + dir.z * speed * dt;
    const gy = this.groundY(nx, nz, b.pos.y);
    if (gy == null || gy - b.pos.y > 1.2 || this.world.get(Math.floor(nx), Math.floor(gy), Math.floor(nz)) === B.water) return false;
    b.pos.x = nx; b.pos.z = nz; b.pos.y += (gy - b.pos.y) * Math.min(1, dt * 12);
    return true;
  }
  /** is this creature standing under the open sky? */
  private skyAbove(b: Beast) { return this.world.surface(Math.floor(b.pos.x), Math.floor(b.pos.z)) < b.pos.y + 0.5; }

  private think(b: Beast, dt: number, P: THREE.Vector3, d: number, playerDown: boolean, others: THREE.Vector3[]) {
    const def = b.def;
    if (b.state === 'dead') { b.deadT -= dt; if (b.deadT <= 0) this.remove(b); return; }
    if (def.boss) { this.bossThink(b, dt, P, others); return; }
    b.timer -= dt; b.attackT -= dt; b.soundT -= dt; b.animLock -= dt; b.shootT -= dt;
    if (b.soundT <= 0) { b.soundT = (def.monster ? 5 : 8) + Math.random() * 20; if (def.sound && d < 40) this.onSound(def.sound, b.pos); }
    // knocked back by a hit
    if (b.kb.lengthSq() > 0.05) {
      const len = b.kb.length(); tmp.copy(b.kb).divideScalar(len);
      if (!def.water) this.step(b, tmp, len, dt);
      b.kb.multiplyScalar(Math.pow(0.004, dt));
    }
    const sunny = this.sun > 0.55;
    // the undead burn in daylight
    if (def.undead && sunny && this.skyAbove(b)) {
      b.burning = 1; b.hp -= 4 * dt;
      if (b.hp <= 0) { b.state = 'dead'; b.deadT = 3; this.dieAnim(b); return; }
    } else b.burning = 0;
    // tamed animals follow their owner and fight off monsters near them
    if (b.owner) { this.petThink(b, dt); return; }
    if (b.saddled) { this.play(b, 'idle'); return; }
    // nearest player (host or guests)
    let tgt = P, td = d;
    for (const o of others) { const od = b.pos.distanceTo(o); if (od < td) { td = od; tgt = o; } }
    const dayCalm = def.key.endsWith('spider') && sunny && !b.provoked && this.skyAbove(b);
    const sight = def.monster || def.bandit ? (b.state === 'chase' || b.state === 'attack' ? 30 : 18) : def.water ? 16 : 14;
    const hostile = (def.mood === 'hostile' && !dayCalm || b.provoked) && !!def.damage && !playerDown && td < sight;
    const scared = (def.mood === 'skittish' && td < 9) || b.state === 'flee';
    if (hostile) {
      if (def.ranged) b.state = td < 15 ? 'attack' : 'chase';
      else b.state = td < (def.reach ?? 1.5) + 0.4 ? 'attack' : 'chase';
    } else if (b.state === 'chase' || b.state === 'attack') b.state = 'idle';
    if (scared && b.state !== 'chase' && b.state !== 'attack') {
      if (b.state !== 'flee') { b.state = 'flee'; b.timer = 4 + Math.random() * 3; }
      const away = b.pos.clone().sub(tgt).setY(0).normalize().multiplyScalar(14);
      b.target.copy(b.pos).add(away);
      if (b.timer <= 0) b.state = 'idle';
    }
    if (b.state === 'idle' && b.timer <= 0) {
      b.state = 'walk'; b.timer = 3 + Math.random() * 6;
      b.target.set(b.pos.x + (Math.random() - 0.5) * 16, b.pos.y, b.pos.z + (Math.random() - 0.5) * 16);
      if (def.fly) { const gy = this.groundY(b.target.x, b.target.z, b.pos.y + 3) ?? b.pos.y - 2; b.target.y = gy + 1 + Math.random() * (def.cave ? 2 : 5); if (def.fly) b.timer = 1.5 + Math.random() * 3; }
    } else if (b.state === 'walk' && (b.timer <= 0 || b.pos.distanceTo(b.target) < 0.8)) { b.state = 'idle'; b.timer = 2 + Math.random() * 6; }
    if (b.state === 'chase' || b.state === 'attack') b.target.copy(tgt);
    // archers: hold their ground, back off if you get close, and loose arrows
    if (def.ranged && b.state === 'attack') {
      tmp.copy(tgt).sub(b.pos); b.yaw = Math.atan2(tmp.x, tmp.z);
      if (b.shootT <= 0) {
        b.shootT = 2 + Math.random() * 0.8;
        const from = b.pos.clone().setY(b.pos.y + b.height * 0.8), at = tgt.clone().setY(tgt.y + 1.1);
        if (!this.world.raycast(from, at.clone().sub(from).normalize(), from.distanceTo(at) - 0.5)) {
          this.onShoot(b, from, at); this.lockAnim(b, 'attack', 0.8);
        }
      }
      if (td < 5) { tmp.copy(b.pos).sub(tgt).setY(0).normalize(); this.step(b, tmp, def.speed * 1.6, dt); this.play(b, 'walk'); return; }
      if (b.animLock <= 0) this.play(b, 'idle');
      return;
    }
    if (b.state === 'attack' && b.attackT <= 0) { b.attackT = 1.3; this.onAttack(b, def.damage ?? 3, tgt); this.lockAnim(b, 'attack', 0.7); }

    const speed = b.state === 'flee' || b.state === 'chase' ? def.run : b.state === 'walk' ? def.speed : 0;
    if (b.animLock <= 0) this.play(b, speed === 0 ? 'idle' : speed > def.speed * 1.5 ? 'run' : 'walk');
    if (!speed) return;
    this.walkTo(b, b.target, speed, dt);
  }
  /**
    The Sky Colossus. It walks you down and slams the ground (jump or back off), and as it weakens it
    hurls crystal shards (a shield helps) and then calls wisps to help. It never leaves its arena.
  */
  private bossThink(b: Beast, dt: number, P: THREE.Vector3, others: THREE.Vector3[]) {
    const def = b.def, f = b.hp / def.hp;
    b.attackT -= dt; b.shootT -= dt; b.animLock -= dt; b.timer -= dt; b.soundT -= dt;
    let tgt = P, td = b.pos.distanceTo(P);
    for (const o of others) { const od = b.pos.distanceTo(o); if (od < td) { td = od; tgt = o; } }
    if (b.soundT <= 0) { b.soundT = 6 + Math.random() * 6; this.onSound('beast', b.pos); }
    tmp.copy(tgt).sub(b.pos).setY(0); b.yaw = Math.atan2(tmp.x, tmp.z);
    const slam = (b as any).slamAt as number | undefined;
    if (slam !== undefined) {
      (b as any).slamAt = slam - dt;
      if (slam - dt <= 0) {
        delete (b as any).slamAt;
        this.onFx('slam', b.pos.clone());
        for (const p of [P, ...others]) if (Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 6.5 && Math.abs(p.y - b.pos.y) < 1.6) this.onAttack(b, def.damage ?? 14, p, true);
      }
      return;
    }
    if (td < 6 && b.attackT <= 0) { b.attackT = f < 0.33 ? 2 : 2.8; b.animLock = 0.9; (b as any).slamAt = 0.55; this.play(b, 'idle'); return; }
    if (f < 0.66 && b.shootT <= 0 && td < 45) {
      b.shootT = f < 0.33 ? 3.2 : 5;
      const from = b.pos.clone().setY(b.pos.y + 5.5), side = new THREE.Vector3(-(tgt.z - b.pos.z), 0, tgt.x - b.pos.x).normalize();
      for (let k = -2; k <= 2; k++) this.onShoot(b, from, tgt.clone().setY(tgt.y + 1).addScaledVector(side, k * 1.6));
    }
    if (f < 0.33 && b.timer <= 0) {
      b.timer = 14;
      for (let k = 0; k < 2; k++) this.spawnM('wisp', b.pos.x + (Math.random() - 0.5) * 8, b.pos.y + 4, b.pos.z + (Math.random() - 0.5) * 8);
    }
    if (td > 4 && b.animLock <= 0) {
      b.state = 'chase'; this.walkTo(b, tgt, def.run * (f < 0.33 ? 1.35 : 1), dt);
      const r = Math.hypot(b.pos.x, b.pos.z); if (r > 32) { b.pos.x *= 32 / r; b.pos.z *= 32 / r; }
    } else b.state = 'idle';
  }
  bossAlive() { return this.list.find(b => b.def.boss && b.state !== 'dead') ?? null; }

  private walkTo(b: Beast, to: THREE.Vector3, speed: number, dt: number) {
    const def = b.def;
    const dir = to.clone().sub(b.pos); if (!def.water && !def.fly) dir.y = 0;
    const len = dir.length(); if (len < 0.3) return;
    dir.divideScalar(len);
    b.yaw = Math.atan2(dir.x, dir.z);
    if (def.fly) {
      // flyers go anywhere there's air, and keep within a few blocks of the ground
      const nx = b.pos.x + dir.x * speed * dt, ny = b.pos.y + dir.y * speed * dt, nz = b.pos.z + dir.z * speed * dt;
      const id = this.world.get(Math.floor(nx), Math.floor(ny + 0.3), Math.floor(nz));
      if (id === 0 || (id > 0 && BLOCKS[id].solid === false && id !== B.water)) b.pos.set(nx, ny, nz);
      else b.target.set(b.pos.x - dir.x * 6, b.pos.y + 1.5, b.pos.z - dir.z * 6);
      return;
    }
    if (def.water) {
      const nx = b.pos.x + dir.x * speed * dt, nz = b.pos.z + dir.z * speed * dt;
      const id = this.world.get(Math.floor(nx), Math.floor(b.pos.y + dir.y * speed * dt), Math.floor(nz));
      if (id === B.water) { b.pos.x = nx; b.pos.z = nz; b.pos.y = Math.min(SEA - 0.6, b.pos.y + dir.y * speed * dt); }
      else { b.target.set(b.pos.x - dir.x * 10, b.pos.y, b.pos.z - dir.z * 10); }
      return;
    }
    if (!this.step(b, dir, speed, dt) && b.state !== 'chase' && b.state !== 'attack') {
      // blocked (cliff, wall or water): pick somewhere else
      b.target.set(b.pos.x - dir.x * 8 + (Math.random() - 0.5) * 8, b.pos.y, b.pos.z - dir.z * 8 + (Math.random() - 0.5) * 8);
    } else if (b.state === 'chase' && Math.random() < dt * 0.8) {
      // try to go around obstacles while chasing
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
      this.step(b, side, speed, dt * 3);
    }
  }
  private petThink(b: Beast, dt: number) {
    const def = b.def, home = this.ownerPos(b.owner!);
    if (!home) { this.play(b, 'idle'); return; }
    const hd = b.pos.distanceTo(home);
    if (hd > 40) { b.pos.copy(home).add(new THREE.Vector3(1, 0.2, 1)); return; }    // got lost: catch up
    // fight: the nearest monster close to the owner
    if (def.damage) {
      let foe: Beast | null = null, fd = 12;
      for (const m of this.list) if ((m.def.monster || m.def.bandit) && m.state !== 'dead' && m.pos.distanceTo(home) < 14) { const q = m.pos.distanceTo(b.pos); if (q < fd) { fd = q; foe = m; } }
      if (foe) {
        if (fd < (def.reach ?? 1.6) + 0.5) { if (b.attackT <= 0) { b.attackT = 1; const drops = this.damage(foe, def.damage, b.pos); if (drops) this.onPetKill(drops, foe.pos.clone()); } this.play(b, 'idle'); }
        else { this.play(b, 'run'); this.walkTo(b, foe.pos, def.run, dt); }
        return;
      }
    }
    if (hd > 4) { this.play(b, hd > 10 ? 'run' : 'walk'); b.state = 'walk'; this.walkTo(b, home, hd > 10 ? def.run : def.speed * 2, dt); }
    else { b.state = 'idle'; this.play(b, 'idle'); }
  }
  private lockAnim(b: Beast, k: string, t: number) { if (!b.actions[k]) return; b.cur = ''; this.play(b, k); b.animLock = t; }
  private dieAnim(b: Beast) {
    if (b.actions.death) { b.mixer?.stopAllAction(); b.cur = ''; this.play(b, 'death'); }
    else b.mixer?.stopAllAction();
  }

  // ---------------- riding ----------------
  /** steer a ridden animal; returns true if it moved */
  drive(b: Beast, dir: THREE.Vector3, speed: number, dt: number) {
    if (dir.lengthSq() < 0.01) { this.play(b, 'idle'); return false; }
    b.yaw = Math.atan2(dir.x, dir.z);
    this.play(b, speed > b.def.speed * 2 ? 'run' : 'walk');
    b.ridden = performance.now() + 500;
    return this.step(b, dir, speed, dt);
  }
  /** host: a friend is riding this one */
  rideRemote(id: string, x: number, y: number, z: number, yaw: number, anim: string) {
    const b = this.list.find(q => q.id === id); if (!b) return;
    b.pos.set(x, y, z); b.yaw = yaw; b.ridden = performance.now() + 1000; this.play(b, anim || 'idle');
  }
  /** tame with the right item: wolves become dogs, cats stay cats */
  tame(b: Beast, owner: string): Promise<Beast | null> | null {
    if (!b.def.tame || b.owner || b.state === 'dead') return null;
    this.onFx('hearts', b.pos.clone().setY(b.pos.y + b.height));
    if (b.def.tameTo) {
      const at = b.pos.clone(); this.remove(b);
      return this.spawn(b.def.tameTo, at.x, at.y, at.z).then(n => { if (n) { n.owner = owner; this.ensureBar(n); } return n; });
    }
    b.owner = owner; b.state = 'idle'; this.ensureBar(b);
    return Promise.resolve(b);
  }
  saddle(b: Beast) {
    if (!b.def.rideable || b.saddled) return false;
    b.saddled = true; b.state = 'idle';
    this.addSaddle(b);
    return true;
  }
  private addSaddle(b: Beast) {
    if (b.saddle) return;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: '#5a2e14' }));
    s.position.set(0, b.height * 0.78, 0); b.obj.add(s); b.saddle = s;
  }

  /** first living animal along a ray (for hunting) */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, reach: number, skip?: (b: Beast) => boolean): Beast | null {
    let best: Beast | null = null, bt = reach;
    const c = new THREE.Vector3();
    for (const b of this.list) {
      if (b.state === 'dead' || skip?.(b)) continue;
      c.copy(b.pos); c.y += b.height * 0.5;
      const rad = Math.max(0.35, Math.min(b.radius, b.height * 0.6)) + 0.2;
      const oc = c.clone().sub(o), t = oc.dot(d);
      if (t < 0 || t > bt) continue;
      if (oc.lengthSq() - t * t < rad * rad) { best = b; bt = t; }
    }
    return best;
  }
  /** returns drops if it died */
  damage(b: Beast, amount: number, from: THREE.Vector3, knock = 1): [string, number][] | null {
    if (b.state === 'dead') return null;
    b.hp -= amount; b.flash = 0.25; b.provoked = true;
    if (b.bar === undefined) this.ensureBar(b);
    // knockback: lighter creatures fly further
    const push = b.def.boss ? 0 : (6 * knock) / (1 + b.def.hp / 50);
    tmp.copy(b.pos).sub(from).setY(0); if (tmp.lengthSq() > 0.0001) tmp.normalize();
    b.kb.set(tmp.x * push, 0, tmp.z * push); b.hop = 0.3;
    if (b.def.mood !== 'hostile' && !b.owner) {
      if (b.def.mood === 'neutral' && b.def.damage) b.state = 'chase';
      else { b.state = 'flee'; b.timer = 6; b.target.copy(b.pos).add(b.pos.clone().sub(from).setY(0).normalize().multiplyScalar(14)); }
    }
    if (b.hp > 0) return null;
    b.state = 'dead'; b.deadT = b.actions.death ? 4 : 6; this.dieAnim(b);
    return b.def.drops.map(([k, lo, hi]) => [k, lo + Math.floor(Math.random() * (hi - lo + 1))] as [string, number]).filter(d => d[1] > 0);
  }
  /** for the bed: anything hostile close by? */
  monstersNear(p: THREE.Vector3, r: number) { return this.list.some(b => (b.def.monster || b.def.bandit) && b.state !== 'dead' && b.pos.distanceTo(p) < r); }

  // ---------------- saving pets ----------------
  pets(owner: string): PetSave[] {
    return this.list.filter(b => (b.owner === owner || (b.saddled && !b.owner)) && b.state !== 'dead')
      .map(b => ({ key: b.def.key, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), owner: b.owner ?? '', saddled: b.saddled, hp: Math.round(b.hp) }));
  }
  async loadPets(list: PetSave[] | undefined) {
    for (const p of list ?? []) {
      if (!ANIMAL[p.key]) continue;
      const b = await this.spawn(p.key, p.x, p.y, p.z); if (!b) continue;
      b.owner = p.owner || null; b.hp = Math.min(b.def.hp, p.hp || b.def.hp);
      if (p.saddled) { b.saddled = true; this.addSaddle(b); }
      if (b.owner) this.ensureBar(b);
    }
  }

  // ---- co-op: the host shares positions, guests draw them ----
  snapshot() {
    return this.list.map(b => [b.id, b.def.key, +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2), +b.yaw.toFixed(2), b.state === 'dead' ? 1 : 0, b.cur, Math.round(b.hp),
      (b.owner ? 1 : 0) | (b.saddled ? 2 : 0) | (b.burning > 0 ? 4 : 0), b.model, b.owner ?? '']);
  }
  async applySnapshot(list: any[]) {
    const seen = new Set<string>();
    for (const [id, key, x, y, z, yaw, dead, anim, hp, flags, model, owner] of list) {
      seen.add(id);
      let b = this.list.find(q => q.id === id);
      if (!b) { b = (await this.spawn(key, x, y, z, id, model)) ?? undefined; if (!b) continue; b.remote = true; b.obj.position.set(x, y, z); }
      if (!b.localRide) { b.pos.set(x, y, z); b.yaw = yaw; }
      if (hp != null) b.hp = hp;
      b.owner = flags & 1 ? String(owner || 'host') : null; b.burning = flags & 4 ? 1 : 0;
      if (flags & 2 && !b.saddled) { b.saddled = true; this.addSaddle(b); }
      if (b.owner || b.hp < b.def.hp) this.ensureBar(b);
      if (dead && b.state !== 'dead') { b.state = 'dead'; this.dieAnim(b); }
      if (!dead && !b.localRide && anim) this.play(b, anim);
    }
    for (const b of [...this.list]) if (!seen.has(b.id)) this.remove(b);
  }
}
export { ANIMALS };
