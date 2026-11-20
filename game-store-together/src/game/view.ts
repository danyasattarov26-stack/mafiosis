/* Keeps the 3D scene in sync with the World (host or mirrored): objects, boxes, mess, people, popups. */
import * as THREE from 'three';
import { ITEM } from '../config/items';
import { STAFF } from '../config/economy';
import { instance } from '../engine/assets';
import type { Gfx } from '../engine/gfx';
import { ShopShell, type AABB } from '../world/shop';
import { City } from '../world/city';
import { CharView } from '../world/chars';
import { buildObject, updateShelf, objKey, smoke, animateSmoke, type ObjView } from '../world/objects';
import { productProto, spill, textCanvas } from '../world/props';
import { footprint, counterSpots, DOOR, WALL_H } from '../sim/layout';
import { floorY, floorOfY, officeWalls } from '../sim/building';
import { PLAYING, type World, type Customer } from '../sim/world';
import { REGULAR, hearts } from '../config/npcs';
import { damp, dampAngle } from '../core/util';

interface CustEntry { v: CharView; tx: number; tz: number; ty: number; try: number; init: boolean }

export class View {
  shell = new ShopShell();
  city = new City();
  root = new THREE.Group();
  objs = new Map<string, ObjView>();
  boxes = new Map<string, { o: THREE.Object3D; key: string }>();
  trash = new Map<string, THREE.Object3D>();
  custs = new Map<string, CustEntry>();
  staff = new Map<string, CharView>();
  remotes = new Map<string, CharView>();
  counterItems = new THREE.Group();
  popups: { s: THREE.Sprite; t: number }[] = [];
  colliders: AABB[] = [];
  localId = '';
  private rev = -1;
  private time = 0;
  private labelCache = new Map<string, THREE.Texture>();
  private counterKey = '';
  private cullFloor = -1;

  constructor(public gfx: Gfx, public world: World) {
    gfx.scene.add(this.root);
    this.root.add(this.shell.group, this.city.group, this.counterItems);
    this.city.build();
  }

  setWorld(w: World) {
    this.world = w; this.rev = -1;
    for (const v of this.objs.values()) v.root.removeFromParent();
    this.objs.clear();
    for (const b of this.boxes.values()) b.o.removeFromParent();
    this.boxes.clear();
    for (const t of this.trash.values()) t.removeFromParent();
    this.trash.clear();
    for (const c of this.custs.values()) c.v.dispose();
    this.custs.clear();
    for (const s of this.staff.values()) s.dispose();
    this.staff.clear();
  }

  /** everything the crosshair can interact with */
  targets(): THREE.Object3D[] {
    const t: THREE.Object3D[] = [this.shell.doorSign, ...this.shell.liftTargets];
    for (const v of this.objs.values()) t.push(v.root);
    for (const b of this.boxes.values()) if (b.o.visible) t.push(b.o);
    for (const o of this.trash.values()) t.push(o);
    t.push(this.counterItems);
    for (const [id, c] of this.custs) { const cu = this.world.cust(id); if (cu && (cu.state === 'steal' || cu.state === 'paying' || cu.state === 'atCounter')) t.push(c.v.root); }
    t.push(...this.city.targets);
    return t;
  }

  private reconcile() {
    this.cullFloor = -1;
    const w = this.world, s = w.save;
    if (this.shell.build(s)) this.shell.group.updateMatrixWorld(true);
    this.shell.setOpen(s.open);
    // objects
    const seen = new Set<string>();
    for (const o of s.objects) {
      seen.add(o.id);
      let v = this.objs.get(o.id);
      if (v && v.key !== objKey(o)) { v.root.removeFromParent(); v = undefined; }
      if (!v) { v = buildObject(o); this.objs.set(o.id, v); this.root.add(v.root); v.root.updateMatrixWorld(true); }
      if (v.shelf) updateShelf(v, o, o.product ? (s.prices[o.product] ?? ITEM[o.product].product!.market) : null);
      if (o.broken && !v.smoke) { v.smoke = smoke(); v.root.add(v.smoke); }
      if (!o.broken && v.smoke) { v.smoke.removeFromParent(); v.smoke = undefined; }
    }
    for (const [id, v] of this.objs) if (!seen.has(id)) { v.root.removeFromParent(); this.objs.delete(id); }
    // boxes
    const bseen = new Set<string>();
    for (const b of s.boxes) {
      bseen.add(b.id);
      const label = b.empty ? 'EMPTY' : b.product ? `${ITEM[b.item].name} ×${b.count}` : `📦 ${ITEM[b.item].name}`;
      const key = (b.empty ? 'open' : 'closed') + '|' + label;
      let e = this.boxes.get(b.id);
      if (e && e.key !== key) { e.o.removeFromParent(); e = undefined; }
      if (!e) {
        const o = new THREE.Group();
        const m = instance(b.empty ? 'cardboardBoxOpen' : 'cardboardBoxClosed');
        if (b.empty) m.scale.setScalar(0.75);
        o.add(m);
        const tex = this.label(label);
        const top = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        top.userData.ownGeo = true; top.position.set(0, 0.36, 0.215);
        if (!b.empty) o.add(top);
        o.userData.target = { kind: 'box', id: b.id };
        e = { o, key }; this.boxes.set(b.id, e); this.root.add(o);
      }
      e.o.visible = !b.at && b.carrier !== this.localId;
      e.o.userData.fl = b.fl || 0;
      if (!b.carrier) { e.o.position.set(b.x, floorY(b.fl || 0) + (b.y || 0), b.z); e.o.rotation.y = b.ry; }
    }
    for (const [id, e] of this.boxes) if (!bseen.has(id)) { e.o.removeFromParent(); this.boxes.delete(id); }
    // trash & spills
    const tseen = new Set<string>();
    for (const t of s.trash) {
      tseen.add(t.id);
      if (!this.trash.has(t.id)) {
        const o = t.kind === 'spill' ? spill() : instance('trash_A');
        if (t.kind !== 'spill') o.scale.setScalar(0.6);
        const g = new THREE.Group(); g.add(o); g.position.set(t.x, floorY(t.fl || 0), t.z); g.rotation.y = t.ry; g.userData.fl = t.fl || 0;
        if (t.kind === 'spill') { const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.7), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.ownGeo = true; g.add(hit); }
        g.userData.target = { kind: 'trash', id: t.id };
        this.trash.set(t.id, g); this.root.add(g);
      }
    }
    for (const [id, o] of this.trash) if (!tseen.has(id)) { o.removeFromParent(); this.trash.delete(id); }
    // colliders for the player
    this.colliders = [...this.shell.colliders, ...this.city.colliders];
    for (const o of s.objects) {
      if (o.wall || ITEM[o.item]?.walkable) continue;
      const y0 = floorY(o.fl || 0);
      if (o.item === 'office') { for (const r of officeWalls(o)) this.colliders.push({ ...r, y0, y1: y0 + WALL_H }); continue; }
      const f = footprint(o.item, o.x, o.z, o.rot);
      this.colliders.push({ x0: f.x0 + 0.05, x1: f.x1 - 0.05, z0: f.z0 + 0.05, z1: f.z1 - 0.05, y0, y1: y0 + 1.0 });
    }
  }

  label(text: string) {
    let t = this.labelCache.get(text);
    if (!t) { t = textCanvas(text, { w: 256, h: 78, bg: '#fff8e7', fg: '#3d2c1e', border: '#a47148' }); this.labelCache.set(text, t); }
    return t;
  }

  popup(x: number, z: number, text: string, color = '#80ed99', y = 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textCanvas(text, { w: 256, h: 96, fg: color, glow: 'rgba(0,0,0,0.6)' }), depthTest: false, transparent: true }));
    s.scale.set(0.9, 0.34, 1); s.position.set(x, y + 1.6, z); s.renderOrder = 12;
    this.root.add(s); this.popups.push({ s, t: 0 });
  }

  update(dt: number, cam: THREE.Vector3) {
    const w = this.world, s = w.save;
    this.time += dt;
    if (w.rev !== this.rev) { this.rev = w.rev; this.reconcile(); }
    const people: { x: number; y: number; z: number }[] = [{ x: cam.x, y: cam.y - 1.6, z: cam.z }];
    // only draw the floor you're on and its neighbours (outside, the ground floor)
    const pf = floorOfY(cam.y - 1.62);
    const near = (fl: number) => Math.abs(fl - pf) <= 1;
    // customers
    const cseen = new Set<string>();
    const occupied = new Set<string>();
    const live = new Set<string>();
    for (const c of w.customers) {
      cseen.add(c.id);
      let e = this.custs.get(c.id);
      if (!e) { const v = new CharView(c.model, { tint: c.tint }); e = { v, tx: c.x, tz: c.z, ty: c.y, try: c.ry, init: false }; this.custs.set(c.id, e); this.root.add(v.root); v.root.userData.target = { kind: 'cust', id: c.id }; }
      e.tx = c.x; e.tz = c.z; e.try = c.ry;
      const r = e.v.root;
      if (!e.init || w.isHost) { r.position.set(c.x, c.y || 0, c.z); r.rotation.y = c.ry; e.init = true; }
      else { r.position.x = damp(r.position.x, c.x, 10, dt); r.position.z = damp(r.position.z, c.z, 10, dt); r.position.y = damp(r.position.y, c.y || 0, 10, dt); r.rotation.y = dampAngle(r.rotation.y, c.ry, 10, dt); }
      r.visible = near(c.fl || 0);
      const build = ITEM[w.obj(c.target || '')?.item || '']?.build;
      e.v.seatY = build === 'console' ? 0.42 : build === 'racing' ? 0.36 : 0.5;
      e.v.update(dt, c.anim, cam);
      const warn = c.state === 'wait' || c.state === 'toWait' || c.state === 'foodWait';
      e.v.setRing(c.progress, warn);
      e.v.setBubble(c.bubble, !!c.live || c.state === 'foodWait');
      if (c.regular) { const r = REGULAR[c.regular], h = hearts(s.regulars[c.regular]?.love || 0); e.v.setLabel(`${s.regulars[c.regular]?.vip ? '💳 ' : ''}${r.name} ${'♥'.repeat(h)}`, '#ffd6e8'); }
      if (PLAYING.has(c.anim) && c.target) occupied.add(c.target);
      if (c.live && c.target) live.add(c.target);
      people.push(r.position);
    }
    for (const [id, e] of this.custs) if (!cseen.has(id)) { e.v.dispose(); this.custs.delete(id); }
    // staff
    const sseen = new Set<string>();
    for (const st of w.staff) {
      sseen.add(st.id);
      let v = this.staff.get(st.id);
      if (!v) {
        v = new CharView(st.body === 'female' ? 'humanFemaleA' : 'humanMaleA');
        const role = STAFF.find(r => r.id === st.role);
        v.setLook({ shirt: role?.shirt || '#4cc9f0', pants: '#2b2d42', skin: (st.name.length * 7) % 6, hat: 'cap', hatColor: role?.shirt || '#4cc9f0' });
        this.staff.set(st.id, v); this.root.add(v.root);
      }
      const lvl = s.staff.find(m => m.id === st.id)?.lvl || 1;
      v.setLabel(`${STAFF.find(r => r.id === st.role)?.icon || ''} ${st.name}${lvl > 1 ? ' ' + '★'.repeat(lvl) : ''}`, '#fff');
      const r = v.root;
      if (w.isHost) { r.position.set(st.x, st.y || 0, st.z); r.rotation.y = st.ry; }
      else { r.position.x = damp(r.position.x, st.x, 10, dt); r.position.z = damp(r.position.z, st.z, 10, dt); r.position.y = damp(r.position.y, st.y || 0, 10, dt); r.rotation.y = dampAngle(r.rotation.y, st.ry, 10, dt); }
      r.visible = near(st.fl || 0);
      v.update(dt, st.anim, cam);
      people.push(r.position);
    }
    for (const [id, v] of this.staff) if (!sseen.has(id)) { v.dispose(); this.staff.delete(id); }
    // remote players
    const pseen = new Set<string>();
    for (const p of w.players.values()) {
      if (p.id === this.localId) continue;
      pseen.add(p.id);
      let v = this.remotes.get(p.id);
      const body = p.look?.body === 'female' ? 'humanFemaleA' : 'humanMaleA';
      if (v && v.modelName !== body) { v.dispose(); this.remotes.delete(p.id); v = undefined; }
      if (!v) { v = new CharView(body); v.setLabel(p.name + (p.host ? ' 👑' : ''), '#ffd166'); this.remotes.set(p.id, v); this.root.add(v.root); }
      if (p.look) v.setLook(p.look);
      v.root.position.x = damp(v.root.position.x, p.x, 12, dt); v.root.position.z = damp(v.root.position.z, p.z, 12, dt);
      v.root.position.y = damp(v.root.position.y, Math.max(0, p.y - 1.6), 12, dt);
      v.root.rotation.y = dampAngle(v.root.rotation.y, p.ry + Math.PI, 12, dt);
      v.update(dt, p.carry ? (p.anim === 'walk' ? 'carry' : 'carry') : p.anim, cam);
      people.push(v.root.position);
    }
    for (const [id, v] of this.remotes) if (!pseen.has(id)) { v.dispose(); this.remotes.delete(id); }
    // carried boxes follow their carrier
    for (const b of s.boxes) {
      if (!b.carrier || b.carrier === this.localId) continue;
      const e = this.boxes.get(b.id); if (!e) continue;
      const v = this.remotes.get(b.carrier) || this.staff.get(b.carrier);
      if (!v) continue;
      const r = v.root;
      e.o.position.set(r.position.x + Math.sin(r.rotation.y) * 0.42, r.position.y + 0.82, r.position.z + Math.cos(r.rotation.y) * 0.42);
      e.o.rotation.y = r.rotation.y;
    }
    // objects: screens, smoke, neon at night (and hide floors you can't see)
    if (this.cullFloor !== pf) {
      this.cullFloor = pf;
      for (const o of s.objects) { const v = this.objs.get(o.id); if (v) v.root.visible = near(o.wall ? floorOfY(o.y ?? 1.8) : o.fl || 0); }
      for (const e of this.boxes.values()) if (!e.o.userData.hiddenByCarry) e.o.userData.cullHide = !near(e.o.userData.fl || 0);
      for (const t of this.trash.values()) t.visible = near(t.userData.fl || 0);
    }
    for (const e of this.boxes.values()) if (e.o.userData.cullHide) e.o.visible = false;
    for (const [id, v] of this.objs) {
      const used = occupied.has(id);
      for (const m of v.screens) { m.emissiveIntensity = used ? 1.3 : 0.25 + this.gfx.night * 0.2; if (m.map && used) m.map.offset.x = (this.time * 0.15) % 1; }
      if (v.smoke) animateSmoke(v.smoke, this.time);
      if (v.neon) v.neon.color.setScalar(0.75 + this.gfx.night * 0.5 + Math.sin(this.time * 3 + id.length) * 0.05);
      if (v.lamp) (v.lamp as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + this.gfx.night * 1.6;
      if (v.glow) for (const g of v.glow as THREE.MeshStandardMaterial[]) g.emissiveIntensity = 1 + this.gfx.night * 1.5;
      if (v.wheel) v.wheel.rotation.z = used ? Math.sin(this.time * 1.6) * 0.5 + Math.sin(this.time * 4.3) * 0.08 : v.wheel.rotation.z * 0.9;
      if (v.onAir) v.onAir.emissiveIntensity = live.has(id) ? 1.6 + Math.sin(this.time * 6) * 0.3 : 0.12;
      if (v.ringLight) v.ringLight.emissiveIntensity = used ? 2.2 : 0.3;
    }
    this.updateCounterItems();
    // door opens for anyone nearby
    const nearDoor = people.some(p => p.y < 1 && Math.abs(p.x - DOOR.x) < 1.6 && Math.abs(p.z) < 2.2);
    this.shell.update(dt, this.gfx.night, nearDoor, this.time, pf, people);
    this.city.update(dt, s.time, this.gfx.night, cam, people.slice(0, 1).concat([...w.players.values()]));
    // cash popups
    for (const p of [...this.popups]) {
      p.t += dt; p.s.position.y += dt * 0.7;
      (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - p.t / 1.6);
      if (p.t > 1.6) { p.s.removeFromParent(); (p.s.material as THREE.SpriteMaterial).map?.dispose(); p.s.material.dispose(); this.popups.splice(this.popups.indexOf(p), 1); }
    }
  }

  /** unscanned items sit on the checkout counter in front of the customer */
  private updateCounterItems() {
    const w = this.world;
    const parts: string[] = [];
    const heads: Customer[] = [];
    for (const [kid, q] of w.queues) {
      const c = q.length ? w.cust(q[0]) : null;
      if (c && c.state === 'atCounter') { heads.push(c); parts.push(kid + ':' + c.id + ':' + c.scanned + ':' + c.cart.length); }
    }
    // guests don't have queues: use customers at a counter
    if (!w.isHost) for (const c of w.customers) if (c.state === 'atCounter' && c.queueAt && !heads.includes(c)) { heads.push(c); parts.push(c.queueAt + ':' + c.id + ':' + c.scanned + ':' + c.cart.length); }
    const key = parts.join('|');
    if (key === this.counterKey) return;
    this.counterKey = key;
    this.counterItems.clear();
    for (const c of heads) {
      const k = c.queueAt ? w.obj(c.queueAt) : null; if (!k) continue;
      const cs = counterSpots(k);
      const left = c.cart.slice(c.scanned);
      left.forEach((it, i) => {
        const pd = ITEM[it.p].product!;
        const pr = productProto(pd.mesh, pd.color);
        const m = new THREE.Mesh(pr.geo, pr.mat);
        const p = cs.itemsAt(i, left.length);
        m.position.set(p.x, floorY(k.fl || 0) + cs.topY, p.z);
        m.rotation.y = k.rot * Math.PI / 2;
        const g = new THREE.Group(); g.add(m);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(p.x, floorY(k.fl || 0) + cs.topY + 0.1, p.z); hit.userData.ownGeo = true; g.add(hit);
        g.userData.target = { kind: 'scan', id: c.id };
        this.counterItems.add(g);
      });
    }
  }
}
