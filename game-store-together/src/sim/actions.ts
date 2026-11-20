/*
  Everything a player can do to the shop is an Action. Solo play applies them directly; in co-op,
  guests send them to the host, which validates and applies them, so the host's world stays the truth.
*/
import { ITEM, type ItemDef } from '../config/items';
import { ECON, EXPANSIONS, FLOORS, WALLS, LIGHTS, LICENSES, STAFF, STAFF_NAMES, MAX_STAFF_PER_ROLE, XP, PERKS, ELEVATOR, REBIRTH, STAFF_SKILL } from '../config/economy';
import { officeSpot, newSave, emptyDay, type PlacedObject } from '../core/save';
import { rollGoals } from '../config/goals';
import { clearReserved, nextStorey, maxFloors, floorOfY } from './building';
import { uid, pick, rand, clamp } from '../core/util';
import { placeBlocked, deliveryZone, shopSize, dist, footprint } from './layout';
import type { World } from './world';
import type { Sim } from './sim';

export type Action =
  | { t: 'buy'; item: string; qty?: number }
  | { t: 'place'; item: string; x: number; z: number; rot: number; wall?: boolean; y?: number; fl?: number }
  | { t: 'pickupObj'; id: string }
  | { t: 'moveObj'; id: string; x: number; z: number; rot: number; y?: number; fl?: number }
  | { t: 'sell'; id: string }
  | { t: 'sellInv'; item: string }
  | { t: 'install'; id: string; item: string }
  | { t: 'grabBox'; id: string }
  | { t: 'dropBox'; id: string; x: number; z: number; ry: number; fl?: number }
  | { t: 'unbox'; id: string }
  | { t: 'stock'; box: string; obj: string }
  | { t: 'unstock'; obj: string }
  | { t: 'binBox'; box: string }
  | { t: 'toggleOpen' }
  | { t: 'clean'; id: string }
  | { t: 'repair'; id: string }
  | { t: 'scan'; cust: string }
  | { t: 'card'; cust: string }
  | { t: 'change'; cust: string; amount: number }
  | { t: 'useRegister'; id: string | null }
  | { t: 'price'; product: string; value: number }
  | { t: 'sessionPrice'; value: number }
  | { t: 'hire'; role: string }
  | { t: 'fire'; id: string }
  | { t: 'expand' }
  | { t: 'style'; kind: 'floor' | 'wall' | 'light'; id: string }
  | { t: 'shopName'; name: string }
  | { t: 'license'; id: string }
  | { t: 'perk'; id: string }
  | { t: 'catch'; cust: string }
  | { t: 'cook'; obj: string }
  | { t: 'train'; id: string }
  | { t: 'buildFloor' }
  | { t: 'buyElevator' }
  | { t: 'rebirth' }
  | { t: 'nextDay' }
  | { t: 'cheat'; what: string; n?: number };

export interface Result { ok: boolean; msg?: string }
const ok = (msg?: string): Result => ({ ok: true, msg });
const no = (msg: string): Result => ({ ok: false, msg });

export function locked(w: World, d: ItemDef): string | null {
  const s = w.save;
  if (d.level > s.level) return `Reach level ${d.level}`;
  if (d.license && !s.licenses.includes(d.license)) return `Needs ${LICENSES.find(l => l.id === d.license)?.name || d.license}`;
  return null;
}
export function unitCost(w: World, d: ItemDef) {
  return d.kind === 'product' && w.save.perks.includes('thrifty') ? Math.round(d.price * 0.85) : d.price;
}

/** free spot in the delivery zone for a new box */
function boxSlot(w: World) {
  const z = deliveryZone(w.save);
  const slots: { x: number; z: number }[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) slots.push({ x: z.x0 + 0.3 + c * 0.52, z: z.z1 - 0.3 - r * 0.52 });
  for (let level = 0; level < 3; level++) for (const s of slots) {
    const n = w.save.boxes.filter(b => !b.carrier && Math.abs(b.x - s.x) < 0.2 && Math.abs(b.z - s.z) < 0.2).length;
    if (n === level) return { ...s, y: level * 0.56 };
  }
  return { x: z.x0 + rand(0.3, 1.8), z: z.z0 + rand(0.3, 1.8), y: 1.7 };
}

export function applyAction(w: World, sim: Sim | null, a: Action, by: string): Result {
  const s = w.save;
  switch (a.t) {
    case 'buy': {
      const d = ITEM[a.item]; if (!d) return no('Unknown item');
      const lock = locked(w, d); if (lock) return no(lock);
      const qty = clamp(Math.floor(a.qty || 1), 1, 20);
      if (d.kind === 'service') {
        if (s.services.includes(d.service!)) return no('Already installed');
        if (s.money < d.price) return no('Not enough money');
        s.money -= d.price; s.today.spentItems += d.price; s.services.push(d.service!); w.bump();
        return ok(`${d.name} installed!`);
      }
      const cost = unitCost(w, d) * qty;
      if (s.money < cost) return no('Not enough money');
      s.money -= cost;
      if (d.kind === 'product') s.today.spentStock += cost; else s.today.spentItems += cost;
      const express = s.services.includes('express');
      const at = express || !sim ? 0 : sim.clock + ECON.deliverySeconds;
      for (let i = 0; i < qty; i++) {
        const p = boxSlot(w);
        s.boxes.push({ id: uid('b'), item: d.id, count: d.kind === 'product' ? d.product!.perBox : 1, x: p.x, z: p.z, y: p.y, ry: rand(-0.15, 0.15), at, carrier: null, product: d.kind === 'product' });
      }
      w.bump();
      return ok(express ? `📦 ${qty}× ${d.name} delivered!` : `📦 Ordered ${qty}× ${d.name} — arriving in ${ECON.deliverySeconds} s.`);
    }
    case 'place': {
      const d = ITEM[a.item]; if (!d) return no('Unknown item');
      if (!(s.inventory[a.item] > 0)) return no('Not in your inventory');
      if (d.kind === 'wall') {
        if (!a.wall) return no('Hang it on a wall');
      } else {
        const why = placeBlocked(s, a.item, a.x, a.z, a.rot, undefined, a.fl || 0); if (why) return no(why);
      }
      s.inventory[a.item]--; if (!s.inventory[a.item]) delete s.inventory[a.item];
      const o: any = { id: uid('o'), item: a.item, x: a.x, z: a.z, rot: a.rot & 3 };
      if (a.wall) { o.wall = true; o.y = a.y ?? 1.8; }
      const fl = a.wall ? floorOfY(o.y) : a.fl || 0;
      if (fl > 0) o.fl = fl;
      if (d.kind === 'station') { o.mon = 0; o.chair = 0; o.desk = 0; o.sessions = 0; }
      if (d.kind === 'shelf' || d.kind === 'fridge' || d.kind === 'foodbar') { o.product = null; o.stock = 0; }
      s.objects.push(o);
      w.bump();
      return ok();
    }
    case 'moveObj': {
      const o = w.obj(a.id); if (!o || o.item === 'office') return no('Can’t move that');
      if (inUse(w, o.id)) return no('Someone is using it');
      if (!o.wall) { const why = placeBlocked(s, o.item, a.x, a.z, a.rot, o.id, a.fl || 0); if (why) return no(why); }
      o.x = a.x; o.z = a.z; o.rot = a.rot & 3; if (o.wall && a.y != null) o.y = a.y;
      const fl = o.wall ? floorOfY(o.y ?? 1.8) : a.fl || 0;
      if (fl > 0) o.fl = fl; else delete o.fl;
      w.bump();
      return ok();
    }
    case 'pickupObj': {
      const o = w.obj(a.id); if (!o || o.item === 'office') return no('Can’t pick that up');
      if (inUse(w, o.id)) return no('Someone is using it');
      s.objects.splice(s.objects.indexOf(o), 1);
      returnObject(w, o);
      w.bump();
      return ok(`${ITEM[o.item].name} → inventory`);
    }
    case 'sell': {
      const o = w.obj(a.id); if (!o || o.item === 'office') return no('Can’t sell that');
      if (inUse(w, o.id)) return no('Someone is using it');
      if (o.item === 'st_laptop' && s.objects.filter(x => ITEM[x.item]?.kind === 'station').length <= 1) return no('Keep at least one station');
      s.objects.splice(s.objects.indexOf(o), 1);
      const v = Math.round(ITEM[o.item].price * ECON.sellBack);
      s.money += v;
      returnComponents(w, o);
      returnStock(w, o);
      w.bump();
      return ok(`Sold for $${v}`);
    }
    case 'sellInv': {
      if (!(s.inventory[a.item] > 0)) return no('Not in your inventory');
      s.inventory[a.item]--; if (!s.inventory[a.item]) delete s.inventory[a.item];
      const v = Math.round(ITEM[a.item].price * ECON.sellBack);
      s.money += v; w.bump();
      return ok(`Sold for $${v}`);
    }
    case 'install': {
      const o = w.obj(a.id), d = ITEM[a.item];
      if (!o || !d || d.kind !== 'component') return no('Can’t install that');
      const sd = ITEM[o.item];
      if (sd?.kind !== 'station') return no('Install it on a gaming station');
      if (d.slot === 'mon' && (sd.build !== 'station' || sd.tier === 0)) return no('Laptops can’t take a monitor');
      if (sd.build === 'console' && d.slot !== 'chair') return no('Consoles only take chair upgrades');
      if (sd.build === 'racing' || sd.build === 'vr') return no(`The ${sd.name} comes fully kitted`);
      if (sd.kitted && d.slot !== 'chair') return no(`The ${sd.name} only takes chair upgrades`);
      if (!(s.inventory[a.item] > 0)) return no('Not in your inventory');
      if (inUse(w, o.id)) return no('Someone is using it');
      const slot = d.slot!;
      const old = (o as any)[slot] || 0;
      if (old === d.slotTier) return no('Already installed');
      s.inventory[a.item]--; if (!s.inventory[a.item]) delete s.inventory[a.item];
      if (old > 0) { const back = componentId(slot, old); if (back) s.inventory[back] = (s.inventory[back] || 0) + 1; }
      (o as any)[slot] = d.slotTier;
      w.bump();
      return ok(`${d.name} installed!`);
    }
    case 'grabBox': {
      const b = w.box(a.id); if (!b || b.at) return no('Not here yet');
      if (b.carrier && b.carrier !== by) return no('Someone is carrying it');
      if (s.boxes.some(x => x.carrier === by && x.id !== b.id)) return no('Hands full');
      b.carrier = by; w.bump();
      return ok();
    }
    case 'dropBox': {
      const b = w.box(a.id); if (!b || b.carrier !== by) return no('Not carrying that');
      b.carrier = null; b.x = a.x; b.z = a.z; b.ry = a.ry;
      if (a.fl) b.fl = a.fl; else delete b.fl;
      b.y = stackHeight(w, b);
      w.bump();
      return ok();
    }
    case 'unbox': {
      const b = w.box(a.id); if (!b || b.product || b.empty) return no('Nothing to unbox');
      if (b.carrier && b.carrier !== by) return no('Someone is carrying it');
      s.boxes.splice(s.boxes.indexOf(b), 1);
      s.inventory[b.item] = (s.inventory[b.item] || 0) + 1;
      w.bump();
      return ok(`${ITEM[b.item].name} → inventory (Tab)`);
    }
    case 'stock': {
      const b = w.box(a.box), o = w.obj(a.obj);
      if (!b || !o || b.carrier !== by) return no('Carry a stock box first');
      const sd = ITEM[o.item], pd = ITEM[b.item];
      if (!pd?.product || b.empty || b.count <= 0) return no('The box is empty');
      if (sd.accepts !== pd.product.place) return no(placeHint(pd.product.place));
      if (o.product && o.product !== b.item && (o.stock || 0) > 0) return no('This shelf holds ' + ITEM[o.product].name);
      if ((o.stock || 0) >= (sd.capacity || 0)) return no('Shelf is full');
      o.product = b.item; o.stock = (o.stock || 0) + 1; b.count--;
      if (b.count <= 0) { b.count = 0; b.empty = true; }
      sim?.addXp(XP.restock);
      w.bump();
      return ok();
    }
    case 'unstock': {
      const o = w.obj(a.obj); if (!o || !o.stock) return no('Nothing to take');
      const carried = s.boxes.find(b => b.carrier === by);
      if (!carried || (carried.item !== o.product && !carried.empty) || !carried.product) return no('Carry a matching box');
      carried.item = o.product!; carried.empty = false; carried.count++; o.stock!--; if (!o.stock) o.product = null;
      w.bump();
      return ok();
    }
    case 'binBox': {
      const b = w.box(a.box); if (!b || b.carrier !== by) return no('Not carrying a box');
      if (!b.empty) return no('Only empty boxes go in the bin');
      s.boxes.splice(s.boxes.indexOf(b), 1); w.bump();
      return ok();
    }
    case 'toggleOpen': {
      if (s.dayOver) return no('The day is over');
      if (!s.open && s.time >= ECON.dayEnd) return no('Too late — it’s past closing time');
      s.open = !s.open; w.bump();
      if (s.open && s.tutorial < 2) s.tutorial = 2;
      return ok(s.open ? '🟢 Shop is OPEN!' : '🔴 Shop closed — no new customers.');
    }
    case 'clean': {
      const ti = s.trash.findIndex(t => t.id === a.id);
      if (ti >= 0) { s.trash.splice(ti, 1); s.today.cleaned++; s.lifetime.cleaned++; sim?.addXp(XP.clean); w.bump(); return ok(); }
      const b = w.box(a.id);
      if (b && b.empty && !b.carrier) { s.boxes.splice(s.boxes.indexOf(b), 1); w.bump(); return ok(); }
      return no('Already clean');
    }
    case 'repair': {
      const o = w.obj(a.id); if (!o || !o.broken) return no('Not broken');
      o.broken = false; s.today.repaired++; sim?.addXp(XP.repair); w.bump();
      return ok('🔧 Fixed!');
    }
    case 'scan': {
      const c = w.cust(a.cust); if (!c || c.state !== 'atCounter') return no('Nothing to scan');
      if (c.scanned < c.cart.length) { c.scanned++; w.bump(); }
      return ok();
    }
    case 'card': {
      const c = w.cust(a.cust); if (!c || c.state !== 'paying' || c.pay !== 'card') return no('Not paying by card');
      sim?.completeCheckout(c, null);
      return ok();
    }
    case 'change': {
      const c = w.cust(a.cust); if (!c || c.state !== 'paying' || c.pay !== 'cash') return no('Not paying cash');
      sim?.completeCheckout(c, Math.max(0, Math.round(a.amount)));
      return ok();
    }
    case 'useRegister': {
      for (const [k, v] of w.registerUser) if (v === by) w.registerUser.delete(k);
      if (a.id) {
        const cur = w.registerUser.get(a.id);
        if (cur && cur !== by) return no('Someone else is on this register');
        w.registerUser.set(a.id, by);
      }
      return ok();
    }
    case 'price': {
      const d = ITEM[a.product]; if (!d?.product) return no('Unknown product');
      s.prices[a.product] = clamp(Math.round(a.value), 1, d.product.market * 4); w.bump();
      return ok();
    }
    case 'sessionPrice': s.sessionPrice = clamp(Math.round(a.value), 5, 80); w.bump(); return ok();
    case 'hire': {
      const r = STAFF.find(x => x.id === a.role); if (!r) return no('Unknown role');
      if (r.level > s.level) return no(`Reach level ${r.level}`);
      if (s.staff.filter(x => x.role === r.id).length >= MAX_STAFF_PER_ROLE) return no('That team is full');
      const used = new Set(s.staff.map(x => x.name));
      s.staff.push({ id: uid('e'), role: r.id, name: pick(STAFF_NAMES.filter(n => !used.has(n)).concat(['Pat'])), body: Math.random() < 0.5 ? 'male' : 'female' });
      w.bump();
      return ok(`Hired a ${r.name.toLowerCase()} ($${r.wage}/day)`);
    }
    case 'train': {
      const m = s.staff.find(x => x.id === a.id); if (!m) return no('Not on staff');
      const lvl = m.lvl || 1;
      if (lvl >= STAFF_SKILL.max) return no(`${m.name} is already a pro`);
      const cost = STAFF_SKILL.train(lvl);
      if (s.money < cost) return no('Not enough money');
      s.money -= cost; s.today.spentItems += cost; m.lvl = lvl + 1; m.xp = 0; w.bump();
      return ok(`🎓 ${m.name} finished training: skill level ${m.lvl}!`);
    }
    case 'fire': {
      const i = s.staff.findIndex(x => x.id === a.id); if (i < 0) return no('Not on staff');
      s.staff.splice(i, 1); w.bump();
      return ok('Let go. Thanks for the hard work!');
    }
    case 'expand': {
      const next = EXPANSIONS[s.expansion + 1]; if (!next) return no('Already at the biggest lot');
      if (next.level > s.level) return no(`Reach level ${next.level}`);
      if (s.money < next.price) return no('Not enough money');
      s.money -= next.price; s.today.spentItems += next.price;
      s.expansion++;
      const off = s.objects.find(o => o.item === 'office');
      if (off) { const p = officeSpot(s.expansion); off.x = p.x; off.z = p.z; }
      const moved = clearReserved(s, o => returnObject(w, o));
      w.bump();
      const { w: ww, d } = shopSize(s);
      return ok(`🏗️ Shop expanded to ${ww}×${d} m!${moved ? ` ${moved} item${moved > 1 ? 's were' : ' was'} in the way and went to your inventory.` : ''}`);
    }
    case 'buildFloor': {
      const nx = nextStorey(s);
      if (!nx) return no('Your shop is as tall as it gets');
      if (nx.n > maxFloors(s)) return no('Rebirth to build higher than 4 floors');
      if (s.expansion < 1) return no('Expand the lot once first (room for the stairs)');
      if (nx.level > s.level) return no(`Reach level ${nx.level}`);
      if (s.money < nx.price) return no('Not enough money');
      s.money -= nx.price; s.today.spentItems += nx.price; s.floors = nx.n;
      const moved = clearReserved(s, o => returnObject(w, o));
      w.bump();
      return ok(`🏗️ Floor ${nx.n} is built! Take the stairs in the back-left corner.${moved ? ` ${moved} item${moved > 1 ? 's' : ''} moved to your inventory to make room.` : ''}`);
    }
    case 'buyElevator': {
      if (s.elevator) return no('You already have an elevator');
      if ((s.floors || 1) < 2) return no('Build a second floor first');
      if (ELEVATOR.level > s.level) return no(`Reach level ${ELEVATOR.level}`);
      if (s.money < ELEVATOR.price) return no('Not enough money');
      s.money -= ELEVATOR.price; s.today.spentItems += ELEVATOR.price; s.elevator = true;
      const moved = clearReserved(s, o => returnObject(w, o));
      w.bump();
      return ok(`🛗 Elevator installed next to the stairs!${moved ? ` ${moved} item${moved > 1 ? 's' : ''} moved to your inventory.` : ''}`);
    }
    case 'rebirth': {
      const max = maxFloors(s);
      if ((s.floors || 1) < max) return no(`Build all ${max} floors first`);
      const keep = {
        id: s.id, createdAt: s.createdAt, shopName: s.shopName, day: s.day, rebirths: (s.rebirths || 0) + 1,
        regulars: s.regulars, achievements: s.achievements, ownedStyles: s.ownedStyles, floor: s.floor, wall: s.wall, light: s.light,
        lifetime: s.lifetime, reviews: s.reviews.slice(-10), tutorial: 99,
      };
      Object.assign(s, newSave(s.shopName), keep);
      s.money = ECON.startMoney + REBIRTH.startMoney * s.rebirths;
      s.today = emptyDay(); s.goals = rollGoals(s);
      if (sim) for (const c of [...w.customers]) sim.leave(c, null);
      w.customers.length = 0; w.seatUse.clear(); w.queues.clear(); w.registerUser.clear();
      w.bump();
      return ok(`💎 Rebirth #${s.rebirths}! Income +${Math.round(REBIRTH.income * 100 * s.rebirths)}% and XP +${Math.round(REBIRTH.xp * 100 * s.rebirths)}% forever, and you can now build up to 7 floors.`);
    }
    case 'style': {
      const list = a.kind === 'floor' ? FLOORS : a.kind === 'wall' ? WALLS : LIGHTS;
      const st = list.find(x => x.id === a.id); if (!st) return no('Unknown style');
      if (!s.ownedStyles.includes(st.id)) {
        if (st.level > s.level) return no(`Reach level ${st.level}`);
        if (s.money < st.price) return no('Not enough money');
        s.money -= st.price; s.today.spentItems += st.price; s.ownedStyles.push(st.id);
      }
      (s as any)[a.kind] = st.id; w.bump();
      return ok();
    }
    case 'shopName': {
      const n = String(a.name || '').replace(/[^\p{L}\p{N} '&!._-]/gu, '').trim().slice(0, 24);
      if (!n) return no('Pick a name');
      s.shopName = n; w.bump();
      return ok('Sign updated!');
    }
    case 'license': {
      const l = LICENSES.find(x => x.id === a.id); if (!l) return no('Unknown license');
      if (s.licenses.includes(l.id)) return no('Already licensed');
      if (l.level > s.level) return no(`Reach level ${l.level}`);
      if (s.money < l.price) return no('Not enough money');
      s.money -= l.price; s.today.spentItems += l.price; s.licenses.push(l.id); w.bump();
      return ok(`📜 ${l.name} acquired!`);
    }
    case 'perk': {
      if (s.pendingPerks <= 0) return no('No perk to pick');
      if (!PERKS.find(p => p.id === a.id) || s.perks.includes(a.id)) return no('Pick another perk');
      s.perks.push(a.id); s.pendingPerks--; w.bump();
      return ok();
    }
    case 'catch': {
      const c = w.cust(a.cust); if (!c || c.state !== 'steal') return no('Too late');
      const p = w.players.get(by);
      if (p && dist(p, c) > 2.6) return no('Get closer!');
      sim?.catchThief(c);
      return ok();
    }
    case 'cook': {
      const o = w.obj(a.obj); if (!o || ITEM[o.item]?.kind !== 'foodbar') return no('Not a snack bar');
      if (o.broken) return no('Repair it first');
      if (!(o.stock || 0)) return no('Out of food supplies');
      if (!sim?.foodHead(o.id)) return no('Nobody is waiting');
      sim.serveMeal(o.id);
      return ok();
    }
    case 'nextDay': sim?.nextDay(); return ok();
    case 'cheat': {
      if (a.what === 'money') s.money += a.n || 1000;
      if (a.what === 'xp') sim?.addXp(a.n || 100);
      if (a.what === 'time') s.time = Math.min(ECON.dayEnd, s.time + (a.n || 60));
      if (a.what === 'customer') sim?.spawnCustomer((a as any).type);
      if (a.what === 'trash') { const { w: ww, d } = shopSize(s); s.trash.push({ id: uid('t'), kind: Math.random() < 0.5 ? 'trash' : 'spill', x: rand(-ww / 2 + 1, ww / 2 - 1), z: rand(-d + 1, -1.5), ry: rand(0, 6) }); }
      if (a.what === 'break') { const st = s.objects.filter(o => ITEM[o.item]?.kind === 'station'); if (st.length) pick(st).broken = true; }
      if (a.what === 'endday') { s.time = ECON.dayEnd; s.open = false; for (const c of [...w.customers]) sim?.leave(c, null); w.customers.length = 0; sim?.finishDay(); }
      if (a.what === 'licenses') { s.licenses = LICENSES.map(l => l.id); }
      if (a.what === 'floors') { s.floors = Math.min(7, Math.max(1, a.n || 4)); clearReserved(s, o => returnObject(w, o)); }
      w.bump();
      return ok('cheat: ' + a.what);
    }
  }
  return no('Unknown action');
}

export const placeHint = (place: string) => place === 'fridge' ? 'Drinks go in a fridge' : place === 'foodbar' ? 'Food supplies go in the Snack Bar' : 'This goes on a shelf';

export function inUse(w: World, id: string) {
  if ((w.seatUse.get(id) || []).some(Boolean)) return true;
  if (w.customers.some(c => c.target === id || c.queueAt === id)) return true;
  return false;
}
function componentId(slot: string, tier: number) {
  return { mon: ['', 'mon_2', 'mon_3', 'mon_4'], chair: ['', 'ch_2', 'ch_3', 'ch_4'], desk: ['', 'dk_2', 'dk_3'] }[slot]?.[tier] || null;
}
/** an object leaving the floor: the item, its upgrades and its stock go back to you */
export function returnObject(w: World, o: PlacedObject) {
  w.save.inventory[o.item] = (w.save.inventory[o.item] || 0) + 1;
  returnComponents(w, o);
  returnStock(w, o);
}
function returnComponents(w: World, o: any) {
  for (const slot of ['mon', 'chair', 'desk']) if (o[slot] > 0) { const id = componentId(slot, o[slot]); if (id) w.save.inventory[id] = (w.save.inventory[id] || 0) + 1; }
}
function returnStock(w: World, o: any) {
  if (!o.product || !o.stock) return;
  const p = boxSlot(w);
  w.save.boxes.push({ id: uid('b'), item: o.product, count: o.stock, x: p.x, z: p.z, y: p.y, ry: 0, at: 0, carrier: null, product: true });
}
function stackHeight(w: World, b: { id: string; x: number; z: number }) {
  let y = 0;
  const fl = (b as any).fl || 0;
  for (const o of w.save.boxes) if (o.id !== b.id && !o.carrier && (o.fl || 0) === fl && Math.abs(o.x - b.x) < 0.42 && Math.abs(o.z - b.z) < 0.42) y = Math.max(y, (o.y || 0) + 0.56);
  return Math.min(y, 1.7);
}
export { footprint };
