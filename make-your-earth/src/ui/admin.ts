/*
  Admin panel for the world's owner (the host in co-op, or you in single player). Opens with F2 or from the
  pause menu. Players: kick, ban, mute, go to, bring here, give items, see their inventory. World: time,
  weather, message everyone, clear animals. You: heal and feed, god mode, give yourself anything.
*/
import { t, nm } from '../i18n/i18n';
import { ITEMS, ITEM } from '../shared/items';
import { itemIcon } from '../render/textures';
import { DAY, type Game } from '../game/game';
import type { Session } from '../net/session';
import { sound } from '../audio/audio';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Admin {
  root: HTMLElement;
  private invView: { name: string; items: { k: string; n: number }[] } | null = null;
  constructor(private game: Game, private session: Session | null, private onClose: () => void) {
    this.root = document.createElement('div'); this.root.className = 'overlay admin-wrap';
    document.body.appendChild(this.root);
    if (session) session.onInventory = (name, items) => { this.invView = { name, items }; this.render(); };
    this.render();
  }
  close() { this.root.remove(); if (this.session) this.session.onInventory = () => {}; this.onClose(); }

  private render() {
    const g = this.game, s = this.session;
    const banned = g.data.admin?.banned ?? [];
    const peers = s ? [...s.names] : [];
    this.root.innerHTML = `<div class="admin"><button class="close">✕</button><h3>🛠 ${t('admin.title')}</h3>
      <div class="admin-cols">
        <div class="card"><h4>${t('admin.players')}</h4>
          ${peers.length ? peers.map(([id, name]) => `<div class="aplayer"><b>${esc(name)}</b>
            <div class="row">
              <button class="btn small" data-tp="${id}">${t('admin.tpTo')}</button><button class="btn small" data-bring="${id}">${t('admin.bring')}</button>
              <button class="btn small" data-inv="${id}">${t('admin.inv')}</button>
              <button class="btn small" data-mute="${id}">${s!.muted.has(id) ? t('admin.unmute') : t('admin.mute')}</button>
              <button class="btn small bad" data-kick="${id}">${t('admin.kick')}</button><button class="btn small bad" data-ban="${id}">${t('admin.ban')}</button>
            </div></div>`).join('') : `<p class="muted">${t('admin.noPlayers')}</p>`}
          ${banned.length ? `<h4>${t('admin.banList')}</h4>${banned.map(n => `<div class="row"><span>${esc(n)}</span><button class="btn small" data-unban="${esc(n)}">${t('admin.unban')}</button></div>`).join('')}` : ''}
          ${this.invView ? `<h4>${t('admin.invOf', { name: this.invView.name })}</h4><div class="ainv">${this.invView.items.map(i => `<span title="${esc(nm(ITEM[i.k]))}"><img src="${itemIcon(i.k)}" alt="">${i.n}</span>`).join('') || '—'}</div>` : ''}
        </div>
        <div class="card"><h4>${t('admin.give')}</h4>
          <datalist id="adm-items">${ITEMS.map(i => `<option value="${esc(nm(i))}">`).join('')}</datalist>
          <div class="row"><input class="aitem" list="adm-items" placeholder="${t('admin.item')}"><input class="aamt" type="number" min="1" max="999" value="16"></div>
          <div class="row"><span>${t('admin.to')}</span><select class="ato"><option value="me">${t('admin.self')}</option>${peers.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')}</select><button class="btn" data-give>${t('admin.give')}</button></div>
          <h4>${t('admin.time')}</h4><div class="seg">${[['morning', 0.3], ['noon', 0.5], ['evening', 0.76], ['night', 0.0]].map(([k, f]) => `<button data-time="${f}">${t(('admin.' + k) as any)}</button>`).join('')}</div>
          <h4>${t('admin.weather')}</h4><div class="seg">${['clear', 'rain', 'storm'].map(w => `<button data-weather="${w}" class="${g.weather === w ? 'on' : ''}">${t(('admin.' + w) as any)}</button>`).join('')}</div>
          <h4>${t('admin.tools')}</h4>
          <div class="row"><button class="btn" data-heal>${t('admin.heal')}</button><button class="btn" data-clearanimals>${t('admin.clearAnimals')}</button></div>
          <label class="field toggle"><span>${t('admin.god')}</span><input type="checkbox" class="agod" ${g.player.god ? 'checked' : ''}></label>
          ${s ? `<h4>${t('admin.broadcast')}</h4><div class="row"><input class="abc" maxlength="200"><button class="btn" data-bc>${t('admin.send')}</button></div>` : ''}
        </div>
      </div></div>`;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    q('.close').onclick = () => this.close();
    const on = (attr: string, f: (v: string) => void) => this.root.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach(b => b.onclick = () => { sound.play('click', { vol: 0.4 }); f(b.dataset[attr]!); });
    on('tp', id => { const r = g.remotes.get(id); if (r) { g.player.pos.copy(r.pos).add({ x: 1.2, y: 0.2, z: 0 } as any); this.close(); } });
    on('bring', id => s?.room.send({ k: 'tp', x: g.player.pos.x + 1.5, y: g.player.pos.y + 0.3, z: g.player.pos.z }, id));
    on('inv', id => { s?.room.send({ k: 'invreq' }, id); });
    on('mute', id => { if (!s) return; s.muted.has(id) ? s.muted.delete(id) : s.muted.add(id); this.render(); });
    on('kick', id => { s?.room.send({ k: 'kick' }, id); });
    on('ban', id => { const name = s?.names.get(id); if (!name) return; g.data.admin = { banned: [...new Set([...banned, name])] }; s!.room.send({ k: 'kick', ban: true }, id); g.save(); this.render(); });
    on('unban', name => { g.data.admin = { banned: banned.filter(n => n !== name) }; g.save(); this.render(); });
    on('time', f => { g.time = Math.floor(g.time / DAY) * DAY + +f * DAY; s?.syncTime(); });
    on('weather', w => { g.weather = w as any; g.weatherT = 600; s?.syncTime(); this.render(); });
    on('heal', () => { Object.assign(g.player.stats, { health: 100, hunger: 100, thirst: 100, stamina: 100, temp: 37, sick: 0 }); g.onChange(); });
    on('clearanimals', () => g.animals.clear());
    q<HTMLInputElement>('.agod').onchange = e => { g.player.god = (e.target as HTMLInputElement).checked; };
    q('[data-give]').onclick = () => {
      const name = q<HTMLInputElement>('.aitem').value.trim().toLowerCase(), n = Math.max(1, Math.min(999, +q<HTMLInputElement>('.aamt').value || 1));
      const it = ITEMS.find(i => nm(i).toLowerCase() === name || i.key === name); if (!it) return;
      const to = q<HTMLSelectElement>('.ato').value;
      if (to === 'me') g.give(it.key, n); else s?.room.send({ k: 'give', items: [[it.key, Math.min(64 * 9, n)]] }, to);
      sound.play('pickup');
    };
    const bc = this.root.querySelector<HTMLElement>('[data-bc]');
    if (bc) bc.onclick = () => { const v = q<HTMLInputElement>('.abc').value.trim(); if (v) { s!.say('📢 ' + v); q<HTMLInputElement>('.abc').value = ''; } };
  }
}
