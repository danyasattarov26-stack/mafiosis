/*
  Host-side simulation: the clock, walk-ins, customer behaviour, staff, deliveries, mess, breakdowns,
  money, XP, reviews and the end-of-day summary. Only the host (or a solo player) runs this.
*/
import { ECON, EXPANSIONS, PERKS, STAFF, xpForLevel, XP, LICENSES } from '../config/economy';
import { ITEM, ITEMS, PRODUCTS, MEALS, MEAL } from '../config/items';
import { CUSTOMERS, REVIEW_LINES, REGULARS, REGULAR, hearts, type CustomerType } from '../config/npcs';
import { GOAL, ACHIEVEMENTS, rollGoals } from '../config/goals';
import { emptyDay, type PlacedObject, type Box } from '../core/save';
import { clamp, pick, rand, chance, uid, angleDelta } from '../core/util';
import { preset } from '../core/settings';
import { World, type Customer, type StaffNpc, type DaySummary, type Anim } from './world';
import { useSpots, seats, counterSpots, foodSpots, deliveryZone, shopSize, dist, DOOR, SIDEWALK_Z, type V2 } from './layout';

const has = (w: World, perk: string) => w.save.perks.includes(perk);
const svc = (w: World, s: string) => w.save.services.includes(s);
const kindOf = (o: PlacedObject) => ITEM[o.item]?.kind;
const SHOUTS = ['📢', '😱', '🔥', '💬', '🤬', '🏆', '😂', '❤️', '🎉', '💀'];
const PLAY_ANIM: Record<string, Anim> = { racing: 'drive', vr: 'vr' };

export class Sim {
  w: World;
  clock = 0;              // real seconds since the sim started
  private spawnT = 3;
  private vendT = 0;
  private claims = new Set<string>();
  private shoutT = new Map<string, number>();
  private followers: { at: number; from: string }[] = [];
  private goalT = 0;

  constructor(w: World) { this.w = w; }

  // ---------- derived numbers ----------
  rating() {
    const r = this.w.save.reviews.slice(-30);
    if (!r.length) return 3.5;
    return r.reduce((a, b) => a + b.stars, 0) / r.length;
  }
  appeal() {
    let a = 0;
    for (const o of this.w.save.objects) {
      const d = ITEM[o.item]; if (!d) continue;
      a += d.appeal || 0;
      if (d.kind === 'station') a += (o.mon || 0) * 2 + (o.desk || 0) * 3;
    }
    return Math.min(60, a);
  }
  dirt() { return this.w.save.trash.length + this.w.save.boxes.filter(b => b.empty && !b.carrier).length * 0.5; }
  sessionPrice(o: PlacedObject) {
    const d = ITEM[o.item];
    return Math.round(this.w.save.sessionPrice * (d.priceMul || 1) * (1 + 0.1 * (o.mon || 0)) * (has(this.w, 'charisma') ? 1.1 : 1));
  }
  fairSession(o: PlacedObject) { const d = ITEM[o.item]; return ECON.sessionBase * (d.priceMul || 1) * (1 + 0.1 * (o.mon || 0)); }
  productPrice(p: string) { return this.w.save.prices[p] ?? ITEM[p].product!.market; }
  power() { return this.w.save.objects.reduce((a, o) => a + (ITEM[o.item]?.power || 0), 0); }
  rent() { return Math.round(EXPANSIONS[this.w.save.expansion].rent * (has(this.w, 'landlord') ? 0.75 : 1)); }
  wages() { return this.w.save.staff.reduce((a, s) => a + (STAFF.find(r => r.id === s.role)?.wage || 0), 0); }

  // ---------- main tick ----------
  tick(dt: number) {
    const w = this.w, s = w.save;
    this.clock += dt;
    // clock: waits at opening time until the sign is flipped
    if (!s.dayOver) {
      const waiting = !s.open && s.time <= ECON.dayStart;
      if (!waiting && s.time < ECON.dayEnd) {
        s.time = Math.min(ECON.dayEnd, s.time + (dt / ECON.secPerGameMinute) * (s.open ? 1 : 3));
      }
      if (s.time >= ECON.dayEnd && s.open) { s.open = false; w.ev.emit('toast', { msg: 'It’s 22:00 — closing time! Finish up with the last customers.', kind: 'info' }); w.bump(); }
      if (s.time >= ECON.dayEnd && !w.customers.length) this.finishDay();
    }
    // deliveries
    let arrived = 0;
    for (const b of s.boxes) if (b.at && b.at <= this.clock) { b.at = 0; arrived++; }
    if (arrived) { w.bump(); w.ev.emit('toast', { msg: `📦 Delivery arrived (${arrived} box${arrived > 1 ? 'es' : ''}) — in the delivery zone by the door.`, kind: 'info' }); const z = deliveryZone(s); w.ev.emit('sfx', { name: 'thud', x: z.x0 + 1, z: z.z0 + 1 }); }
    // walk-ins
    if (s.open && s.time < ECON.lastEntry) {
      this.spawnT -= dt * this.spawnRate();
      if (this.spawnT <= 0) { this.spawnT = ECON.spawnEvery * rand(0.6, 1.4); this.spawnCustomer(); }
    }
    // vending machines sell drinks on their own
    if (s.open) {
      this.vendT -= dt;
      if (this.vendT <= 0) {
        this.vendT = rand(18, 30);
        for (const o of s.objects) if (ITEM[o.item]?.kind === 'vending' && chance(0.7)) { const a = Math.round(rand(2, 4)); this.earn(a, 'vending', o.x, o.z); }
      }
    }
    // followers of a live streamer come to watch
    for (const f of [...this.followers]) if (f.at <= this.clock) {
      this.followers.splice(this.followers.indexOf(f), 1);
      if (!s.open) continue;
      const types = (['casual', 'pro', 'kid'] as CustomerType[]).filter(t => CUSTOMERS[t].level <= s.level);
      const c = this.spawnCustomer(pick(types), true);
      if (c) { c.bubble = '📱'; w.ev.emit('toast', { msg: `📱 One of ${f.from}'s viewers came to check out the shop!`, kind: 'good' }); }
    }
    this.goalT -= dt;
    if (this.goalT <= 0) { this.goalT = 1; this.checkGoals(); }
    for (const c of [...w.customers]) this.updateCustomer(c, dt);
    for (const st of w.staff) this.updateStaff(st, dt);
    this.syncStaffRoster();
  }

  spawnRate() {
    const s = this.w.save, h = s.time / 60;
    const tod = h < 10 ? 0.6 : h < 12 ? 0.9 : h < 14 ? 1.3 : h < 17 ? 1.0 : h < 20 ? 1.4 : 0.9;
    const r = this.rating();
    let m = (0.5 + r * 0.17) * (1 + this.appeal() / 70) * tod * (1 + 0.05 * (s.level - 1));
    if (has(this.w, 'popular')) m *= 1.15;
    if (svc(this.w, 'ads')) m *= 1.25;
    m *= Math.max(0.4, 1 - this.dirt() * 0.04);
    const stations = s.objects.filter(o => ITEM[o.item]?.kind === 'station').length;
    m *= clamp(0.55 + stations * 0.22, 0.6, 2.2);
    m *= 1 + 0.35 * this.w.customers.filter(c => c.live).length;   // viewers drop by
    return m;
  }

  // ---------- customers ----------
  hasBuild(build: string) { return this.w.save.objects.some(o => ITEM[o.item]?.build === build); }
  spawnCustomer(type?: CustomerType, force = false, regularId?: string) {
    const w = this.w, s = w.save;
    const cap = Math.min(preset().maxCustomers, 6 + s.objects.length * 2);
    if (!type && !force && w.customers.length >= cap) return null;
    const pod = this.hasBuild('pod');
    // sometimes a named regular walks in instead of a stranger
    let reg = regularId ? REGULAR[regularId] : null;
    if (!type && !reg && s.level >= 2 && chance(0.13)) {
      const here = new Set(w.customers.map(c => c.regular));
      // once a day each (VIPs sometimes twice)
      const cand = REGULARS.filter(r => CUSTOMERS[r.type].level <= s.level && !here.has(r.id) && (r.type !== 'streamer' || pod) && (s.regulars[r.id]?.lastDay !== s.day || (s.regulars[r.id]?.vip && chance(0.3))));
      const wt = (r: typeof REGULARS[number]) => (s.regulars[r.id]?.vip ? 2 : 1);
      let x = Math.random() * cand.reduce((a, r) => a + wt(r), 0);
      for (const r of cand) { x -= wt(r); if (x <= 0) { reg = r; break; } }
    }
    const pool = Object.values(CUSTOMERS).filter(c => c.level <= s.level && (c.id !== 'streamer' || pod));
    if (reg) type = reg.type;
    let t = type ? CUSTOMERS[type] : pool[0];
    if (!type) { let r = Math.random() * pool.reduce((a, b) => a + b.weight, 0); for (const c of pool) { r -= c.weight; if (r <= 0) { t = c; break; } } }
    const side = chance(0.5) ? -1 : 1;
    const c: Customer = {
      id: uid('c'), type: t.id, model: pick(t.models), tint: Math.floor(Math.random() * 6),
      x: side * rand(9, 14), z: SIDEWALK_Z + rand(-0.3, 0.3), y: 0, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2, anim: 'walk',
      state: 'enter', t: 0, tMax: 0, patience: 0, path: [], speed: t.speed * rand(0.9, 1.1),
      target: null, seat: -1, plan: [], cart: [], scanned: 0, pay: 'card', given: 0,
      sat: reg ? 76 : 72, reasons: [], progress: 0, bubble: '', queueAt: null, after: null, order: null, regular: reg ? reg.id : null,
    };
    if (reg) {
      c.model = reg.model; c.tint = reg.tint;
      const st = s.regulars[reg.id] ||= { love: 0, visits: 0, lastDay: 0 };
      st.visits++; st.lastDay = s.day; s.today.regulars++;
      w.ev.emit('toast', { msg: `👋 ${reg.name} ${st.visits > 1 ? 'is back' : 'walked in for the first time'}!${st.vip ? ' 💳 VIP' : ''}`, kind: 'info' });
    }
    c.path = [{ x: DOOR.outside.x + rand(-0.3, 0.3), z: DOOR.outside.z }, { x: 0, z: -0.4 }, { x: rand(-0.6, 0.6), z: DOOR.inside.z - 0.3 }];
    w.customers.push(c);
    w.ev.emit('sfx', { name: 'door', x: 0, z: 0 });
    return c;
  }

  private walk(e: { x: number; z: number; ry: number; path: V2[]; anim: string }, speed: number, dt: number) {
    if (!e.path.length) return true;
    const p = e.path[0];
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
    const step = speed * dt;
    if (d <= step + 0.02) { e.x = p.x; e.z = p.z; e.path.shift(); return !e.path.length; }
    e.x += (dx / d) * step; e.z += (dz / d) * step;
    const want = Math.atan2(dx, dz);
    e.ry += angleDelta(e.ry, want) * Math.min(1, dt * 10);
    return false;
  }
  private goTo(c: Customer | StaffNpc, to: V2, state: string) {
    c.path = this.w.nav.route({ x: c.x, z: c.z }, to);
    c.state = state; c.anim = 'walk';
  }

  private stocked() { return new Set(this.w.save.objects.filter(o => (kindOf(o) === 'shelf' || kindOf(o) === 'fridge') && o.product && (o.stock || 0) > 0).map(o => o.product!)); }
  private decide(c: Customer) {
    const def = CUSTOMERS[c.type];
    const s = this.w.save;
    const canShop = s.objects.some(o => ITEM[o.item]?.kind === 'counter') && s.objects.some(o => (ITEM[o.item]?.kind === 'shelf' || ITEM[o.item]?.kind === 'fridge') && (o.stock || 0) > 0);
    if (c.regular) {
      const r = REGULAR[c.regular], st = s.regulars[c.regular];
      if (st && !st.wish && this.stocked().has(r.wish)) {
        st.wish = true; st.love = (st.love || 0) + 12;
        this.w.ev.emit('toast', { msg: `✨ ${r.name} is thrilled you stock ${ITEM[r.wish].name}! (+💛)`, kind: 'good' });
      }
      if (canShop && this.stocked().has(r.fav) && chance(0.35) && this.wantShop(c, r.fav)) return true;
    }
    if (c.type !== 'streamer' && chance(c.type === 'kid' ? 0.2 : 0.12) && this.wantFood(c)) return true;
    const hasArcade = s.objects.some(o => ITEM[o.item]?.kind === 'arcade' && !o.broken);
    let r = Math.random();
    const wants = { ...def.wants };
    if (!canShop) wants.shop = 0;
    if (!hasArcade) wants.arcade = 0;
    const tot = wants.play + wants.arcade + wants.shop || 1;
    r *= tot;
    if (r < wants.play) return this.wantPlay(c);
    r -= wants.play;
    if (r < wants.arcade) return this.wantArcade(c) || this.wantPlay(c);
    if (canShop) return this.wantShop(c) || this.wantPlay(c);
    return this.wantPlay(c);
  }

  private stationCandidates(c: Customer) {
    const def = CUSTOMERS[c.type];
    const list: { o: PlacedObject; seat: number; score: number }[] = [];
    for (const o of this.w.save.objects) {
      const d = ITEM[o.item];
      if (d?.kind !== 'station' || o.broken) continue;
      const use = this.w.seatUse.get(o.id) || [];
      const n = d.seats || 1;
      const price = this.sessionPrice(o), fair = this.fairSession(o);
      if (price > fair * def.priceTolerance * 1.15) continue;
      for (let i = 0; i < n; i++) if (!use[i]) {
        let score = (d.tier || 0) * (c.type === 'pro' ? 3 : 1) + (o.chair || 0) + rand(0, 1.5);
        if (c.type === 'kid' && d.build === 'console') score += 3;
        if (d.build === 'pod') score += c.type === 'streamer' ? 14 : -3;       // leave the pod for streamers
        else if (c.type === 'streamer') score -= 4;
        if (d.build === 'racing') score += c.type === 'pro' ? 3 : c.type === 'spender' ? 2 : 0.5;
        if (d.build === 'vr') score += c.type === 'kid' ? 2.5 : c.type === 'spender' ? 3 : 1;
        if (d.build === 'retro') score += c.type === 'kid' ? 2.5 : c.type === 'casual' ? 1.5 : c.type === 'pro' ? -3 : 0;
        list.push({ o, seat: i, score });
      }
    }
    return list.sort((a, b) => b.score - a.score);
  }
  private reserve(o: PlacedObject, seat: number, c: Customer) {
    const use = this.w.seatUse.get(o.id) || [];
    use[seat] = c.id; this.w.seatUse.set(o.id, use);
    c.target = o.id; c.seat = seat;
  }
  release(c: { id: string; target: string | null; seat: number }) {
    if (!c.target) return;
    const use = this.w.seatUse.get(c.target);
    if (use && use[c.seat] === c.id) use[c.seat] = null;
    c.target = null; c.seat = -1;
  }

  private wantPlay(c: Customer): boolean {
    const s = this.w.save;
    const anyStation = s.objects.some(o => ITEM[o.item]?.kind === 'station');
    if (!anyStation) { this.leave(c, 'nothing to play', -25); return true; }
    const cand = this.stationCandidates(c);
    if (cand.length) {
      const best = cand[0];
      this.reserve(best.o, best.seat, c);
      const spot = useSpots(best.o)[Math.min(best.seat, useSpots(best.o).length - 1)];
      this.goTo(c, spot, 'toSeat');
      c.bubble = '🎮';
      return true;
    }
    // queue for a free station
    const spots = this.waitSpots();
    const taken = this.w.customers.filter(x => x.state === 'wait' || x.state === 'toWait').length;
    if (taken >= spots.length) { this.leave(c, 'wait', -20); return true; }
    c.patience = ECON.queuePatience + (has(this.w, 'patience') ? 6 : 0);
    this.goTo(c, spots[taken], 'toWait');
    c.bubble = '⌛';
    return true;
  }
  waitSpots(): V2[] {
    const { w } = shopSize(this.w.save);
    const out: V2[] = [];
    for (const x of [1.7, 2.5, 3.3, 4.1, -1.7]) for (const z of [-0.8, -1.6]) if (Math.abs(x) < w / 2 - 0.4) out.push({ x, z });
    return out;
  }

  private wantArcade(c: Customer): boolean {
    const list = this.w.save.objects.filter(o => ITEM[o.item]?.kind === 'arcade' && !o.broken && !(this.w.seatUse.get(o.id) || [])[0]);
    if (!list.length) return false;
    const o = pick(list);
    this.reserve(o, 0, c);
    this.goTo(c, useSpots(o)[0], 'toArcade');
    c.bubble = '🕹️';
    return true;
  }

  private wantShop(c: Customer, fav?: string): boolean {
    const def = CUSTOMERS[c.type];
    const stocked = this.stocked();
    if (!stocked.size) return false;
    const n = Math.round(rand(def.items[0], def.items[1]));
    const liked = def.likes.filter(p => stocked.has(p));
    const plan: string[] = fav ? [fav] : [];
    for (let i = plan.length; i < n; i++) plan.push(liked.length && chance(0.75) ? pick(liked) : pick([...stocked]));
    c.plan = plan;
    c.bubble = '🛒';
    return this.nextShelf(c);
  }
  private nextShelf(c: Customer): boolean {
    while (c.plan.length) {
      const p = c.plan[0];
      const shelves = this.w.save.objects.filter(o => o.product === p && (o.stock || 0) > 0 && kindOf(o) !== 'foodbar');
      if (!shelves.length) { c.plan.shift(); c.sat -= 8; c.reasons.push('stock'); continue; }
      shelves.sort((a, b) => dist(a, c) - dist(b, c));
      const o = shelves[0];
      const spots = useSpots(o);
      const spot = spots.sort((a, b) => dist(a, c) - dist(b, c))[0];
      c.target = o.id;
      this.goTo(c, spot, 'toShelf');
      return true;
    }
    c.target = null;
    if (c.cart.length) return this.toCheckout(c);
    this.leave(c, 'stock', -15);
    return true;
  }
  private toCheckout(c: Customer): boolean {
    const counters = this.w.save.objects.filter(o => ITEM[o.item]?.kind === 'counter');
    if (!counters.length) { this.leave(c, 'stock', -10); return true; }
    const trouble = CUSTOMERS[c.type].trouble;
    if (trouble && !this.friendly(c) && chance(trouble.steal * (svc(this.w, 'cctv') ? 0.4 : 1))) {
      c.state = 'steal'; c.anim = 'run'; c.bubble = '🏃';
      c.path = this.w.nav.route({ x: c.x, z: c.z }, { x: chance(0.5) ? -20 : 20, z: SIDEWALK_Z });
      return true;
    }
    counters.sort((a, b) => (this.w.queues.get(a.id)?.length || 0) - (this.w.queues.get(b.id)?.length || 0));
    const k = counters[0];
    const q = this.w.queues.get(k.id) || []; q.push(c.id); this.w.queues.set(k.id, q);
    c.queueAt = k.id; c.patience = ECON.checkoutPatience;
    const spot = counterSpots(k).queue(q.length - 1);
    this.goTo(c, spot, 'queue');
    c.bubble = '🧾';
    return true;
  }
  private leaveQueue(c: Customer) {
    if (!c.queueAt) return;
    const q = this.w.queues.get(c.queueAt) || [];
    const i = q.indexOf(c.id); if (i >= 0) q.splice(i, 1);
    c.queueAt = null;
  }

  /** friends of the shop (2+ hearts) behave */
  friendly(c: Customer) { return !!c.regular && hearts(this.w.save.regulars[c.regular]?.love || 0) >= 2; }
  lose() { const t = this.w.today(); t.lost++; t.streakNow = 0; }

  // ---------- snack bar ----------
  foodbars() { return this.w.save.objects.filter(o => kindOf(o) === 'foodbar' && !o.broken); }
  wantFood(c: Customer): boolean {
    const bars = this.foodbars().filter(o => (o.stock || 0) > 0);
    if (!bars.length) return false;
    bars.sort((a, b) => (this.w.queues.get(a.id)?.length || 0) - (this.w.queues.get(b.id)?.length || 0));
    const k = bars[0];
    const q = this.w.queues.get(k.id) || [];
    if (q.length >= 5) return false;
    q.push(c.id); this.w.queues.set(k.id, q);
    const m = c.type === 'kid' ? pick(['pizza', 'slushie', 'slushie']) : c.type === 'pro' ? pick(['noodles', 'slushie', 'pizza']) : pick(MEALS).id;
    c.queueAt = k.id; c.order = m; c.patience = 40; c.bubble = MEAL[m].emoji;
    this.goTo(c, foodSpots(k).queue(q.length - 1), 'foodQ');
    return true;
  }
  mealPrice(meal: string) { return Math.max(1, Math.round(MEAL[meal].price * this.productPrice('pr_food') / ITEM.pr_food.product!.market)); }
  /** the head of this bar's line, if they're waiting for food */
  foodHead(barId: string) {
    const id = (this.w.queues.get(barId) || [])[0];
    const c = id ? this.w.cust(id) : null;
    return c && c.state === 'foodWait' && c.order ? c : null;
  }
  serveMeal(barId: string): boolean {
    const w = this.w, k = w.obj(barId), c = this.foodHead(barId);
    if (!k || !c || !(k.stock || 0)) return false;
    k.stock!--; if (!k.stock) k.product = null;
    const price = this.mealPrice(c.order!);
    if (price > MEAL[c.order!].price * CUSTOMERS[c.type].priceTolerance) { c.sat -= 10; c.reasons.push('price'); }
    else c.sat += 10;
    this.earn(price, 'food', k.x, k.z);
    w.today().meals++; w.save.lifetime.meals++;
    this.addXp(XP.meal);
    c.order = null; c.after = 'eat';
    this.leaveQueue(c);
    w.ev.emit('sfx', { name: 'ding', x: k.x, z: k.z });
    w.bump();
    this.litter(c, 'trash', 0.5);
    if (chance(0.3) && this.wantPlay(c)) { c.after = null; return true; }
    this.leave(c, null);
    c.bubble = '😋';
    return true;
  }

  leave(c: Customer, reason: string | null, satDelta = 0) {
    this.release(c);
    this.leaveQueue(c);
    if (reason) { c.reasons.push(reason); c.sat += satDelta; }
    c.bubble = c.sat >= 70 ? '😊' : c.sat >= 45 ? '😐' : '😠';
    c.state = 'leave'; c.anim = 'walk'; c.order = null; c.live = false;
    c.path = this.w.nav.route({ x: c.x, z: c.z }, { x: chance(0.5) ? -22 : 22, z: SIDEWALK_Z + rand(-0.3, 0.3) });
    if (c.cart.length && c.scanned < c.cart.length) c.cart = [];
  }

  private litter(c: Customer, kind: 'trash' | 'spill', p = 1) {
    const tr = CUSTOMERS[c.type].trouble; if (!tr) return;
    const s = this.w.save;
    let pr = (kind === 'trash' ? tr.litter : tr.spill) * p;
    if (has(this.w, 'tidy')) pr *= 0.65;
    if (s.objects.some(o => ITEM[o.item]?.kind === 'bin' && dist(o, c) < 5)) pr *= 0.5;
    if (!chance(pr)) return;
    const { w, d } = shopSize(s);
    if (c.z > -0.3 || c.z < -d + 0.3 || Math.abs(c.x) > w / 2 - 0.3) return;
    s.trash.push({ id: uid('t'), kind, x: c.x + rand(-0.4, 0.4), z: c.z + rand(-0.4, 0.4), ry: rand(0, 6.28) });
    this.w.bump();
  }

  private updateCustomer(c: Customer, dt: number) {
    const w = this.w, s = w.save;
    const sp = c.speed * (c.state === 'steal' ? 1.7 : 1);
    switch (c.state) {
      case 'enter':
        if (this.walk(c, sp, dt)) this.decide(c);
        break;
      case 'toSeat': {
        const o = c.target ? w.obj(c.target) : null;
        if (!o || o.broken) { this.release(c); this.wantPlay(c); break; }
        if (this.walk(c, sp, dt)) {
          const st = seats(o)[c.seat] || seats(o)[0];
          const d = ITEM[o.item];
          c.x = st.x; c.z = st.z; c.ry = st.ry; c.anim = PLAY_ANIM[d.build || ''] || 'play';
          if (c.type === 'streamer' && d.build === 'pod') {
            c.live = true; s.today.streams++; s.lifetime.streams++;
            this.shoutT.set(c.id, 1);
            const who = c.regular ? REGULAR[c.regular].name : 'A streamer';
            w.ev.emit('toast', { msg: `🔴 ${who} went LIVE in the Streamer Pod!`, kind: 'good' });
            for (let i = 0, n = Math.round(rand(1, 2)); i < n; i++) this.followers.push({ at: this.clock + rand(4, 12), from: c.regular ? REGULAR[c.regular].name : 'the streamer' });
          }
          let T = ECON.playSeconds * (d.playMul || 1);
          if (has(w, 'turbo')) T *= 0.85;
          if (svc(w, 'wifi')) T *= 0.85;
          c.t = c.tMax = T; c.state = 'playing'; c.bubble = '';
        }
        break;
      }
      case 'playing': {
        c.t -= dt; c.progress = 1 - c.t / c.tMax;
        if (c.live) {
          const t = (this.shoutT.get(c.id) || 0) - dt;
          if (t <= 0) { c.bubble = pick(SHOUTS); w.ev.emit('sfx', { name: chance(0.3) ? 'scream' : 'shout', x: c.x, z: c.z }); this.shoutT.set(c.id, rand(1.6, 3.4)); }
          else this.shoutT.set(c.id, t);
        }
        if (c.t <= 0) this.endSession(c);
        break;
      }
      case 'toWait':
        if (this.walk(c, sp, dt)) { c.state = 'wait'; c.anim = 'idle'; }
        // fallthrough check for a free station while walking
        this.checkWaiting(c, dt);
        break;
      case 'wait':
        this.checkWaiting(c, dt);
        break;
      case 'toArcade': {
        const o = c.target ? w.obj(c.target) : null;
        if (!o) { this.release(c); this.leave(c, null); break; }
        if (this.walk(c, sp, dt)) {
          const spot = useSpots(o)[0];
          c.ry = spot.ry; c.anim = 'work'; c.state = 'arcading'; c.t = c.tMax = ECON.arcadeSeconds; c.bubble = '';
        }
        break;
      }
      case 'arcading':
        c.t -= dt; c.progress = 1 - c.t / c.tMax;
        if (c.t <= 0) {
          const o = c.target ? w.obj(c.target) : null;
          const price = o ? ITEM[o.item].arcadePrice || 5 : 5;
          if (o) this.earn(price, 'arcade', o.x, o.z);
          this.addXp(XP.arcade);
          c.sat += 6; c.progress = 0;
          if (o && chance(ITEM[o.item].breakChance || 0)) { o.broken = true; w.bump(); w.ev.emit('toast', { msg: `⚠️ ${ITEM[o.item].name} broke down! Hold E on it to repair.`, kind: 'bad' }); }
          this.release(c);
          this.litter(c, 'trash', 0.6);
          if (chance(0.3) && this.wantShop(c)) break;
          this.leave(c, null);
        }
        break;
      case 'toShelf': {
        if (!this.walk(c, sp, dt)) break;
        const o = c.target ? w.obj(c.target) : null;
        const p = c.plan.shift();
        if (o && p && o.product === p && (o.stock || 0) > 0) {
          const price = this.productPrice(p), market = ITEM[p].product!.market;
          if (price > market * CUSTOMERS[c.type].priceTolerance) { c.sat -= 10; c.reasons.push('price'); c.bubble = '💸'; }
          else {
            o.stock!--; if (o.stock! <= 0) { o.stock = 0; }
            c.cart.push({ p, price });
            w.bump();
            if (ITEM[o.item].kind === 'fridge') this.litter(c, 'spill', 0.5);
          }
        } else if (p) { c.sat -= 8; c.reasons.push('stock'); }
        c.state = 'pick'; c.t = 0.6; c.anim = 'idle';
        if (o) { const spot = useSpots(o).sort((a, b) => dist(a, c) - dist(b, c))[0]; if (spot) c.ry = spot.ry; }
        break;
      }
      case 'pick':
        c.t -= dt;
        if (c.t <= 0) this.nextShelf(c);
        break;
      case 'queue': {
        const k = c.queueAt ? w.obj(c.queueAt) : null;
        if (!k) { this.leaveQueue(c); this.toCheckout(c); break; }
        const q = w.queues.get(k.id) || [];
        const i = q.indexOf(c.id);
        const spot = counterSpots(k).queue(Math.max(0, i));
        if (!c.path.length && dist(c, spot) > 0.15) c.path = [spot];
        if (this.walk(c, sp, dt)) {
          c.ry = spot.ry; c.anim = 'idle';
          if (i === 0) { c.state = 'atCounter'; c.scanned = 0; c.bubble = '🧾'; w.bump(); }
        }
        c.patience -= dt;
        if (c.patience <= 0) { w.ev.emit('toast', { msg: '😠 A customer gave up waiting at the checkout.', kind: 'bad' }); this.leave(c, 'wait', -25); this.lose(); }
        break;
      }
      case 'atCounter':
        c.patience -= dt * 0.5;
        if (c.patience <= -20) { this.leave(c, 'wait', -25); this.lose(); break; }
        if (c.scanned >= c.cart.length && c.cart.length) {
          c.state = 'paying';
          const total = c.cart.reduce((a, b) => a + b.price, 0);
          c.pay = chance(0.55) ? 'card' : 'cash';
          if (c.pay === 'cash') { const bills = [5, 10, 20, 50, 100]; c.given = chance(0.2) ? total : bills.find(b => b >= total) || Math.ceil(total / 100) * 100; }
          c.bubble = c.pay === 'card' ? '💳' : '💵';
          w.bump();
        }
        break;
      case 'paying':
        c.patience -= dt * 0.3;
        break;
      case 'foodQ': case 'foodWait': {
        const k = c.queueAt ? w.obj(c.queueAt) : null;
        if (!k) { this.leaveQueue(c); if (!this.wantFood(c)) this.leave(c, null); break; }
        const q = w.queues.get(k.id) || [];
        const i = q.indexOf(c.id);
        const spot = foodSpots(k).queue(Math.max(0, i));
        if (!c.path.length && dist(c, spot) > 0.15) c.path = [spot];
        if (this.walk(c, sp, dt)) { c.ry = spot.ry; c.anim = 'idle'; if (i === 0 && c.state === 'foodQ') { c.state = 'foodWait'; w.bump(); } }
        c.patience -= dt * (c.state === 'foodWait' ? 0.8 : 1);
        c.progress = c.state === 'foodWait' ? clamp(1 - c.patience / 40, 0, 1) : 0;
        if (c.patience <= 0) { c.progress = 0; w.ev.emit('toast', { msg: `😠 A hungry customer gave up waiting for ${MEAL[c.order || 'pizza'].name.toLowerCase()}.`, kind: 'bad' }); this.leave(c, 'wait', -20); this.lose(); }
        break;
      }
      case 'steal':
        if (this.walk(c, sp, dt)) {
          w.today().thefts++;
          w.ev.emit('toast', { msg: '🏃 A thief got away with your stock!', kind: 'bad' });
          this.remove(c);
        }
        break;
      case 'leave':
        if (this.walk(c, sp, dt)) this.finishCustomer(c);
        break;
    }
    // customers walking through the shop push the anim
    if (c.path.length && c.state !== 'playing' && c.state !== 'arcading') c.anim = c.state === 'steal' ? 'run' : c.after === 'eat' ? 'eat' : 'walk';
  }

  private checkWaiting(c: Customer, dt: number) {
    c.patience -= dt;
    c.progress = 1 - c.patience / (ECON.queuePatience + (has(this.w, 'patience') ? 6 : 0));
    const cand = this.stationCandidates(c);
    // first come first served: only the earliest waiter grabs a seat
    const first = this.w.customers.find(x => x.state === 'wait' || x.state === 'toWait');
    if (cand.length && first === c) {
      c.progress = 0;
      const best = cand[0];
      this.reserve(best.o, best.seat, c);
      const spots = useSpots(best.o);
      this.goTo(c, spots[Math.min(best.seat, spots.length - 1)], 'toSeat');
      c.bubble = '🎮';
      c.sat -= Math.max(0, (ECON.queuePatience - c.patience) * 1.2);
      if (ECON.queuePatience - c.patience > 8) c.reasons.push('wait');
      return;
    }
    if (c.patience <= 0) {
      c.progress = 0;
      this.lose();
      this.w.ev.emit('toast', { msg: '😠 A customer left: no free station.', kind: 'bad' });
      this.leave(c, 'wait', -30);
    }
  }

  private endSession(c: Customer) {
    const w = this.w, o = c.target ? w.obj(c.target) : null;
    c.progress = 0;
    if (o) {
      const d = ITEM[o.item], def = CUSTOMERS[c.type];
      const price = this.sessionPrice(o), fair = this.fairSession(o);
      // satisfaction from the setup, comfort, price and cleanliness
      c.sat += (d.tier || 0) * 4 + (o.mon || 0) * 3 + (o.chair || 0) * 4 + (o.desk || 0) * 2;
      if ((d.tier || 0) < def.minTier) { c.sat -= 15; c.reasons.push('old'); }
      const ratio = price / fair;
      if (ratio > 1.05) { c.sat -= (ratio - 1) * 70; if (ratio > 1.2) c.reasons.push('price'); }
      else if (ratio < 0.95) c.sat += 5;
      c.sat += Math.min(15, this.appeal() / 4) - Math.min(25, this.dirt() * 4);
      if (svc(w, 'ac')) c.sat += 8;
      if (svc(w, 'wifi')) c.sat += 4;
      let tip = 0;
      if (c.sat > 80 && def.payMul > 1) tip = Math.round(Math.min(has(w, 'tips') ? 8 : 4, (c.sat - 80) / 5 * def.payMul));
      else if (has(w, 'tips') && c.sat > 85) tip = Math.round(rand(1, 5));
      if (c.regular && w.save.regulars[c.regular]?.vip) tip += 3;
      if (c.live) tip += Math.round(rand(3, 9) * def.payMul);     // chat donations
      this.earn(price, 'session', o.x, o.z);
      if (tip) this.earn(tip, 'tip', o.x, o.z + 0.3);
      w.today().sessions++; w.save.lifetime.sessions++;
      o.sessions = (o.sessions || 0) + 1;
      this.addXp(XP.session);
      // breakdowns and vandalism
      let br = d.breakChance || 0;
      if (has(w, 'techie')) br *= 0.6;
      const tr = def.trouble;
      const vandal = tr && !this.friendly(c) ? tr.vandal * (svc(w, 'cctv') ? 0.4 : 1) : 0;
      if (chance(br) || chance(vandal)) {
        o.broken = true; w.bump();
        w.ev.emit('toast', { msg: `⚠️ ${d.name} broke down${chance(vandal) ? ' (someone kicked it!)' : ''}. Hold E on it to repair.`, kind: 'bad' });
        w.ev.emit('sfx', { name: 'error', x: o.x, z: o.z });
      }
      // step back out to the front of the station
      const spot = useSpots(o)[Math.min(c.seat, useSpots(o).length - 1)];
      if (spot) { c.x = spot.x; c.z = spot.z; }
    }
    if (c.live) { c.live = false; this.shoutT.delete(c.id); c.bubble = ''; }
    this.release(c);
    this.litter(c, chance(0.7) ? 'trash' : 'spill');
    if (chance(c.type === 'streamer' ? 0.45 : 0.28) && this.wantFood(c)) return;
    if (chance(0.3) && this.wantShop(c)) return;
    if (chance(0.12) && this.wantArcade(c)) return;
    this.leave(c, null);
  }

  /** complete a checkout: card or cash with the change given back */
  completeCheckout(c: Customer, changeGiven: number | null) {
    const w = this.w;
    const total = c.cart.reduce((a, b) => a + b.price, 0);
    let received = total;
    if (c.pay === 'cash' && changeGiven != null) {
      const due = c.given - total;
      received = c.given - changeGiven;
      if (changeGiven < due) { c.sat -= 25; c.reasons.push('change'); w.ev.emit('toast', { msg: `😠 Short-changed by $${due - changeGiven}!`, kind: 'bad' }); }
      else if (changeGiven > due) w.ev.emit('toast', { msg: `Oops — gave $${changeGiven - due} too much change.`, kind: 'bad' });
      else c.sat += 4;
    }
    const k = c.queueAt ? w.obj(c.queueAt) : null;
    this.earn(received, 'sale', k ? k.x : c.x, k ? k.z : c.z);
    w.today().sales += c.cart.length;
    this.addXp(XP.sale * c.cart.length);
    c.sat += 6;
    c.cart = [];
    this.leaveQueue(c);
    this.leave(c, null);
    w.bump();
    w.ev.emit('sfx', { name: 'cash', x: c.x, z: c.z });
  }

  catchThief(c: Customer) {
    const total = c.cart.reduce((a, b) => a + b.price, 0);
    if (total) this.earn(total, 'sale', c.x, c.z);
    this.addXp(XP.catchThief); this.w.save.lifetime.caught++;
    c.cart = []; c.sat = 20; c.bubble = '😳';
    this.w.ev.emit('toast', { msg: `🚨 Caught a thief! They paid $${total}.`, kind: 'good' });
    this.leave(c, null);
  }

  private finishCustomer(c: Customer) {
    const w = this.w, s = w.save;
    if (c.sat >= 0) {
      const sat = clamp(c.sat, 0, 100);
      const t = w.today();
      t.served++; t.satSum += sat; t.satN++; t.streakNow++; t.streak = Math.max(t.streak, t.streakNow);
      s.lifetime.customers++;
      if (c.regular) this.befriend(c, sat);
      const stars = clamp(Math.round(sat / 20 + 0.2), 1, 5);
      if (chance(stars >= 5 || stars <= 2 ? 0.75 : 0.45)) {
        const reason = c.reasons[c.reasons.length - 1];
        const key = stars >= 5 ? 'great' : stars === 4 ? 'good' : reason && REVIEW_LINES[reason] ? reason : stars <= 2 ? 'dirty' : 'good';
        const text = pick(REVIEW_LINES[stars <= 3 && reason && REVIEW_LINES[reason] ? reason : key] || REVIEW_LINES.good);
        const rv = { stars, text, day: s.day, who: c.regular ? REGULAR[c.regular].name : CUSTOMERS[c.type].name };
        if (stars >= 5) { w.today().fiveStar++; s.lifetime.fiveStar++; }
        s.reviews.push(rv); if (s.reviews.length > 80) s.reviews.splice(0, s.reviews.length - 80);
        if (stars >= 5) this.addXp(XP.review5); else if (stars === 4) this.addXp(XP.review4);
        w.ev.emit('review', rv);
      }
    }
    this.remove(c);
  }
  /** a regular's visit changes their friendship: VIP card at 3 hearts, a gift at 5 */
  private befriend(c: Customer, sat: number) {
    const w = this.w, s = w.save, r = REGULAR[c.regular!];
    const st = s.regulars[r.id] ||= { love: 0, visits: 1, lastDay: s.day };
    const before = hearts(st.love);
    st.love = clamp((st.love || 0) + (sat >= 85 ? 8 : sat >= 70 ? 6 : sat >= 50 ? 3 : sat < 35 ? -6 : 0), 0, 100);
    const now = hearts(st.love);
    if (now > before) w.ev.emit('toast', { msg: `💛 ${r.name} likes your shop more! (${'♥'.repeat(now)}${'♡'.repeat(5 - now)})`, kind: 'good' });
    if (now >= 3 && !st.vip) {
      st.vip = true;
      this.earn(40, 'member', c.x, c.z);
      w.ev.emit('toast', { msg: `💳 ${r.name} bought a VIP membership (+$40)! VIPs visit more and tip on every session.`, kind: 'good' });
    }
    if (now >= 5 && !st.gift) {
      st.gift = true;
      s.inventory[r.gift] = (s.inventory[r.gift] || 0) + 1;
      w.ev.emit('toast', { msg: `🎁 ${r.name} gave you a gift: ${ITEM[r.gift]?.name || 'something nice'}! It's in your inventory (Tab).`, kind: 'good' });
      w.bump();
    }
  }

  // ---------- daily goals & achievements ----------
  checkGoals() {
    const w = this.w, s = w.save;
    for (const g of s.goals) {
      if (g.done) continue;
      const def = GOAL[g.id]; if (!def) continue;
      if (def.stat(s.today) >= g.target) {
        g.done = true;
        s.money += g.money; s.today.bonus += g.money;
        this.addXp(g.xp);
        w.ev.emit('goal', { icon: def.icon, text: def.text(g.target), money: g.money, xp: g.xp, kind: 'goal' });
        if (s.goals.every(x => x.done)) {
          const extra = 40 + s.level * 10;
          s.money += extra; s.today.bonus += extra;
          w.ev.emit('goal', { icon: '🎯', text: 'All daily goals done!', money: extra, xp: 0, kind: 'goal' });
        }
        w.bump();
      }
    }
    for (const a of ACHIEVEMENTS) {
      if (s.achievements.includes(a.id) || !a.check(s)) continue;
      s.achievements.push(a.id);
      this.addXp(a.xp);
      w.ev.emit('goal', { icon: a.icon, text: a.name, money: 0, xp: a.xp, kind: 'achievement' });
      w.bump();
    }
  }

  private remove(c: Customer) {
    this.release(c); this.leaveQueue(c);
    const i = this.w.customers.indexOf(c); if (i >= 0) this.w.customers.splice(i, 1);
  }

  // ---------- money / xp ----------
  earn(amount: number, kind: 'session' | 'sale' | 'arcade' | 'tip' | 'vending' | 'food' | 'member', x: number, z: number) {
    const s = this.w.save, t = s.today;
    s.money += amount; s.lifetime.revenue += amount;
    if (kind === 'session') t.sessionRev += amount;
    else if (kind === 'sale') t.salesRev += amount;
    else if (kind === 'arcade') t.arcadeRev += amount;
    else if (kind === 'tip') t.tips += amount;
    else if (kind === 'food') t.foodRev += amount;
    else if (kind === 'member') t.members += amount;
    else t.arcadeRev += amount;
    this.w.ev.emit('cash', { x, z, amount, label: kind === 'tip' ? 'tip' : kind === 'member' ? 'VIP' : undefined });
    this.w.ev.emit('sfx', { name: kind === 'sale' ? 'cash' : 'coins', x, z });
  }
  addXp(n: number) {
    const s = this.w.save;
    s.xp += n; s.today.xp += n;
    while (s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level); s.level++;
      s.pendingPerks++;
      this.w.ev.emit('levelup', { level: s.level, unlocks: unlocksAt(s.level) });
      this.w.bump();
    }
  }

  // ---------- staff ----------
  syncStaffRoster() {
    const w = this.w;
    for (const m of w.save.staff) if (!w.staff.find(n => n.id === m.id)) {
      w.staff.push({ id: m.id, role: m.role, name: m.name, body: m.body, x: rand(-0.5, 0.5), z: -1, ry: Math.PI, anim: 'idle', state: 'idle', t: rand(0, 1), path: [], task: null, carry: null, counter: null });
    }
    for (const n of [...w.staff]) if (!w.save.staff.find(m => m.id === n.id)) {
      if (n.carry) { const b = w.box(n.carry); if (b) { b.carrier = null; b.x = n.x; b.z = n.z; } }
      if (n.task) this.claims.delete(n.task);
      w.staff.splice(w.staff.indexOf(n), 1);
    }
  }
  private claim(st: StaffNpc, key: string) { if (this.claims.has(key)) return false; this.claims.add(key); st.task = key; return true; }
  private unclaim(st: StaffNpc) { if (st.task) this.claims.delete(st.task); st.task = null; }

  private updateStaff(st: StaffNpc, dt: number) {
    const w = this.w, s = w.save;
    const speed = 1.6 * (has(w, 'sprinter') ? 1.12 : 1);
    const quick = has(w, 'mechanic') ? 0.5 : 1;
    st.t -= dt;
    if (st.path.length) { st.anim = st.carry ? 'carry' : 'walk'; if (!this.walk(st, speed, dt)) return; st.anim = st.carry ? 'carry' : 'idle'; }
    switch (st.role) {
      case 'cleaner': {
        if (st.state === 'cleaning') {
          if (st.t > 0) { st.anim = 'work'; return; }
          const key = st.task?.split(':')[1];
          const ti = s.trash.findIndex(t => t.id === key);
          if (ti >= 0) { s.trash.splice(ti, 1); s.today.cleaned++; s.lifetime.cleaned++; w.bump(); w.ev.emit('sfx', { name: 'sweep', x: st.x, z: st.z }); }
          const bi = s.boxes.findIndex(b => b.id === key && b.empty && !b.carrier);
          if (bi >= 0) { s.boxes.splice(bi, 1); w.bump(); }
          this.unclaim(st); st.state = 'idle'; st.anim = 'idle';
          return;
        }
        if (st.state === 'going') { st.state = 'cleaning'; st.t = 2 * quick; st.anim = 'work'; return; }
        if (st.t > 0) return;
        st.t = 0.6;
        const dz = deliveryZone(s);
        const targets = [
          ...s.trash.map(t => ({ id: t.id, x: t.x, z: t.z })),
          ...s.boxes.filter(b => b.empty && !b.carrier && !(b.x > dz.x0 && b.x < dz.x1 && b.z > dz.z0 && b.z < dz.z1)).map(b => ({ id: b.id, x: b.x, z: b.z })),
        ].filter(t => !this.claims.has('clean:' + t.id)).sort((a, b) => dist(a, st) - dist(b, st));
        if (targets.length && this.claim(st, 'clean:' + targets[0].id)) { this.goTo(st, targets[0], 'going'); return; }
        this.wander(st);
        return;
      }
      case 'technician': {
        if (st.state === 'repairing') {
          if (st.t > 0) { st.anim = 'work'; return; }
          const o = w.obj(st.task!.split(':')[1]);
          if (o && o.broken) { o.broken = false; s.today.repaired++; w.bump(); w.ev.emit('sfx', { name: 'repair', x: o.x, z: o.z }); }
          this.unclaim(st); st.state = 'idle';
          return;
        }
        if (st.state === 'going') { st.state = 'repairing'; st.t = 4 * quick; st.anim = 'work'; return; }
        if (st.t > 0) return;
        st.t = 0.8;
        const broken = s.objects.filter(o => o.broken && !this.claims.has('fix:' + o.id)).sort((a, b) => dist(a, st) - dist(b, st));
        if (broken.length && this.claim(st, 'fix:' + broken[0].id)) { this.goTo(st, useSpots(broken[0])[0] || broken[0], 'going'); return; }
        this.wander(st);
        return;
      }
      case 'cashier': {
        let k = st.counter ? w.obj(st.counter) : null;
        if (!k) {
          st.counter = null;
          const taken = new Set(w.staff.filter(x => x !== st && x.counter).map(x => x.counter));
          k = s.objects.find(o => ITEM[o.item]?.kind === 'counter' && !taken.has(o.id)) || null;
          if (!k) { if (st.t <= 0) { st.t = 2; this.wander(st); } return; }
          st.counter = k.id;
          this.goTo(st, counterSpots(k).cashier, 'going');
          return;
        }
        const spot = counterSpots(k).cashier;
        if (dist(st, spot) > 0.3) { if (!st.path.length) this.goTo(st, spot, 'going'); return; }
        st.ry = spot.ry; st.anim = 'idle';
        if (w.registerUser.get(k.id)) return; // a player is running this register
        const head = (w.queues.get(k.id) || []).map(id => w.cust(id)).find(c => c && (c.state === 'atCounter' || c.state === 'paying'));
        if (!head || st.t > 0) return;
        st.anim = 'work';
        if (head.state === 'atCounter' && head.scanned < head.cart.length) { head.scanned++; st.t = 0.9 * (has(w, 'cashier') ? 0.5 : 1); w.bump(); w.ev.emit('sfx', { name: 'beep', x: k.x, z: k.z }); return; }
        if (head.state === 'paying') { st.t = 1.2; this.completeCheckout(head, head.pay === 'cash' ? head.given - head.cart.reduce((a, b) => a + b.price, 0) : null); }
        return;
      }
      case 'cook': {
        let k = st.counter ? w.obj(st.counter) : null;
        if (!k) {
          st.counter = null;
          const taken = new Set(w.staff.filter(x => x !== st && x.counter).map(x => x.counter));
          k = this.foodbars().find(o => !taken.has(o.id)) || null;
          if (!k) { if (st.t <= 0) { st.t = 2; this.wander(st); } return; }
          st.counter = k.id;
          this.goTo(st, foodSpots(k).cook, 'going');
          return;
        }
        const spot = foodSpots(k).cook;
        if (dist(st, spot) > 0.3) { if (!st.path.length) this.goTo(st, spot, 'going'); return; }
        st.ry = spot.ry;
        const head = this.foodHead(k.id);
        if (st.task) {
          if (!head || 'cook:' + head.id !== st.task) { st.task = null; st.anim = 'idle'; return; }
          st.anim = 'work';
          if (st.t <= 0) { st.task = null; st.anim = 'idle'; this.serveMeal(k.id); }
          return;
        }
        st.anim = 'idle';
        if (head && (k.stock || 0) > 0 && !w.registerUser.get(k.id)) { st.task = 'cook:' + head.id; st.t = MEAL[head.order!].secs * 1.4 * (has(w, 'mechanic') ? 0.7 : 1); st.anim = 'work'; }
        return;
      }
      case 'restocker': {
        if (st.state === 'stocking') {
          const o = w.obj(st.task!.split(':')[1]); const b = st.carry ? w.box(st.carry) : null;
          if (!o || !b) { this.dropCarry(st); this.unclaim(st); st.state = 'idle'; return; }
          if (st.t > 0) { st.anim = 'work'; return; }
          const def = ITEM[o.item];
          if (b.count > 0 && (o.stock || 0) < (def.capacity || 0) && (!o.product || o.product === b.item)) {
            o.product = b.item; o.stock = (o.stock || 0) + 1; b.count--; st.t = 0.35; w.bump();
            if (b.count <= 0) { b.count = 0; b.empty = true; }
            return;
          }
          // done: bin the empty box or leave the partial one in the zone
          if (b.empty) {
            const bin = s.objects.filter(x => ITEM[x.item]?.kind === 'bin').sort((a, c) => dist(a, st) - dist(c, st))[0];
            if (bin) { st.state = 'binning'; this.goTo(st, useSpots(bin)[0], 'binning'); st.state = 'binning'; return; }
            s.boxes.splice(s.boxes.indexOf(b), 1); st.carry = null; w.bump();
          } else this.dropCarry(st);
          this.unclaim(st); st.state = 'idle';
          return;
        }
        if (st.state === 'binning') { const b = st.carry ? w.box(st.carry) : null; if (b) { s.boxes.splice(s.boxes.indexOf(b), 1); w.bump(); } st.carry = null; this.unclaim(st); st.state = 'idle'; return; }
        if (st.state === 'fetch') {
          const [, oid, bid] = st.task!.split(':');
          const b = w.box(bid), o = w.obj(oid);
          if (!b || b.carrier || !o) { this.unclaim(st); st.state = 'idle'; return; }
          b.carrier = st.id; st.carry = b.id; w.bump();
          this.goTo(st, useSpots(o).sort((a, c) => dist(a, st) - dist(c, st))[0], 'toShelf');
          return;
        }
        if (st.state === 'toShelf') { st.state = 'stocking'; st.t = 0.4; return; }
        if (st.t > 0) return;
        st.t = 1;
        // find a shelf that needs stock and a box that fits it
        const free = s.boxes.filter(b => b.product && !b.empty && !b.carrier && !b.at && b.count > 0);
        if (!free.length) { this.wander(st); return; }
        const shelves = s.objects.filter(o => { const d = ITEM[o.item]; return (d?.kind === 'shelf' || d?.kind === 'fridge' || d?.kind === 'foodbar') && (o.stock || 0) < (d.capacity || 0) * 0.6; })
          .sort((a, b) => (a.stock || 0) / (ITEM[a.item].capacity || 1) - (b.stock || 0) / (ITEM[b.item].capacity || 1));
        for (const o of shelves) {
          if ([...this.claims].some(k => k.startsWith('stock:' + o.id + ':'))) continue;
          const accepts = ITEM[o.item].accepts;
          const b = free.find(b => (o.product ? b.item === o.product : ITEM[b.item].product!.place === accepts) && !this.claims.has('box:' + b.id));
          if (!b) continue;
          if (!o.stock) o.product = b.item;
          if (this.claim(st, `stock:${o.id}:${b.id}`)) { this.claims.add('box:' + b.id); this.goTo(st, b, 'fetch'); return; }
        }
        this.wander(st);
        return;
      }
    }
  }
  private dropCarry(st: StaffNpc) {
    const b = st.carry ? this.w.box(st.carry) : null;
    if (b) { b.carrier = null; b.x = st.x; b.z = st.z; b.y = 0; this.claims.delete('box:' + b.id); }
    st.carry = null; this.w.bump();
  }
  private wander(st: StaffNpc) {
    if (st.path.length || chance(0.6)) return;
    const { w, d } = shopSize(this.w.save);
    const p = { x: rand(-w / 2 + 1, w / 2 - 1), z: rand(-d + 1, -1.2) };
    st.path = this.w.nav.route({ x: st.x, z: st.z }, p); st.state = 'idle';
  }

  // ---------- day ----------
  finishDay() {
    const w = this.w, s = w.save;
    if (s.dayOver) return;
    const t = s.today;
    const wages = this.wages(), rent = this.rent(), power = Math.round(this.power());
    s.money -= wages + rent + power;
    s.dayOver = true;
    s.lifetime.days++;
    const newReviews = s.reviews.filter(r => r.day === s.day);
    const sum: DaySummary = {
      day: s.day,
      income: { 'Gaming sessions': t.sessionRev, 'Store sales': t.salesRev, 'Snack Bar': t.foodRev, 'Arcade & vending': t.arcadeRev, Tips: t.tips, 'VIP memberships': t.members, 'Goal rewards': t.bonus },
      costs: { 'Stock bought': Math.round(t.spentStock), 'Items bought': Math.round(t.spentItems), Salaries: wages, Rent: rent, Electricity: power },
      net: 0, served: t.served, lost: t.lost, sat: t.satN ? Math.round(t.satSum / t.satN) : 0, reviews: newReviews, xp: Math.round(t.xp), rating: this.rating(), thefts: t.thefts,
    };
    sum.net = Object.values(sum.income).reduce((a, b) => a + b, 0) - Object.values(sum.costs).reduce((a, b) => a + b, 0);
    w.summary = sum;
    w.bump();
    w.ev.emit('dayover', sum);
  }
  nextDay() {
    const s = this.w.save;
    if (!s.dayOver) return;
    s.day++; s.time = ECON.dayStart; s.open = false; s.dayOver = false; s.today = emptyDay();
    s.goals = rollGoals(s);
    this.followers.length = 0;
    for (const b of s.boxes) b.at = 0;
    this.w.summary = null;
    for (const c of [...this.w.customers]) this.remove(c);
    this.w.bump();
  }
}

// ---------- unlock list for the level-up popup ----------
export function unlocksAt(level: number): string[] {
  const out: string[] = [];
  for (const i of ITEMS) if (i.level === level) out.push(`${i.name}`);
  for (const c of Object.values(CUSTOMERS)) if (c.level === level) out.push(`New customers: ${c.name}`);
  for (const r of STAFF) if (r.level === level) out.push(`Hire: ${r.name}`);
  for (const l of LICENSES) if (l.level === level) out.push(`License: ${l.name}`);
  for (const [i, e] of EXPANSIONS.entries()) if (i > 0 && e.level === level) out.push(`Expansion to ${e.w}×${e.d} m`);
  return out;
}
export const perkById = (id: string) => PERKS.find(p => p.id === id);
export { PRODUCTS };
export type { Box };
