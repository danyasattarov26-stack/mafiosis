/* Small procedural props, canvas textures and shared materials. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loaded } from '../engine/assets';

const matCache = new Map<string, THREE.Material>();
export function mat(color: THREE.ColorRepresentation, o: { emissive?: THREE.ColorRepresentation; ei?: number; rough?: number; metal?: number; transparent?: boolean; opacity?: number } = {}) {
  const key = JSON.stringify([color, o]);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0.05, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.transparent, opacity: o.opacity ?? 1 });
    matCache.set(key, m);
  }
  return m;
}
export function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.position.set(x, y, z); g.castShadow = true; g.receiveShadow = true; g.userData.ownGeo = true;
  return g;
}

// ---------- text textures ----------
export function textCanvas(text: string, o: { w?: number; h?: number; bg?: string; fg?: string; font?: string; glow?: string; pad?: number; border?: string } = {}) {
  const W = o.w || 512, H = o.h || 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, W, H); }
  if (o.border) { c.strokeStyle = o.border; c.lineWidth = H * 0.06; c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, W - c.lineWidth, H - c.lineWidth); }
  let size = H * 0.62;
  c.font = `800 ${size}px ${o.font || '"Baloo 2", "Trebuchet MS", system-ui, sans-serif'}`;
  while (c.measureText(text).width > W - (o.pad ?? 30) && size > 10) { size -= 2; c.font = `800 ${size}px ${o.font || '"Baloo 2", "Trebuchet MS", system-ui, sans-serif'}`; }
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (o.glow) { c.shadowColor = o.glow; c.shadowBlur = H * 0.18; }
  c.fillStyle = o.fg || '#fff';
  c.fillText(text, W / 2, H / 2 + size * 0.04);
  if (o.glow) c.fillText(text, W / 2, H / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------- PC tower ----------
const TIER_RGB = ['#888', '#3ee6ff', '#ff4fd8', '#ffd166'];
export function pcTower(tier: number) {
  const g = new THREE.Group();
  const body = tier >= 2 ? '#1d1d2b' : '#2b2d42';
  g.add(box(0.22, 0.46, 0.44, mat(body, { rough: 0.45, metal: 0.3 }), 0, 0.23, 0));
  if (tier >= 1) {
    const glow = mat(TIER_RGB[tier], { emissive: TIER_RGB[tier], ei: 1.6 });
    g.add(box(0.012, 0.36, 0.36, mat('#9bd', { transparent: true, opacity: 0.35, rough: 0.1 }), 0.115, 0.25, 0));
    for (let i = 0; i < (tier >= 2 ? 3 : 1); i++) {
      const fan = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 16), glow);
      fan.userData.ownGeo = true; fan.rotation.y = Math.PI / 2; fan.position.set(0.1, 0.36 - i * 0.12, 0.1); g.add(fan);
    }
    g.add(box(0.005, 0.02, 0.4, glow, 0.113, 0.03, 0));
    g.userData.glow = glow;
  }
  if (tier >= 3) { const cool = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), mat('#7df9ff', { emissive: '#3ee6ff', ei: 0.8, transparent: true, opacity: 0.8 })); cool.userData.ownGeo = true; cool.position.set(0.02, 0.25, -0.12); g.add(cool); }
  return g;
}

/** keyboard + mouse in the Kenney style */
export function keyboardMouse(rgb = false) {
  const g = new THREE.Group();
  g.add(box(0.44, 0.02, 0.14, mat(rgb ? '#1b1b28' : '#30343f'), 0, 0.01, 0));
  if (rgb) g.add(box(0.42, 0.005, 0.12, mat('#ff4fd8', { emissive: '#7b2cbf', ei: 1.2 }), 0, 0.022, 0));
  g.add(box(0.06, 0.025, 0.1, mat('#30343f'), 0.3, 0.012, 0.01));
  return g;
}

export function screenMaterial(seed: number) {
  // a little "game" on screen: gradient sky + ground stripe, emissive so it pops at night
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 40;
  const c = cv.getContext('2d')!;
  const hues = [200, 280, 20, 130, 330];
  const h = hues[seed % hues.length];
  const gr = c.createLinearGradient(0, 0, 0, 40); gr.addColorStop(0, `hsl(${h},80%,55%)`); gr.addColorStop(1, `hsl(${(h + 40) % 360},80%,35%)`);
  c.fillStyle = gr; c.fillRect(0, 0, 64, 40);
  c.fillStyle = `hsl(${(h + 180) % 360},70%,45%)`; c.fillRect(0, 28, 64, 12);
  c.fillStyle = '#fff'; c.fillRect(10 + (seed * 7) % 40, 20, 6, 8);
  c.fillStyle = '#ffd166'; c.fillRect(40, 8, 8, 8);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.3 });
}

// ---------- decor ----------
export function neonSign(text: string, color: string) {
  const g = new THREE.Group();
  const t = textCanvas(text, { w: 512, h: 200, fg: '#fff', glow: color, font: '"Pacifico", "Brush Script MT", cursive' });
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(color).lerp(new THREE.Color('#fff'), 0.4), toneMapped: false, depthWrite: false });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), m); p.userData.ownGeo = true; p.position.z = 0.03;
  g.add(box(1.45, 0.6, 0.02, mat('#151020', { rough: 0.9 }), 0, 0, 0));
  g.add(p);
  g.userData.neon = m;
  return g;
}
export function poster(title: string, color: string, seed: number) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 360;
  const c = cv.getContext('2d')!;
  const gr = c.createLinearGradient(0, 0, 0, 360); gr.addColorStop(0, color); gr.addColorStop(1, '#1a1033');
  c.fillStyle = gr; c.fillRect(0, 0, 256, 360);
  c.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 30; i++) { const x = (seed * 37 + i * 53) % 256, y = (seed * 11 + i * 29) % 200; c.fillRect(x, y, 2, 2); }
  c.fillStyle = '#ffd166'; c.beginPath(); c.arc(128, 150 + (seed % 3) * 10, 50, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.font = '900 38px "Baloo 2", system-ui, sans-serif'; c.textAlign = 'center';
  const words = title.split(' ');
  words.forEach((w, i) => c.fillText(w.toUpperCase(), 128, 268 + i * 40));
  c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(4, 4, 248, 352);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.84), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
  p.userData.ownGeo = true; p.position.z = 0.012;
  const g = new THREE.Group(); g.add(p); return g;
}
export function floorLamp() {
  const g = new THREE.Group();
  g.add(box(0.3, 0.04, 0.3, mat('#2b2d42'), 0, 0.02, 0));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 8), mat('#2b2d42', { metal: 0.6, rough: 0.4 })); pole.userData.ownGeo = true; pole.position.y = 0.72; g.add(pole);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.26, 16, 1, true), mat('#ffe8c2', { emissive: '#ffb86b', ei: 0.6 })); shade.userData.ownGeo = true;
  (shade.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide; shade.position.y = 1.45; g.add(shade);
  g.userData.lamp = shade.material;
  return g;
}

// ---------- products (one merged geometry + material each, for instancing on shelves) ----------
export interface Proto { geo: THREE.BufferGeometry; mat: THREE.Material; w: number; h: number }
const protos = new Map<string, Proto>();
function fromModel(name: string, color?: string, scale = 1): Proto | null {
  const g = loaded(name); if (!g) return null;
  const geos: THREE.BufferGeometry[] = []; let m: THREE.Material | null = null;
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o: any) => { if (o.isMesh) { const gg = o.geometry.clone(); gg.applyMatrix4(o.matrixWorld); for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k); geos.push(gg.index ? gg.toNonIndexed() : gg); m = o.material; } });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos.map(x => { if (!x.getAttribute('uv')) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.getAttribute('position').count * 2), 2)); return x; }));
  merged.scale(scale, scale, scale);
  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  let mm = m as unknown as THREE.Material;
  if (color) { mm = (m as any).clone(); (mm as any).color = new THREE.Color(color).lerp(new THREE.Color('#fff'), 0.35); }
  return { geo: merged, mat: mm, w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y };
}
function colored(parts: [THREE.BufferGeometry, string][]): Proto {
  const geos = parts.map(([g, c]) => {
    const gg = g.index ? g.toNonIndexed() : g; const n = gg.getAttribute('position').count; const col = new THREE.Color(c);
    const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    gg.setAttribute('color', new THREE.BufferAttribute(arr, 3)); gg.deleteAttribute('uv'); return gg;
  });
  const merged = mergeGeometries(geos); merged.computeBoundingBox(); const bb = merged.boundingBox!;
  return { geo: merged, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y };
}
const B = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

export function productProto(mesh: string, color = '#fff'): Proto {
  const key = mesh + color;
  if (protos.has(key)) return protos.get(key)!;
  let p: Proto | null = null;
  switch (mesh) {
    case 'soda-can': p = fromModel('soda-can', color, 1.15); break;
    case 'soda-bottle': p = fromModel('soda-bottle', color, 1); break;
    case 'bag': p = fromModel('bag', color, 1.1); break;
    case 'candy': p = colored([[B(0.16, 0.03, 0.06), color], [B(0.06, 0.031, 0.061, 0, 0, 0), '#fff']]); break;
    case 'gamebox': p = colored([[B(0.14, 0.19, 0.025), color], [B(0.1, 0.1, 0.026, 0, 0.06, 0.001), '#fff'], [B(0.14, 0.03, 0.026, 0, 0.16, 0.001), '#ffd166']]); break;
    case 'plush': p = colored([[new THREE.SphereGeometry(0.075, 10, 8).translate(0, 0.075, 0), color], [new THREE.SphereGeometry(0.055, 10, 8).translate(0, 0.17, 0), color], [new THREE.SphereGeometry(0.02, 6, 6).translate(-0.04, 0.22, 0), color], [new THREE.SphereGeometry(0.02, 6, 6).translate(0.04, 0.22, 0), color], [B(0.012, 0.012, 0.01, -0.018, 0.17, 0.05), '#222'], [B(0.012, 0.012, 0.01, 0.018, 0.17, 0.05), '#222']]); break;
    case 'controller': p = colored([[B(0.15, 0.035, 0.08), color], [new THREE.CylinderGeometry(0.03, 0.03, 0.035, 8).translate(-0.065, 0.0175, 0.02), color], [new THREE.CylinderGeometry(0.03, 0.03, 0.035, 8).translate(0.065, 0.0175, 0.02), color], [B(0.02, 0.01, 0.02, 0.04, 0.035, -0.01), '#ef476f'], [B(0.02, 0.01, 0.02, -0.04, 0.035, -0.01), '#ddd']]); break;
    case 'mouse': p = colored([[new THREE.SphereGeometry(0.045, 10, 8).scale(0.75, 0.45, 1.2).translate(0, 0.02, 0), color], [B(0.004, 0.01, 0.03, 0, 0.036, -0.02), '#222']]); break;
    case 'headset': p = colored([[new THREE.TorusGeometry(0.08, 0.012, 6, 16, Math.PI).translate(0, 0.08, 0), color], [new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateZ(Math.PI / 2).translate(-0.08, 0.06, 0), '#222'], [new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateZ(Math.PI / 2).translate(0.08, 0.06, 0), '#222']]); break;
    case 'shirt': p = colored([[B(0.22, 0.04, 0.18), color], [B(0.08, 0.041, 0.06, 0, 0, 0.02), '#2b2d42']]); break;
  }
  if (!p) p = colored([[B(0.12, 0.12, 0.12), color]]);
  protos.set(key, p);
  return p;
}

// ---------- hats for players & staff ----------
export const HATS = ['none', 'cap', 'beanie', 'headphones', 'tophat', 'crown', 'cowboy', 'party'];
export function hat(kind: string, color: string): THREE.Object3D | null {
  const m = mat(color, { rough: 0.6 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mm: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mm); o.position.set(x, y, z); o.castShadow = true; o.userData.ownGeo = true; g.add(o); return o; };
  switch (kind) {
    case 'cap': add(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0, 0); add(new THREE.BoxGeometry(0.2, 0.015, 0.14), m, 0, 0.005, 0.12); break;
    case 'beanie': add(new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), m, 0, -0.01, 0); add(new THREE.SphereGeometry(0.035, 8, 6), mat('#fff'), 0, 0.13, 0); break;
    case 'headphones': add(new THREE.TorusGeometry(0.14, 0.018, 6, 18, Math.PI), m, 0, -0.02, 0).rotation.set(0, 0, 0); add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateZ(Math.PI / 2), mat('#222'), -0.14, -0.04, 0); add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateZ(Math.PI / 2), mat('#222'), 0.14, -0.04, 0); break;
    case 'tophat': add(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 16), m, 0, 0, 0); add(new THREE.CylinderGeometry(0.11, 0.12, 0.2, 16), m, 0, 0.1, 0); add(new THREE.CylinderGeometry(0.121, 0.121, 0.03, 16), mat('#ef476f'), 0, 0.03, 0); break;
    case 'crown': { const c = mat('#ffd166', { metal: 0.7, rough: 0.3, emissive: '#7a5a00', ei: 0.3 }); add(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 10, 1, true), c, 0, 0.035, 0); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(new THREE.ConeGeometry(0.025, 0.06, 4), c, Math.cos(a) * 0.115, 0.095, Math.sin(a) * 0.115); } break; }
    case 'cowboy': add(new THREE.CylinderGeometry(0.24, 0.24, 0.015, 18), m, 0, 0, 0); add(new THREE.CylinderGeometry(0.1, 0.13, 0.16, 14), m, 0, 0.08, 0); break;
    case 'party': add(new THREE.ConeGeometry(0.09, 0.25, 12), m, 0, 0.12, 0); add(new THREE.SphereGeometry(0.03, 6, 6), mat('#ffd166'), 0, 0.25, 0); break;
    default: return null;
  }
  return g;
}

// ---------- mess ----------
export function spill() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.38, 18), new THREE.MeshStandardMaterial({ color: '#8f4f2a', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.scale.set(1, 0.7 + Math.random() * 0.5, 1); m.userData.ownGeo = true;
  return m;
}

// ---------- billboard sprites: progress ring + emoji bubble ----------
export function ringTexture(p: number, color = '#80ed99') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  c.lineWidth = 9; c.strokeStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(32, 32, 24, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = color; c.lineCap = 'round'; c.beginPath(); c.arc(32, 32, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); c.stroke();
  return cv;
}
const RING_STEPS = 24;
const ringTex: THREE.Texture[] = [];
export function ringFrame(p: number, warn = false) {
  const i = Math.round(Math.max(0, Math.min(1, p)) * RING_STEPS) + (warn ? RING_STEPS + 1 : 0);
  if (!ringTex[i]) { const t = new THREE.CanvasTexture(ringTexture(Math.round(Math.max(0, Math.min(1, p)) * RING_STEPS) / RING_STEPS, warn ? '#ffb703' : '#80ed99')); t.colorSpace = THREE.SRGBColorSpace; ringTex[i] = t; }
  return ringTex[i];
}
const emojiTex = new Map<string, THREE.Texture>();
export function emojiTexture(e: string) {
  if (emojiTex.has(e)) return emojiTex.get(e)!;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(255,255,255,0.92)'; c.beginPath(); c.arc(32, 30, 26, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(24, 50); c.lineTo(32, 62); c.lineTo(38, 50); c.fill();
  c.font = '32px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(e, 32, 32);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  emojiTex.set(e, t);
  return t;
}
