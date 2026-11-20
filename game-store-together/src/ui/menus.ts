/* Main menu, pause menu, settings, friends & invites, join, character creator, welcome and credits. */
import * as THREE from 'three';
import { el, esc, isTouch, BUILD } from '../core/util';
import { settings, saveSettings, type Quality } from '../core/settings';
import { audio } from '../engine/audio';
import { input } from '../engine/input';
import { thumbs } from '../engine/thumbs';
import { api, fmtCode, DEFAULT_LOOK, type Look, type Friend } from '../net/api';
import { coop } from '../net/coop';
import { CharView } from '../world/chars';
import { HATS } from '../world/props';
import { SKIN_TONES } from '../engine/assets';
import { modal } from './panels';

const ui = () => document.getElementById('ui')!;
const SHIRTS = ['#ff7a59', '#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#7b2cbf', '#2b2d42', '#f1f1f1', '#ff4fd8', '#80ed99'];
const PANTS = ['#3d5a80', '#2b2d42', '#6c584c', '#adb5bd', '#264653', '#9d0208', '#ffd6a5', '#5e60ce'];
const HAT_NAMES: Record<string, string> = { none: 'None', cap: 'Cap', beanie: 'Beanie', headphones: 'Headset', tophat: 'Top hat', crown: 'Crown', cowboy: 'Cowboy', party: 'Party' };

export interface MenuActions {
  hasSave(): boolean;
  continueGame(): void;
  newGame(shopName: string): void;
  join(code: string): Promise<string | null>;
  visit(code: string, name: string): void;
  goHome(): void;
  quitToMenu(): void;
  applySettings(): void;
  resume(): void;
  inGame(): boolean;
  reload(): void;
  isAway(): boolean;
}

export class Menus {
  main: HTMLElement | null = null;
  pause: HTMLElement | null = null;
  constructor(private a: MenuActions) {}

  // ---------- main menu ----------
  showMain() {
    this.hideMain();
    const p = api.profile;
    const chip = p ? el('div', { class: 'profile-chip' }, el('span', { class: 'online-dot' + (api.online ? ' on' : '') }), el('span', { class: 'grow' }, p.username), el('span', { class: 'code', title: 'Your friend code' }, fmtCode(p.friendCode))) : null;
    const col = el('div', { class: 'menu-col' },
      el('h1', { class: 'title' }, 'Game Store', el('br'), 'Together'),
      el('div', { class: 'subtitle' }, 'A cozy co-op gaming shop. Run it with up to 3 friends.'),
      chip,
      this.a.hasSave() ? el('button', { class: 'btn coral', onclick: () => { audio.unlock(); this.a.continueGame(); } }, '▶  Continue') : null,
      el('button', { class: 'btn ' + (this.a.hasSave() ? '' : 'coral'), onclick: () => { audio.unlock(); this.newGameDialog(); } }, '✨  New game'),
      el('button', { class: 'btn', onclick: () => { audio.unlock(); this.joinDialog(); } }, '🤝  Join friend'),
      el('button', { class: 'btn', onclick: () => this.friends() }, '👥  Friends'),
      el('div', { class: 'row' },
        el('button', { class: 'btn small', onclick: () => this.creator() }, '🧢 Character'),
        el('button', { class: 'btn small', onclick: () => this.settings() }, '⚙️ Settings'),
        el('button', { class: 'btn small', onclick: () => this.credits() }, '📜 Credits')),
      !api.db ? el('p', { class: 'chip', style: { whiteSpace: 'normal' } }, '☁️ Offline mode: saves stay on this device. Online friends & cloud saves turn on when the database is connected.') : null);
    this.main = el('div', { class: 'menu' }, col);
    ui().appendChild(this.main);
  }
  hideMain() { this.main?.remove(); this.main = null; }

  newGameDialog() {
    const name = el('input', { class: 'field', maxlength: 24, value: api.profile?.shopName || `${api.profile?.username || 'My'}'s Game Store`, id: 'new-shop-name' }) as HTMLInputElement;
    const m = modal([
      el('h2', {}, '✨ New game'),
      el('p', {}, `You start with $100, a starter gaming laptop and your own office. ${this.a.hasSave() ? '⚠️ This replaces your current shop.' : ''}`),
      el('label', { class: 'muted', for: 'new-shop-name' }, 'Shop name'), name,
      el('div', { class: 'row', style: { marginTop: '12px' } }, el('button', { class: 'btn coral', onclick: () => { m.close(); this.a.newGame(name.value.trim() || 'Game Store Together'); } }, 'Open my shop!')),
    ]);
    name.focus(); name.select();
  }

  joinDialog(prefill = '') {
    const code = el('input', { class: 'field', maxlength: 7, placeholder: 'ABC-123', value: prefill, id: 'join-code', style: { textTransform: 'uppercase', letterSpacing: '2px', fontSize: '22px' } }) as HTMLInputElement;
    const msg = el('p', { class: 'muted' }, api.realtime ? 'Ask your friend for their friend code. They need to be in their shop.' : 'Offline mode: co-op works between tabs on this device. Connect the database for online co-op.');
    const list = el('div', {});
    const go = async (c: string) => { msg.textContent = 'Connecting…'; const err = await this.a.join(c); if (err) msg.textContent = '⚠️ ' + err; else m.close(); };
    const m = modal([el('h2', {}, '🤝 Join a friend'), el('label', { class: 'muted', for: 'join-code' }, 'Friend code'), code,
      el('div', { class: 'row', style: { margin: '10px 0' } }, el('button', { class: 'btn coral', onclick: () => go(code.value.replace(/[^a-z0-9]/gi, '').toUpperCase()) }, 'Join')), msg, list]);
    code.focus();
    const head = el('h3', { hidden: true }, 'Online now');
    list.append(head);
    const show = (f: Friend) => { if (!f.online || !f.room) return; head.hidden = false; list.append(el('div', { class: 'friend' }, el('span', { class: 'online-dot on' }), el('b', { class: 'grow' }, f.username), el('button', { class: 'btn small coral', onclick: () => go(f.room!) }, 'Join'))); };
    api.friendsLive(show).then(({ friends }) => { for (const f of friends) if (!f.checking) show(f); }).catch(() => {});
  }

  // ---------- friends ----------
  async friends() {
    const p = api.profile;
    const body = el('div', {});
    const m = modal([el('h2', {}, '👥 Friends'), body]);
    const render = async () => {
      body.innerHTML = '';
      body.append(el('div', { class: 'profile-chip', style: { marginBottom: '10px' } }, el('span', { class: 'grow' }, 'Your friend code'), el('span', { class: 'code' }, fmtCode(p?.friendCode || '------')),
        el('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(p?.friendCode || '').then(() => this.flash(body, 'Copied!')).catch(() => {}) }, 'Copy')));
      if (!api.online) { body.append(el('p', { class: 'muted' }, api.db ? 'Signing in…' : 'Friends, invites and visits need the online database. Your code still works for local co-op between tabs.')); return; }
      const add = el('input', { class: 'field', placeholder: 'Friend code, e.g. K7Q-X2P', maxlength: 7, id: 'add-friend' }) as HTMLInputElement;
      const note = el('span', { class: 'muted' });
      body.append(el('div', { class: 'row' }, el('div', { class: 'grow' }, add), el('button', { class: 'btn coral', onclick: async () => {
        try { const r = await api.addFriend(add.value); note.textContent = `Added ${r.friend.username}!`; audio.play('chime'); render(); } catch (e: any) { note.textContent = e.message; }
      } }, 'Add')), note);
      let data: { friends: Friend[]; invites: any[] } = { friends: [], invites: [] };
      try { data = await api.friendsLive(f => (f as any)._redraw?.()); } catch (e: any) { body.append(el('p', {}, e.message)); return; }
      if (data.invites.length) body.append(el('h3', { style: { marginTop: '12px' } }, 'Invites'), ...data.invites.map(i => el('div', { class: 'friend' }, el('b', { class: 'grow' }, `${i.from} invited you`),
        el('button', { class: 'btn small coral', onclick: async () => { m.close(); const err = await this.a.join(i.room); if (err) this.toastModal(err); } }, 'Join'),
        el('button', { class: 'btn small ghost', onclick: async () => { await api.dismiss(i.id); render(); } }, 'Dismiss'))));
      body.append(el('h3', { style: { marginTop: '12px' } }, `Friends (${data.friends.length})`));
      if (!data.friends.length) body.append(el('p', { class: 'muted' }, 'Share your code with friends and add theirs. Their shops appear across the street from yours!'));
      const row = (f: Friend) => {
        const hosting = coop.role === 'host';
        return el('div', { class: 'friend' }, el('span', { class: 'online-dot' + (f.online ? ' on' : '') }),
          el('div', { class: 'grow' }, el('b', {}, f.username), el('div', { class: 'muted', style: { fontSize: '12px' } }, `${esc(f.shopName || '')} · Lv ${f.shopLevel || 1} · ${f.checking ? 'checking…' : f.online ? (f.room ? 'in their shop' : 'online') : 'offline'}`)),
          f.online && f.room ? el('button', { class: 'btn small coral', onclick: async () => { m.close(); const err = await this.a.join(f.room!); if (err) this.toastModal(err); } }, 'Join') : null,
          el('button', { class: 'btn small', onclick: () => { m.close(); this.a.visit(f.friendCode, f.username); } }, 'Visit'),
          hosting && f.online ? el('button', { class: 'btn small sun', onclick: async () => { try { await api.inviteFriend(f, coop.room!); this.flash(body, `Invited ${f.username}!`); } catch (e: any) { this.flash(body, e.message); } } }, 'Invite') : null,
          el('button', { class: 'btn small ghost', title: 'Remove friend', onclick: async () => { await api.removeFriend(f.id); render(); } }, '✕'));
      };
      for (const f of data.friends) {
        let r = row(f); body.append(r);
        (f as any)._redraw = () => { const n = row(f); r.replaceWith(n); r = n; };
      }
      const rec = el('details', { style: { marginTop: '14px' } }, el('summary', { style: { cursor: 'pointer', fontWeight: 800 } }, '🔑 Play on another device'),
        el('p', { class: 'muted' }, 'Your recovery code logs you into this account (and its cloud save) on another device. Keep it secret.'),
        el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(api.token || '').then(() => this.flash(body, 'Recovery code copied')).catch(() => {}) }, 'Copy my recovery code')),
        el('div', { class: 'row', style: { marginTop: '8px' } }, (() => { const i = el('input', { class: 'field', placeholder: 'Paste a recovery code', id: 'recover' }) as HTMLInputElement; return el('div', { class: 'row grow' }, el('div', { class: 'grow' }, i), el('button', { class: 'btn small', onclick: async () => { try { await api.recover(i.value); this.flash(body, 'Logged in! Restart to load the cloud save.'); } catch (e: any) { this.flash(body, e.message); } } }, 'Log in')); })()));
      body.append(rec);
    };
    await render();
  }
  private flash(parent: HTMLElement, msg: string) { const t = el('div', { class: 'toast good' }, msg); parent.prepend(t); setTimeout(() => t.remove(), 2200); }
  toastModal(msg: string) { const m = modal([el('h2', {}, 'Hmm…'), el('p', {}, msg), el('button', { class: 'btn', onclick: () => m.close() }, 'OK')]); }

  // ---------- character creator / welcome ----------
  creator(first = false): Promise<void> {
    return new Promise(resolve => {
      const look: Look = { ...DEFAULT_LOOK, ...(api.profile?.appearance || {}) };
      const name = el('input', { class: 'field', maxlength: 16, value: api.profile?.username || '', placeholder: 'Your name', id: 'username' }) as HTMLInputElement;
      const shop = el('input', { class: 'field', maxlength: 24, value: api.profile?.shopName || '', placeholder: 'e.g. Pixel Palace', id: 'shopname' }) as HTMLInputElement;
      const cv = el('canvas', { width: 300, height: 300 }) as HTMLCanvasElement;
      cv.style.aspectRatio = '1';
      let ch: CharView | null = null;
      const rebuild = () => { const body = look.body === 'female' ? 'humanFemaleA' : 'humanMaleA'; if (!ch || ch.modelName !== body) { ch = new CharView(body); ch.root.remove(ch.ring, ch.bubble); } ch.lookKey = ''; ch.setLook(look); };
      rebuild();
      let ang = 0, alive = true;
      const spin = () => { if (!alive) return; ang += 0.012; if (ch) { ch.update(1 / 60, 'idle'); thumbs.previewObject(cv, ch.root, ang, new THREE.Vector3(0, 1.0, 0), 4.1); } requestAnimationFrame(spin); };
      spin();
      const opts = el('div', {});
      const seg = (label: string, values: string[], get: () => string, set: (v: string) => void, names?: Record<string, string>) => {
        const s = el('div', { class: 'seg' });
        for (const v of values) s.append(el('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); rebuild(); draw(); } }, names?.[v] || v));
        return el('div', { class: 'opt' }, el('label', {}, label), s);
      };
      const colors = (label: string, values: string[], get: () => string, set: (v: string) => void) => {
        const s = el('div', { class: 'colors' });
        for (const v of values) s.append(el('button', { class: get() === v ? 'on' : '', style: { background: v }, 'aria-label': v, onclick: () => { set(v); rebuild(); draw(); } }));
        return el('div', { class: 'opt' }, el('label', {}, label), s);
      };
      const draw = () => {
        opts.innerHTML = '';
        opts.append(
          seg('Body', ['male', 'female'], () => look.body, v => (look.body = v as any), { male: 'Style A', female: 'Style B' }),
          colors('Shirt', SHIRTS, () => look.shirt, v => (look.shirt = v)),
          colors('Trousers', PANTS, () => look.pants, v => (look.pants = v)),
          colors('Skin', SKIN_TONES, () => SKIN_TONES[look.skin], v => (look.skin = SKIN_TONES.indexOf(v))),
          seg('Hat', HATS, () => look.hat, v => (look.hat = v), HAT_NAMES),
          colors('Hat colour', SHIRTS, () => look.hatColor, v => (look.hatColor = v)));
      };
      draw();
      const err = el('p', { class: 'chip bad', hidden: true });
      const save = async () => {
        const username = name.value.trim();
        if (!username) { err.hidden = false; err.textContent = 'Pick a name first'; return; }
        try {
          if (!api.profile || (first && !api.online && api.db)) await api.register(username, look, shop.value.trim());
          else await api.updateProfile({ username, appearance: look, shopName: shop.value.trim() || api.profile.shopName });
          coop.setMe(username, look);
          alive = false; m.close(); resolve();
        } catch (e: any) { err.hidden = false; err.textContent = e.message; }
      };
      const m = modal([
        el('h2', {}, first ? '👋 Welcome, shopkeeper!' : '🧢 Your character'),
        first ? el('p', {}, 'Pick a name and a look. Friends add you with the friend code you’ll get.') : null as any,
        el('div', { class: 'creator' }, el('div', {}, cv, el('div', { class: 'opt', style: { marginTop: '10px' } }, el('label', { for: 'username' }, 'Name'), name), first ? el('div', { class: 'opt' }, el('label', { for: 'shopname' }, 'Shop name'), shop) : null), opts),
        err, el('button', { class: 'btn coral', style: { width: '100%' }, onclick: save }, first ? 'Let’s go!' : 'Save'),
      ].filter(Boolean), { closable: !first, onClose: () => { alive = false; resolve(); } });
      name.focus();
    });
  }

  // ---------- settings ----------
  settings() {
    const body = el('div', {});
    const row = (label: string, ctl: HTMLElement) => el('div', { class: 'settings-row' }, el('span', {}, label), ctl);
    const range = (id: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => String(v)) => {
      const out = el('b', { class: 'num' }, fmt(get()));
      const r = el('input', { type: 'range', min, max, step, value: get(), id }) as HTMLInputElement;
      r.oninput = () => { set(+r.value); out.textContent = fmt(+r.value); saveSettings(); this.a.applySettings(); };
      return el('div', { class: 'row' }, r, out);
    };
    const q = el('div', { class: 'seg' });
    for (const k of ['low', 'medium', 'high', 'ultra'] as Quality[]) q.append(el('button', { class: settings.quality === k ? 'on' : '', onclick: () => { settings.quality = k; saveSettings(); this.a.applySettings(); q.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === k)); } }, k));
    const check = (id: string, get: () => boolean, set: (v: boolean) => void) => { const c = el('input', { type: 'checkbox', id, checked: get() }) as HTMLInputElement; c.onchange = () => { set(c.checked); saveSettings(); this.a.applySettings(); }; return c; };
    const touch = el('div', { class: 'seg' });
    for (const k of ['auto', 'on', 'off'] as const) touch.append(el('button', { class: settings.touch === k ? 'on' : '', onclick: () => { settings.touch = k; saveSettings(); touch.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === k)); this.flash(body, 'Touch controls change after a reload'); } }, k));
    body.append(
      row('Graphics quality', q),
      row('Render distance', range('rd', 40, 200, 10, () => settings.renderDistance, v => (settings.renderDistance = v), v => v + ' m')),
      row('Field of view', range('fov', 60, 100, 1, () => settings.fov, v => (settings.fov = v), v => v + '°')),
      row('Look sensitivity', range('sens', 0.2, 3, 0.1, () => settings.sensitivity, v => (settings.sensitivity = v), v => v.toFixed(1))),
      row('Invert Y', check('inv', () => settings.invertY, v => (settings.invertY = v))),
      row('Master volume', range('vol', 0, 1, 0.05, () => settings.master, v => (settings.master = v), v => Math.round(v * 100) + '%')),
      row('Music', range('mus', 0, 1, 0.05, () => settings.music, v => (settings.music = v), v => Math.round(v * 100) + '%')),
      row('Sound effects', range('sfx', 0, 1, 0.05, () => settings.sfx, v => (settings.sfx = v), v => Math.round(v * 100) + '%')),
      row('Show FPS', check('fps', () => settings.showFps, v => (settings.showFps = v))),
      row('Touch controls', touch),
      el('p', { class: 'muted', style: { fontSize: '13px' } }, 'Low is tuned for phones (30+ FPS): no shadows, fewer lights, people and cars. Render distance works like Minecraft’s: less = faster.'),
      el('details', {}, el('summary', { style: { cursor: 'pointer', fontWeight: 800 } }, '⌨️ Controls'),
        el('p', { html: 'WASD move · Shift run · Space jump · Mouse look<br>E / click — use, pick up, place · hold E — clean, repair, restock<br>F — unbox / pick up into inventory · hold F — sell · G — drop / move<br>R / wheel — rotate · Tab — inventory · Q — cancel · Esc — pause · F3 — debug' })));
    modal([el('h2', {}, '⚙️ Settings'), body]);
  }

  credits() {
    modal([el('h2', {}, '📜 Credits'), el('div', { class: 'credits', html: CREDITS_HTML })]);
  }

  // ---------- pause ----------
  showPause() {
    this.hidePause();
    const away = this.a.isAway();
    this.pause = el('div', { class: 'overlay' }, el('div', { class: 'panel modal' },
      el('h2', {}, '⏸ Paused'),
      el('p', { class: 'muted' }, coop.role === 'guest' ? `Playing in a friend’s shop (code ${fmtCode(coop.room || '')}).` : `Friends can join you with your code ${fmtCode(api.profile?.friendCode || '')}${api.realtime ? '' : ' (same device only in offline mode)'}.`),
      el('div', { class: 'menu-col', style: { width: '100%' } },
        el('button', { class: 'btn coral', onclick: () => { this.hidePause(); this.a.resume(); } }, '▶ Resume'),
        el('button', { class: 'btn', onclick: () => this.friends() }, '👥 Friends & invites'),
        el('button', { class: 'btn', onclick: () => this.creator() }, '🧢 Character'),
        el('button', { class: 'btn', onclick: () => this.settings() }, '⚙️ Settings'),
        away ? el('button', { class: 'btn sun', onclick: () => { this.hidePause(); this.a.goHome(); } }, '🏠 Go home') : null,
        el('button', { class: 'btn ghost', onclick: () => { this.hidePause(); this.a.quitToMenu(); } }, away ? 'Leave to main menu' : '💾 Save & quit to menu'),
        el('button', { class: 'btn small ghost', onclick: () => this.a.reload() }, '🔄 Reload game'),
        el('p', { class: 'muted', style: { fontSize: '12px', margin: '4px 0 0' } }, `Version ${BUILD}`))));
    this.pause.addEventListener('keydown', e => { if (e.key === 'Escape') { this.hidePause(); this.a.resume(); } });
    ui().appendChild(this.pause);
    (this.pause.querySelector('.btn') as HTMLElement)?.focus();
  }
  hidePause() { this.pause?.remove(); this.pause = null; }
}

const CREDITS_HTML = `
<p><b>Game Store Together</b> — design & code made with Claude Code for Danya. Built with three.js, Vite and Supabase, hosted on Vercel.</p>
<p><b>3D models</b> from Patch's free asset library (patch.gg):</p>
<p>• Kenney (kenney.nl) — Furniture Kit, Mini Market, Mini Arcade, Space Kit, Food Kit, Nature Kit, Coaster Kit and Animated Characters Retro. CC0 1.0.</p>
<p>• KayKit by Kay Lousberg — City Builder Bits (roads, buildings, cars, street lights) and Furniture Bits (rugs). CC0 1.0.</p>
<p>• Polyfork (polyfork.dev), CC BY 4.0 — Cafe Customer, Backpacker, Graduate Student, Seated Office Worker, Family Road-Tripper, Teen Player, Student in a Hoodie, BMX Rider, Beginner Kid Skater, Neighborhood Child, School Student, Arriving Hotel Guest, Slot Tourist, Street Skater, Kid in a Black Cat Costume, Desk Monitor, Monitor Arm, Laptop. Models were compressed (meshopt) for the web; customers' walk cycle is retargeted from Family Road-Tripper; poses are procedural.</p>
<p><b>Sound</b> — Kenney Interface Sounds, RPG Audio and Impact Sounds (CC0). Music: “Poor, but happy” by Holizna (CC0, OpenGameArt). Other blips are synthesized.</p>
<p><b>Fonts</b> — Baloo 2, Nunito and Pacifico (SIL Open Font License) via Google Fonts.</p>
<p>Full list with links: <code>CREDITS.md</code> in the repository.</p>`;

export { isTouch, input };
