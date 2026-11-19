/* The manager laptop: a full-screen "ShopOS" app with the shop catalogue, stock & prices, staff, expansion & styles, licenses & perks, reviews and stats. */
import { CATEGORIES, ITEMS, ITEM, PRODUCTS, type CategoryId } from '../config/items';
import { STAFF, EXPANSIONS, FLOORS, WALLS, LIGHTS, LICENSES, PERKS, MAX_STAFF_PER_ROLE, ECON } from '../config/economy';
import { CUSTOMERS } from '../config/npcs';
import { el, money, esc } from '../core/util';
import { thumbs } from '../engine/thumbs';
import { audio } from '../engine/audio';
import { locked, unitCost } from '../sim/actions';
import { shopSize } from '../sim/layout';
import type { Game } from '../game/game';

type Tab = 'shop' | 'stock' | 'staff' | 'expand' | 'perks' | 'reviews' | 'stats';
const TABS: { id: Tab; icon: string; name: string }[] = [
  { id: 'shop', icon: '🛒', name: 'Shop' }, { id: 'stock', icon: '📦', name: 'Stock & Prices' }, { id: 'staff', icon: '👥', name: 'Staff' },
  { id: 'expand', icon: '🏗️', name: 'Expand & Style' }, { id: 'perks', icon: '📜', name: 'Licenses & Perks' }, { id: 'reviews', icon: '⭐', name: 'Reviews' }, { id: 'stats', icon: '📊', name: 'Stats' },
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
      for (const m of team) list.append(el('div', { class: 'row' }, el('span', { class: 'grow' }, `${r.icon} ${m.name}`), el('button', { class: 'btn small ghost', onclick: () => this.game.act({ t: 'fire', id: m.id }) }, 'Let go')));
      wrap.append(el('div', { class: 'card' + (lock ? ' locked' : '') }, el('div', { class: 'thumb', style: { fontSize: '54px' } }, r.icon), el('h3', {}, r.name), el('p', {}, r.desc),
        el('div', { class: 'stats' }, el('span', { class: 'chip' }, `${money(r.wage)}/day`), el('span', { class: 'chip' }, `${team.length}/${MAX_STAFF_PER_ROLE} hired`), lock ? el('span', { class: 'chip lock' }, `🔒 Level ${r.level}`) : null),
        list, el('button', { class: 'btn small coral', disabled: lock || team.length >= MAX_STAFF_PER_ROLE, onclick: () => this.game.act({ t: 'hire', role: r.id }) }, `Hire ${r.name}`)));
    }
    const wages = s.staff.reduce((a, m) => a + (STAFF.find(r => r.id === m.role)?.wage || 0), 0);
    this.body.append(el('p', { class: 'muted' }, `Salaries are paid at the end of each day. Current total: ${money(wages)}/day.`), wrap);
  }

  private renderExpand() {
    const w = this.game.world, s = w.save;
    const { w: ww, d } = shopSize(s);
    const next = EXPANSIONS[s.expansion + 1];
    const exp = el('div', { class: 'section' }, el('h3', {}, '🏗️ Expansion'),
      el('p', {}, `Your shop is ${ww} × ${d} m (rent ${money(EXPANSIONS[s.expansion].rent)}/day).`),
      next ? el('div', { class: 'row' }, el('span', { class: 'grow' }, `Next: ${next.w} × ${next.d} m · rent ${money(next.rent)}/day ${next.level > s.level ? `· 🔒 level ${next.level}` : ''}`),
        el('button', { class: 'btn coral', disabled: next.level > s.level || s.money < next.price, onclick: () => this.buy({ t: 'expand' }) }, `Expand for ${money(next.price)}`)) : el('p', { class: 'chip good' }, 'Maxed out — the whole lot is yours!'));
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
    this.body.append(exp, name, styles('🧱 Floors', 'floor', FLOORS), styles('🎨 Walls', 'wall', WALLS), styles('💡 Lights', 'light', LIGHTS));
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
      el('div', { class: 'col' }, el('h3', {}, `Today (day ${s.day})`), line('Sessions', `${t.sessions} · ${money(t.sessionRev)}`), line('Store sales', `${t.sales} items · ${money(t.salesRev)}`), line('Arcade & vending', money(t.arcadeRev)), line('Tips', money(t.tips)), line('Customers served', String(t.served)), line('Customers lost', String(t.lost)), line('Avg satisfaction', t.satN ? `${Math.round(t.satSum / t.satN)}%` : '—')),
      el('div', { class: 'col' }, el('h3', {}, 'Tonight’s bills'), line('Rent', money(rent)), line('Electricity', money(power)), line('Salaries', money(wages)), line('Total', money(rent + power + wages)), el('h3', { style: { marginTop: '10px' } }, 'All time'), line('Revenue', money(s.lifetime.revenue)), line('Customers', String(s.lifetime.customers)), line('Days run', String(s.lifetime.days)))));
  }
}
