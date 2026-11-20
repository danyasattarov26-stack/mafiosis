/*
  The game session: owns the world, the simulation (when hosting/solo), the view, the player and the
  interaction rules ("what does E do when I look at this?"). UI panels hook in through `ui`.
*/
import * as THREE from 'three';
import { ITEM } from '../config/items';
import { ECON } from '../config/economy';
import { SAVE_VERSION, saveLocal, type SaveData } from '../core/save';
import { money as $m } from '../core/util';
import type { Gfx } from '../engine/gfx';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { World } from '../sim/world';
import { Sim } from '../sim/sim';
import { applyAction, inUse, type Action, type Result } from '../sim/actions';
import { counterSpots, useSpots, dist } from '../sim/layout';
import { View } from './view';
import { Player } from './player';
import { Placement } from './placement';
import { Hud, type PromptLine } from '../ui/hud';
import { coop } from '../net/coop';
import { api } from '../net/api';

export type Mode = 'walk' | 'place' | 'install' | 'register' | 'ui';
interface Opt { key: '' | 'E' | 'F' | 'G' | 'Q' | 'Hold E' | 'Hold F'; text: string; run?: () => void; hold?: number; warn?: boolean }

export interface UiHooks {
  openLaptop(): void;
  openInventory(): void;
  openPause(): void;
  register(show: boolean): void;
  dayOver(sum: any): void;
  levelUp(level: number, unlocks: string[]): void;
  visit(code: string, name: string): void;
  closeAll(): void;
}

export class Game {
  world: World;
  sim: Sim | null = null;
  view: View;
  player: Player;
  placement: Placement;
  hud: Hud;
  mode: Mode = 'walk';
  holding: string | null = null;     // component item being installed
  registerId: string | null = null;
  visiting: { code: string; name: string } | null = null;
  ui!: UiHooks;
  private ray = new THREE.Raycaster();
  private aimed: { kind: string; id: string; name?: string; obj: THREE.Object3D } | null = null;
  private opts: Opt[] = [];
  private holdT = 0; private holdKey = '';
  private altT = -1;
  private saveT = 20; private cloudT = 300; private beatT = 2;
  private stockRepeat = 0;
  private dirtyCloud = false;
  running = false;

  constructor(public gfx: Gfx, save: SaveData, hudParent: HTMLElement) {
    this.world = new World(save);
    this.view = new View(gfx, this.world);
    this.player = new Player(gfx.camera);
    this.placement = new Placement(gfx.scene);
    this.hud = new Hud(hudParent);
    this.hud.show(false);
  }

  get localId() { return coop.id; }
  get isHost() { return coop.role !== 'guest'; }
  get readOnly() { return !!this.visiting; }

  /** start (or restart) a session on a world */
  async begin(save: SaveData, how: 'solo' | 'guest' | 'visit', extra?: { room?: string; visitName?: string }) {
    this.placement.stop(); this.mode = 'walk'; this.holding = null; this.registerId = null;
    this.visiting = how === 'visit' ? { code: extra!.room!, name: extra!.visitName || 'Friend' } : null;
    this.world = new World(save);
    this.world.isHost = how !== 'guest';
    this.sim = how === 'solo' ? new Sim(this.world) : null;
    this.view.setWorld(this.world);
    this.view.localId = this.localId;
    this.wireEvents();
    this.player.pos.set(0, 0, 3.2); this.player.yaw = 0; this.player.pitch = -0.05;
    this.player.speedMul = save.perks.includes('sprinter') ? 1.12 : 1;
    this.hud.setVisit(this.visiting ? `👀 Visiting ${this.visiting.name}'s shop (read-only)` : null);
    this.running = true;
    if (how === 'solo') {
      // open the doors for friends (live visits / co-op)
      const room = api.profile?.friendCode || 'local';
      await coop.host(room, this.world, (a, from) => this.applyRemote(a, from));
    }
  }

  private wireEvents() {
    const w = this.world;
    w.ev.on('cash', e => { this.view.popup(e.x, e.z, `+${$m(e.amount)}${e.label ? ' ' + e.label : ''}`, e.label === 'tip' ? '#ffd166' : '#80ed99'); coop.broadcastEvent('cash', e); });
    w.ev.on('sfx', e => { audio.play(e.name as any, { at: e, throttle: 60 }); coop.broadcastEvent('sfx', e); });
    w.ev.on('toast', e => { this.hud.toast(e.msg, e.kind || 'info'); coop.broadcastEvent('toast', e); });
    w.ev.on('review', r => { this.hud.toast(`${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)} “${r.text}” — ${r.who}`, r.stars >= 4 ? 'good' : r.stars <= 2 ? 'bad' : 'info', 4200); coop.broadcastEvent('review', r); });
    w.ev.on('levelup', e => { audio.play('levelup'); this.ui?.levelUp(e.level, e.unlocks); coop.broadcastEvent('levelup', e); this.persist(true); });
    w.ev.on('dayover', s => { this.ui?.dayOver(s); coop.broadcastEvent('dayover', s); this.persist(true); });
    w.ev.on('changed', () => { this.dirtyCloud = true; });
  }

  /** events relayed from the host to guests */
  onRemoteEvent(type: string, d: any) {
    if (type === 'cash') this.view.popup(d.x, d.z, `+${$m(d.amount)}${d.label ? ' ' + d.label : ''}`, d.label === 'tip' ? '#ffd166' : '#80ed99');
    if (type === 'sfx') audio.play(d.name, { at: d, throttle: 60 });
    if (type === 'toast') this.hud.toast(d.msg, d.kind || 'info');
    if (type === 'review') this.hud.toast(`${'★'.repeat(d.stars)} “${d.text}”`, d.stars >= 4 ? 'good' : 'info', 4000);
    if (type === 'levelup') { audio.play('levelup'); this.ui?.levelUp(d.level, d.unlocks); }
    if (type === 'dayover') this.ui?.dayOver(d);
  }

  /** host side: apply an action that came from a guest */
  private applyRemote(a: Action, from: string): Result {
    if (!this.sim) return { ok: false, msg: 'Not hosting' };
    return applyAction(this.world, this.sim, a, from);
  }

  /** perform an action locally or through the host */
  async act(a: Action, quiet = false): Promise<Result> {
    if (this.readOnly) { const r = { ok: false, msg: 'You’re visiting — this shop is read-only.' }; if (!quiet) this.hud.toast(r.msg!, 'bad'); return r; }
    let r: Result;
    if (coop.role === 'guest') r = await coop.act(a);
    else r = applyAction(this.world, this.sim, a, this.localId);
    if (!quiet && r.msg) this.hud.toast(r.msg, r.ok ? 'good' : 'bad');
    if (!r.ok && !quiet) audio.play('error');
    return r;
  }

  carried() { return this.world.save.boxes.find(b => b.carrier === this.localId) || null; }

  // ---------- per frame ----------
  update(dt: number) {
    if (!this.running) return;
    const w = this.world;
    if (this.sim && !this.readOnly) this.sim.tick(dt);
    const frozen = this.mode === 'ui' || this.mode === 'register';
    // phones never lock a mouse pointer: only desktop waits for pointer lock
    this.player.frozen = frozen || (!input.locked && !input.touch);
    if (this.mode !== 'register') this.player.update(dt, this.view.colliders);
    this.gfx.setTime(w.save.time);
    this.gfx.follow(this.player.pos);
    audio.listener.x = this.player.pos.x; audio.listener.z = this.player.pos.z;
    this.view.update(dt, this.gfx.camera.position);
    // what am I carrying?
    const cb = this.carried();
    const label = cb ? (cb.empty ? 'EMPTY' : cb.product ? `${ITEM[cb.item].name} ×${cb.count}` : `📦 ${ITEM[cb.item].name}`) : null;
    this.player.setCarry(cb ? cb.id + (cb.empty ? 'e' : '') + cb.count : null, !!cb?.empty, label ? this.view.label(label) : undefined);
    this.hud.carry(cb ? `Carrying: ${label}` : this.holding ? `Holding: ${ITEM[this.holding].name} — look at a station` : null);

    if (this.mode === 'place') this.updatePlace();
    else if (this.mode === 'walk' || this.mode === 'install') this.updateAim(dt);
    else if (this.mode === 'register') this.updateRegister();
    if (this.mode !== 'walk' && this.mode !== 'install') this.hud.hold(null);

    // global keys
    if (input.pressed('inventory') && (this.mode === 'walk' || this.mode === 'install')) { input.consume('inventory'); this.ui.openInventory(); }
    if (input.pressed('menu') && this.mode === 'walk') { input.consume('menu'); this.ui.openPause(); }
    if (input.pressed('cancel') && this.mode === 'install') { this.holding = null; this.mode = 'walk'; }
    if (input.pressed('menu') && this.mode === 'install') { this.holding = null; this.mode = 'walk'; }

    // co-op
    coop.tick(dt, { name: coop.me.name, look: coop.me.look, x: this.player.pos.x, y: this.player.pos.y + 1.62, z: this.player.pos.z, ry: this.player.yaw, pitch: this.player.pitch, carry: cb?.id || null, anim: this.player.moving ? 'walk' : 'idle' });
    if (coop.role === 'host') w.players.set(this.localId, { id: this.localId, name: coop.me.name, look: coop.me.look, x: this.player.pos.x, y: 1.62, z: this.player.pos.z, ry: this.player.yaw, pitch: this.player.pitch, carry: cb?.id || null, anim: 'idle', at: Date.now(), host: true });
    // saving & heartbeat
    if (this.isHost && !this.readOnly) {
      this.saveT -= dt; this.cloudT -= dt;
      if (this.saveT <= 0) { this.saveT = 15; saveLocal(w.save); }
      if (this.cloudT <= 0 && this.dirtyCloud) { this.cloudT = 300; this.dirtyCloud = false; this.cloud(); }
    }
    this.beatT -= dt;
    if (this.beatT <= 0) { this.beatT = 30; this.heartbeat(); }
    this.hud.update(w.save, this.sim ? this.sim.rating() : avgRating(w.save), coop.peers.length ? coop.peers.map(p => ({ name: p.name, host: p.host })) : []);
    this.updateHint();
  }

  /** keep hosting while the tab is hidden (no rendering, coarse steps) */
  background(dt: number) {
    if (!this.running) return;
    if (this.sim && !this.readOnly) for (let t = 0; t < dt; t += 0.05) this.sim.tick(Math.min(0.05, dt - t));
    const cb = this.carried();
    coop.tick(dt, { name: coop.me.name, look: coop.me.look, x: this.player.pos.x, y: this.player.pos.y + 1.62, z: this.player.pos.z, ry: this.player.yaw, pitch: this.player.pitch, carry: cb?.id || null, anim: 'idle' });
  }

  persist(cloudNow = false) {
    if (!this.isHost || this.readOnly) return;
    saveLocal(this.world.save);
    if (cloudNow) this.cloud();
  }
  private cloud() { if (api.online && this.isHost && !this.readOnly) api.saveCloud(this.world.save, SAVE_VERSION).catch(e => console.warn('cloud save failed', e.message)); }
  private async heartbeat() {
    if (!api.online || api.presence === 'p2p') return; // peer-to-peer mode: friends ping our inbox instead
    try {
      const inv = await api.heartbeat(coop.role === 'host' ? coop.room : null);
      for (const i of inv) {
        if ((this as any)._seenInv?.has(i.id)) continue;
        ((this as any)._seenInv ||= new Set()).add(i.id);
        this.hud.toast(`🎮 ${i.from} invited you to co-op!`, 'info', 15000, [{ label: 'Join', fn: () => this.ui.visit(i.fromCode, i.from) }]);
      }
    } catch { /* offline */ }
  }

  // ---------- aiming & interactions ----------
  private pick(): typeof this.aimed {
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.gfx.camera);
    this.ray.far = 3.4;
    const hits = this.ray.intersectObjects(this.view.targets(), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      if ((o as any).userData?.noRay) continue;
      while (o && !o.userData.target) o = o.parent;
      if (o && o.userData.target) {
        const t = o.userData.target;
        if (t.kind === 'visit' && h.distance > 4) continue;
        return { kind: t.kind, id: t.id, name: t.name, obj: o };
      }
    }
    return null;
  }

  private options(t: NonNullable<typeof this.aimed>): Opt[] {
    const w = this.world, s = w.save, cb = this.carried();
    const quick = s.perks.includes('mechanic') ? 0.5 : 1;
    const o: Opt[] = [];
    switch (t.kind) {
      case 'sign': o.push({ key: 'E', text: s.open ? 'Close the shop' : s.dayOver ? 'Day is over' : 'Open the shop', run: () => this.act({ t: 'toggleOpen' }).then(r => { if (r.ok) audio.play('door'); }) }); break;
      case 'laptop': o.push({ key: 'E', text: 'Use manager laptop', run: () => this.ui.openLaptop() }); break;
      case 'visit': o.push({ key: 'E', text: `Visit ${t.name}'s shop`, run: () => this.ui.visit(t.id, t.name || 'Friend') }); break;
      case 'trash': o.push({ key: 'Hold E', text: 'Clean up', hold: 1.2 * quick, run: () => this.act({ t: 'clean', id: t.id }, true).then(r => r.ok && audio.play('sweep')) }); break;
      case 'scan': o.push({ key: 'E', text: 'Scan item', run: () => this.act({ t: 'scan', cust: t.id }, true).then(r => r.ok && audio.play('beep')) }); break;
      case 'cust': {
        const c = w.cust(t.id); if (!c) break;
        if (c.state === 'steal') o.push({ key: 'E', text: 'Stop, thief!', warn: true, run: () => this.act({ t: 'catch', cust: c.id }) });
        else if ((c.state === 'atCounter' || c.state === 'paying') && c.queueAt) o.push({ key: 'E', text: 'Serve at the register', run: () => this.enterRegister(c.queueAt!) });
        break;
      }
      case 'box': {
        const b = w.box(t.id); if (!b) break;
        if (cb && cb.id !== b.id) { o.push({ key: 'E', text: 'Put box down', run: () => this.dropCarried() }); break; }
        if (b.carrier && b.carrier !== this.localId) { o.push({ key: '', text: 'Someone is carrying this' }); break; }
        o.push({ key: 'E', text: b.empty ? 'Pick up empty box' : `Pick up ${b.product ? ITEM[b.item].name + ' ×' + b.count : 'box'}`, run: () => this.act({ t: 'grabBox', id: b.id }, true).then(r => r.ok && audio.play('pickup')) });
        if (!b.product && !b.empty) o.push({ key: 'F', text: `Unbox ${ITEM[b.item].name}`, run: () => this.act({ t: 'unbox', id: b.id }).then(r => r.ok && audio.play('pop')) });
        if (b.empty) o.push({ key: 'Hold F', text: 'Flatten & tidy', hold: 0.6, run: () => this.act({ t: 'clean', id: b.id }, true) });
        break;
      }
      case 'obj': {
        const ob = w.obj(t.id); if (!ob) break;
        const d = ITEM[ob.item];
        if (ob.broken) { o.push({ key: 'Hold E', text: `Repair ${d.name}`, hold: 2.5 * quick, warn: true, run: () => this.act({ t: 'repair', id: ob.id }).then(r => r.ok && audio.play('repair')) }); }
        else if (this.mode === 'install' && this.holding) {
          o.push({ key: 'E', text: `Install ${ITEM[this.holding].name}`, run: () => this.act({ t: 'install', id: ob.id, item: this.holding! }).then(r => { if (r.ok) { audio.play('place'); if (!(s.inventory[this.holding!] > 0)) { this.holding = null; this.mode = 'walk'; } } }) });
        } else if (cb && (d.kind === 'shelf' || d.kind === 'fridge')) {
          const pd = ITEM[cb.item]?.product;
          const left = (d.capacity || 0) - (ob.stock || 0);
          if (cb.empty) o.push({ key: 'F', text: ob.stock ? `Take back ${ITEM[ob.product!].name}` : 'Shelf is empty', run: () => this.act({ t: 'unstock', obj: ob.id }, true) });
          else if (!pd) o.push({ key: '', text: 'Unbox furniture with F first', warn: true });
          else if (pd.place !== d.accepts) o.push({ key: '', text: pd.place === 'fridge' ? 'Drinks go in a fridge' : 'This goes on a shelf', warn: true });
          else if (ob.product && ob.product !== cb.item && (ob.stock || 0) > 0) o.push({ key: '', text: `Holds ${ITEM[ob.product].name} — empty it first`, warn: true });
          else if (left <= 0) o.push({ key: '', text: 'Shelf is full', warn: true });
          else o.push({ key: 'E', text: `Restock (${cb.count} in box · ${left} space) — hold to fill`, run: () => this.act({ t: 'stock', box: cb.id, obj: ob.id }, true).then(r => { if (r.ok) audio.play('place', { vol: 0.5 }); else if (r.msg) this.hud.toast(r.msg, 'bad'); }) });
          if (!cb.empty && ob.product === cb.item && ob.stock) o.push({ key: 'F', text: 'Take one back', run: () => this.act({ t: 'unstock', obj: ob.id }, true) });
        } else if (cb && d.kind === 'bin') {
          o.push({ key: 'E', text: cb.empty ? 'Throw empty box away' : 'Only empty boxes go in the bin', warn: !cb.empty, run: cb.empty ? () => this.act({ t: 'binBox', box: cb.id }, true).then(r => r.ok && audio.play('thud')) : undefined });
        } else if (cb) {
          o.push({ key: 'E', text: 'Put box down', run: () => this.dropCarried() });
        } else {
          if (d.kind === 'counter') o.push({ key: 'E', text: 'Use the register', run: () => this.enterRegister(ob.id) });
          const busy = inUse(w, ob.id);
          const value = Math.round(d.price * ECON.sellBack);
          if (d.kind !== 'counter') o.push({ key: 'E', text: busy ? 'In use' : `Move ${d.name}`, run: busy ? undefined : () => this.startMove(ob.id) });
          else o.push({ key: 'F', text: `Move ${d.name}`, run: busy ? undefined : () => this.startMove(ob.id) });
          if (d.kind !== 'counter') o.push({ key: 'F', text: 'Pick up into inventory', run: busy ? undefined : () => this.act({ t: 'pickupObj', id: ob.id }).then(r => r.ok && audio.play('pickup')) });
          o.push({ key: 'Hold F', text: `Sell for ${$m(value)}`, hold: 1.0, run: busy ? undefined : () => this.act({ t: 'sell', id: ob.id }).then(r => r.ok && audio.play('coins')) });
          if (d.kind === 'station') {
            const st = w.seatUse.get(ob.id);
            const price = this.sim ? this.sim.sessionPrice(ob) : null;
            o.unshift({ key: '', text: `${d.name}${price ? ` · ${$m(price)}/session` : ''}${st?.some(Boolean) ? ' · 🎮 playing' : ''} · ${ob.sessions || 0} sessions` });
          }
          if (d.kind === 'shelf' || d.kind === 'fridge') o.unshift({ key: '', text: ob.product ? `${ITEM[ob.product].name}: ${ob.stock}/${d.capacity}` : `Empty ${d.name} (${d.capacity} slots)` });
        }
        break;
      }
    }
    return o;
  }

  private updateAim(dt: number) {
    const t = this.pick();
    this.aimed = t;
    const cb = this.carried();
    this.opts = t ? this.options(t) : [];
    if (!t && cb) this.opts = [{ key: 'E', text: 'Put box down', run: () => this.dropCarried() }];
    if (!t && this.mode === 'install') this.opts = [{ key: 'Q', text: 'Stop holding' } as any];
    const lines: PromptLine[] = this.opts.map(o => ({ key: o.key, text: o.text, warn: o.warn || (!o.run && !!o.key) }));
    this.hud.prompt(lines, !!t);
    // touch labels
    input.setTouchButtons({ interact: this.opts.find(o => o.key.endsWith('E'))?.text.slice(0, 18) || 'Use', alt: this.opts.find(o => o.key.endsWith('F'))?.text.split(' ')[0] || null, rotate: null });
    if (!input.locked && !input.touch) return;
    // E: tap or hold
    const e = this.opts.find(o => o.key === 'E' || o.key === 'Hold E');
    if (e?.hold) {
      if (input.isHeld('interact') && e.run) {
        const key = 'E' + (t?.id || '');
        if (this.holdKey !== key) { this.holdKey = key; this.holdT = 0; }
        this.holdT += dt; this.hud.hold(this.holdT / e.hold);
        if (this.holdT >= e.hold) { e.run(); this.holdT = 0; this.holdKey = ''; this.hud.hold(null); input.consume('interact'); }
      } else if (this.holdKey.startsWith('E')) { this.holdKey = ''; this.holdT = 0; this.hud.hold(null); }
    } else if (e?.run) {
      // restocking repeats while E is held
      const restock = /^Restock/.test(e.text);
      if (input.pressed('interact')) { e.run(); this.stockRepeat = 0.35; }
      else if (restock && input.isHeld('interact')) { this.stockRepeat -= dt; if (this.stockRepeat <= 0) { this.stockRepeat = 0.14; e.run(); } }
    }
    // F: tap (F option) or hold (Hold F option)
    const fTap = this.opts.find(o => o.key === 'F'), fHold = this.opts.find(o => o.key === 'Hold F');
    if (input.pressed('alt')) this.altT = 0;
    if (this.altT >= 0) {
      if (input.isHeld('alt')) {
        this.altT += dt;
        if (fHold?.run && fHold.hold) {
          if (this.altT > 0.25) this.hud.hold((this.altT - 0.25) / fHold.hold);
          if (this.altT - 0.25 >= fHold.hold) { fHold.run(); this.altT = -1; this.hud.hold(null); }
        }
      } else {
        if (this.altT < 0.25 && fTap?.run) fTap.run();
        this.altT = -1; this.hud.hold(null);
      }
    }
    if (input.pressed('drop') && cb) this.dropCarried();
    if (input.pressed('drop') && !cb && t?.kind === 'obj') this.startMove(t.id);
  }

  private dropCarried() {
    const cb = this.carried(); if (!cb) return;
    const hit = this.player.floorHit(2.6);
    const p = hit && !this.view.colliders.some(c => hit.x > c.x0 && hit.x < c.x1 && hit.z > c.z0 && hit.z < c.z1 && c.y1 !== undefined)
      ? hit : this.player.pos.clone().add(this.player.forward().multiplyScalar(0.7));
    this.act({ t: 'dropBox', id: cb.id, x: p.x, z: p.z, ry: this.player.yaw }, true).then(r => r.ok && audio.play('thud', { vol: 0.6 }));
  }

  // ---------- placement ----------
  startPlace(item: string) {
    const d = ITEM[item];
    if (d.kind === 'component') { this.holding = item; this.mode = 'install'; this.hud.toast(`Look at a gaming station and press E to install ${d.name}.`, 'info'); return; }
    this.placement.start(item);
    this.mode = 'place';
  }
  startMove(id: string) {
    const o = this.world.obj(id); if (!o || o.item === 'office') return;
    if (inUse(this.world, id)) { this.hud.toast('Someone is using it', 'bad'); return; }
    this.placement.start(o.item, o);
    const v = this.view.objs.get(id); if (v) v.root.visible = false;
    this.mode = 'place';
  }
  private endPlace() {
    if (this.placement.moving) { const v = this.view.objs.get(this.placement.moving); if (v) v.root.visible = true; }
    this.placement.stop(); this.mode = 'walk';
  }
  private updatePlace() {
    this.placement.update(this.world, this.player, this.view.shell);
    const p = this.placement;
    const d = ITEM[p.item];
    const lines: PromptLine[] = [
      { key: 'E', text: p.valid ? `Place ${d.name}` : p.reason || 'Can’t place here', warn: !p.valid },
      ...(d.kind !== 'wall' ? [{ key: 'R', text: 'Rotate' }] : []),
      { key: 'Q', text: 'Cancel' },
    ];
    this.hud.prompt(lines, false);
    input.setTouchButtons({ interact: 'Place', rotate: d.kind !== 'wall' ? 'Rotate' : null, alt: null });
    if (input.pressed('rotate') || input.wheel) p.rotate();
    if (input.pressed('cancel') || input.pressed('menu') || input.pressed('alt')) { input.consume('menu'); this.endPlace(); return; }
    if (input.pressed('interact')) {
      if (!p.valid) { audio.play('error'); return; }
      const a: Action = p.moving
        ? { t: 'moveObj', id: p.moving, x: p.pos.x, z: p.pos.z, rot: p.rot, y: p.pos.wall ? p.pos.y : undefined }
        : { t: 'place', item: p.item, x: p.pos.x, z: p.pos.z, rot: p.rot, wall: p.pos.wall, y: p.pos.wall ? p.pos.y : undefined };
      const item = p.item, moving = p.moving;
      this.act(a, true).then(r => {
        if (!r.ok) { this.hud.toast(r.msg || 'Can’t place', 'bad'); audio.play('error'); return; }
        audio.play('place');
        if (moving) { this.endPlace(); return; }
        if (!(this.world.save.inventory[item] > 0)) this.endPlace();
      });
    }
  }

  // ---------- register ----------
  enterRegister(counterId: string) {
    const k = this.world.obj(counterId); if (!k) return;
    this.act({ t: 'useRegister', id: counterId }, true).then(r => {
      if (!r.ok) { this.hud.toast(r.msg || 'Busy', 'bad'); return; }
      this.registerId = counterId; this.mode = 'register';
      const cs = counterSpots(k);
      this.player.pos.set(cs.cashier.x, 0, cs.cashier.z);
      this.player.yaw = cs.cashier.ry + Math.PI; this.player.pitch = -0.55;
      this.player.update(0, []);
      input.unlock();
      this.ui.register(true);
    });
  }
  exitRegister() {
    if (this.mode !== 'register') return;
    this.act({ t: 'useRegister', id: null }, true);
    this.registerId = null; this.mode = 'walk';
    this.ui.register(false);
    // step back from the counter
    const k = this.world.obj(this.registerId || '') ;
    void k;
    if (!input.touch) input.lock();
  }
  private updateRegister() {
    this.hud.prompt([], false);
    if (input.pressed('menu') || input.pressed('cancel')) { input.consume('menu'); this.exitRegister(); }
  }
  /** click / tap on the 3D counter while at the register */
  clickAt(nx: number, ny: number) {
    if (this.mode !== 'register') return;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.gfx.camera);
    this.ray.far = 4;
    const hits = this.ray.intersectObject(this.view.counterItems, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.target) o = o.parent;
      if (o?.userData.target?.kind === 'scan') { this.act({ t: 'scan', cust: o.userData.target.id }, true).then(r => r.ok && audio.play('beep')); return; }
    }
  }
  registerCustomer() {
    if (!this.registerId) return null;
    const w = this.world;
    const host = w.queues.get(this.registerId);
    const id = host?.[0];
    let c = id ? w.cust(id) : null;
    if (!c) c = w.customers.find(x => x.queueAt === this.registerId && (x.state === 'atCounter' || x.state === 'paying')) || null;
    return c && (c.state === 'atCounter' || c.state === 'paying') ? c : null;
  }
  queueLength() { return this.world.customers.filter(c => c.queueAt === this.registerId && c.state !== 'leave').length; }

  // ---------- contextual tips ----------
  private updateHint() {
    const s = this.world.save;
    let h: string | null = null;
    if (this.readOnly) h = `<b>Visiting</b> — walk around and get inspired! Press <b>Esc</b> → Go home to return.`;
    else if (this.mode === 'place') h = null;
    else if (s.day === 1 && !s.open && !s.dayOver && s.time <= ECON.dayStart) h = `<b>Welcome to your shop!</b> Look at the <b>CLOSED</b> sign by the door and press <b>E</b> to open. Customers pay ${$m(s.sessionPrice)} to play.`;
    else if (s.objects.some(o => o.broken)) h = `<b>A station broke!</b> Walk up to it and <b>hold E</b> to repair it.`;
    else if (s.boxes.some(b => !b.at && !b.carrier && !b.product && !b.empty)) h = `<b>New furniture arrived!</b> Look at the box in the delivery zone and press <b>F</b> to unbox, then <b>Tab</b> to place it.`;
    else if (Object.keys(s.inventory).length && s.day <= 3) h = `Press <b>Tab</b> to open your inventory and place items.`;
    else if (s.trash.length >= 3) h = `It’s getting messy — <b>hold E</b> on trash and spills, or hire a <b>Cleaner</b>.`;
    else if (s.boxes.some(b => b.product && !b.at && !b.carrier && !b.empty) && !this.carried() && s.day <= 4) h = `Stock arrived: pick up a box with <b>E</b>, carry it to a shelf or fridge and <b>hold E</b> to fill it.`;
    else if (s.day === 1 && s.open && s.money >= 160) h = `Nice! Use the <b>manager laptop</b> in the back corner to buy more stations.`;
    else if (s.day <= 2 && s.level >= 2 && !s.licenses.length) h = `Level 2! Buy a <b>Retail License</b> on the laptop to start selling snacks.`;
    if (this.mode === 'install') h = `Holding <b>${ITEM[this.holding!]?.name}</b> — look at a gaming station and press <b>E</b>. <b>Q</b> to stop.`;
    this.hud.hint(h);
  }
}

function avgRating(s: SaveData) { const r = s.reviews.slice(-30); return r.length ? r.reduce((a, b) => a + b.stars, 0) / r.length : 3.5; }
export { useSpots, dist };
