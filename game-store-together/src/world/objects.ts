/* Builds the 3D look of every placed object (stations with their component tiers, shelves with stock, etc.). */
import * as THREE from 'three';
import { ITEM } from '../config/items';
import type { PlacedObject } from '../core/save';
import { instance, ownMaterials, stripShelf } from '../engine/assets';
import { rotAngle, POD, RIG } from '../sim/layout';
import { box, mat, pcTower, keyboardMouse, screenMaterial, neonSign, poster, floorLamp, productProto, type Proto, textCanvas, foamTexture, gridTexture, menuBoard } from './props';

export interface ObjView {
  root: THREE.Group;
  key: string;
  screens: THREE.MeshStandardMaterial[];
  smoke?: THREE.Group;
  shelf?: { mesh: THREE.InstancedMesh | null; slots: THREE.Vector3[]; product: string | null; stock: number; proto: Proto | null };
  glow?: THREE.Material[];
  lamp?: THREE.Material;
  neon?: THREE.MeshBasicMaterial;
  wheel?: THREE.Object3D;               // racing wheel, turns while driving
  onAir?: THREE.MeshStandardMaterial;   // streamer pod sign, lights up when live
  ringLight?: THREE.MeshStandardMaterial;
  foodbar?: boolean;
}

const cyl = (r0: number, r1: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); c.position.set(x, y, z); c.castShadow = true; c.userData.ownGeo = true; return c;
};
const glassMat = () => new THREE.MeshStandardMaterial({ color: '#d8f3ff', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
/** a screen plane that lights up while someone plays */
function addScreen(g: THREE.Object3D, v: ObjView, seed: number, w: number, h: number, x: number, y: number, z: number, rx = 0) {
  const sm = screenMaterial(seed); v.screens.push(sm);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sm); scr.userData.ownGeo = true;
  scr.position.set(x, y, z); scr.rotation.x = rx; g.add(scr);
  return scr;
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
  if (def.build === 'retro') return retroVisual(o, v, seed);
  if (def.build === 'pod') return podVisual(o, v, seed);
  if (def.build === 'racing') return racingVisual(o, v, seed);
  if (def.build === 'vr') return vrVisual(o, v, seed);
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

/** desk + monitor + tower + keyboard, the chair in front (same layout as a PC station) */
function deskSetup(o: PlacedObject, v: ObjView, seed: number, tier: number, deskTier: number, chairTier: number) {
  const g = new THREE.Group();
  const dk = desk(deskTier); dk.position.set(0, 0, -0.55); g.add(dk);
  if (dk.userData.led) (v.glow ||= []).push(dk.userData.led);
  const top = 0.77;
  const m = instance('desk-monitor'); m.scale.set(1.2, 1.15, 1); m.position.set(0, top, -0.78); g.add(m);
  addScreen(g, v, seed, 0.6, 0.31, 0, top + 0.31, -0.765);
  const tower = pcTower(tier); tower.position.set(0.52, top, -0.66); g.add(tower);
  if (tower.userData.glow) (v.glow ||= []).push(tower.userData.glow);
  const kb = keyboardMouse(tier >= 2); kb.position.set(-0.05, top, -0.36); g.add(kb);
  const ch = chair(chairTier); ch.position.set(0, 0, 0.22); ch.rotation.y = Math.PI; g.add(ch);
  return g;
}

/** beige desktop case + chunky CRT (Poly Haven) on a plain desk */
function retroVisual(o: PlacedObject, v: ObjView, seed: number) {
  const g = v.root, top = 0.77;
  const dk = desk(0); dk.position.set(0, 0, -0.55); g.add(dk);
  const beige = mat('#e8dcc0', { rough: 0.8 }), beigeDark = mat('#cbbd9c', { rough: 0.8 });
  g.add(box(0.56, 0.13, 0.44, beige, -0.02, top + 0.065, -0.66));                // desktop case
  g.add(box(0.2, 0.012, 0.01, mat('#3d3d3d'), -0.12, top + 0.08, -0.437));         // floppy slot
  g.add(box(0.05, 0.03, 0.01, beigeDark, 0.17, top + 0.065, -0.437));              // power button
  g.add(box(0.015, 0.015, 0.01, mat('#80ed99', { emissive: '#80ed99', ei: 1.4 }), 0.22, top + 0.065, -0.437));
  const tv = instance('television_01'); tv.scale.setScalar(0.82); tv.position.set(-0.02, top + 0.13, -0.68); g.add(tv);
  addScreen(g, v, seed, 0.34, 0.25, -0.045, top + 0.13 + 0.215, -0.68 + 0.196);
  g.add(box(0.42, 0.025, 0.15, beige, -0.05, top + 0.0125, -0.33));                 // keyboard
  for (let i = 0; i < 5; i++) g.add(box(0.36, 0.006, 0.018, beigeDark, -0.05, top + 0.028, -0.385 + i * 0.026));
  g.add(box(0.06, 0.03, 0.09, beige, 0.26, top + 0.015, -0.32));                    // ball mouse
  const ch = chair(o.chair || 0); ch.position.set(0, 0, 0.22); ch.rotation.y = Math.PI; g.add(ch);
}

/** soundproof booth: acoustic foam, glass front, ring light, mic, webcam and an ON AIR sign */
function podVisual(o: PlacedObject, v: ObjView, seed: number) {
  const g = v.root;
  const { W, D, H, shift } = POD;
  const shell = mat('#2b2d42', { rough: 0.6 }), trim = mat('#ff4fd8', { emissive: '#ff4fd8', ei: 1.4 });
  const foamT = foamTexture('#3c3556'); foamT.repeat.set(4, 4);
  const foam = new THREE.MeshStandardMaterial({ map: foamT, roughness: 1 });
  const t = 0.06;
  g.add(box(W, 0.06, D, mat('#1d1b2b'), 0, 0.03, 0));                                // floor
  const roof = box(W, t, D, shell, 0, H - t / 2, 0); roof.userData.thumbHide = true; g.add(roof);  // roof (hidden in the shop thumbnail)
  const panel = box(W - 0.5, 0.02, 0.5, mat('#f3e9ff', { emissive: '#e0c3ff', ei: 1.2 }), 0, H - t - 0.012, -0.2); panel.userData.thumbHide = true; g.add(panel); // ceiling light
  g.add(box(W, H, t, shell, 0, H / 2, -D / 2 + t / 2));                                 // back
  for (const sx of [-1, 1]) g.add(box(t, H, D, shell, sx * (W / 2 - t / 2), H / 2, 0)); // sides
  // foam panels inside
  const fb = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, H - 0.4), foam); fb.userData.ownGeo = true; fb.position.set(0, H / 2 + 0.05, -D / 2 + t + 0.005); g.add(fb);
  for (const sx of [-1, 1]) { const fs = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.5, H - 0.4), foam); fs.userData.ownGeo = true; fs.position.set(sx * (W / 2 - t - 0.005), H / 2 + 0.05, -0.1); fs.rotation.y = -sx * Math.PI / 2; g.add(fs); }
  // front: glass either side of the doorway, a header with the ON AIR sign
  const door = 0.92, side = (W - door) / 2;
  const glass = glassMat();
  for (const sx of [-1, 1]) {
    const x = sx * (door / 2 + side / 2);
    const p = box(side - 0.02, H - 0.36, 0.02, glass, x, (H - 0.3) / 2 + 0.03, D / 2 - 0.02); p.castShadow = false; g.add(p);
    g.add(box(0.06, H, 0.08, shell, sx * door / 2, H / 2, D / 2 - 0.04));
  }
  g.add(box(W, 0.32, 0.08, shell, 0, H - 0.16, D / 2 - 0.04));
  const onAir = new THREE.MeshStandardMaterial({ map: textCanvas('ON AIR', { w: 256, h: 80, bg: '#2a0a0a', fg: '#ff4d4d' }), emissive: '#ffffff', emissiveIntensity: 0.15, roughness: 0.4 });
  (onAir as any).emissiveMap = onAir.map;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.2), onAir); sign.userData.ownGeo = true; sign.position.set(0, H - 0.16, D / 2 + 0.005); g.add(sign);
  v.onAir = onAir;
  g.add(box(W + 0.02, 0.03, 0.03, trim, 0, H + 0.005, D / 2 - 0.01), box(0.03, 0.03, D, trim, -W / 2, H + 0.005, 0), box(0.03, 0.03, D, trim, W / 2, H + 0.005, 0));
  (v.glow ||= []).push(trim);
  // the streaming setup inside, shifted back
  const inner = deskSetup(o, v, seed, 2, 2, Math.max(2, o.chair || 0)); inner.position.z = shift; g.add(inner);
  const z0 = shift, top = 0.77;
  g.add(box(0.07, 0.04, 0.05, mat('#111'), 0, top + 0.68, z0 - 0.75));                 // webcam on the monitor
  g.add(box(0.02, 0.02, 0.005, mat('#3ee6ff', { emissive: '#3ee6ff', ei: 2 }), 0, top + 0.68, z0 - 0.722));
  // ring light on a stand
  const ringM = mat('#ffffff', { emissive: '#fff4e0', ei: 0.4 }) as THREE.MeshStandardMaterial;
  const ringMat = ringM.clone(); v.ringLight = ringMat;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 28), ringMat); ring.userData.ownGeo = true;
  ring.position.set(0.62, 1.42, z0 - 0.5); ring.rotation.y = -0.5; g.add(ring);
  g.add(cyl(0.012, 0.012, 1.25, mat('#222'), 0.62, 0.65, z0 - 0.5), cyl(0.14, 0.14, 0.03, mat('#222'), 0.62, 0.05, z0 - 0.5));
  // mic on a boom arm, in front of the streamer's face
  const dark = mat('#222', { metal: 0.4, rough: 0.4 });
  g.add(cyl(0.012, 0.012, 0.5, dark, -0.55, top + 0.25, z0 - 0.62));
  const arm = cyl(0.01, 0.01, 0.6, dark, -0.35, top + 0.52, z0 - 0.38); arm.rotation.z = -1.1; arm.rotation.x = 0.5; g.add(arm);
  const mic = cyl(0.035, 0.03, 0.13, mat('#3d3d4a', { metal: 0.5, rough: 0.3 }), -0.1, top + 0.5, z0 - 0.22); mic.rotation.x = 0.9; g.add(mic);
  // acoustic "dampener" stripes and a little LED strip under the desk
  g.add(box(W - 0.2, 0.02, 0.02, trim, 0, 0.1, -D / 2 + t + 0.02));
}

/** bucket seat, wheel and pedals facing three screens */
function racingVisual(o: PlacedObject, v: ObjView, seed: number) {
  const g = v.root;
  const black = mat('#1b1b22', { rough: 0.5, metal: 0.3 }), red = mat('#e63946', { rough: 0.6 }), dark = mat('#2b2d42', { rough: 0.6 });
  g.add(box(0.7, 0.06, 1.75, black, 0, 0.03, 0.1));                                    // frame rails
  g.add(box(0.12, 0.2, 0.12, black, 0, 0.13, RIG.seatZ));                               // seat post
  // bucket seat
  const seat = new THREE.Group(); seat.position.set(0, 0.24, RIG.seatZ + 0.04);
  seat.add(box(0.48, 0.1, 0.5, dark, 0, 0.05, 0));
  seat.add(box(0.08, 0.16, 0.5, red, -0.23, 0.13, 0), box(0.08, 0.16, 0.5, red, 0.23, 0.13, 0));
  const back = new THREE.Group(); back.position.set(0, 0.08, 0.24); back.rotation.x = -0.3;
  back.add(box(0.48, 0.7, 0.1, dark, 0, 0.35, 0), box(0.08, 0.6, 0.14, red, -0.23, 0.32, -0.02), box(0.08, 0.6, 0.14, red, 0.23, 0.32, -0.02), box(0.2, 0.06, 0.11, red, 0, 0.62, -0.01));
  seat.add(back); g.add(seat);
  // wheel column and wheel
  const col = box(0.1, 0.62, 0.1, black, 0, 0.31, RIG.wheelZ - 0.14); g.add(col);
  g.add(box(0.2, 0.12, 0.22, black, 0, RIG.wheelY - 0.04, RIG.wheelZ - 0.1));
  const wheel = new THREE.Group(); wheel.position.set(0, RIG.wheelY, RIG.wheelZ); wheel.rotation.x = -0.35;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 26), mat('#2b2d42', { rough: 0.5 })); rim.userData.ownGeo = true; wheel.add(rim);
  wheel.add(box(0.3, 0.035, 0.03, mat('#2b2d42'), 0, 0, 0), box(0.035, 0.15, 0.03, mat('#2b2d42'), 0, -0.07, 0), box(0.05, 0.03, 0.035, red, 0, 0.15, 0));
  g.add(wheel); v.wheel = wheel;
  // pedals
  for (const px of [-0.12, 0, 0.12]) { const pd = box(0.07, 0.12, 0.02, mat('#8b949e', { metal: 0.6, rough: 0.3 }), px, 0.12, -0.5); pd.rotation.x = -0.6; g.add(pd); }
  g.add(box(0.45, 0.04, 0.2, black, 0, 0.06, -0.52));
  // three screens on a long stand
  g.add(box(1.9, 0.04, 0.3, black, 0, 0.72, -1.0));
  for (const lx of [-0.85, 0.85]) g.add(box(0.05, 0.72, 0.05, black, lx, 0.36, -1.0));
  const top = 0.74;
  [-1, 0, 1].forEach((k, i) => {
    const sg = new THREE.Group();
    const m = instance('desk-monitor'); m.scale.set(1.12, 1.12, 1); sg.add(m);
    addScreen(sg, v, seed + i, 0.56, 0.3, 0, 0.3, 0.016);
    const a = k * 0.5;
    sg.position.set(k * 0.61, top, -0.98 + Math.abs(k) * 0.13); sg.rotation.y = -a;
    g.add(sg);
  });
  const led = mat('#3ee6ff', { emissive: '#3ee6ff', ei: 1.4 }); g.add(box(1.8, 0.015, 0.015, led, 0, 0.7, -0.84)); (v.glow ||= []).push(led);
}

/** play mat, tracking towers and a spectator screen */
function vrVisual(o: PlacedObject, v: ObjView, seed: number) {
  const g = v.root;
  const matM = new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.9, emissive: '#3ee6ff', emissiveIntensity: 0.12 });
  (matM as any).emissiveMap = matM.map;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), matM); pad.userData.ownGeo = true; pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.012, 0.2); pad.receiveShadow = true; g.add(pad);
  const edge = mat('#3ee6ff', { emissive: '#3ee6ff', ei: 1.5 });
  for (const [w, d, x, z] of [[1.72, 0.03, 0, -0.66], [1.72, 0.03, 0, 1.06], [0.03, 1.72, -0.86, 0.2], [0.03, 1.72, 0.86, 0.2]] as const) g.add(box(w, 0.01, d, edge, x, 0.015, z));
  (v.glow ||= []).push(edge);
  const black = mat('#1b1b22', { rough: 0.5, metal: 0.3 });
  for (const sx of [-1, 1]) {
    g.add(cyl(0.025, 0.025, 2.0, black, sx * 1.1, 1.0, -1.05), cyl(0.18, 0.18, 0.03, black, sx * 1.1, 0.015, -1.05));
    const tower = box(0.12, 0.12, 0.1, black, sx * 1.1, 2.04, -1.02); tower.rotation.y = sx * -0.7; tower.rotation.x = 0.35; g.add(tower);
    g.add(box(0.03, 0.03, 0.01, mat('#80ed99', { emissive: '#80ed99', ei: 2 }), sx * 1.07, 2.04, -0.96));
  }
  // spectator monitor + PC on a small cabinet at the back
  g.add(box(1.0, 0.7, 0.4, mat('#24242e', { rough: 0.6 }), 0, 0.35, -1.02));
  const m = instance('desk-monitor'); m.scale.set(1.5, 1.4, 1); m.position.set(0, 0.7, -1.04); g.add(m);
  addScreen(g, v, seed, 0.75, 0.38, 0, 0.7 + 0.38, -1.025);
  const tower = pcTower(3); tower.position.set(0.38, 0.7, -0.98); g.add(tower);
  if (tower.userData.glow) (v.glow ||= []).push(tower.userData.glow);
  // headset hook with a cable
  g.add(box(0.04, 0.3, 0.04, black, -0.42, 0.85, -0.86));
}

/** counter with a microwave, coffee and slushie machines, pizza display and a menu board */
function foodbarVisual(o: PlacedObject, v: ObjView) {
  const g = v.root;
  const front = mat('#ef476f', { rough: 0.6 }), white = mat('#fff8e7', { rough: 0.5 }), dark = mat('#2b2d42', { rough: 0.6 });
  const W = 2.5, H = 0.95;
  g.add(box(W - 0.04, H - 0.05, 0.05, front, 0, (H - 0.05) / 2, 0.42));                // front panel
  for (const y of [0.25, 0.55]) g.add(box(W - 0.06, 0.05, 0.051, white, 0, y, 0.425)); // stripes
  for (const sx of [-1, 1]) g.add(box(0.05, H - 0.05, 0.85, front, sx * (W / 2 - 0.05), (H - 0.05) / 2, 0.02));
  g.add(box(W, 0.05, 0.9, white, 0, H - 0.025, 0.02));                                  // counter top
  g.add(box(W - 0.12, 0.03, 0.7, dark, 0, 0.45, 0.02));                                 // inner shelf
  const top = H;
  const mw = instance('kitchenMicrowave'); mw.position.set(-0.85, top, -0.12); mw.scale.setScalar(0.95); g.add(mw);
  // pizza display: a whole pizza on a raised plate under a glass cover
  g.add(cyl(0.2, 0.2, 0.02, white, -0.3, top + 0.12, 0.05, 20), cyl(0.02, 0.03, 0.12, white, -0.3, top + 0.06, 0.05));
  const pz = instance('pizza'); pz.position.set(-0.3, top + 0.13, 0.05); g.add(pz);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), glassMat()); dome.userData.ownGeo = true; dome.position.set(-0.3, top + 0.13, 0.05); g.add(dome);
  const cm = instance('kitchenCoffeeMachine'); cm.position.set(0.22, top, -0.15); g.add(cm);
  const bowl = instance('bowl-broth'); bowl.position.set(0.25, top, 0.22); g.add(bowl);
  // slushie machine: two coloured tanks
  g.add(box(0.46, 0.18, 0.36, dark, 0.8, top + 0.09, -0.12));
  for (const [x, c] of [[0.69, '#3ee6ff'], [0.91, '#ff4fd8']] as const) {
    const tank = cyl(0.09, 0.1, 0.32, mat(c, { emissive: c, ei: 0.35, transparent: true, opacity: 0.75, rough: 0.15 }), x, top + 0.34, -0.12, 14); g.add(tank);
    g.add(box(0.05, 0.05, 0.05, mat('#8b949e', { metal: 0.6 }), x, top + 0.2, 0.08));
  }
  g.add(cyl(0.035, 0.03, 0.1, mat('#ffffff', { rough: 0.4 }), 0.6, top + 0.05, 0.28), cyl(0.035, 0.03, 0.1, mat('#ffffff', { rough: 0.4 }), 0.98, top + 0.05, 0.25));
  // menu board on posts at the back
  for (const sx of [-1, 1]) g.add(box(0.05, 1.25, 0.05, dark, sx * 0.95, top + 0.62, -0.38));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), new THREE.MeshStandardMaterial({ map: menuBoard(['🍕 PIZZA   🍜 NOODLES', '🥤 SLUSHIES', 'MADE TO ORDER']), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.15 }));
  (board.material as any).emissiveMap = (board.material as THREE.MeshStandardMaterial).map;
  board.userData.ownGeo = true; board.position.set(0, top + 0.95, -0.36); g.add(board);
  (v.glow ||= []).push(board.material as THREE.Material);
  // food supplies stacked under the counter (4 stacks of 10)
  const slots: THREE.Vector3[] = [];
  for (const y0 of [0.03, 0.465]) for (let s = 0; s < 4; s++) for (let i = 0; i < 5; i++) slots.push(new THREE.Vector3(-0.85 + s * 0.57, y0 + i * 0.043, 0.0));
  v.shelf = { mesh: null, slots, product: null, stock: -1, proto: null };
  v.foodbar = true;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.15), new THREE.MeshBasicMaterial({ transparent: true }));
  tag.userData.ownGeo = true; tag.userData.priceTag = true; tag.position.set(0.7, 0.75, 0.452); g.add(tag);
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
    const key = v.foodbar ? `food|${stock}` : product ? `${ITEM[product].name}|${price}` : 'empty';
    if (tag.userData.key !== key) {
      tag.userData.key = key;
      const m = tag.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      const has = v.foodbar ? stock > 0 : !!product;
      const text = v.foodbar ? (stock > 0 ? `🍕 ${stock} LEFT` : 'NO FOOD') : product ? `$${price}` : 'EMPTY';
      m.map = textCanvas(text, { w: 256, h: 90, bg: has ? '#fff' : '#ffe8e8', fg: has ? '#2b2d42' : '#c1121f', border: '#2b2d42' });
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
    case 'station': case 'console': case 'retro': case 'pod': case 'racing': case 'vr': stationVisual(o, v); break;
    case 'foodbar': foodbarVisual(o, v); break;
    case 'shelf': case 'fridge': shelfVisual(o, v); break;
    case 'counter': case 'model': { const m = instance(def.model!); if (def.scale) m.scale.setScalar(def.scale); root.add(m); break; }
    case 'plant': { const p = instance('pot_large'); p.scale.setScalar(0.5); root.add(p); const b = instance('plant_bushDetailed'); b.scale.setScalar(0.62); b.position.y = 0.22; root.add(b); break; }
    case 'lamp': { const l = floorLamp(); root.add(l); v.lamp = l.userData.lamp; break; }
    case 'poster': root.add(poster(def.name.replace('Poster: ', ''), def.tint || '#5b5bd6', o.id.length)); break;
    case 'neon': { const n = neonSign(def.name.match(/“(.+)”/)?.[1] || 'GG', def.tint || '#ff4fd8'); root.add(n); v.neon = n.userData.neon; break; }
  }
  if (def.kind === 'shelf' || def.kind === 'fridge' || def.kind === 'foodbar') updateShelf(v, o, null);
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
