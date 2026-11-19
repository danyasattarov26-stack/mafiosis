/* Builds the 3D look of every placed object (stations with their component tiers, shelves with stock, etc.). */
import * as THREE from 'three';
import { ITEM } from '../config/items';
import type { PlacedObject } from '../core/save';
import { instance, ownMaterials, stripShelf } from '../engine/assets';
import { rotAngle } from '../sim/layout';
import { box, mat, pcTower, keyboardMouse, screenMaterial, neonSign, poster, floorLamp, productProto, type Proto, textCanvas } from './props';

export interface ObjView {
  root: THREE.Group;
  key: string;
  screens: THREE.MeshStandardMaterial[];
  smoke?: THREE.Group;
  shelf?: { mesh: THREE.InstancedMesh | null; slots: THREE.Vector3[]; product: string | null; stock: number; proto: Proto | null };
  glow?: THREE.Material[];
  lamp?: THREE.Material;
  neon?: THREE.MeshBasicMaterial;
}

const TIER_CHAIR = [
  { seat: '#ffb347', frame: '#c9d1d9', dark: '#8b949e', scale: 1 },
  { seat: '#e63946', frame: '#1d1d24', dark: '#2b2d42', scale: 1.05 },
  { seat: '#3a86ff', frame: '#111118', dark: '#ffd166', scale: 1.1 },
  { seat: '#7b2cbf', frame: '#ffd166', dark: '#ffd166', scale: 1.18 },
];
const TIER_DESK = [{ top: null as string | null, led: null as string | null }, { top: '#f1f1f1', led: '#3ee6ff' }, { top: '#24242e', led: '#ff4fd8' }];

function chair(tier: number) {
  const c = ownMaterials(instance('desk_chairArms'));
  const t = TIER_CHAIR[tier] || TIER_CHAIR[0];
  c.traverse((o: any) => {
    if (!o.isMesh) return;
    const n = o.material.name;
    if (n === 'metalRed') o.material.color.set(t.seat);
    else if (n === 'metalDark') o.material.color.set(t.dark);
    else o.material.color.set(t.frame);
  });
  c.scale.setScalar(t.scale);
  const g = new THREE.Group(); g.add(c);
  if (tier >= 2) g.add(box(0.36, 0.42, 0.06, mat(t.seat), 0, 1.0 * t.scale, -0.12)); // tall racing back
  if (tier >= 2) g.add(box(0.2, 0.08, 0.08, mat(t.dark), 0, 1.18 * t.scale, -0.1)); // neck pillow
  return g;
}

function desk(tier: number) {
  const d = instance('desk');
  const t = TIER_DESK[tier] || TIER_DESK[0];
  if (t.top) { ownMaterials(d); d.traverse((o: any) => { if (o.isMesh && /wood/i.test(o.material.name)) o.material.color.set(t.top); }); }
  const g = new THREE.Group(); g.add(d);
  if (t.led) { const led = mat(t.led, { emissive: t.led, ei: 1.5 }); g.add(box(1.4, 0.02, 0.02, led, 0, 0.7, 0.38)); g.userData.led = led; }
  return g;
}

function stationVisual(o: PlacedObject, v: ObjView) {
  const def = ITEM[o.item];
  const g = v.root;
  const tier = def.tier || 0;
  const seed = Math.abs([...o.id].reduce((a, c) => a + c.charCodeAt(0), 0));
  if (def.build === 'console') {
    const cab = instance('cabinetTelevision'); cab.position.set(0, 0, -0.95); g.add(cab);
    const tv = instance('televisionModern'); tv.position.set(0, 0.62, -1.0); tv.scale.setScalar(tier >= 2 ? 1.25 : 1); g.add(tv);
    const sm = screenMaterial(seed); v.screens.push(sm);
    const sw = 1.22 * (tier >= 2 ? 1.25 : 1), sh = 0.68 * (tier >= 2 ? 1.25 : 1);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), sm); scr.userData.ownGeo = true; scr.position.set(0, 0.62 + (0.55 * (tier >= 2 ? 1.25 : 1)), -0.86); g.add(scr);
    g.add(box(0.36, 0.07, 0.24, mat(tier >= 2 ? '#f1f1f1' : '#1d1d24', { rough: 0.4 }), 0.45, 0.66, -0.95));
    if (tier >= 2) { const led = mat('#ff4fd8', { emissive: '#ff4fd8', ei: 1.4 }); g.add(box(1.5, 0.02, 0.02, led, 0, 0.02, -0.7)); v.glow = [led]; }
    const sofa = instance('loungeSofa'); sofa.position.set(0, 0, 0.75); sofa.rotation.y = Math.PI;
    if ((o.chair || 0) > 0) { ownMaterials(sofa); sofa.traverse((m: any) => { if (m.isMesh) m.material.color.lerp(new THREE.Color(TIER_CHAIR[o.chair!].seat), 0.6); }); }
    g.add(sofa);
    for (const sx of [-0.45, 0.45]) g.add(box(0.12, 0.03, 0.06, mat('#2b2d42'), sx, 0.47, 0.35));
    return;
  }
  // PC / laptop station: desk at the back, chair in front facing it
  const dk = desk(o.desk || 0); dk.position.set(0, 0, -0.55); g.add(dk);
  if (dk.userData.led) (v.glow ||= []).push(dk.userData.led);
  const top = 0.77;
  if (tier === 0) {
    const lap = instance('laptop'); lap.position.set(0, top, -0.5); lap.scale.setScalar(1.3); g.add(lap);
    const sm = screenMaterial(seed); v.screens.push(sm);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), sm); scr.userData.ownGeo = true;
    scr.position.set(0, top + 0.17, -0.66); scr.rotation.x = -0.25; g.add(scr);
  } else {
    const mon = o.mon || 0;
    if (mon === 2) {
      for (const sx of [-0.33, 0.33]) { const arm = instance('monitor-arm'); arm.position.set(sx, top - 0.6, -0.86); g.add(arm); const sm = screenMaterial(seed + (sx > 0 ? 1 : 0)); v.screens.push(sm); const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36), sm); scr.userData.ownGeo = true; scr.position.set(sx, top + 0.38, -0.735); g.add(scr); }
    } else {
      const m = instance('desk-monitor');
      const sx = mon === 3 ? 1.75 : mon === 1 ? 1.2 : 1, sy = mon === 3 ? 1.1 : mon === 1 ? 1.15 : 1;
      m.scale.set(sx, sy, 1); m.position.set(0, top, -0.78); g.add(m);
      const sm = screenMaterial(seed); v.screens.push(sm);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5 * sx, 0.27 * sy), sm); scr.userData.ownGeo = true;
      scr.position.set(0, top + 0.27 * sy, -0.765); g.add(scr);
    }
    const tower = pcTower(tier); tower.position.set(0.52, top, -0.66); g.add(tower);
    if (tower.userData.glow) (v.glow ||= []).push(tower.userData.glow);
    const kb = keyboardMouse(tier >= 2); kb.position.set(-0.05, top, -0.36); g.add(kb);
  }
  const ch = chair(o.chair || 0); ch.position.set(0, 0, 0.22); ch.rotation.y = Math.PI; g.add(ch);
}

function fridgeModel() {
  // built in code so the glass doors are really see-through
  const g = new THREE.Group();
  const body = mat('#e9ecef', { rough: 0.5 }), dark = mat('#495057', { rough: 0.6 }), inner = mat('#dff3ff', { emissive: '#bfe8ff', ei: 0.55 });
  const W = 2.3, H = 2.05, D = 0.95;
  g.add(box(W, 0.12, D, dark, 0, 0.06, 0));                       // plinth
  g.add(box(W, 0.18, D, body, 0, H - 0.09, 0));                   // top
  g.add(box(0.08, H, D, body, -W / 2 + 0.04, H / 2, 0), box(0.08, H, D, body, W / 2 - 0.04, H / 2, 0), box(0.06, H - 0.3, D, body, 0, H / 2, 0));
  g.add(box(W - 0.1, H - 0.3, 0.04, inner, 0, H / 2, -D / 2 + 0.03)); // lit back wall
  for (const y of [0.33, 0.83, 1.33]) g.add(box(W - 0.12, 0.025, D - 0.15, mat('#f8f9fa', { rough: 0.3, metal: 0.2 }), 0, y, 0));
  const glass = new THREE.MeshStandardMaterial({ color: '#d8f3ff', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false });
  for (const sx of [-1, 1]) { const p = box(W / 2 - 0.1, H - 0.32, 0.02, glass, sx * W / 4, H / 2, D / 2 - 0.02); p.castShadow = false; g.add(p); g.add(box(0.03, 0.5, 0.04, dark, sx * 0.08, 1.05, D / 2 + 0.01)); }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.14), new THREE.MeshBasicMaterial({ map: textCanvas('ICE COLD DRINKS', { w: 512, h: 64, fg: '#0077b6' }), transparent: true }));
  sign.userData.ownGeo = true; sign.position.set(0, H - 0.09, D / 2 + 0.005); g.add(sign);
  return g;
}

function shelfVisual(o: PlacedObject, v: ObjView) {
  const def = ITEM[o.item];
  const g = v.root;
  const cap = def.capacity || 12;
  let slots: THREE.Vector3[] = [];
  if (def.kind === 'fridge') {
    g.add(fridgeModel());
    const levels = [0.345, 0.845, 1.345], perRow = Math.ceil(cap / levels.length);
    for (const y of levels) for (let i = 0; i < perRow; i++) slots.push(new THREE.Vector3(-0.98 + (i / (perRow - 1)) * 1.96, y, 0.12));
  } else {
    const m = instance(def.model!);
    g.add(m);
    const anchors = stripShelf(m);
    // find the board under each baked product: that's where our stock stands
    m.updateWorldMatrix(true, true);
    const ray = new THREE.Raycaster();
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    const boards = new Map<string, number>();
    for (const a of anchors) {
      const wp = a.clone().applyMatrix4(m.matrixWorld);
      ray.set(wp.clone().setY(wp.y + 0.05), new THREE.Vector3(0, -1, 0)); ray.far = 1.2;
      const hit = ray.intersectObject(m, true)[0];
      const y = hit ? hit.point.clone().applyMatrix4(inv).y : a.y;
      boards.set(`${Math.round(y * 20)}|${Math.round(a.z * 10)}`, y);
    }
    const levels = [...boards.entries()].map(([k, y]) => ({ y, z: Number(k.split('|')[1]) / 10 }));
    const perRow = Math.ceil(cap / Math.max(1, levels.length));
    const bb = new THREE.Box3().setFromObject(m);
    const half = Math.min(0.8, (bb.max.x - bb.min.x) / 2 - 0.18);
    for (const l of levels) for (let i = 0; i < perRow; i++) slots.push(new THREE.Vector3(-half + (perRow > 1 ? i / (perRow - 1) : 0.5) * half * 2, l.y + 0.005, l.z));
    if (!slots.length) for (let i = 0; i < cap; i++) slots.push(new THREE.Vector3(-0.7 + (i % 6) * 0.28, 0.45 + Math.floor(i / 6) * 0.5, 0));
  }
  v.shelf = { mesh: null, slots: slots.slice(0, cap), product: null, stock: -1, proto: null };
  // price tag
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.12), new THREE.MeshBasicMaterial({ transparent: true }));
  tag.userData.ownGeo = true; tag.userData.priceTag = true;
  tag.position.set(0, def.kind === 'fridge' ? 1.82 : 0.16, def.kind === 'fridge' ? 0.5 : (def.size![1] * 0.25) + 0.02);
  g.add(tag);
}

export function updateShelf(v: ObjView, o: PlacedObject, price: number | null) {
  if (!v.shelf) return;
  const sh = v.shelf;
  const product = o.product || null, stock = o.stock || 0;
  if (product !== sh.product) {
    if (sh.mesh) { v.root.remove(sh.mesh); sh.mesh.dispose(); sh.mesh = null; }
    sh.product = product; sh.stock = -1;
    if (product) {
      const pd = ITEM[product].product!;
      sh.proto = productProto(pd.mesh, pd.color);
      sh.mesh = new THREE.InstancedMesh(sh.proto.geo, sh.proto.mat, sh.slots.length);
      sh.mesh.castShadow = true; sh.mesh.userData.noRay = true; sh.mesh.frustumCulled = false;
      v.root.add(sh.mesh);
    }
  }
  if (sh.mesh && stock !== sh.stock) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < sh.slots.length; i++) { const p = sh.slots[i]; m.compose(p, q, new THREE.Vector3(1, 1, 1)); sh.mesh.setMatrixAt(i, m); }
    sh.mesh.count = Math.min(stock, sh.slots.length);
    sh.mesh.instanceMatrix.needsUpdate = true;
    sh.stock = stock;
  }
  // price tag text
  const tag = v.root.children.find(c => c.userData.priceTag) as THREE.Mesh | undefined;
  if (tag) {
    const key = product ? `${ITEM[product].name}|${price}` : 'empty';
    if (tag.userData.key !== key) {
      tag.userData.key = key;
      const m = tag.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.map = textCanvas(product ? `$${price}` : 'EMPTY', { w: 256, h: 90, bg: product ? '#fff' : '#ffe8e8', fg: product ? '#2b2d42' : '#c1121f', border: '#2b2d42' });
      m.needsUpdate = true;
    }
  }
}

export function buildObject(o: PlacedObject): ObjView {
  const root = new THREE.Group();
  const v: ObjView = { root, key: objKey(o), screens: [] };
  const def = ITEM[o.item];
  root.position.set(o.x, o.wall ? (o.y ?? 1.8) : 0, o.z);
  root.rotation.y = rotAngle(o.rot);
  root.userData.target = { kind: o.item === 'office' ? 'laptop' : 'obj', id: o.id };
  if (o.item === 'office') {
    const dk = instance('desk'); dk.position.set(0, 0, -0.05); root.add(dk);
    const lap = instance('laptop'); lap.position.set(0, 0.77, 0.0); lap.scale.setScalar(1.25); root.add(lap);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshStandardMaterial({ map: textCanvas('ShopOS', { w: 256, h: 150, bg: '#3a0ca3', fg: '#fff' }), emissive: '#fff', emissiveIntensity: 0.6 }));
    (scr.material as any).emissiveMap = (scr.material as any).map;
    scr.userData.ownGeo = true; scr.position.set(0, 0.92, -0.135); scr.rotation.x = -0.25; root.add(scr);
    const ch = chair(0); ch.position.set(0, 0, -0.75); root.add(ch);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: textCanvas('MANAGER', { w: 512, h: 120, bg: '#2b2d42', fg: '#ffd166' }) }));
    label.userData.ownGeo = true; label.position.set(0, 0.6, 0.4); root.add(label);
    return v;
  }
  if (!def) return v;
  switch (def.build) {
    case 'station': case 'console': stationVisual(o, v); break;
    case 'shelf': case 'fridge': shelfVisual(o, v); break;
    case 'counter': case 'model': { const m = instance(def.model!); if (def.scale) m.scale.setScalar(def.scale); root.add(m); break; }
    case 'plant': { const p = instance('pot_large'); p.scale.setScalar(0.5); root.add(p); const b = instance('plant_bushDetailed'); b.scale.setScalar(0.62); b.position.y = 0.22; root.add(b); break; }
    case 'lamp': { const l = floorLamp(); root.add(l); v.lamp = l.userData.lamp; break; }
    case 'poster': root.add(poster(def.name.replace('Poster: ', ''), def.tint || '#5b5bd6', o.id.length)); break;
    case 'neon': { const n = neonSign(def.name.match(/“(.+)”/)?.[1] || 'GG', def.tint || '#ff4fd8'); root.add(n); v.neon = n.userData.neon; break; }
  }
  if (def.kind === 'shelf' || def.kind === 'fridge') updateShelf(v, o, null);
  return v;
}

export const objKey = (o: PlacedObject) => [o.item, o.x, o.z, o.rot, o.y ?? '', o.mon || 0, o.chair || 0, o.desk || 0].join('|');

/** smoke puffs for broken stations */
export function smoke() {
  const g = new THREE.Group();
  const m = new THREE.SpriteMaterial({ color: '#555', transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < 5; i++) { const s = new THREE.Sprite(m); s.scale.setScalar(0.3); s.userData.phase = i / 5; g.add(s); }
  const warn = new THREE.Sprite(new THREE.SpriteMaterial({ map: textCanvas('⚠ BROKEN', { w: 256, h: 64, bg: '#c1121f', fg: '#fff' }), depthTest: false }));
  warn.scale.set(0.8, 0.2, 1); warn.position.y = 1.9; warn.renderOrder = 10; g.add(warn);
  return g;
}
export function animateSmoke(g: THREE.Group, t: number) {
  for (const s of g.children) {
    if (!(s as any).isSprite || s.userData.phase == null) continue;
    const p = (t * 0.5 + s.userData.phase) % 1;
    s.position.set(Math.sin(p * 6 + s.userData.phase * 9) * 0.1, 1.0 + p * 1.0, -0.6);
    s.scale.setScalar(0.2 + p * 0.5);
    ((s as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 0.5 * (1 - p);
  }
}
