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
import { localMods, saveLocalMod, removeLocalMod } from '../mods/mods';
import { BUILDERS } from '../world/structures';

const CATS: [string, (k: string) => boolean][] = [
  ['all', () => true], ['block', k => ITEM[k].kind === 'block'], ['tool', k => ITEM[k].kind === 'tool' || ITEM[k].kind === 'weapon' || !!ITEM[k].shield],
  ['armor', k => ITEM[k].kind === 'armor'], ['food', k => ['food', 'drink', 'medicine'].includes(ITEM[k].kind)], ['material', k => ITEM[k].kind === 'material' || ITEM[k].kind === 'misc'],
];

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Admin {
  root: HTMLElement;
  private invView: { name: string; items: { k: string; n: number }[] } | null = null;
  private sel = 'torch'; private cat = 'all'; private q = ''; private amount = 16; private to = 'me';
  constructor(private game: Game, private session: Session | null, private onClose: () => void) {
    this.root = document.createElement('div'); this.root.className = 'overlay admin-wrap';
    document.body.appendChild(this.root);
    if (session) session.onInventory = (name, items) => { this.invView = { name, items }; this.render(); };
    this.render();
  }
  private pickList() {
    const test = CATS.find(c => c[0] === this.cat)![1], qq = this.q.trim().toLowerCase();
    return ITEMS.filter(i => test(i.key) && (!qq || nm(i).toLowerCase().includes(qq) || i.key.includes(qq) || i.en.toLowerCase().includes(qq))).slice(0, 240);
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
          <div class="picker">
            <div class="row"><input class="aq" placeholder="🔍 ${t('admin.search')}" value="${esc(this.q)}"></div>
            <div class="seg cats">${CATS.map(([c]) => `<button data-cat="${c}" class="${this.cat === c ? 'on' : ''}">${t(('admin.cat.' + c) as any)}</button>`).join('')}</div>
            <div class="pgrid">${this.pickList().map(i => `<button class="pick ${i.key === this.sel ? 'on' : ''}" data-pick="${i.key}" title="${esc(nm(i))}"><img src="${itemIcon(i.key)}" alt=""></button>`).join('')}</div>
            <div class="row chosen"><img src="${itemIcon(this.sel)}" alt=""><b>${esc(nm(ITEM[this.sel]))}</b><small>${esc(this.sel)}</small></div>
            <div class="row"><div class="seg">${[1, 16, 64].map(n => `<button data-amt="${n}" class="${this.amount === n ? 'on' : ''}">${n}</button>`).join('')}</div><input class="aamt" type="number" min="1" max="999" value="${this.amount}"></div>
            <div class="row"><span>${t('admin.to')}</span><select class="ato"><option value="me">${t('admin.self')}</option>${peers.map(([id, name]) => `<option value="${id}" ${this.to === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select><button class="btn big" data-give>${t('admin.give')}</button></div>
          </div>
          <h4>${t('admin.teleport')}</h4>
          <div class="row"><input class="tpx" type="number" placeholder="X" value="${Math.round(g.player.pos.x)}"><input class="tpz" type="number" placeholder="Z" value="${Math.round(g.player.pos.z)}"><button class="btn" data-tpgo>${t('admin.go')}</button></div>
          <div class="row">${g.bed ? `<button class="btn small" data-tpbed>🛏 ${t('admin.toBed')}</button>` : ''}${g.data.quest?.beacon ? `<button class="btn small" data-tpbeacon>✨ ${t('admin.toBeacon')}</button>` : ''}${g.waypoints.map((w, i) => `<button class="btn small" data-tpwp="${i}">📍 ${esc(w.label)}</button>`).join('')}
            <button class="btn small" data-dim>${g.dim === 'earth' ? '☁ ' + t('admin.toSky') : '🌍 ' + t('admin.toEarth')}</button></div>
          <h4>${t('admin.structures')}</h4>
          <div class="row"><select class="astruct">${Object.keys(BUILDERS).sort().map(k => `<option value="${k}">${esc(t(('struct.' + k) as any))}</option>`).join('')}</select><button class="btn" data-struct>${t('admin.build')}</button></div>
          <h4>${t('admin.time')}</h4><div class="seg">${[['morning', 0.3], ['noon', 0.5], ['evening', 0.76], ['night', 0.0]].map(([k, f]) => `<button data-time="${f}">${t(('admin.' + k) as any)}</button>`).join('')}</div>
          <h4>${t('admin.weather')}</h4><div class="seg">${['clear', 'rain', 'storm'].map(w => `<button data-weather="${w}" class="${g.weather === w ? 'on' : ''}">${t(('admin.' + w) as any)}</button>`).join('')}</div>
          <h4>${t('admin.tools')}</h4>
          <div class="row"><button class="btn" data-heal>${t('admin.heal')}</button><button class="btn" data-clearanimals>${t('admin.clearAnimals')}</button></div>
          <label class="field toggle"><span>${t('admin.god')}</span><input type="checkbox" class="agod" ${g.player.god ? 'checked' : ''}></label>
          <h4>${t('admin.mods')}</h4><p class="muted">${t('admin.modsHint')}</p>
          ${localMods().map(m => `<div class="row"><span>🧩 ${esc(m.name)} <small>v${esc(m.version)}</small></span><button class="btn small bad" data-rmmod="${esc(m.id)}">${t('admin.remove')}</button></div>`).join('')}
          <label class="btn small filebtn">📂 ${t('admin.installMod')}<input type="file" accept=".js,.mjs,text/javascript" class="modfile" hidden></label>
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
    // getting around and building
    const tp = (x: number, z: number) => {
      const y = g.world.surface(Math.floor(x), Math.floor(z));
      g.player.pos.set(x + 0.5, Math.max(y + 1.5, 4) + (g.world.chunkAt(x, z) ? 0 : 30), z + 0.5); g.player.vel.set(0, 0, 0); g.slowFall = 6; g.ready = false;
      this.close();
    };
    q('[data-tpgo]').onclick = () => { const x = +q<HTMLInputElement>('.tpx').value, z = +q<HTMLInputElement>('.tpz').value; if (isFinite(x) && isFinite(z)) tp(Math.round(x), Math.round(z)); };
    const tb = this.root.querySelector<HTMLElement>('[data-tpbed]'); if (tb && g.bed) tb.onclick = () => tp(g.bed![0], g.bed![2] + 1);
    const tbc = this.root.querySelector<HTMLElement>('[data-tpbeacon]'); if (tbc) tbc.onclick = () => { const b = g.data.quest!.beacon!; tp(b[0] + 2, b[2]); };
    on('tpwp', i => { const w = g.waypoints[+i]; if (w) tp(w.x, w.z); });
    q('[data-dim]').onclick = () => { this.close(); g.travel(); };
    q('[data-struct]').onclick = () => { const k = q<HTMLSelectElement>('.astruct').value; if (g.spawnStructure(k)) { g.toast(t('admin.built', { name: t(('struct.' + k) as any) }), 'good'); this.close(); } };
    // the item picker: search, categories, pick an icon, choose how many
    const aq = q<HTMLInputElement>('.aq');
    aq.oninput = () => { this.q = aq.value; const pos = aq.selectionStart; this.render(); const a2 = q<HTMLInputElement>('.aq'); a2.focus(); a2.setSelectionRange(pos, pos); };
    on('cat', c => { this.cat = c; this.render(); });
    on('pick', k => { this.sel = k; this.render(); });
    on('amt', n => { this.amount = +n; this.render(); });
    q<HTMLInputElement>('.aamt').onchange = e => { this.amount = Math.max(1, Math.min(999, +(e.target as HTMLInputElement).value || 1)); };
    q<HTMLSelectElement>('.ato').onchange = e => { this.to = (e.target as HTMLSelectElement).value; };
    q('[data-give]').onclick = () => {
      const it = ITEM[this.sel]; if (!it) return;
      const n = this.amount, to = q<HTMLSelectElement>('.ato').value;
      if (to === 'me') g.give(it.key, n); else s?.room.send({ k: 'give', items: [[it.key, Math.min(64 * 9, n)]] }, to);
      g.toast(`+${n} ${nm(it)}`, 'good'); sound.play('pickup');
    };
    // mods on this device only (the owner trying one out before publishing it)
    on('rmmod', id => { removeLocalMod(id); g.toast(t('admin.modReload')); this.render(); });
    q<HTMLInputElement>('.modfile').onchange = async e => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      const code = await f.text();
      if (!/export\s+default/.test(code)) { g.toast(t('admin.modBad'), 'bad'); return; }
      const id = 'local-' + f.name.replace(/\.m?js$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
      saveLocalMod({ id, name: f.name.replace(/\.m?js$/, ''), description: t('admin.localDesc'), version: '0', author: 'owner', file: '', code });
      g.toast(t('admin.modReload'), 'good'); this.render();
    };
    const bc = this.root.querySelector<HTMLElement>('[data-bc]');
    if (bc) bc.onclick = () => { const v = q<HTMLInputElement>('.abc').value.trim(); if (v) { s!.say('📢 ' + v); q<HTMLInputElement>('.abc').value = ''; } };
  }
}
