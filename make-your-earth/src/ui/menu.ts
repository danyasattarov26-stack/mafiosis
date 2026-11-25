/* Main menu over the turning Earth: Play (single player, host, join), Friends, Settings, Credits; EN/PT switch. */
import { t, setLang, lang, onLang } from '../i18n/i18n';
import { settings, saveSettings, applyPreset, PRESETS, DEFAULT_KEYS, type Preset } from '../game/settings';
import { profile, saveProfile, friends, saveFriends, inbox, cleanName, newCode, type Friend } from '../net/coop';
import { FLAGS } from '../monetization/flags';
import { sound } from '../audio/audio';
import type { SaveData } from '../game/game';

export type PlayChoice = { mode: 'single' | 'host'; save: SaveData; invite?: string[] } | { mode: 'join'; code: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function listWorlds(): SaveData[] {
  const out: SaveData[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!; if (!k.startsWith('mye-world-')) continue;
    try { out.push(JSON.parse(localStorage.getItem(k)!)); } catch { /* broken save */ }
  }
  return out.sort((a, b) => (b.played || 0) - (a.played || 0));
}
export function newWorld(name: string, seed?: number): SaveData {
  const s = seed ?? Math.floor(Math.random() * 2 ** 31);
  return { id: newCode(8), name: name || 'My Earth', seed: s, created: Date.now(), played: Date.now(), time: 1200 * 0.3, edits: {}, player: null, graves: [], explored: [], waypoints: [] };
}

export class Menu {
  root: HTMLElement; tab = 'play';
  onPlay: (c: PlayChoice) => void = () => {};
  private status = new Map<string, string>();
  private party = new Set<string>();
  constructor(private credits: { models: any[]; sounds: any[] }) {
    this.root = document.createElement('div'); this.root.id = 'menu';
    document.body.appendChild(this.root);
    onLang(() => this.render());
    this.render();
    const p = profile(); inbox.status = () => ({ name: p.name || settings.name, playing: null, room: null, players: 0 }); inbox.open(p.code);
  }
  show(v: boolean) { this.root.hidden = !v; if (v) this.render(); }

  render() {
    const p = profile();
    this.root.innerHTML = `
      <header><div class="brand"><h1>${t('title')}</h1><p>${t('tagline')}</p></div>
        <div class="lang"><button data-lang="en" class="${lang() === 'en' ? 'on' : ''}">EN</button><button data-lang="pt-PT" class="${lang() === 'pt-PT' ? 'on' : ''}">PT</button></div></header>
      <nav>${['play', 'friends', 'settings', 'credits'].map(k => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${t(('tab.' + k) as any)}</button>`).join('')}</nav>
      <section class="body"></section>
      <footer>${FLAGS.support ? `<button class="btn ghost">${t('misc.support')}</button>` : ''}<small>${t('misc.version', { v: __BUILD__ })}</small></footer>`;
    this.root.querySelectorAll<HTMLElement>('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang as any); sound.play('click'); });
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab!; sound.start(); sound.play('click'); this.render(); });
    const body = $('.body', this.root);
    if (this.tab === 'play') this.renderPlay(body);
    if (this.tab === 'friends') this.renderFriends(body, p);
    if (this.tab === 'settings') this.renderSettings(body);
    if (this.tab === 'credits') this.renderCredits(body);
  }

  private renderPlay(body: HTMLElement) {
    const worlds = listWorlds();
    body.innerHTML = `
      <label class="field"><span>${t('play.yourName')}</span><input class="pname" maxlength="16" value="${esc(settings.name)}" placeholder="Ada Stone"></label>
      <div class="card"><h3>${t('play.singleplayer')}</h3>
        <div class="worlds">${worlds.length ? worlds.map(w => `<div class="world"><div><b>${esc(w.name)}</b><small>${t('play.lastPlayed')} ${new Date(w.played).toLocaleDateString()}</small></div>
          <button class="btn" data-go="${w.id}">${t('play.continue')}</button><button class="btn ghost" data-host="${w.id}">${t('play.host')}</button><button class="icon" data-del="${w.id}" title="${t('play.delete')}">🗑</button></div>`).join('') : `<p class="muted">${t('play.none')}</p>`}</div>
        <div class="row"><input class="wname" placeholder="${t('play.worldName')}" maxlength="24"><input class="wseed" placeholder="${t('play.seed')} (${t('play.random')})" maxlength="12">
          <button class="btn big" data-new="single">${t('play.newWorld')}</button></div>
      </div>
      <div class="card"><h3>${t('play.coop')}</h3><p class="muted">${t('play.coopHint')}</p>
        <div class="row"><button class="btn" data-new="host">${t('play.hostBtn')}</button><input class="jcode" placeholder="${t('play.code')}" maxlength="6"><button class="btn" data-join>${t('play.joinBtn')}</button></div>
      </div>`;
    const name = $<HTMLInputElement>('.pname', body);
    name.onchange = () => { settings.name = cleanName(name.value); name.value = settings.name; saveSettings(); const pr = profile(); pr.name = settings.name; saveProfile(pr); };
    const seedOf = () => { const v = $<HTMLInputElement>('.wseed', body).value.trim(); if (!v) return undefined; const n = Number(v); return Number.isFinite(n) ? Math.abs(Math.floor(n)) : [...v].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); };
    body.querySelectorAll<HTMLElement>('[data-new]').forEach(b => b.onclick = () => { sound.start(); const w = newWorld($<HTMLInputElement>('.wname', body).value.trim(), seedOf()); this.onPlay({ mode: b.dataset.new as any, save: w }); });
    body.querySelectorAll<HTMLElement>('[data-go]').forEach(b => b.onclick = () => { sound.start(); this.onPlay({ mode: 'single', save: worlds.find(w => w.id === b.dataset.go)! }); });
    body.querySelectorAll<HTMLElement>('[data-host]').forEach(b => b.onclick = () => { sound.start(); this.onPlay({ mode: 'host', save: worlds.find(w => w.id === b.dataset.host)! }); });
    body.querySelectorAll<HTMLElement>('[data-del]').forEach(b => b.onclick = () => { if (confirm(t('play.delete') + '?')) { localStorage.removeItem('mye-world-' + b.dataset.del); this.render(); } });
    $<HTMLElement>('[data-join]', body).onclick = () => { const c = $<HTMLInputElement>('.jcode', body).value.trim().toUpperCase(); if (c.length >= 4) { sound.start(); this.onPlay({ mode: 'join', code: c }); } };
  }

  private renderFriends(body: HTMLElement, p: ReturnType<typeof profile>) {
    const list = friends();
    body.innerHTML = `
      <div class="card"><h3>${t('friends.yourCode')}</h3><div class="row"><code class="mycode">${p.code}</code><button class="btn" data-copy>${t('friends.copy')}</button></div></div>
      <div class="card"><h3>${t('friends.add')}</h3><div class="row"><input class="fcode" maxlength="6" placeholder="${t('friends.addHint')}"><input class="fname" maxlength="16" placeholder="${t('play.yourName')}"><button class="btn" data-add>${t('friends.add')}</button></div></div>
      <div class="card"><h3>${t('tab.friends')}</h3><p class="muted">${t('friends.party')}</p>
        <div class="friends">${list.length ? list.map(f => `<div class="friend"><label><input type="checkbox" data-party="${f.code}" ${this.party.has(f.code) ? 'checked' : ''}> <b>${esc(f.name || f.code)}</b> <code>${f.code}</code></label>
          <span class="st ${this.status.get(f.code) ?? ''}">${this.status.get(f.code) === 'on' ? '● ' + t('friends.online') : this.status.get(f.code) === 'play' ? '● ' + t('friends.playing') : '○ ' + t('friends.offline')}</span>
          <button class="icon" data-rm="${f.code}" title="${t('friends.remove')}">✕</button></div>`).join('') : `<p class="muted">${t('friends.none')}</p>`}</div>
        ${list.length ? `<button class="btn big" data-together>${t('friends.spawnTogether')}</button>` : ''}
      </div>`;
    $<HTMLElement>('[data-copy]', body).onclick = e => { navigator.clipboard?.writeText(p.code).catch(() => {}); (e.target as HTMLElement).textContent = t('friends.copied'); };
    $<HTMLElement>('[data-add]', body).onclick = () => {
      const code = $<HTMLInputElement>('.fcode', body).value.trim().toUpperCase(), name = cleanName($<HTMLInputElement>('.fname', body).value);
      if (code.length !== 6 || code === p.code || list.some(f => f.code === code)) return;
      saveFriends([...list, { code, name }]); this.render(); this.probeAll();
    };
    body.querySelectorAll<HTMLElement>('[data-rm]').forEach(b => b.onclick = () => { saveFriends(list.filter(f => f.code !== b.dataset.rm)); this.render(); });
    body.querySelectorAll<HTMLInputElement>('[data-party]').forEach(c => c.onchange = () => { if (c.checked) { if (this.party.size >= 4) { c.checked = false; return; } this.party.add(c.dataset.party!); } else this.party.delete(c.dataset.party!); });
    const tog = body.querySelector<HTMLElement>('[data-together]');
    if (tog) tog.onclick = () => {
      const pick = [...this.party].length ? [...this.party] : list.filter(f => this.status.get(f.code) === 'on').map(f => f.code).slice(0, 4);
      if (!pick.length) return;
      const w = listWorlds()[0] ?? newWorld('Together');
      sound.start(); this.onPlay({ mode: 'host', save: w, invite: pick });
    };
    this.probeAll();
  }
  private probing = false;
  private async probeAll() {
    if (this.probing) return; this.probing = true;
    await Promise.all(friends().map(async (f: Friend) => { const s = await inbox.probe(f.code, 8000); this.status.set(f.code, s ? (s.room ? 'play' : 'on') : 'off'); }));
    this.probing = false; if (this.tab === 'friends' && !this.root.hidden) this.render();
  }

  renderSettings(body: HTMLElement, onClose?: () => void) {
    const s = settings;
    const slider = (k: keyof typeof s, label: string, min: number, max: number, step: number, fmt = (v: number) => String(v)) =>
      `<label class="field slider"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"><b>${fmt(s[k] as number)}</b></label>`;
    const toggle = (k: keyof typeof s, label: string) => `<label class="field toggle"><span>${label}</span><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}></label>`;
    body.innerHTML = `
      <div class="card"><h3>${t('set.graphics')}</h3>
        <div class="seg">${(Object.keys(PRESETS) as Preset[]).map(p => `<button data-preset="${p}" class="${s.preset === p ? 'on' : ''}">${t(('set.' + p) as any)}</button>`).join('')}</div>
        ${s.autoDetected ? `<p class="muted">✓ ${t('set.autoDetected')}</p>` : ''}
        ${slider('render', t('set.render'), 3, 16, 1, v => v + ' ' + t('set.chunks'))}${slider('sim', t('set.sim'), 2, 8, 1, v => v + ' ' + t('set.chunks'))}
        <p class="muted">${t('set.chunkNote')}</p>
        ${slider('scale', t('set.scale'), 0.5, 1.5, 0.05, v => Math.round(v * 100) + '%')}${slider('fov', t('set.fov'), 55, 100, 1, v => v + '°')}
        ${toggle('shadows', t('set.shadows'))}${toggle('foliage', t('set.foliage'))}${toggle('particles', t('set.particles'))}
      </div>
      <div class="card"><h3>${t('set.audio')}</h3>${slider('master', t('set.master'), 0, 1, 0.05, v => Math.round(v * 100) + '%')}${slider('ambience', t('set.music'), 0, 1, 0.05, v => Math.round(v * 100) + '%')}${slider('sfx', t('set.sfx'), 0, 1, 0.05, v => Math.round(v * 100) + '%')}</div>
      <div class="card"><h3>${t('set.controls')}</h3>${slider('sensitivity', t('set.sensitivity'), 0.2, 3, 0.05, v => v.toFixed(2))}${toggle('invertY', t('set.invertY'))}${toggle('profanity', t('set.profanity'))}
        <p class="muted">${t('set.rebind')}</p>
        <div class="keys">${Object.keys(DEFAULT_KEYS).map(a => `<label class="field"><span>${t(('key.' + a) as any)}</span><button class="keybtn" data-key="${a}">${s.keys[a].replace(/^Key|^Digit/, '')}</button></label>`).join('')}</div>
      </div>
      ${onClose ? `<button class="btn big" data-close>${t('set.close')}</button>` : ''}`;
    body.querySelectorAll<HTMLElement>('[data-preset]').forEach(b => b.onclick = () => { applyPreset(b.dataset.preset as Preset); this.renderSettings(body, onClose); });
    body.querySelectorAll<HTMLInputElement>('input[data-k]').forEach(i => i.oninput = () => {
      const k = i.dataset.k as keyof typeof s;
      (s as any)[k] = i.type === 'checkbox' ? i.checked : +i.value;
      if (i.type === 'range') { const b = i.parentElement!.querySelector('b'); if (b) b.textContent = i.value; }
      if (['render', 'sim', 'scale', 'fov', 'shadows', 'foliage', 'particles'].includes(k)) s.autoDetected = false;
      saveSettings(); sound.volumes();
    });
    body.querySelectorAll<HTMLElement>('[data-key]').forEach(b => b.onclick = () => {
      b.textContent = t('set.pressKey');
      const on = (e: KeyboardEvent) => { e.preventDefault(); s.keys[b.dataset.key!] = e.code; saveSettings(); removeEventListener('keydown', on, true); this.renderSettings(body, onClose); };
      addEventListener('keydown', on, true);
    });
    const c = body.querySelector<HTMLElement>('[data-close]'); if (c && onClose) c.onclick = onClose;
  }

  private renderCredits(body: HTMLElement) {
    const { models, sounds } = this.credits;
    body.innerHTML = `<div class="card credits"><p>${t('credits.code')} ${t('credits.thanks')}</p>
      <h3>${t('credits.models')}</h3><ul>${models.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
      <h3>${t('credits.sounds')}</h3><ul>${sounds.map((s: any) => `<li>“${esc(s.title)}” by ${esc(s.author)} — ${esc(s.license)} — <a href="${esc(s.url)}" target="_blank" rel="noopener">freesound.org</a></li>`).join('')}</ul></div>`;
  }
}
declare const __BUILD__: string;
