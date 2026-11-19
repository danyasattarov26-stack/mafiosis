/* Inventory (Tab), the checkout register panel, end-of-day summary, level-up perk picker and the debug panel. */
import { ITEM, PRODUCTS } from '../config/items';
import { PERKS, xpForLevel } from '../config/economy';
import { el, money, clock } from '../core/util';
import { thumbs } from '../engine/thumbs';
import { audio } from '../engine/audio';
import { input } from '../engine/input';
import { coop } from '../net/coop';
import { api } from '../net/api';
import type { Game } from '../game/game';
import type { DaySummary } from '../sim/world';

const ui = () => document.getElementById('ui')!;

// ---------- inventory ----------
export class Inventory {
  root: HTMLElement | null = null;
  sel: string | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private angle = 0;
  constructor(private game: Game, private onClose: () => void) {}
  get open() { return !!this.root; }
  show() {
    audio.play('click');
    this.root = el('div', { class: 'inv' });
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); });
    ui().appendChild(this.root);
    this.render();
  }
  close() { if (!this.root) return; this.root.remove(); this.root = null; this.canvas = null; this.onClose(); }
  render() {
    if (!this.root) return;
    const s = this.game.world.save;
    const items = Object.entries(s.inventory).filter(([, n]) => n > 0);
    if (this.sel && !(s.inventory[this.sel] > 0)) this.sel = null;
    if (!this.sel && items.length) this.sel = items[0][0];
    const grid = el('div', { class: 'grid' });
    for (const [id, n] of items) {
      const img = thumbs.get(id);
      grid.append(el('button', { class: 'inv-item' + (id === this.sel ? ' on' : ''), onclick: () => { this.sel = id; audio.play('click'); this.render(); } },
        img ? el('img', { src: img, alt: '' }) : el('div', { style: { height: '72px', fontSize: '40px' } }, '📦'), el('span', { class: 'n' }, '×' + n), el('div', {}, ITEM[id].name)));
    }
    const d = this.sel ? ITEM[this.sel] : null;
    this.canvas = el('canvas', { width: 256, height: 256 }) as HTMLCanvasElement;
    const side = el('div', { class: 'inv-side' }, this.canvas,
      d ? el('h3', {}, d.name) : el('h3', {}, 'Inventory'),
      el('p', { style: { margin: 0 } }, d ? d.desc : 'Buy things on the manager laptop. Furniture arrives in boxes: pick one up and press F to unbox it here.'),
      d ? el('button', { class: 'btn coral', disabled: this.game.readOnly, onclick: () => { const id = this.sel!; this.close(); this.game.startPlace(id); } }, d.kind === 'component' ? '🔧 Hold & install' : '📍 Place') : null,
      d ? el('button', { class: 'btn ghost', disabled: this.game.readOnly, onclick: async () => { const r = await this.game.act({ t: 'sellInv', item: this.sel! }); if (r.ok) audio.play('coins'); this.render(); } }, `Sell for ${money(Math.round(d.price / 2))}`) : null,
      el('button', { class: 'btn small ghost', onclick: () => this.close() }, 'Close (Tab)'));
    this.root.innerHTML = '';
    this.root.append(el('div', { class: 'panel inv-box' }, el('div', { class: 'inv-list' }, el('h2', { style: { fontSize: '28px', marginBottom: '10px' } }, '🎒 Inventory'),
      items.length ? grid : el('p', { class: 'muted' }, 'Nothing here yet. Unboxed furniture and picked-up items land here.')), side));
  }
  tick(dt: number) {
    if (!this.root || !this.canvas || !this.sel) return;
    this.angle += dt * 0.7;
    thumbs.preview(this.canvas, this.sel, this.angle);
  }
}

// ---------- register ----------
export class Register {
  root: HTMLElement | null = null;
  private change = 0;
  private key = '';
  constructor(private game: Game) {}
  show(v: boolean) {
    if (!v) { this.root?.remove(); this.root = null; return; }
    this.root = el('div', { class: 'panel register' });
    ui().appendChild(this.root);
    this.key = ''; this.change = 0;
    this.render();
  }
  tick() {
    if (!this.root) return;
    const c = this.game.registerCustomer();
    const k = c ? `${c.id}|${c.state}|${c.scanned}|${c.cart.length}|${c.pay}` : 'none|' + this.game.queueLength();
    if (k !== this.key) { if (!c || !this.key.startsWith(c.id)) this.change = 0; this.key = k; this.render(); }
  }
  render() {
    if (!this.root) return;
    const c = this.game.registerCustomer();
    this.root.innerHTML = '';
    const leave = el('button', { class: 'btn small ghost', onclick: () => this.game.exitRegister() }, 'Leave register (Esc)');
    if (!c) {
      this.root.append(el('div', { class: 'screen' }, el('div', { class: 'big' }, 'READY'), el('div', {}, `${this.game.queueLength()} in line`)), el('p', { class: 'muted' }, 'Waiting for a customer with a basket…'), leave);
      return;
    }
    const total = c.cart.reduce((a, b) => a + b.price, 0);
    const scannedTotal = c.cart.slice(0, c.scanned).reduce((a, b) => a + b.price, 0);
    const screen = el('div', { class: 'screen' }, el('div', {}, `ITEMS ${c.scanned}/${c.cart.length}`), el('div', { class: 'big num' }, money(c.state === 'paying' ? total : scannedTotal)));
    this.root.append(screen);
    if (c.state === 'atCounter') {
      this.root.append(el('p', { style: { margin: '0 0 8px', fontWeight: 800 } }, input.touch ? 'Tap each item on the counter to scan it.' : 'Click each item on the counter to scan it.'),
        el('div', { class: 'stats' }, ...c.cart.slice(c.scanned).map(i => el('span', { class: 'chip' }, ITEM[i.p].name))), el('div', { style: { height: '8px' } }), leave);
      return;
    }
    if (c.pay === 'card') {
      this.root.append(el('p', { style: { margin: '0 0 8px', fontWeight: 800 } }, '💳 Paying by card'),
        el('button', { class: 'btn mint', style: { width: '100%' }, onclick: () => this.game.act({ t: 'card', cust: c.id }, true).then(r => r.ok && audio.play('cash')) }, `Charge ${money(total)}`), el('div', { style: { height: '8px' } }), leave);
      return;
    }
    const due = c.given - total;
    const pad = el('div', { class: 'cashpad' });
    for (const v of [50, 20, 10, 5, 1]) pad.append(el('button', { onclick: () => { this.change += v; audio.play('coins', { vol: 0.4 }); this.render(); } }, `$${v}`));
    pad.append(el('button', { onclick: () => { this.change = 0; this.render(); } }, 'Reset'));
    this.root.append(el('p', { style: { margin: '0 0 6px', fontWeight: 800 } }, `💵 Customer gave ${money(c.given)} — change due ${money(due)}`), pad,
      el('div', { class: 'row' }, el('b', { class: 'grow num', style: { fontSize: '20px' } }, `Giving: ${money(this.change)}`),
        el('button', { class: 'btn mint', onclick: () => { const a = this.change; this.change = 0; this.game.act({ t: 'change', cust: c.id, amount: a }, true).then(r => r.ok && audio.play('cash')); } }, 'Give change')),
      el('div', { style: { height: '8px' } }), leave);
  }
}

// ---------- modals ----------
export function modal(content: HTMLElement[], opts: { onClose?: () => void; closable?: boolean } = {}) {
  const box = el('div', { class: 'panel modal', style: { position: 'relative' } }, ...content);
  const ov = el('div', { class: 'overlay' }, box);
  const close = () => { ov.remove(); opts.onClose?.(); };
  if (opts.closable !== false) { box.prepend(el('button', { class: 'close-x', 'aria-label': 'Close', onclick: close }, '×')); ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }); }
  ui().appendChild(ov);
  return { ov, close };
}

export function daySummary(game: Game, sum: DaySummary, onDone: () => void) {
  const line = (a: string, b: number, neg = false) => el('div', { class: 'line' }, el('span', {}, a), el('b', { class: 'num', style: { color: neg ? '#c1121f' : '' } }, (neg ? '−' : '') + money(b)));
  const host = game.isHost;
  const m = modal([
    el('h2', {}, `🌙 Day ${sum.day} complete!`),
    el('p', { class: 'muted' }, `${sum.served} customers served · ${sum.lost} walked out · satisfaction ${sum.sat}% · rating ${sum.rating.toFixed(1)}★${sum.thefts ? ` · ${sum.thefts} theft${sum.thefts > 1 ? 's' : ''}` : ''}`),
    el('div', { class: 'summary-grid' },
      el('div', { class: 'col' }, el('h3', {}, 'Income'), ...Object.entries(sum.income).map(([k, v]) => line(k, v))),
      el('div', { class: 'col' }, el('h3', {}, 'Costs'), ...Object.entries(sum.costs).map(([k, v]) => line(k, v, v > 0)))),
    el('div', { class: 'net', style: { color: sum.net >= 0 ? '#1b7a3d' : '#c1121f' } }, `${sum.net >= 0 ? 'Profit' : 'Loss'}: ${money(Math.abs(sum.net))}`),
    el('p', { style: { textAlign: 'center', margin: '0 0 6px' } }, `+${sum.xp} XP today`),
    ...(sum.reviews.length ? [el('div', {}, ...sum.reviews.slice(-3).map(r => el('div', { class: 'review' }, el('span', { class: 'stars' }, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)), ' ', r.text)))] : []),
    host ? el('button', { class: 'btn coral', style: { width: '100%', marginTop: '10px' }, onclick: () => { m.close(); onDone(); } }, '☀️ Start the next day') : el('p', { class: 'chip', style: { marginTop: '10px' } }, 'Waiting for the host to start the next day…'),
  ], { closable: !host, onClose: host ? undefined : () => {} });
  return m;
}

export function levelUp(game: Game, level: number, unlocks: string[], onDone: () => void) {
  const s = game.world.save;
  const choices = PERKS.filter(p => !s.perks.includes(p.id)).sort(() => Math.random() - 0.5).slice(0, 3);
  const pickable = game.isHost && s.pendingPerks > 0 && choices.length;
  const m = modal([
    el('h2', {}, `⭐ Level ${level}!`),
    unlocks.length ? el('div', { class: 'stats', style: { margin: '6px 0 12px' } }, ...unlocks.slice(0, 10).map(u => el('span', { class: 'chip good' }, '🔓 ' + u))) : el('p', {}, 'Your shop is getting famous.'),
    pickable ? el('h3', { style: { margin: '6px 0' } }, 'Pick a perk') : el('p', { class: 'muted' }, game.isHost ? '' : 'The host picks a perk.'),
    pickable ? el('div', { class: 'perks' }, ...choices.map(p => el('button', { class: 'perk', onclick: async () => { await game.act({ t: 'perk', id: p.id }, true); audio.play('levelup'); m.close(); onDone(); } }, el('div', { class: 'ico' }, p.icon), el('b', {}, p.name), el('span', { class: 'muted' }, p.desc)))) : el('button', { class: 'btn coral', onclick: () => { m.close(); onDone(); } }, 'Nice!'),
  ], { closable: !pickable, onClose: onDone });
  return m;
}

// ---------- debug panel ----------
export class Debug {
  root: HTMLElement | null = null;
  private fps = 0; private frames = 0; private acc = 0;
  constructor(private game: Game) {}
  toggle() { if (this.root) { this.root.remove(); this.root = null; } else { this.root = el('div', { class: 'debug' }); ui().appendChild(this.root); this.build(); } }
  private build() {
    const g = this.game, b = (t: string, f: () => void) => el('button', { onclick: f }, t);
    const info = el('div', { id: 'dbg-info' });
    const types = ['casual', 'kid', 'pro', 'spender', 'trouble'];
    this.root!.append(el('b', {}, 'DEBUG (F3)'), info,
      el('div', {}, b('+$1000', () => g.act({ t: 'cheat', what: 'money', n: 1000 })), b('+XP', () => g.act({ t: 'cheat', what: 'xp', n: 150 })), b('+1h', () => g.act({ t: 'cheat', what: 'time', n: 60 })), b('licenses', () => g.act({ t: 'cheat', what: 'licenses' }))),
      el('div', {}, ...types.map(t => b('+' + t, () => g.act({ t: 'cheat', what: 'customer', type: t } as any)))),
      el('div', {}, b('trash', () => g.act({ t: 'cheat', what: 'trash' })), b('break PC', () => g.act({ t: 'cheat', what: 'break' })), b('open/close', () => g.act({ t: 'toggleOpen' })), b('end day', () => g.act({ t: 'cheat', what: 'endday' }))),
      el('div', {}, b('stock all', () => { for (const p of PRODUCTS) g.act({ t: 'buy', item: p.id }, true); }), b('save json', () => { const s = JSON.stringify(g.world.save); navigator.clipboard?.writeText(s).catch(() => {}); console.log(s); })));
  }
  tick(dt: number) {
    this.frames++; this.acc += dt;
    if (this.acc >= 0.5) { this.fps = this.frames / this.acc; this.frames = 0; this.acc = 0; }
    if (!this.root) return;
    const g = this.game, w = g.world, s = w.save, r = g.gfx.renderer.info;
    const info = this.root.querySelector('#dbg-info')!;
    info.innerHTML = [`fps <b>${this.fps.toFixed(0)}</b> · draw ${r.render.calls} · tris ${(r.render.triangles / 1000).toFixed(0)}k`,
      `mode ${g.mode} · ${coop.role}${coop.room ? ' @' + coop.room : ''} · peers ${coop.peers.length}`,
      `net sent ${coop.stats.sent} recv ${coop.stats.recv} · api ${api.status}${api.realtime ? ' · realtime' : ' · local'}`,
      `day ${s.day} ${clock(s.time)} · open ${s.open} · lvl ${s.level} xp ${Math.round(s.xp)}/${xpForLevel(s.level)}`,
      `cust ${w.customers.length} · staff ${w.staff.length} · objs ${s.objects.length} · boxes ${s.boxes.length} · trash ${s.trash.length}`,
      `rev ${w.rev} · rating ${g.sim?.rating().toFixed(2) ?? '-'} · spawn ×${g.sim?.spawnRate().toFixed(2) ?? '-'}`,
      `pos ${g.player.pos.x.toFixed(1)}, ${g.player.pos.z.toFixed(1)}`].join('<br>');
  }
  get fpsValue() { return this.fps; }
}
