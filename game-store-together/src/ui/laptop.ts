/* The manager laptop: a full-screen "ShopOS" app with the shop catalogue, stock & prices, staff, expansion & styles, licenses & perks, reviews and stats. */
import { CATEGORIES, ITEMS, ITEM, PRODUCTS, type CategoryId } from '../config/items';
import { STAFF, EXPANSIONS, FLOORS, WALLS, LIGHTS, LICENSES, PERKS, MAX_STAFF_PER_ROLE, ECON, ELEVATOR, REBIRTH, STAFF_SKILL, staffWage } from '../config/economy';
import { maxFloors, nextStorey } from '../sim/building';
import { modal } from './panels';
import { CUSTOMERS, REGULARS, hearts } from '../config/npcs';
import { GOAL, ACHIEVEMENTS } from '../config/goals';
import { el, money, esc } from '../core/util';
import { thumbs } from '../engine/thumbs';
import { audio } from '../engine/audio';
import { locked, unitCost } from '../sim/actions';
import { shopSize } from '../sim/layout';
import type { Game } from '../game/game';

type Tab = 'shop' | 'stock' | 'staff' | 'expand' | 'perks' | 'goals' | 'regulars' | 'reviews' | 'stats';
const TABS: { id: Tab; icon: string; name: string }[] = [
  { id: 'shop', icon: '🛒', name: 'Shop' }, { id: 'stock', icon: '📦', name: 'Stock & Prices' }, { id: 'staff', icon: '👥', name: 'Staff' },
  { id: 'expand', icon: '🏗️', name: 'Expand & Style' }, { id: 'perks', icon: '📜', name: 'Licenses & Perks' }, { id: 'goals', icon: '🎯', name: 'Goals' }, { id: 'regulars', icon: '💛', name: 'Regulars' }, { id: 'reviews', icon: '⭐', name: 'Reviews' }, { id: 'stats', icon: '📊', name: 'Stats' },
];

export class Laptop {
  root: HTMLElement | null = null;
  tab: Tab = 'shop';
  cat: CategoryId = 'pcs';
  private body!: HTMLElement;
  private headMoney!: HTMLElement;
  private qty: Record<string, number> = {};
  private off: (() => void) | null = null;
  private renderQueued = false;

  constructor(private game: Game, private onClose: () => void) {}

  get open() { return !!this.root; }

  show(tab?: Tab) {
    if (tab) this.tab = tab;
    if (this.root) { this.render(); return; }
    audio.play('click');
    const side = el('div', { class: 'lap-side' }, el('div', { class: 'os' }, 'ShopOS'));
    for (const t of TABS) side.append(el('button', { class: 'tab' + (t.id === this.tab ? ' on' : ''), 'data-tab': t.id, onclick: () => { this.tab = t.id; audio.play('click'); this.render(); } }, t.icon, el('span', {}, t.name)));
    this.headMoney = el('span', { class: 'pill num' });
    this.body = el('div', { class: 'lap-body' });
    const head = el('div', { class: 'lap-head' }, el('h2', { id: 'lap-title' }, ''), this.headMoney, el('button', { class: 'btn small', onclick: () => this.close() }, '✕ Close'));
    this.root = el('div', { class: 'laptop' }, el('div', { class: 'lap' }, el('div', { class: 'lap-screen' }, side, el('div', { class: 'lap-main' }, head, this.body))));
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
    document.getElementById('ui')!.appendChild(this.root);
    this.off = this.game.world.ev.on('changed', () => this.queue());
    this.render();
  }
  close() {
    if (!this.root) return;
    this.root.remove(); this.root = null; this.off?.(); this.off = null;
    this.onClose();
  }
  private queue() { if (this.renderQueued) return; this.renderQueued = true; requestAnimationFrame(() => { this.renderQueued = false; if (this.root) this.render(); }); }

  private async buy(a: any) { const r = await this.game.act(a); if (r.ok) audio.play('coins'); this.render(); }

  render() {
    if (!this.root) return;
    const w = this.game.world, s = w.save;
    this.root.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.tab === this.tab));
    (this.root.querySelector('#lap-title') as HTMLElement).textContent = TABS.find(t => t.id === this.tab)!.name;
    this.headMoney.textContent = `💰 ${money(s.money)} · Lv ${s.level}`;
    const scroll = this.body.scrollTop;
    this.body.innerHTML = '';
    const guest = !this.game.isHost;
    if (this.game.readOnly) { this.body.append(el('p', {}, 'You’re visiting. The laptop is read-only.')); }
    switch (this.tab) {
      case 'shop': this.renderShop(); break;
      case 'stock': this.renderStock(); break;
      case 'staff': this.renderStaff(); break;
      case 'expand': this.renderExpand(); break;
      case 'perks': this.renderPerks(); break;
      case 'goals': this.renderGoals(); break;
      case 'regulars': this.renderRegulars(); break;
      case 'reviews': this.renderReviews(); break;
      case 'stats': this.renderStats(); break;
    }
    if (guest) this.body.prepend(el('p', { class: 'chip' }, '🤝 Co-op: purchases come out of the host’s shop money.'));
    this.body.scrollTop = scroll;
  }

  private renderShop() {
    const w = this.game.world, s = w.save;
    const cats = el('div', { class: 'cats' });
    for (const c of CATEGORIES) cats.append(el('button', { class: 'chip' + (c.id === this.cat ? ' on' : ''), onclick: () => { this.cat = c.id; this.render(); } }, `${c.icon} ${c.name}`));
    const cat = CATEGORIES.find(c => c.id === this.cat)!;
    const grid = el('div', { class: 'grid' });
    for (const d of ITEMS.filter(i => i.cat === this.cat).sort((a, b) => a.level - b.level || a.price - b.price)) {
      const lock = locked(w, d);
      const owned = d.kind === 'service' && s.services.includes(d.service!);
      const img = thumbs.get(d.id);
      const stats = el('div', { class: 'stats' });
      const st = (t: string, cls = '') => stats.append(el('span', { class: 'chip ' + cls }, t));
      if (d.kind === 'station') { st(`${money(Math.round(s.sessionPrice * (d.priceMul || 1)))}/session`, 'good'); if (d.seats! > 1) st(`${d.seats} seats`); st(`⚡ $${d.power}/day`); if (d.appeal) st(`✨ +${d.appeal}`); }
      if (d.kind === 'arcade') { st(`${money(d.arcadePrice!)}/play`, 'good'); st(`⚡ $${d.power}/day`); }
      if (d.kind === 'product') { const p = d.product!; st(`${p.perBox} per box`); st(`sells ~${money(p.market)}`, 'good'); st(p.place === 'fridge' ? '🧊 fridge' : '🗄️ shelf'); }
      if (d.kind === 'component') { if (d.comfort) st(`😌 +${d.comfort} comfort`); if (d.appeal) st(`✨ +${d.appeal}`); }
      if (d.capacity) st(`${d.capacity} slots`);
      if (d.appeal && d.kind === 'decor') st(`✨ +${d.appeal} appeal`);
      if (lock) st('🔒 ' + lock, 'lock');
      const cost = unitCost(w, d);
      const q = this.qty[d.id] || 1;
      const qtyEl = d.kind === 'product' || d.kind === 'decor' || d.kind === 'wall' || d.kind === 'component' ? el('div', { class: 'qty' },
        el('button', { onclick: () => { this.qty[d.id] = Math.max(1, q - 1); this.render(); } }, '−'), el('b', { class: 'num' }, String(q)),
        el('button', { onclick: () => { this.qty[d.id] = Math.min(10, q + 1); this.render(); } }, '+')) : null;
      const buyBtn = el('button', { class: 'btn small coral', disabled: !!lock || owned || s.money < cost * q || this.game.readOnly, onclick: () => this.buy({ t: 'buy', item: d.id, qty: q }) }, owned ? 'Installed ✓' : `Buy ${q > 1 ? q + '× ' : ''}${money(cost * q)}`);
      grid.append(el('div', { class: 'card' + (lock ? ' locked' : '') },
        el('div', { class: 'thumb' }, img ? el('img', { src: img, alt: d.name, draggable: 'false' }) : el('span', { style: { fontSize: '48px' } }, cat.icon)),
        el('h3', {}, d.name), el('p', {}, d.desc), stats,
        el('div', { class: 'row' }, el('span', { class: 'price grow num' }, money(cost)), qtyEl, buyBtn)));
    }
    this.body.append(cats, el('p', { class: 'muted', style: { margin: '0 0 10px' } }, cat.blurb + (this.cat !== 'upgrades' || true ? ' Orders arrive as boxes in the delivery zone by the door.' : '')), grid);
  }

  private renderStock() {
    const w = this.game.world, s = w.save;
    const sec = el('div', { class: 'section' }, el('h3', {}, '🎮 Session price'));
    const sp = el('input', { type: 'range', min: 5, max: 60, step: 1, value: s.sessionPrice, id: 'session-price' }) as HTMLInputElement;
    const lbl = el('b', { class: 'num' }, money(s.sessionPrice));
    sp.oninput = () => { lbl.textContent = money(+sp.value); };
    sp.onchange = () => this.game.act({ t: 'sessionPrice', value: +sp.value }, true);
    sec.append(el('div', { class: 'row' }, sp, lbl, el('span', { class: 'muted' }, `Fair price is ${money(ECON.sessionBase)} for a laptop. Better PCs earn more automatically. Too pricey and customers walk away.`)));
    const tbl = el('table', { class: 'tbl' }, el('tr', {}, el('th', {}, 'Product'), el('th', {}, 'On shelves'), el('th', {}, 'In boxes'), el('th', {}, 'Your price'), el('th', {}, 'Market'), el('th', {}, '')));
    for (const p of PRODUCTS) {
      if (locked(w, p) && !s.boxes.some(b => b.item === p.id) && !s.objects.some(o => o.product === p.id)) continue;
      const onShelf = s.objects.filter(o => o.product === p.id).reduce((a, o) => a + (o.stock || 0), 0);
      const inBox = s.boxes.filter(b => b.item === p.id).reduce((a, b) => a + b.count, 0);
      const price = s.prices[p.id] ?? p.product!.market;
      const inp = el('input', { type: 'range', min: 1, max: Math.max(5, p.product!.market * 3), step: 1, value: price, id: 'price-' + p.id }) as HTMLInputElement;
      const val = el('b', { class: 'num' }, money(price));
      inp.oninput = () => { val.textContent = money(+inp.value); };
      inp.onchange = () => this.game.act({ t: 'price', product: p.id, value: +inp.value }, true);
      const ratio = price / p.product!.market;
      tbl.append(el('tr', {}, el('td', {}, el('b', {}, p.name)), el('td', { class: 'num' }, String(onShelf)), el('td', { class: 'num' }, String(inBox)),
        el('td', {}, el('div', { class: 'row' }, inp, val)), el('td', { class: 'num' }, money(p.product!.market)),
        el('td', {}, el('span', { class: 'chip ' + (ratio > 1.3 ? 'bad' : ratio < 0.9 ? 'good' : '') }, ratio > 1.3 ? 'Pricey' : ratio < 0.9 ? 'Bargain' : 'Fair'),
          ' ', el('button', { class: 'btn small coral', disabled: !!locked(w, p) || s.money < unitCost(w, p), onclick: () => this.buy({ t: 'buy', item: p.id, qty: 1 }) }, `+1 box ${money(unitCost(w, p))}`))));
    }
    const stocked = el('div', { class: 'section' }, el('h3', {}, '🗄️ Products'), PRODUCTS.some(p => !locked(w, p)) ? tbl : el('p', { class: 'muted' }, 'Get the Retail License (Licenses & Perks) at level 2 to start selling snacks and drinks.'));
    this.body.append(sec, stocked);
  }

  private renderStaff() {
    const w = this.game.world, s = w.save;
    const wrap = el('div', { class: 'grid' });
    for (const r of STAFF) {
      const team = s.staff.filter(m => m.role === r.id);
      const lock = r.level > s.level;
      const list = el('div', {});
      for (const m of team) {
        const lvl = m.lvl || 1, maxed = lvl >= STAFF_SKILL.max, cost = STAFF_SKILL.train(lvl);
        list.append(el('div', { class: 'staff-row' },
          el('div', { class: 'row' }, el('b', { class: 'grow' }, `${r.icon} ${m.name}`), el('span', { class: 'stars', title: `Skill ${lvl}/${STAFF_SKILL.max}` }, '★'.repeat(lvl) + '☆'.repeat(STAFF_SKILL.max - lvl))),
          el('div', { class: 'row' }, el('span', { class: 'muted' }, `${money(staffWage(m.role, lvl))}/day`),
            maxed ? el('span', { class: 'chip good' }, 'Pro') : el('div', { class: 'bar grow', title: 'Experience' }, el('i', { style: { width: Math.min(100, ((m.xp || 0) / STAFF_SKILL.xpFor(lvl)) * 100) + '%' } }))),
          el('div', { class: 'row' },
            maxed ? el('span', { class: 'grow' }) : el('button', { class: 'btn small grow', disabled: s.money < cost, onclick: () => this.game.act({ t: 'train', id: m.id }).then(x => { if (x.ok) audio.play('levelup'); }) }, `🎓 Train ${money(cost)}`),
            el('button', { class: 'btn small ghost', onclick: () => this.game.act({ t: 'fire', id: m.id }) }, 'Let go'))));
      }
      wrap.append(el('div', { class: 'card' + (lock ? ' locked' : '') }, el('div', { class: 'thumb', style: { fontSize: '54px' } }, r.icon), el('h3', {}, r.name), el('p', {}, r.desc),
        el('div', { class: 'stats' }, el('span', { class: 'chip' }, `${money(r.wage)}/day`), el('span', { class: 'chip' }, `${team.length}/${MAX_STAFF_PER_ROLE} hired`), lock ? el('span', { class: 'chip lock' }, `🔒 Level ${r.level}`) : null),
        list, el('button', { class: 'btn small coral', disabled: lock || team.length >= MAX_STAFF_PER_ROLE, onclick: () => this.game.act({ t: 'hire', role: r.id }) }, `Hire ${r.name}`)));
    }
    const wages = s.staff.reduce((a, m) => a + staffWage(m.role, m.lvl), 0);
    this.body.append(el('p', { class: 'muted' }, `Salaries are paid at the end of each day. Current total: ${money(wages)}/day. Staff gain skill (★) as they work, or train them: each level makes them ${Math.round(STAFF_SKILL.speed * 100)}% faster on their feet and ${Math.round(STAFF_SKILL.work * 100)}% quicker at the job, for $${STAFF_SKILL.wage}/day more.`), wrap);
  }

  private renderExpand() {
    const w = this.game.world, s = w.save;
    const { w: ww, d } = shopSize(s);
    const next = EXPANSIONS[s.expansion + 1];
    const exp = el('div', { class: 'section' }, el('h3', {}, '🏗️ Expansion'),
      el('p', {}, `Your shop is ${ww} × ${d} m (rent ${money(EXPANSIONS[s.expansion].rent)}/day).`),
      next ? el('div', { class: 'row' }, el('span', { class: 'grow' }, `Next: ${next.w} × ${next.d} m · rent ${money(next.rent)}/day ${next.level > s.level ? `· 🔒 level ${next.level}` : ''}`),
        el('button', { class: 'btn coral', disabled: next.level > s.level || s.money < next.price, onclick: () => this.buy({ t: 'expand' }) }, `Expand for ${money(next.price)}`)) : el('p', { class: 'chip good' }, 'Maxed out — the whole lot is yours!'));
    // floors, elevator, rebirth
    const floors = s.floors || 1, cap = maxFloors(s), nx = nextStorey(s);
    const rb = s.rebirths || 0;
    const tower = el('div', { class: 'floor-stack' });
    for (let i = Math.max(cap, floors); i >= 1; i--) tower.append(el('div', { class: 'fs' + (i <= floors ? ' on' : '') + (i > cap ? ' lock' : '') }, i <= floors ? `${i}F` : i > cap ? '💎' : '·'));
    const floorWhy = !nx ? '' : nx.n > cap ? 'Rebirth to build higher' : s.expansion < 1 ? 'Expand the lot once first' : nx.level > s.level ? `🔒 Level ${nx.level}` : '';
    const floorBox = el('div', { class: 'section' }, el('h3', {}, '🏢 Floors'),
      el('div', { class: 'row floors-row' }, tower, el('div', { class: 'grow' },
        el('p', {}, `Your shop has ${floors} floor${floors > 1 ? 's' : ''} (up to ${cap}${cap < 7 ? ', 7 after a rebirth' : ''}). Stairs go in the back-left corner and every floor adds rent. Customers don't love climbing: higher floors are less popular until you get an elevator.`),
        nx && nx.n <= cap ? el('div', { class: 'row' }, el('span', { class: 'grow' }, `Floor ${nx.n} · rent +${money(nx.rent)}/day ${floorWhy ? '· ' + floorWhy : ''}`),
          el('button', { class: 'btn coral', disabled: !!floorWhy || s.money < nx.price, onclick: () => this.buy({ t: 'buildFloor' }) }, `Build floor ${nx.n} for ${money(nx.price)}`)) : el('p', { class: 'chip good' }, floors >= 7 ? 'Tallest shop in town!' : `All ${cap} floors built: time to rebirth?`),
        floors >= 2 ? el('div', { class: 'row' }, el('span', { class: 'grow' }, s.elevator ? '🛗 Elevator installed: customers happily go up.' : `🛗 Elevator: customers reach high floors faster and like them more. ${ELEVATOR.level > s.level ? `🔒 Level ${ELEVATOR.level}` : ''}`),
          s.elevator ? null : el('button', { class: 'btn', disabled: ELEVATOR.level > s.level || s.money < ELEVATOR.price, onclick: () => this.buy({ t: 'buyElevator' }) }, `Install for ${money(ELEVATOR.price)}`)) : null)));
    const canRebirth = floors >= cap;
    const rebirthBox = el('div', { class: 'section rebirth' }, el('h3', {}, `💎 Rebirth${rb ? ` · ${rb} so far` : ''}`),
      el('p', {}, `Start over with a fresh little shop and keep a permanent bonus: +${REBIRTH.income * 100}% income and +${REBIRTH.xp * 100}% XP for every rebirth, $${REBIRTH.startMoney} more to start with, and the first rebirth unlocks floors 5–7.`),
      el('p', { class: 'muted' }, 'You keep your regulars, achievements, owned styles, shop name and lifetime stats. Money, level, stations, staff, licenses, perks, the lot and the floors start over.'),
      rb ? el('p', { class: 'chip good' }, `Now: income +${Math.round(REBIRTH.income * 100 * rb)}% · XP +${Math.round(REBIRTH.xp * 100 * rb)}%`) : null,
      el('button', { class: 'btn coral', disabled: !canRebirth, onclick: () => this.confirmRebirth() }, canRebirth ? '💎 Rebirth now' : `Build all ${cap} floors to rebirth (${floors}/${cap})`));
    const nameIn = el('input', { class: 'field', value: s.shopName, maxlength: 24, id: 'shop-name' }) as HTMLInputElement;
    const name = el('div', { class: 'section' }, el('h3', {}, '🪧 Shop name & sign'), el('div', { class: 'row' }, el('div', { class: 'grow' }, nameIn), el('button', { class: 'btn', onclick: () => this.game.act({ t: 'shopName', name: nameIn.value }) }, 'Update sign')));
    const styles = (title: string, kind: 'floor' | 'wall' | 'light', list: typeof FLOORS) => {
      const g = el('div', { class: 'swatches' });
      for (const st of list) {
        const own = s.ownedStyles.includes(st.id), cur = (s as any)[kind] === st.id;
        g.append(el('button', { class: 'swatch' + (cur ? ' on' : ''), disabled: !own && st.level > s.level, onclick: () => this.buy({ t: 'style', kind, id: st.id }) },
          el('div', { class: 'sw', style: { background: `linear-gradient(135deg, ${st.a} 50%, ${st.b} 50%)` } }), el('b', {}, st.name),
          el('span', { class: 'muted' }, cur ? 'In use' : own ? 'Owned — apply' : st.level > s.level ? `🔒 Level ${st.level}` : money(st.price))));
      }
      return el('div', { class: 'section' }, el('h3', {}, title), g);
    };
    this.body.append(exp, floorBox, rebirthBox, name, styles('🧱 Floors', 'floor', FLOORS), styles('🎨 Walls', 'wall', WALLS), styles('💡 Lights', 'light', LIGHTS));
  }

  private confirmRebirth() {
    const s = this.game.world.save, n = (s.rebirths || 0) + 1;
    const m = modal([
      el('h2', {}, `💎 Rebirth #${n}?`),
      el('p', {}, `Your shop starts over from a single laptop, with ${money(ECON.startMoney + REBIRTH.startMoney * n)} in the bank.`),
      el('p', {}, `Forever after: income +${Math.round(REBIRTH.income * 100 * n)}%, XP +${Math.round(REBIRTH.xp * 100 * n)}%, and up to 7 floors.`),
      el('p', { class: 'muted' }, 'Kept: regulars, achievements, styles, shop name, lifetime stats.'),
      el('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        el('button', { class: 'btn', onclick: () => m.close() }, 'Not yet'),
        el('button', { class: 'btn coral', onclick: async () => { m.close(); const r = await this.game.act({ t: 'rebirth' }); if (r.ok) { audio.play('levelup'); this.game.afterRebirth(); this.close(); } } }, '💎 Rebirth')),
    ]);
  }

  private renderPerks() {
    const w = this.game.world, s = w.save;
    const lic = el('div', { class: 'grid' });
    for (const l of LICENSES) {
      const has = s.licenses.includes(l.id), lock = l.level > s.level;
      lic.append(el('div', { class: 'card' + (lock ? ' locked' : '') }, el('h3', {}, `📜 ${l.name}`), el('p', {}, l.desc),
        el('div', { class: 'row' }, el('span', { class: 'price grow' }, money(l.price)),
          el('button', { class: 'btn small coral', disabled: has || lock || s.money < l.price, onclick: () => this.buy({ t: 'license', id: l.id }) }, has ? 'Owned ✓' : lock ? `🔒 Lv ${l.level}` : 'Buy'))));
    }
    const perks = el('div', { class: 'grid' });
    for (const p of PERKS) {
      const has = s.perks.includes(p.id);
      perks.append(el('div', { class: 'card' }, el('h3', {}, `${p.icon} ${p.name}`), el('p', {}, p.desc),
        has ? el('span', { class: 'chip good' }, 'Active') : s.pendingPerks > 0 && this.game.isHost ? el('button', { class: 'btn small sun', onclick: () => this.game.act({ t: 'perk', id: p.id }) }, 'Pick this perk') : el('span', { class: 'chip' }, 'Earn perks by levelling up')));
    }
    const cust = el('div', { class: 'grid' });
    for (const c of Object.values(CUSTOMERS)) cust.append(el('div', { class: 'card' + (c.level > s.level ? ' locked' : '') }, el('h3', {}, c.name), el('p', {}, c.blurb), el('span', { class: 'chip ' + (c.level > s.level ? 'lock' : 'good') }, c.level > s.level ? `Arrive at level ${c.level}` : 'Visiting your shop')));
    this.body.append(el('div', { class: 'section' }, el('h3', {}, 'Licenses'), lic),
      el('div', { class: 'section' }, el('h3', {}, `Perks ${s.pendingPerks ? `— ${s.pendingPerks} to pick!` : ''}`), perks),
      el('div', { class: 'section' }, el('h3', {}, 'Customer types'), cust));
  }

  private renderGoals() {
    const s = this.game.world.save;
    const today = el('div', { class: 'grid goals-grid' });
    for (const g of s.goals) {
      const d = GOAL[g.id]; if (!d) continue;
      const n = Math.min(g.target, Math.floor(d.stat(s.today)));
      today.append(el('div', { class: 'card goal' + (g.done ? ' done' : '') },
        el('div', { class: 'row' }, el('span', { class: 'goal-icon' }, d.icon), el('h3', { class: 'grow' }, d.text(g.target))),
        el('div', { class: 'bar' }, el('i', { style: { width: (n / g.target) * 100 + '%' } })),
        el('div', { class: 'stats' }, el('span', { class: 'chip' + (g.done ? ' good' : '') }, g.done ? '✓ Done' : `${n} / ${g.target}`), el('span', { class: 'chip' }, `+${money(g.money)}`), el('span', { class: 'chip' }, `+${g.xp} XP`))));
    }
    this.body.append(el('div', { class: 'section' }, el('h3', {}, `Today’s goals (day ${s.day})`), el('p', { class: 'muted' }, 'Three new goals every morning. Finish all three for a bonus.'), today));
    const got = new Set(s.achievements);
    const grid = el('div', { class: 'grid ach-grid' });
    for (const a of ACHIEVEMENTS) grid.append(el('div', { class: 'card ach' + (got.has(a.id) ? ' done' : ' locked') },
      el('div', { class: 'row' }, el('span', { class: 'goal-icon' }, got.has(a.id) ? a.icon : '🔒'), el('h3', { class: 'grow' }, a.name)), el('p', {}, a.desc), el('div', { class: 'stats' }, el('span', { class: 'chip' + (got.has(a.id) ? ' good' : '') }, got.has(a.id) ? '✓ Unlocked' : `+${a.xp} XP`))));
    this.body.append(el('div', { class: 'section' }, el('h3', {}, `Achievements · ${got.size}/${ACHIEVEMENTS.length}`), grid));
  }

  private renderRegulars() {
    const s = this.game.world.save;
    this.body.append(el('div', { class: 'section' }, el('h3', {}, 'Regulars'), el('p', { class: 'muted' }, 'Named customers who come back (from level 2). Happy visits earn hearts: at ♥♥♥ they buy a VIP membership (+$40, they visit more and tip every session), at ♥♥♥♥♥ they bring you a gift. Stock their wish item to make their day.')));
    const grid = el('div', { class: 'grid' });
    for (const r of REGULARS) {
      const st = s.regulars[r.id];
      const unlocked = CUSTOMERS[r.type].level <= s.level;
      const met = !!st && st.visits > 0;
      const h = hearts(st?.love || 0);
      const img = met ? thumbs.person(r.model) : null;
      const progress = st ? (st.love % 20) / 20 : 0;
      grid.append(el('div', { class: 'card regular' + (met ? '' : ' locked') },
        el('div', { class: 'thumb' }, img ? el('img', { src: img, alt: r.name }) : el('span', { style: { fontSize: '44px' } }, '❔')),
        el('div', { class: 'row' }, el('h3', { class: 'grow' }, met ? r.name : '???'), st?.vip ? el('span', { class: 'chip good' }, '💳 VIP') : null),
        el('div', { class: 'hearts', title: `${st?.love || 0}/100` }, '♥'.repeat(h) + '♡'.repeat(5 - h)),
        h < 5 && met ? el('div', { class: 'bar' }, el('i', { style: { width: progress * 100 + '%' } })) : null,
        el('p', {}, met ? r.bio : unlocked ? 'Hasn’t visited yet.' : `Shows up from level ${Math.max(2, CUSTOMERS[r.type].level)}${r.type === 'streamer' ? ' (needs a Streamer Pod)' : ''}.`),
        met ? el('div', { class: 'stats' },
          el('span', { class: 'chip' }, `❤️ ${ITEM[r.fav]?.name || r.fav}`),
          el('span', { class: 'chip' + (st.wish ? ' good' : '') }, `${st.wish ? '✓' : '✨'} Wish: ${ITEM[r.wish]?.name || r.wish}`),
          el('span', { class: 'chip' }, `${st.visits} visit${st.visits === 1 ? '' : 's'}`),
          st.gift ? el('span', { class: 'chip good' }, '🎁 Gift received') : null) : null));
    }
    this.body.append(grid);
  }

  private renderReviews() {
    const s = this.game.world.save;
    const list = s.reviews.slice().reverse();
    const avg = list.slice(0, 30).reduce((a, r) => a + r.stars, 0) / Math.max(1, Math.min(30, list.length));
    this.body.append(el('div', { class: 'section' }, el('h3', {}, list.length ? `Rating ${avg.toFixed(1)} ★ from ${list.length} reviews` : 'No reviews yet'), el('p', { class: 'muted' }, 'Your rating (last 30 reviews) decides how many customers walk in. Keep it clean, keep the queues short, keep prices fair.')));
    for (const r of list.slice(0, 40)) this.body.append(el('div', { class: 'review' }, el('div', { class: 'row' }, el('span', { class: 'stars' }, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)), el('b', { class: 'grow' }, r.who), el('span', { class: 'muted' }, `Day ${r.day}`)), el('div', { html: esc(r.text) })));
  }

  private renderStats() {
    const g = this.game, s = g.world.save, t = s.today, sim = g.sim;
    const line = (a: string, b: string) => el('div', { class: 'line' }, el('span', {}, a), el('b', { class: 'num' }, b));
    const power = sim ? Math.round(sim.power()) : 0, rent = sim ? sim.rent() : EXPANSIONS[s.expansion].rent, wages = sim ? sim.wages() : 0;
    this.body.append(el('div', { class: 'summary-grid' },
      el('div', { class: 'col' }, el('h3', {}, `Today (day ${s.day})`), line('Sessions', `${t.sessions} · ${money(t.sessionRev)}`), line('Store sales', `${t.sales} items · ${money(t.salesRev)}`), line('Snack Bar', `${t.meals} snacks · ${money(t.foodRev)}`), line('Arcade & vending', money(t.arcadeRev)), line('Tips', money(t.tips)), line('Streams', String(t.streams)), line('Customers served', String(t.served)), line('Customers lost', String(t.lost)), line('Avg satisfaction', t.satN ? `${Math.round(t.satSum / t.satN)}%` : '—')),
      el('div', { class: 'col' }, el('h3', {}, 'Tonight’s bills'), line('Rent', money(rent)), line('Electricity', money(power)), line('Salaries', money(wages)), line('Total', money(rent + power + wages)), el('h3', { style: { marginTop: '10px' } }, 'All time'), line('Revenue', money(s.lifetime.revenue)), line('Customers', String(s.lifetime.customers)), line('Sessions', String(s.lifetime.sessions)), line('Snacks served', String(s.lifetime.meals)), line('Streams', String(s.lifetime.streams)), line('Days run', String(s.lifetime.days)))));
  }
}
