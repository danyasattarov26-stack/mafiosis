/* Model loading, caching and cloning. All models are meshopt-compressed GLBs from Patch's library. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
const ready = new Map<string, GLTF>();

export function load(name: string): Promise<GLTF> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`/models/${name}.glb`).then(g => {
      g.scene.traverse((o: any) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.anisotropy = 4; m.roughness = Math.max(m.roughness ?? 1, 0.55); m.metalness = Math.min(m.metalness ?? 0, 0.3); }
        }
      });
      ready.set(name, g);
      return g;
    });
    cache.set(name, p);
  }
  return p;
}
export const loaded = (name: string) => ready.get(name);

export async function preload(names: string[], progress?: (done: number, total: number) => void) {
  let done = 0;
  await Promise.all(names.map(n => load(n).catch(e => console.warn('model failed', n, e)).finally(() => progress?.(++done, names.length))));
}

/** A fresh copy of a loaded model (geometry/materials shared). */
export function instance(name: string): THREE.Object3D {
  const g = ready.get(name);
  if (!g) { const ph = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: '#f0f' })); ph.position.y = 0.25; const o = new THREE.Group(); o.add(ph); return o; }
  let skinned = false;
  g.scene.traverse((o: any) => { if (o.isSkinnedMesh) skinned = true; });
  return skinned ? SkeletonUtils.clone(g.scene) : g.scene.clone(true);
}

/** Clone materials of a copy so it can be tinted without touching the originals. */
export function ownMaterials(root: THREE.Object3D) {
  root.traverse((o: any) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m: any) => m.clone()) : o.material.clone();
  });
  return root;
}
export function tint(root: THREE.Object3D, color: THREE.ColorRepresentation, matName?: RegExp) {
  const c = new THREE.Color(color);
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!matName || matName.test(m.name)) m.color.copy(c);
  });
}

// ---------- characters ----------
const POLY_IDLE_T = new Map<string, number>();
let walkClip: THREE.AnimationClip | null = null;

/** Shared walk cycle for every Polyfork person (they share one rig). Position tracks are dropped so kids keep their own height. */
export function polyWalk(): THREE.AnimationClip | null {
  if (walkClip) return walkClip;
  const g = ready.get('family-road-tripper');
  const c = g?.animations.find(a => /walk/i.test(a.name));
  if (!c) return null;
  walkClip = new THREE.AnimationClip('walk', c.duration, c.tracks.filter(t => !t.name.endsWith('.position') && !t.name.endsWith('.scale')));
  return walkClip;
}
/** The moment in the walk cycle where the legs pass each other: used as a relaxed standing pose. */
export function polyIdleTime(): number {
  if (POLY_IDLE_T.has('t')) return POLY_IDLE_T.get('t')!;
  const clip = polyWalk(); if (!clip) return 0;
  const l = clip.tracks.find(t => t.name === 'LeftUpLeg.quaternion') as THREE.QuaternionKeyframeTrack;
  const r = clip.tracks.find(t => t.name === 'RightUpLeg.quaternion') as THREE.QuaternionKeyframeTrack;
  let best = 0, bd = Infinity;
  if (l && r) {
    const ql = new THREE.Quaternion(), qr = new THREE.Quaternion();
    for (let i = 0; i < l.times.length && i < r.times.length; i++) {
      ql.fromArray(l.values, i * 4); qr.fromArray(r.values, i * 4);
      const d = ql.angleTo(qr);
      if (d < bd) { bd = d; best = l.times[i]; }
    }
  }
  POLY_IDLE_T.set('t', best);
  return best;
}

const skinTones = ['#ffe0c7', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e'];
const texCache = new Map<string, THREE.Texture>();
/**
 * Recolours a Kenney retro character atlas: shirt (white area) and trousers (denim area) take the chosen colours,
 * skin areas are shifted toward the chosen tone. Layout of the 256×256 atlas: shirt bottom-left, jeans bottom-right.
 */
export function characterTexture(body: 'male' | 'female', shirt: string, pants: string, skin: number): THREE.Texture | null {
  const key = [body, shirt, pants, skin].join('|');
  if (texCache.has(key)) return texCache.get(key)!;
  const g = ready.get(body === 'female' ? 'humanFemaleA' : 'humanMaleA');
  let src: any = null;
  g?.scene.traverse((o: any) => { if (o.isMesh && o.material?.map) src = o.material.map; });
  const img = src?.image as (HTMLImageElement | ImageBitmap | undefined);
  if (!img) return null;
  const W = 256, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img as any, 0, 0, W, H);
  const d = cx.getImageData(0, 0, W, H), p = d.data;
  const sc = new THREE.Color(shirt), pc = new THREE.Color(pants), tone = new THREE.Color(skinTones[skin] || skinTones[1]), base = new THREE.Color('#f1c27d');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255;
    const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
    if (y >= 118 && x < 152) { // shirt
      const k = Math.min(1.15, lum * 1.12);
      p[i] = Math.min(255, sc.r * k * 255); p[i + 1] = Math.min(255, sc.g * k * 255); p[i + 2] = Math.min(255, sc.b * k * 255);
    } else if (y >= 188 && x >= 152) { // trousers
      const k = Math.min(1.3, lum * 2.2);
      p[i] = Math.min(255, pc.r * k * 255); p[i + 1] = Math.min(255, pc.g * k * 255); p[i + 2] = Math.min(255, pc.b * k * 255);
    } else if (r > gg && gg > b && r - b > 0.12 && lum > 0.35) { // skin-ish pixels
      p[i] = Math.min(255, r * (tone.r / base.r) * 255); p[i + 1] = Math.min(255, gg * (tone.g / base.g) * 255); p[i + 2] = Math.min(255, b * (tone.b / base.b) * 255);
    }
  }
  cx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = src.flipY; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = src.magFilter; t.minFilter = src.minFilter;
  texCache.set(key, t);
  return t;
}
export const SKIN_TONES = skinTones;

/** Kenney shelves come pre-filled; hide the baked products and return where they stood (slot anchors in the model's local space). */
export function stripShelf(root: THREE.Object3D) {
  const anchors: THREE.Vector3[] = [];
  root.updateWorldMatrix(true, true); // parents too, or getWorldPosition below would disagree with inv
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const hide: THREE.Object3D[] = [];
  root.traverse(o => { if (/^(bottle|carton|box)/i.test(o.name) && o !== root) hide.push(o); });
  for (const o of hide) { const p = new THREE.Vector3(); o.getWorldPosition(p); anchors.push(p.applyMatrix4(inv)); o.visible = false; o.removeFromParent(); }
  return anchors;
}

export function disposeTree(root: THREE.Object3D, materialsToo = false) {
  root.traverse((o: any) => {
    if (o.isMesh && o.userData.ownGeo) o.geometry.dispose();
    if (materialsToo && o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
}

export const ALL_MODELS = {
  core: ['desk', 'desk_chairArms', 'desk-monitor', 'monitor-arm', 'laptop', 'cardboardBoxClosed', 'cardboardBoxOpen', 'trash', 'trash_A', 'humanMaleA', 'humanFemaleA', 'family-road-tripper',
    'cash-register', 'shelf-end', 'shelf-boxes', 'soda-can', 'soda-bottle', 'bag', 'pot_large', 'plant_bushDetailed'],
  city: ['road_straight', 'road_junction', 'road_tsplit', 'road_corner', 'road_straight_crossing', 'base', 'building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G',
    'streetlight', 'bench', 'bush', 'dumpster', 'car_sedan', 'car_hatchback', 'car_police', 'car_taxi', 'car_stationwagon'],
  people: ['cafe-customer', 'backpacker', 'graduate-student', 'seated-office-worker', 'teen-player', 'student-in-a-hoodie', 'bmx-rider', 'beginner-kid-skater', 'neighborhood-child', 'school-student',
    'arriving-hotel-guest', 'slot-tourist', 'street-skater', 'kid-in-a-black'],
  extra: ['cabinetTelevision', 'televisionModern', 'loungeSofa', 'arcade-machine', 'pinball', 'claw-machine', 'dance-machine', 'vending-machine', 'prizes', 'rug_rectangle_stripes_A', 'rug_oval_A'],
};
