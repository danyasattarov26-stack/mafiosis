/* The shop building, built in code so it can grow with each expansion and take new floor/wall/light styles. */
import * as THREE from 'three';
import { FLOORS, WALLS, LIGHTS } from '../config/economy';
import type { SaveData } from '../core/save';
import { preset } from '../core/settings';
import { shopSize, deliveryZone, DOOR, WALL_H } from '../sim/layout';
import { stairs, elevator, floorY, FLOOR_H, LANE, RUN, type Rect } from '../sim/building';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, mat, textCanvas } from './props';

export interface AABB { x0: number; x1: number; z0: number; z1: number; y0?: number; y1?: number }

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
  /** elevator doors per floor (two sliding panels) and how open they are */
  liftDoors: { l: THREE.Mesh; r: THREE.Mesh; open: number; fl: number }[] = [];
  liftTargets: THREE.Object3D[] = [];
  private lift: ReturnType<typeof elevator> = null;
  private key = '';
  private signOpen: THREE.Texture | null = null;
  private signClosed: THREE.Texture | null = null;
  private doorOpen = 0;
  private lightStyle = LIGHTS[0];

  build(s: SaveData) {
    const key = [s.expansion, s.floor, s.wall, s.light, s.shopName, preset().lights, s.floors || 1, s.elevator ? 1 : 0].join('|');
    if (key === this.key) return false;
    this.key = key;
    this.group.traverse((o: any) => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); });
    this.group.clear();
    this.colliders = []; this.wallMeshes = []; this.doorPanels = []; this.lights = []; this.liftDoors = []; this.liftTargets = [];
    const { w, d } = shopSize(s);
    const H = WALL_H, T = 0.2;
    const floors = s.floors || 1;
    const st = stairs(s), el = elevator(s);
    this.lift = el;
    this.lightStyle = LIGHTS.find(l => l.id === s.light) || LIGHTS[0];

    const ft = floorTexture(s.floor);
    const floorMat = new THREE.MeshStandardMaterial({ map: ft, roughness: s.floor === 'concrete' ? 0.35 : 0.8 });
    const ceilMat = mat('#f5efe6', { rough: 1 });
    /** a horizontal rectangle whose texture is pinned to world metres (so floors line up around holes) */
    const flat = (r: Rect, y: number, m: THREE.Material, up = true) => {
      const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
      g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
      const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2, -pos.getZ(i) / 2);
      const mm = new THREE.Mesh(g, m); mm.receiveShadow = true; mm.userData.ownGeo = true; this.group.add(mm);
      return mm;
    };
    const minus = (full: Rect, hole: Rect | null): Rect[] => {
      if (!hole) return [full];
      const out: Rect[] = [];
      if (hole.z0 > full.z0) out.push({ ...full, z1: hole.z0 });
      if (hole.z1 < full.z1) out.push({ ...full, z0: hole.z1 });
      if (hole.x0 > full.x0) out.push({ x0: full.x0, x1: hole.x0, z0: hole.z0, z1: hole.z1 });
      if (hole.x1 < full.x1) out.push({ x0: hole.x1, x1: full.x1, z0: hole.z0, z1: hole.z1 });
      return out;
    };
    const full: Rect = { x0: -w / 2, x1: w / 2, z0: -d, z1: 0 };

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
      if (coll) this.colliders.push({ x0, x1, z0, z1, y0, y1 });
      if (inside === inMat) this.wallMeshes.push(m);
      return m;
    };
    const panel = mat('#fff8e7', { emissive: this.lightStyle.a, ei: 1.0 });
    this.neon = new THREE.MeshStandardMaterial({ color: this.lightStyle.b, emissive: this.lightStyle.b, emissiveIntensity: 0.4, toneMapped: false });
    const dx = DOOR.w / 2;

    for (let k = 0; k < floors; k++) {
      const y0 = floorY(k), top = k === floors - 1;
      const yTop = top ? y0 + H : y0 + FLOOR_H;     // walls run up through the slab band between storeys
      // floor (with the stair opening on upper floors) and ceiling (open where this floor's flight climbs)
      for (const r of minus(full, st ? st.hole(k) : null)) { const f = flat(r, y0 + 0.006, floorMat); if (k === 0) f.userData.floor = true; }
      const up = st && !top ? (() => { const [a, b] = st.laneX(st.laneOf(k)); return { x0: a, x1: b, z0: st.zBack, z1: st.zFront }; })() : null;
      for (const r of minus(full, up)) flat(r, y0 + H - 0.01, ceilMat, false);
      if (up) { // edges of the opening in the slab above
        const yb = y0 + H + (FLOOR_H - H) / 2, hgt = FLOOR_H - H;
        this.group.add(box(up.x1 - up.x0, hgt, 0.04, ceilMat, (up.x0 + up.x1) / 2, yb, up.z0), box(up.x1 - up.x0, hgt, 0.04, ceilMat, (up.x0 + up.x1) / 2, yb, up.z1), box(0.04, hgt, up.z1 - up.z0, ceilMat, up.x1, yb, (up.z0 + up.z1) / 2));
      }
      // back + sides (interior skin + exterior skin), a window in each side wall
      seg(-w / 2 - T, w / 2 + T, -d - T, -d - T / 2, y0, yTop, outMat);
      seg(-w / 2, w / 2, -d - T / 2, -d, y0, yTop, inMat);
      for (const sx of [-1, 1]) {
        const xi = sx * w / 2, xo = sx * (w / 2 + T);
        const [a, b] = sx < 0 ? [xo, xo + T / 2] : [xo - T / 2, xo];
        const [c, e] = sx < 0 ? [xo + T / 2, xi] : [xi, xo - T / 2];
        const wz0 = -d * 0.65, wz1 = -d * 0.35;
        for (const [m0, m1] of [[-d, wz0], [wz1, 0]] as [number, number][]) { seg(a, b, m0, m1, y0, yTop, outMat); seg(c, e, m0, m1, y0, yTop, inMat); }
        seg(a, b, wz0, wz1, y0, y0 + 1.0, outMat); seg(c, e, wz0, wz1, y0, y0 + 1.0, inMat);
        seg(a, b, wz0, wz1, y0 + 2.3, yTop, outMat); seg(c, e, wz0, wz1, y0 + 2.3, yTop, inMat);
        const g = box(T * 0.3, 1.3, wz1 - wz0, glass, (a + e) / 2, y0 + 1.65, (wz0 + wz1) / 2); g.castShadow = false; this.group.add(g);
        this.colliders.push({ x0: Math.min(a, e), x1: Math.max(a, e), z0: wz0, z1: wz1, y0, y1: yTop });
      }
      // front wall
      const fz0 = 0, fz1 = T;
      if (k === 0) {
        // big shop windows either side of the door
        for (const [x0, x1] of [[-w / 2 - T, -dx], [dx, w / 2 + T]] as [number, number][]) {
          seg(x0, x1, fz0, fz1, 0, 0.6, outMat, true);
          seg(x0, x1, fz0, fz1, 2.5, yTop, outMat, false);
          const pillar = 0.25;
          seg(x0, x0 + pillar, fz0, fz1, 0.6, 2.5, outMat, false); seg(x1 - pillar, x1, fz0, fz1, 0.6, 2.5, outMat, false);
          const g = box(x1 - x0 - pillar * 2, 1.9, 0.04, glass, (x0 + x1) / 2, 1.55, T / 2); g.castShadow = false; this.group.add(g);
          this.group.add(box(x1 - x0, 0.06, 0.3, trim, (x0 + x1) / 2, 0.62, T / 2));
          this.colliders.push({ x0, x1, z0: fz0, z1: fz1, y0: 0.6, y1: 2.5 });
        }
        seg(-dx, dx, fz0, fz1, 2.5, yTop, outMat, false);
      } else {
        // upper floors: a row of windows
        seg(-w / 2 - T, w / 2 + T, fz0, fz1, y0, y0 + 0.9, outMat);
        seg(-w / 2 - T, w / 2 + T, fz0, fz1, y0 + 2.5, yTop, outMat);
        const n = Math.max(2, Math.round(w / 3.2)), span = (w + 2 * T) / n;
        for (let i = 0; i < n; i++) {
          const x0 = -w / 2 - T + i * span;
          seg(x0, x0 + 0.3, fz0, fz1, y0 + 0.9, y0 + 2.5, outMat, false);
          const g = box(span - 0.3, 1.6, 0.04, glass, x0 + 0.15 + span / 2, y0 + 1.7, T / 2); g.castShadow = false; this.group.add(g);
        }
        seg(w / 2 + T - 0.3, w / 2 + T, fz0, fz1, y0 + 0.9, y0 + 2.5, outMat, false);
        this.colliders.push({ x0: -w / 2 - T, x1: w / 2 + T, z0: fz0, z1: fz1, y0, y1: yTop });
        this.group.add(box(w + 2 * T + 0.1, 0.08, 0.12, trim, 0, y0 + 0.02, T + 0.04)); // floor line on the facade
      }
      // ceiling light panels + neon strip
      const nx = Math.max(1, Math.round(w / 4.5)), nz = Math.max(1, Math.round(d / 4.5));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const px = -w / 2 + (i + 0.5) * w / nx, pz = -d + (j + 0.5) * d / nz;
        if (up && px > up.x0 - 0.6 && px < up.x1 + 0.6 && pz > up.z0 - 0.3 && pz < up.z1 + 0.3) continue;
        this.group.add(box(1.2, 0.04, 0.5, panel, px, y0 + H - 0.03, pz));
      }
      this.group.add(box(w, 0.04, 0.04, this.neon, 0, y0 + H - 0.25, -d + 0.03), box(0.04, 0.04, d, this.neon, -w / 2 + 0.03, y0 + H - 0.25, -d / 2), box(0.04, 0.04, d, this.neon, w / 2 - 0.03, y0 + H - 0.25, -d / 2));
      if (st) this.buildStairs(s, k, inMat, trim);
      if (el) this.buildLift(s, k, trim);
    }

    // entrance mat, roof, awning, facade sign, door
    this.group.add(box(1.6, 0.012, 0.9, mat('#3d405b'), 0, 0.006, -0.5));
    const roofY = floorY(floors - 1) + H;
    this.group.add(box(w + T * 2 + 0.3, 0.25, d + T * 2 + 0.3, mat('#5c4d4a'), 0, roofY + 0.12, -d / 2));
    const aw = new THREE.CanvasTexture((() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const c = cv.getContext('2d')!; for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#fff4e0' : '#e85d75'; c.fillRect(i * 8, 0, 8, 8); } return cv; })());
    aw.wrapS = THREE.RepeatWrapping; aw.repeat.set(w / 1.2, 1); aw.colorSpace = THREE.SRGBColorSpace;
    const awn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.05, 1.1), new THREE.MeshStandardMaterial({ map: aw, roughness: 0.9 }));
    awn.position.set(0, 2.65, 0.75); awn.rotation.x = 0.28; awn.userData.ownGeo = true; awn.castShadow = true; this.group.add(awn);
    const signW = Math.min(w - 1, 7);
    const sgt = textCanvas(s.shopName, { w: 1024, h: 160, bg: '#2b2d42', fg: '#ffd166', glow: '#ff9e64', border: '#ffd166' });
    this.facadeSign = new THREE.MeshStandardMaterial({ map: sgt, emissive: '#ffffff', emissiveMap: sgt, emissiveIntensity: 0.25, roughness: 0.6 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(signW, signW * 160 / 1024, 0.08), [mat('#2b2d42'), mat('#2b2d42'), mat('#2b2d42'), mat('#2b2d42'), this.facadeSign, mat('#2b2d42')]);
    sign.position.set(0, (floors > 1 ? roofY : H) + 0.75, T + 0.06); sign.userData.ownGeo = true; this.group.add(sign);
    this.group.add(box(0.08, 2.5, T + 0.04, trim, -dx, 1.25, T / 2), box(0.08, 2.5, T + 0.04, trim, dx, 1.25, T / 2), box(DOOR.w, 0.08, T + 0.04, trim, 0, 2.5, T / 2));
    for (const sx of [-1, 1]) { const p = box(dx - 0.04, 2.4, 0.04, glass, sx * dx / 2, 1.22, T / 2); p.castShadow = false; this.doorPanels.push(p); this.group.add(p); }
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

    // a few real lights; they follow you from floor to floor (see update)
    const nl = preset().lights;
    const cols = Math.max(1, Math.min(nl, Math.ceil(Math.sqrt(nl * w / d))));
    const rows = Math.max(1, Math.ceil(nl / cols));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (this.lights.length >= nl) break;
      const L = new THREE.PointLight(this.lightStyle.a, 6, Math.max(w, d) * 1.1, 1.4);
      L.position.set(-w / 2 + (i + 0.5) * w / cols, H - 0.4, -d + (j + 0.5) * d / rows);
      this.lights.push(L); this.group.add(L);
    }
    this.group.traverse((o: any) => { if (o.isMesh && o.material === this.neon) o.castShadow = false; });
    return true;
  }

  /** flight k (floor k → k+1), the wall between the two lanes and the railing around the opening on floor k */
  private buildStairs(s: SaveData, k: number, wallMat: THREE.Material, trim: THREE.Material) {
    const st = stairs(s)!, floors = s.floors || 1, y0 = floorY(k);
    const tread = mat('#b07d56', { rough: 0.7 }), riser = mat('#8d5b3a', { rough: 0.8 });
    // wall between the lanes, the full length of the flights
    const xm = st.x0 + LANE;
    const div = box(0.12, WALL_H, st.zFront - st.zBack, wallMat, xm, y0 + WALL_H / 2, (st.zBack + st.zFront) / 2); div.castShadow = false; this.group.add(div);
    this.colliders.push({ x0: xm - 0.06, x1: xm + 0.06, z0: st.zBack, z1: st.zFront, y0, y1: y0 + FLOOR_H });
    if (k < floors - 1) {
      const lane = st.laneOf(k), [a, b] = st.laneX(lane), N = 14, back = lane === 0;
      const geos: THREE.BufferGeometry[] = [], noses: THREE.BufferGeometry[] = [];
      for (let i = 0; i < N; i++) {
        const h = ((i + 0.5) / N) * FLOOR_H, dz = RUN / N;
        const zc = back ? st.zFront - (i + 0.5) * dz : st.zBack + (i + 0.5) * dz;
        geos.push(new THREE.BoxGeometry(b - a - 0.08, h, dz).translate((a + b) / 2, y0 + h / 2, zc));
        noses.push(new THREE.BoxGeometry(b - a - 0.06, 0.035, dz + 0.02).translate((a + b) / 2, y0 + h - 0.0175, zc));
      }
      const steps = new THREE.Mesh(mergeGeometries(geos), riser); steps.userData.ownGeo = true; steps.castShadow = true; steps.receiveShadow = true; this.group.add(steps);
      const nose = new THREE.Mesh(mergeGeometries(noses), tread); nose.userData.ownGeo = true; nose.receiveShadow = true; this.group.add(nose);
      geos.forEach(g => g.dispose()); noses.forEach(g => g.dispose());
      // handrail on the wall side
      const len = Math.hypot(RUN, FLOOR_H), ang = Math.atan2(FLOOR_H, RUN);
      const rail = box(0.05, 0.05, len, trim, a + 0.07, y0 + FLOOR_H / 2 + 0.9, (st.zBack + st.zFront) / 2);
      rail.rotation.x = back ? ang : -ang; this.group.add(rail);
    }
    // railing where the flight from below comes up through this floor
    const hole = st.hole(k);
    if (hole) {
      const lane = st.laneOf(k - 1), zEdge = lane === 0 ? hole.z1 : hole.z0;   // the end where that flight starts below
      this.group.add(box(hole.x1 - hole.x0, 0.06, 0.06, trim, (hole.x0 + hole.x1) / 2, y0 + 1.0, zEdge));
      for (let i = 0; i <= 4; i++) this.group.add(box(0.04, 1.0, 0.04, trim, hole.x0 + 0.05 + i * (hole.x1 - hole.x0 - 0.1) / 4, y0 + 0.5, zEdge));
      this.colliders.push({ x0: hole.x0, x1: hole.x1, z0: zEdge - 0.06, z1: zEdge + 0.06, y0: y0 - 0.2, y1: y0 + 1.1 });
    }
  }

  /** the elevator shaft on floor k: walls, sliding doors, a floor number and call buttons */
  private buildLift(s: SaveData, k: number, trim: THREE.Material) {
    const el = elevator(s)!, y0 = floorY(k), H = WALL_H, sh = el.shaft;
    const metal = mat('#c9d1d9', { metal: 0.6, rough: 0.35 }), dark = mat('#2b2d42', { rough: 0.5 });
    const t = 0.1, door = 0.9, cx = (sh.x0 + sh.x1) / 2;
    this.group.add(box(t, H, sh.z1 - sh.z0, dark, sh.x0 + t / 2, y0 + H / 2, (sh.z0 + sh.z1) / 2), box(t, H, sh.z1 - sh.z0, dark, sh.x1 - t / 2, y0 + H / 2, (sh.z0 + sh.z1) / 2));
    const side = (sh.x1 - sh.x0 - door) / 2;
    this.group.add(box(side, H, t, metal, sh.x0 + side / 2, y0 + H / 2, sh.z1 - t / 2), box(side, H, t, metal, sh.x1 - side / 2, y0 + H / 2, sh.z1 - t / 2), box(door, H - 2.2, t, metal, cx, y0 + 2.2 + (H - 2.2) / 2, sh.z1 - t / 2));
    this.group.add(box(sh.x1 - sh.x0 - 0.2, 0.02, sh.z1 - sh.z0 - 0.2, mat('#3d405b'), cx, y0 + 0.01, (sh.z0 + sh.z1) / 2));
    const l = box(door / 2, 2.2, 0.04, metal, cx - door / 4, y0 + 1.1, sh.z1 - 0.02), r = box(door / 2, 2.2, 0.04, metal, cx + door / 4, y0 + 1.1, sh.z1 - 0.02);
    this.group.add(l, r);
    this.liftDoors.push({ l, r, open: 0, fl: k });
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.2), new THREE.MeshBasicMaterial({ map: textCanvas(`▲▼ ${k + 1}F`, { w: 256, h: 120, bg: '#111', fg: '#ffb703' }) }));
    num.userData.ownGeo = true; num.position.set(cx, y0 + 2.45, sh.z1 + 0.005); this.group.add(num);
    const btn = box(0.12, 0.22, 0.03, trim, sh.x1 + 0.15, y0 + 1.2, sh.z1 + 0.015);
    this.group.add(btn);
    // what you aim at to ride it
    const hit = new THREE.Mesh(new THREE.BoxGeometry(door + 0.3, 2.3, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(cx, y0 + 1.15, sh.z1 + 0.1); hit.userData.ownGeo = true; hit.userData.target = { kind: 'elevator', id: String(k) };
    this.group.add(hit); this.liftTargets.push(hit);
    this.colliders.push({ ...sh, y0, y1: y0 + FLOOR_H });
  }

  setOpen(open: boolean) {
    const m = this.doorSign.material as THREE.MeshStandardMaterial;
    const t = open ? this.signOpen : this.signClosed;
    if (m.map !== t) { m.map = t; m.emissiveMap = t; m.needsUpdate = true; }
  }

  /** `floor` is the floor you're on (the real lights follow you); `near` are people's positions, to open the elevator */
  update(dt: number, night: number, nearDoor: boolean, time: number, floor = 0, near: { x: number; y: number; z: number }[] = []) {
    this.doorOpen += ((nearDoor ? 1 : 0) - this.doorOpen) * Math.min(1, dt * 6);
    const dx = DOOR.w / 2;
    this.doorPanels.forEach((p, i) => { const s = i ? 1 : -1; p.position.x = s * (dx / 2 + this.doorOpen * (dx - 0.1)); });
    const ly = floorY(floor) + WALL_H - 0.4;
    for (const L of this.lights) { L.intensity = 4 + night * 6; L.position.y = ly; }
    if (this.neon) {
      this.neon.emissiveIntensity = 0.3 + night * 2.2;
      if (this.lightStyle.id === 'rgb') this.neon.emissive.setHSL((time * 0.05) % 1, 0.9, 0.55);
    }
    if (this.facadeSign) this.facadeSign.emissiveIntensity = 0.2 + night * 1.4;
    if (this.lift) {
      const door = this.lift.door, half = 0.9 / 4;
      for (const ld of this.liftDoors) {
        const y = floorY(ld.fl);
        const want = near.some(p => Math.abs(p.y - y) < 1.2 && Math.abs(p.x - door.x) < 1.0 && p.z > door.z - 1.2 && p.z < door.z + 1.6) ? 1 : 0;
        ld.open += (want - ld.open) * Math.min(1, dt * 5);
        ld.l.position.x = door.x - half - ld.open * 0.42; ld.r.position.x = door.x + half + ld.open * 0.42;
      }
    }
  }
}
