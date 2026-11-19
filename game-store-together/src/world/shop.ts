/* The shop building, built in code so it can grow with each expansion and take new floor/wall/light styles. */
import * as THREE from 'three';
import { FLOORS, WALLS, LIGHTS } from '../config/economy';
import type { SaveData } from '../core/save';
import { preset } from '../core/settings';
import { shopSize, deliveryZone, DOOR, WALL_H } from '../sim/layout';
import { box, mat, textCanvas } from './props';

export interface AABB { x0: number; x1: number; z0: number; z1: number; y1?: number }

function floorTexture(id: string) {
  const st = FLOORS.find(f => f.id === id) || FLOORS[0];
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = st.a; c.fillRect(0, 0, 256, 256);
  if (st.kind === 'planks') {
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? st.b : st.a; c.fillRect(0, i * 32, 256, 32); c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, i * 32, 256, 2); const off = (i * 97) % 256; c.fillRect(off, i * 32, 2, 32); }
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(80,40,10,${Math.random() * 0.06})`; c.fillRect(Math.random() * 256, Math.random() * 256, 12, 1); }
  } else if (st.kind === 'checker') {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = (x + y) % 2 ? st.b : st.a; c.fillRect(x * 64, y * 64, 64, 64); }
  } else if (st.kind === 'carpet') {
    for (let i = 0; i < 6000; i++) { c.fillStyle = Math.random() < 0.5 ? st.b : 'rgba(255,255,255,0.08)'; c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  } else if (st.kind === 'concrete') {
    for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; c.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
    c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(0, 0, 256, 2); c.fillRect(0, 0, 2, 256);
  } else if (st.kind === 'grid') {
    c.strokeStyle = st.b; c.lineWidth = 3; c.shadowColor = st.b; c.shadowBlur = 8;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, 256); c.stroke(); c.beginPath(); c.moveTo(0, i * 64); c.lineTo(256, i * 64); c.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function wallTexture(id: string) {
  const st = WALLS.find(f => f.id === id) || WALLS[0];
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = st.a; c.fillRect(0, 0, 256, 256);
  if (st.kind === 'brick') {
    c.fillStyle = st.b; for (let y = 0; y < 256; y += 32) { c.fillRect(0, y, 256, 3); for (let x = (y / 32) % 2 ? 0 : 32; x < 256; x += 64) c.fillRect(x, y, 3, 32); }
    for (let i = 0; i < 800; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; c.fillRect(Math.random() * 256, Math.random() * 256, 6, 3); }
  } else if (st.kind === 'panel') {
    for (let x = 0; x < 256; x += 32) { c.fillStyle = (x / 32) % 2 ? st.b : st.a; c.fillRect(x, 0, 32, 256); c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x, 0, 2, 256); }
  } else {
    for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.025})`; c.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
    c.fillStyle = st.b; c.fillRect(0, 200, 256, 56); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(0, 198, 256, 4);
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ShopShell {
  group = new THREE.Group();
  colliders: AABB[] = [];
  wallMeshes: THREE.Mesh[] = [];
  doorSign!: THREE.Mesh;
  doorPanels: THREE.Mesh[] = [];
  lights: THREE.PointLight[] = [];
  neon: THREE.MeshStandardMaterial | null = null;
  facadeSign: THREE.MeshStandardMaterial | null = null;
  laptopScreen: THREE.Mesh | null = null;
  private key = '';
  private signOpen: THREE.Texture | null = null;
  private signClosed: THREE.Texture | null = null;
  private doorOpen = 0;
  private lightStyle = LIGHTS[0];

  build(s: SaveData) {
    const key = [s.expansion, s.floor, s.wall, s.light, s.shopName, preset().lights].join('|');
    if (key === this.key) return false;
    this.key = key;
    this.group.traverse((o: any) => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); });
    this.group.clear();
    this.colliders = []; this.wallMeshes = []; this.doorPanels = []; this.lights = [];
    const { w, d } = shopSize(s);
    const H = WALL_H, T = 0.2;
    this.lightStyle = LIGHTS.find(l => l.id === s.light) || LIGHTS[0];

    // floor
    const ft = floorTexture(s.floor); ft.repeat.set(w / 2, d / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: ft, roughness: s.floor === 'concrete' ? 0.35 : 0.8 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.006, -d / 2); floor.receiveShadow = true; floor.userData.ownGeo = true; floor.userData.floor = true;
    this.group.add(floor);
    // entrance mat
    this.group.add(box(1.6, 0.012, 0.9, mat('#3d405b'), 0, 0.006, -0.5));

    // walls: interior material from the style, exterior a warm stucco facade
    const wt = wallTexture(s.wall);
    const inMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.9 });
    const outMat = mat('#e9d8c4', { rough: 0.95 });
    const trim = mat('#6d4c3d');
    const glass = new THREE.MeshStandardMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const seg = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, inside: THREE.Material, coll = true) => {
      const m = box(x1 - x0, y1 - y0, z1 - z0, inside, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const tex = (inside as any).map as THREE.Texture | undefined;
      if (tex) { const uv = m.geometry.getAttribute('uv'); const sx = Math.max(x1 - x0, z1 - z0) / 2.5, sy = (y1 - y0) / 2.5; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy + y0 / 2.5); }
      m.castShadow = false;
      this.group.add(m);
      if (coll) this.colliders.push({ x0, x1, z0, z1, y1 });
      if (inside === inMat) this.wallMeshes.push(m);
      return m;
    };
    // back + sides (interior skin + exterior skin)
    seg(-w / 2 - T, w / 2 + T, -d - T, -d - T / 2, 0, H, outMat);
    seg(-w / 2, w / 2, -d - T / 2, -d, 0, H, inMat);
    for (const sx of [-1, 1]) {
      const xi = sx * w / 2, xo = sx * (w / 2 + T);
      const [a, b] = sx < 0 ? [xo, xo + T / 2] : [xo - T / 2, xo];
      const [c, e] = sx < 0 ? [xo + T / 2, xi] : [xi, xo - T / 2];
      // side wall with one window in the middle
      const wz0 = -d * 0.65, wz1 = -d * 0.35;
      for (const [m0, m1] of [[-d, wz0], [wz1, 0]] as [number, number][]) { seg(a, b, m0, m1, 0, H, outMat); seg(c, e, m0, m1, 0, H, inMat); }
      seg(a, b, wz0, wz1, 0, 1.0, outMat); seg(c, e, wz0, wz1, 0, 1.0, inMat);
      seg(a, b, wz0, wz1, 2.3, H, outMat); seg(c, e, wz0, wz1, 2.3, H, inMat);
      const g = box(T * 0.3, 1.3, wz1 - wz0, glass, (a + e) / 2, 1.65, (wz0 + wz1) / 2); g.castShadow = false; this.group.add(g);
      this.colliders.push({ x0: Math.min(a, e), x1: Math.max(a, e), z0: wz0, z1: wz1 });
    }
    // front wall: big shop windows either side of the door
    const dx = DOOR.w / 2;
    const fz0 = 0, fz1 = T;
    for (const [x0, x1] of [[-w / 2 - T, -dx], [dx, w / 2 + T]] as [number, number][]) {
      seg(x0, x1, fz0, fz1, 0, 0.6, outMat, true);
      seg(x0, x1, fz0, fz1, 2.5, H, outMat, false);
      const pillar = 0.25;
      seg(x0, x0 + pillar, fz0, fz1, 0.6, 2.5, outMat, false); seg(x1 - pillar, x1, fz0, fz1, 0.6, 2.5, outMat, false);
      const g = box(x1 - x0 - pillar * 2, 1.9, 0.04, glass, (x0 + x1) / 2, 1.55, T / 2); g.castShadow = false; this.group.add(g);
      this.group.add(box(x1 - x0, 0.06, 0.3, trim, (x0 + x1) / 2, 0.62, T / 2));
    }
    seg(-dx, dx, fz0, fz1, 2.5, H, outMat, false);
    // door frame + sliding glass doors
    this.group.add(box(0.08, 2.5, T + 0.04, trim, -dx, 1.25, T / 2), box(0.08, 2.5, T + 0.04, trim, dx, 1.25, T / 2), box(DOOR.w, 0.08, T + 0.04, trim, 0, 2.5, T / 2));
    for (const sx of [-1, 1]) { const p = box(dx - 0.04, 2.4, 0.04, glass, sx * dx / 2, 1.22, T / 2); p.castShadow = false; this.doorPanels.push(p); this.group.add(p); }

    // roof, ceiling, parapet
    this.group.add(box(w + T * 2 + 0.3, 0.25, d + T * 2 + 0.3, mat('#5c4d4a'), 0, H + 0.12, -d / 2));
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat('#f5efe6', { rough: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H - 0.01, -d / 2); ceil.userData.ownGeo = true; this.group.add(ceil);
    // awning over the windows
    const aw = new THREE.CanvasTexture((() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const c = cv.getContext('2d')!; for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#fff4e0' : '#e85d75'; c.fillRect(i * 8, 0, 8, 8); } return cv; })());
    aw.wrapS = THREE.RepeatWrapping; aw.repeat.set(w / 1.2, 1); aw.colorSpace = THREE.SRGBColorSpace;
    const awn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.05, 1.1), new THREE.MeshStandardMaterial({ map: aw, roughness: 0.9 }));
    awn.position.set(0, 2.65, 0.75); awn.rotation.x = 0.28; awn.userData.ownGeo = true; awn.castShadow = true; this.group.add(awn);

    // facade sign with the shop name
    const signW = Math.min(w - 1, 7);
    const st = textCanvas(s.shopName, { w: 1024, h: 160, bg: '#2b2d42', fg: '#ffd166', glow: '#ff9e64', border: '#ffd166' });
    this.facadeSign = new THREE.MeshStandardMaterial({ map: st, emissive: '#ffffff', emissiveMap: st, emissiveIntensity: 0.25, roughness: 0.6 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(signW, signW * 160 / 1024, 0.08), [mat('#2b2d42'), mat('#2b2d42'), mat('#2b2d42'), mat('#2b2d42'), this.facadeSign, mat('#2b2d42')]);
    sign.position.set(0, H + 0.75, T + 0.06); sign.userData.ownGeo = true; this.group.add(sign);

    // OPEN / CLOSED door sign (both sides)
    this.signOpen = textCanvas('OPEN', { w: 256, h: 96, bg: '#1b4332', fg: '#80ed99', glow: '#80ed99', border: '#80ed99' });
    this.signClosed = textCanvas('CLOSED', { w: 256, h: 96, bg: '#3d0c11', fg: '#ff6b6b', glow: '#ff6b6b', border: '#ff6b6b' });
    const signMat = new THREE.MeshStandardMaterial({ map: this.signClosed, emissive: '#fff', emissiveMap: this.signClosed, emissiveIntensity: 0.6 });
    this.doorSign = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.03), signMat);
    this.doorSign.position.set(dx + 0.45, 1.55, T / 2); this.doorSign.userData.ownGeo = true;
    this.doorSign.userData.target = { kind: 'sign', id: 'sign' };
    this.group.add(this.doorSign);

    // delivery zone floor tape
    const z = deliveryZone(s);
    const tape = mat('#ffd166', { rough: 0.8 });
    const zw = z.x1 - z.x0, zd = z.z1 - z.z0, cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
    for (const [bw, bd, bx, bz] of [[zw, 0.07, cx, z.z0], [zw, 0.07, cx, z.z1], [0.07, zd, z.x0, cz], [0.07, zd, z.x1, cz]]) this.group.add(box(bw, 0.004, bd, tape, bx, 0.009, bz));
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshBasicMaterial({ map: textCanvas('DELIVERIES', { w: 512, h: 96, fg: '#ffd166' }), transparent: true, depthWrite: false }));
    lbl.rotation.x = -Math.PI / 2; lbl.position.set(cx, 0.011, z.z0 + 0.25); lbl.userData.ownGeo = true; this.group.add(lbl);

    // ceiling light panels + a few real lights
    const panel = mat('#fff8e7', { emissive: this.lightStyle.a, ei: 1.0 });
    const nx = Math.max(1, Math.round(w / 4.5)), nz = Math.max(1, Math.round(d / 4.5));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) this.group.add(box(1.2, 0.04, 0.5, panel, -w / 2 + (i + 0.5) * w / nx, H - 0.03, -d + (j + 0.5) * d / nz));
    const nl = preset().lights;
    const cols = Math.max(1, Math.min(nl, Math.ceil(Math.sqrt(nl * w / d))));
    const rows = Math.max(1, Math.ceil(nl / cols));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (this.lights.length >= nl) break;
      const L = new THREE.PointLight(this.lightStyle.a, 6, Math.max(w, d) * 1.1, 1.4);
      L.position.set(-w / 2 + (i + 0.5) * w / cols, H - 0.4, -d + (j + 0.5) * d / rows);
      this.lights.push(L); this.group.add(L);
    }
    // neon strip around the top of the walls (glows at night)
    this.neon = new THREE.MeshStandardMaterial({ color: this.lightStyle.b, emissive: this.lightStyle.b, emissiveIntensity: 0.4, toneMapped: false });
    this.group.add(box(w, 0.04, 0.04, this.neon, 0, H - 0.25, -d + 0.03), box(0.04, 0.04, d, this.neon, -w / 2 + 0.03, H - 0.25, -d / 2), box(0.04, 0.04, d, this.neon, w / 2 - 0.03, H - 0.25, -d / 2));
    this.group.traverse((o: any) => { if (o.isMesh && o.material === this.neon) o.castShadow = false; });
    return true;
  }

  setOpen(open: boolean) {
    const m = this.doorSign.material as THREE.MeshStandardMaterial;
    const t = open ? this.signOpen : this.signClosed;
    if (m.map !== t) { m.map = t; m.emissiveMap = t; m.needsUpdate = true; }
  }

  update(dt: number, night: number, nearDoor: boolean, time: number) {
    this.doorOpen += ((nearDoor ? 1 : 0) - this.doorOpen) * Math.min(1, dt * 6);
    const dx = DOOR.w / 2;
    this.doorPanels.forEach((p, i) => { const s = i ? 1 : -1; p.position.x = s * (dx / 2 + this.doorOpen * (dx - 0.1)); });
    for (const L of this.lights) L.intensity = 4 + night * 6;
    if (this.neon) {
      this.neon.emissiveIntensity = 0.3 + night * 2.2;
      if (this.lightStyle.id === 'rgb') this.neon.emissive.setHSL((time * 0.05) % 1, 0.9, 0.55);
    }
    if (this.facadeSign) this.facadeSign.emissiveIntensity = 0.2 + night * 1.4;
  }
}
