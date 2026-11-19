/* 3D thumbnails for the laptop shop and the rotating preview in the inventory (one small extra renderer). */
import * as THREE from 'three';
import { ITEM } from '../config/items';
import { buildObject } from '../world/objects';
import { productProto } from '../world/props';
import { instance } from './assets';

class Thumbs {
  private r: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private cache = new Map<string, string>();
  private objs = new Map<string, THREE.Object3D>();

  private init() {
    if (this.r) return this.r;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    this.r = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.r.setSize(256, 256, false);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8a8d8', 2.4));
    const d = new THREE.DirectionalLight('#fff', 2); d.position.set(2, 4, 3); this.scene.add(d);
    return this.r;
  }

  objectFor(id: string): THREE.Object3D | null {
    if (this.objs.has(id)) return this.objs.get(id)!;
    const d = ITEM[id];
    let o: THREE.Object3D | null = null;
    if (!d) return null;
    if (d.kind === 'product') {
      const g = new THREE.Group();
      const b = instance('cardboardBoxOpen'); g.add(b);
      const p = productProto(d.product!.mesh, d.product!.color);
      for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(p.geo, p.mat); m.position.set(-0.18 + i * 0.18, 0.42, 0); g.add(m); }
      const big = new THREE.Mesh(p.geo, p.mat); big.scale.setScalar(1.8); big.position.set(0.55, 0, 0.1); g.add(big);
      o = g;
    } else if (d.kind === 'component') {
      const host = d.slot === 'chair' ? 'st_pc1' : 'st_pc1';
      o = buildObject({ id: 'thumb', item: host, x: 0, z: 0, rot: 0, mon: d.slot === 'mon' ? d.slotTier : 0, chair: d.slot === 'chair' ? d.slotTier : 0, desk: d.slot === 'desk' ? d.slotTier : 0 }).root;
    } else if (d.kind !== 'service') {
      o = buildObject({ id: 'thumb', item: id, x: 0, z: 0, rot: 0, mon: 0, chair: 0, desk: 0, wall: d.kind === 'wall', y: 0 }).root;
      o.position.set(0, 0, 0);
    }
    if (o) { o.traverse((m: any) => { if (m.isSprite) m.visible = false; }); this.objs.set(id, o); }
    return o;
  }

  private frame(o: THREE.Object3D, angle: number) {
    o.rotation.y = angle;
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z) * 0.62 + 0.05;
    const dist = r / Math.tan((this.cam.fov * Math.PI) / 360);
    this.cam.position.set(c.x + dist * 0.55, c.y + dist * 0.45, c.z + dist * 0.75);
    this.cam.lookAt(c);
  }

  get(id: string): string | null {
    if (this.cache.has(id)) return this.cache.get(id)!;
    const o = this.objectFor(id); if (!o) return null;
    const r = this.init();
    this.scene.add(o); this.frame(o, -0.5);
    r.render(this.scene, this.cam);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(o);
    this.cache.set(id, url);
    return url;
  }

  /** draw a slowly rotating preview into a visible 2D canvas */
  preview(target: HTMLCanvasElement, id: string, angle: number) {
    const o = this.objectFor(id); const cx = target.getContext('2d'); if (!cx) return;
    cx.clearRect(0, 0, target.width, target.height);
    if (!o) return;
    const r = this.init();
    this.scene.add(o); this.frame(o, angle);
    r.render(this.scene, this.cam);
    this.scene.remove(o);
    cx.drawImage(r.domElement, 0, 0, target.width, target.height);
  }

  /** a character preview for the creator */
  previewObject(target: HTMLCanvasElement, o: THREE.Object3D, angle: number, look = new THREE.Vector3(0, 1, 0), dist = 3.2) {
    const cx = target.getContext('2d'); if (!cx) return;
    const r = this.init();
    this.scene.add(o); o.rotation.y = angle;
    this.cam.position.set(0, look.y + 0.15, dist); this.cam.lookAt(look);
    r.render(this.scene, this.cam);
    this.scene.remove(o);
    cx.clearRect(0, 0, target.width, target.height);
    cx.drawImage(r.domElement, 0, 0, target.width, target.height);
  }
}

export const thumbs = new Thumbs();
