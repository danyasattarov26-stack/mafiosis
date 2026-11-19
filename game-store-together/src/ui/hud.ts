/* Minimal HUD: money, level, clock, open sign, rating, co-op peers, crosshair, prompts, hold ring, toasts, hints. */
import { el, money, clock, esc } from '../core/util';
import { xpForLevel } from '../config/economy';
import type { SaveData } from '../core/save';

export interface PromptLine { key: string; text: string; warn?: boolean }

export class Hud {
  root: HTMLElement;
  private moneyEl: HTMLElement; private lvlEl: HTMLElement; private xpEl: HTMLElement; private clockEl: HTMLElement; private openEl: HTMLElement;
  private ratingEl: HTMLElement; private peersEl: HTMLElement; private cross: HTMLElement; private promptEl: HTMLElement;
  private holdEl: HTMLCanvasElement; private toastsEl: HTMLElement; private hintEl: HTMLElement; private carryEl: HTMLElement; private fpsEl: HTMLElement;
  private visitEl: HTMLElement;
  private lastPrompt = '';
  private lastMoney = NaN;

  constructor(parent: HTMLElement) {
    this.moneyEl = el('span', { class: 'num' });
    this.lvlEl = el('span');
    this.xpEl = el('i');
    this.clockEl = el('span', { class: 'num' });
    this.openEl = el('div', { class: 'pill closed' }, 'CLOSED');
    this.ratingEl = el('div', { class: 'pill' });
    this.peersEl = el('div', { class: 'peers' });
    this.cross = el('div', { class: 'cross' });
    this.promptEl = el('div', { class: 'prompt' });
    this.holdEl = el('canvas', { class: 'hold', width: 88, height: 88 }); this.holdEl.style.display = 'none';
    this.toastsEl = el('div', { class: 'toasts' });
    this.hintEl = el('div', { class: 'hint' }); this.hintEl.hidden = true;
    this.carryEl = el('div', { class: 'carry' }); this.carryEl.hidden = true;
    this.fpsEl = el('div', { class: 'fps' });
    this.visitEl = el('div', { class: 'pill', style: { background: '#e9e6f5' } }); this.visitEl.hidden = true;
    this.root = el('div', { class: 'hud' },
      el('div', { class: 'hud-top' },
        el('div', { class: 'pill' }, '💰', this.moneyEl),
        el('div', { class: 'pill' }, '⭐', this.lvlEl, el('div', { class: 'xp' }, this.xpEl)),
        el('div', { class: 'pill' }, '🕒', this.clockEl),
        this.openEl, this.visitEl),
      el('div', { class: 'hud-right' }, this.ratingEl, this.peersEl),
      this.cross, this.holdEl, this.promptEl, this.toastsEl, this.hintEl, this.carryEl, this.fpsEl);
    // toasts can carry buttons (invites), so they need pointer events
    this.toastsEl.style.pointerEvents = 'auto';
    parent.appendChild(this.root);
  }

  show(v: boolean) { this.root.hidden = !v; }

  update(s: SaveData, rating: number, peers: { name: string; host: boolean }[]) {
    if (s.money !== this.lastMoney) {
      if (!isNaN(this.lastMoney) && s.money > this.lastMoney) { this.moneyEl.parentElement!.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 250 }); }
      this.lastMoney = s.money; this.moneyEl.textContent = money(s.money);
      this.moneyEl.style.color = s.money < 0 ? '#c1121f' : '';
    }
    this.lvlEl.textContent = `Lv ${s.level}`;
    this.xpEl.style.width = Math.min(100, (s.xp / xpForLevel(s.level)) * 100) + '%';
    this.clockEl.textContent = `Day ${s.day} · ${clock(s.time)}`;
    const open = s.open;
    this.openEl.className = 'pill ' + (open ? 'open' : 'closed');
    this.openEl.textContent = s.dayOver ? '🌙 DAY OVER' : open ? '🟢 OPEN' : '🔴 CLOSED';
    this.ratingEl.innerHTML = `<span class="stars">${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))}</span> <span class="num">${rating.toFixed(1)}</span>`;
    const pk = peers.map(p => p.name + p.host).join();
    if (this.peersEl.dataset.k !== pk) {
      this.peersEl.dataset.k = pk;
      this.peersEl.innerHTML = '';
      const cols = ['#ff7a59', '#3ee6ff', '#80ed99', '#ff4fd8'];
      if (peers.length > 1) peers.forEach((p, i) => this.peersEl.append(el('span', { title: p.name, style: { background: cols[i % 4] } }, (p.host ? '👑' : '') || p.name.slice(0, 1).toUpperCase())));
    }
  }

  setVisit(text: string | null) { this.visitEl.hidden = !text; if (text) this.visitEl.textContent = text; }

  prompt(lines: PromptLine[], active: boolean) {
    const k = lines.map(l => l.key + l.text + (l.warn ? '!' : '')).join('|') + active;
    if (k === this.lastPrompt) return;
    this.lastPrompt = k;
    this.cross.classList.toggle('on', active);
    this.promptEl.innerHTML = lines.map(l => `<div class="${l.warn ? 'warn' : ''}">${l.key ? `<kbd>${esc(l.key)}</kbd>` : ''}${esc(l.text)}</div>`).join('');
  }

  hold(p: number | null) {
    if (p == null) { this.holdEl.style.display = 'none'; return; }
    this.holdEl.style.display = '';
    const c = this.holdEl.getContext('2d')!;
    c.clearRect(0, 0, 88, 88);
    c.lineWidth = 10; c.strokeStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(44, 44, 34, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#ffd166'; c.lineCap = 'round'; c.beginPath(); c.arc(44, 44, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); c.stroke();
  }

  toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info', ms = 3200, buttons?: { label: string; fn: () => void }[]) {
    const t = el('div', { class: 'toast ' + kind }, msg);
    if (buttons) for (const b of buttons) t.append(' ', el('button', { class: 'btn small sun', onclick: () => { b.fn(); t.remove(); } }, b.label));
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.lastElementChild!.remove();
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, ms);
  }

  hint(html: string | null) {
    if (!html) { this.hintEl.hidden = true; return; }
    if (this.hintEl.innerHTML !== html) this.hintEl.innerHTML = html;
    this.hintEl.hidden = false;
  }
  carry(text: string | null) { this.carryEl.hidden = !text; if (text) this.carryEl.textContent = text; }
  fps(text: string | null) { this.fpsEl.textContent = text || ''; }
}
