/* Boot: load models, sign in, show the menu over a live view of the shop, then run the game loop. */
import './style.css';
import * as THREE from 'three';
import { Gfx } from './engine/gfx';
import { input } from './engine/input';
import { audio } from './engine/audio';
import { preload, ALL_MODELS } from './engine/assets';
import { settings, preset } from './core/settings';
import { newSave, loadLocal, saveLocal, hasLocal, migrate, SAVE_VERSION, type SaveData } from './core/save';
import { el } from './core/util';
import { Game } from './game/game';
import { Laptop } from './ui/laptop';
import { Inventory, Register, Debug, daySummary, levelUp } from './ui/panels';
import { Menus } from './ui/menus';
import { api } from './net/api';
import { coop } from './net/coop';
import { inbox } from './net/p2p';

const $ = (id: string) => document.getElementById(id)!;
const bar = $('boot-bar'), msg = $('boot-msg');
const debugMode = new URLSearchParams(location.search).has('debug');

async function boot() {
  const canvas = $('game') as HTMLCanvasElement;
  const gfx = new Gfx(canvas);
  input.init(canvas);
  const names = [...ALL_MODELS.core, ...ALL_MODELS.city, ...ALL_MODELS.people, ...ALL_MODELS.extra];
  const loadModels = preload(names, (d, t) => { bar.style.width = Math.round((d / t) * 90) + '%'; msg.textContent = `Unpacking boxes… ${d}/${t}`; });
  const signIn = api.init().catch(e => console.warn('api init failed', e));
  await Promise.all([loadModels, signIn]);
  msg.textContent = 'Opening the doors…';

  // a preview world for the menu background
  let local = loadLocal();
  const game = new Game(gfx, local || newSave('Game Store Together'), $('ui'));
  if (debugMode) Object.assign(window as any, { __game: game, __input: input, __coop: coop, __api: api });
  if (api.profile) coop.setMe(api.profile.username, api.profile.appearance);

  // ---------- UI wiring ----------
  let paused = false;
  const resumeIfNeeded = () => { if (!input.touch) input.lock(); };
  const laptop = new Laptop(game, () => { game.mode = 'walk'; input.enabled = true; resumeIfNeeded(); });
  const inventory = new Inventory(game, () => { if (game.mode === 'ui') game.mode = 'walk'; input.enabled = true; resumeIfNeeded(); });
  const register = new Register(game);
  const debug = new Debug(game);
  const openUi = () => { game.mode = 'ui'; input.enabled = false; input.unlock(); };
  let modalOpen = 0;
  const menus: Menus = new Menus({
    hasSave: () => !!loadLocal(),
    continueGame: () => start(),
    newGame: name => { const s = newSave(name); saveLocal(s); api.updateProfile({ shopName: name }).catch(() => {}); start(s); },
    join: async code => {
      if (!code || code.length < 4) return 'Type your friend’s 6-letter code.';
      if (code === api.profile?.friendCode) return 'That’s your own code!';
      await game.begin(newSave(''), 'guest');
      const r = await coop.join(code, game.world);
      if (!r.ok) { game.running = false; return r.why || 'Could not join'; }
      game.view.setWorld(game.world);
      enterPlay();
      game.hud.toast('🤝 Joined! Help run your friend’s shop.', 'good');
      return null;
    },
    visit: async (code, name) => {
      try {
        const r = await api.visit(code);
        if (api.presence === 'p2p' && coop.transportKind === 'p2p') {
          // ask the friend's game directly whether it's open
          const st = await inbox.probe(code, 8000);
          if (st) { r.profile.online = true; r.profile.room = st.room; }
        }
        if (r.profile.online && r.profile.room) {
          const err = await menus['a'].join(r.profile.room);
          if (!err) return; // joined live
        }
        if (!r.save) { menus.toastModal(`${name} hasn’t saved a shop yet.`); return; }
        if (game.running && coop.role === 'host') game.persist(true);
        await coop.leave();
        await game.begin(migrate(r.save.data), 'visit', { room: code, visitName: name });
        enterPlay();
      } catch (e: any) { menus.toastModal(e.message || 'Could not visit'); }
    },
    goHome: () => start(),
    quitToMenu: async () => { if (coop.role !== 'guest' && !game.readOnly) game.persist(true); await coop.leave(); game.running = false; input.unlock(); showMenu(); },
    applySettings: () => { gfx.applyQuality(); game.view.shell.build(game.world.save); game.view.city.rebuildForQuality(); audio.applyVolumes(); game.world.rev++; },
    resume: () => { paused = false; game.mode = 'walk'; input.enabled = true; resumeIfNeeded(); },
    inGame: () => game.running,
    isAway: () => coop.role === 'guest' || game.readOnly,
  });

  game.ui = {
    openLaptop: () => { openUi(); laptop.show(); },
    openInventory: () => { openUi(); inventory.show(); },
    openPause: () => { openUi(); paused = true; menus.showPause(); },
    register: v => register.show(v),
    dayOver: sum => { openUi(); modalOpen++; daySummary(game, sum, () => { modalOpen--; game.act({ t: 'nextDay' }); game.mode = 'walk'; input.enabled = true; resumeIfNeeded(); }); },
    levelUp: (lv, un) => { if (game.mode === 'ui' && modalOpen) return; openUi(); modalOpen++; levelUp(game, lv, un, () => { modalOpen--; if (!modalOpen) { game.mode = 'walk'; input.enabled = true; resumeIfNeeded(); } }); },
    visit: (code, name) => menus['a'].visit(code, name),
    closeAll: () => { laptop.close(); inventory.close(); menus.hidePause(); },
  };
  coop.onEvent = e => game.onRemoteEvent(e.type, e.data);
  coop.onEnded = why => { menus.toastModal(why + ' Taking you home.'); start(); };
  coop.onPeersChange = () => {};

  // click-to-play overlay for pointer lock (desktop)
  const ctp = el('div', { class: 'click-to-play', hidden: true }, el('div', {}, '🖱️ Click to play'));
  ctp.onclick = () => { audio.unlock(); input.lock(); };
  $('ui').appendChild(ctp);
  input.onLockChange = locked => {
    if (!locked && game.running && (game.mode === 'walk' || game.mode === 'place' || game.mode === 'install') && !paused && !input.touch) {
      // Esc released the pointer: show the pause menu
      game.ui.openPause();
    }
  };

  // register clicks (scan items with the mouse / finger)
  canvas.addEventListener('pointerdown', e => {
    if (game.mode !== 'register') return;
    const r = canvas.getBoundingClientRect();
    game.clickAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  });

  function enterPlay() {
    menus.hideMain(); menus.hidePause(); laptop.close(); inventory.close();
    paused = false;
    game.hud.show(true);
    game.mode = 'walk'; input.enabled = true;
    input.showTouch(input.touch);
    audio.unlock(); audio.startMusic();
    if (!input.touch) input.lock();
    // friends' shops across the street
    let friendsNow: any[] = [];
    const paint = () => game.view.city.setNeighbours(friendsNow.map(f => ({ code: f.friendCode, name: f.username, shopName: f.shopName, online: f.online, level: f.shopLevel || 1 })));
    let repaint: any = null;
    api.friendsLive(() => { clearTimeout(repaint); repaint = setTimeout(paint, 400); }).then(({ friends }) => { friendsNow = friends; paint(); }).catch(() => {});
  }

  async function start(fresh?: SaveData) {
    await coop.leave();
    let s = fresh || loadLocal();
    // cloud save wins when it is newer (playing on another device)
    if (!fresh && api.online) {
      try {
        const c = await api.loadCloud();
        if (c && (!s || c.updatedAt > (s.updatedAt || 0) + 5000)) { s = migrate(c.data); saveLocal(s); }
      } catch (e) { console.warn('cloud load failed', e); }
    }
    if (!s) s = newSave(api.profile?.shopName || 'Game Store Together');
    await game.begin(s, 'solo');
    enterPlay();
  }

  function showMenu() {
    game.hud.show(false);
    input.showTouch(false);
    laptop.close(); inventory.close(); register.show(false);
    menus.showMain();
  }

  // menu background: the shop, seen from across the street
  game.world.save = local || newSave('Game Store Together');
  game.view.setWorld(game.world);

  // ---------- loop ----------
  let last = performance.now(), menuT = 0, touchShown = false;
  const fpsEl = { t: 0, n: 0 };
  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    input.update();
    if (input.pressed('debug') && (debugMode || game.running)) debug.toggle();
    if (game.running && !paused) {
      game.update(dt);
      if (inventory.open && input.pressed('inventory')) { /* handled by inventory keys */ }
    } else if (game.running && paused) {
      game.view.update(dt, gfx.camera.position);
    } else {
      // orbiting menu camera
      menuT += dt * 0.05;
      const r = 17;
      gfx.camera.position.set(Math.sin(menuT) * r * 0.6, 4.2, 10 + Math.cos(menuT) * 3);
      gfx.camera.lookAt(0, 1.6, -3);
      gfx.setTime(13 * 60 + Math.sin(menuT * 0.7) * 60 * 6 + 5 * 60);
      gfx.follow(gfx.camera.position);
      game.view.update(dt, gfx.camera.position);
    }
    inventory.tick(dt);
    register.tick();
    debug.tick(dt);
    if (settings.showFps || debugMode) { fpsEl.t += dt; fpsEl.n++; if (fpsEl.t > 0.5) { game.hud.fps(`${Math.round(fpsEl.n / fpsEl.t)} fps · ${preset() && settings.quality}`); fpsEl.t = 0; fpsEl.n = 0; } } else game.hud.fps(null);
    // touch controls only while actually walking around (never on top of panels)
    const wantTouch = input.touch && game.running && !paused && (game.mode === 'walk' || game.mode === 'place' || game.mode === 'install') && !document.querySelector('.overlay');
    if (wantTouch !== touchShown) { touchShown = wantTouch; input.showTouch(wantTouch); }
    // keep the click-to-play prompt honest
    ctp.hidden = !(game.running && !paused && !input.touch && !input.locked && (game.mode === 'walk' || game.mode === 'place' || game.mode === 'install'));
    gfx.render();
    input.endFrame();
  }
  requestAnimationFrame(frame);

  // hidden tab: rAF stops, so keep the host simulation and co-op messages going at a low rate
  let hiddenAt = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (document.hidden && game.running && coop.role !== 'guest') game.background(Math.min(2, (now - hiddenAt) / 1000));
    hiddenAt = now;
  }, 500);

  // inventory toggles with Tab while open
  addEventListener('keydown', e => {
    if (e.code === 'Tab' && inventory.open) { e.preventDefault(); inventory.close(); }
    if (e.code === 'Escape' && laptop.open) laptop.close();
    if (e.code === 'Escape' && inventory.open) inventory.close();
  });
  // save when the tab is hidden or closed
  addEventListener('visibilitychange', () => { if (document.hidden && game.running) game.persist(true); });
  addEventListener('pagehide', () => { if (game.running) game.persist(false); });

  // ---------- first launch ----------
  bar.style.width = '100%';
  $('boot').classList.add('out');
  setTimeout(() => $('boot').remove(), 600);
  if (!api.profile) await menus.creator(true);
  else if (api.profile.local && api.db) await api.register(api.profile.username, api.profile.appearance, api.profile.shopName).catch(() => {});
  if (api.profile) coop.setMe(api.profile.username, api.profile.appearance);
  // peer-to-peer presence: friends can see we're online and send invites
  inbox.status = () => ({ name: api.profile?.username || '', shopName: game.world.save.shopName, level: game.world.save.level, room: coop.role === 'host' ? coop.room : null });
  inbox.onInvite = inv => {
    audio.play('chime');
    if (game.running) game.hud.toast(`🎮 ${inv.from} invited you to co-op!`, 'info', 20000, [{ label: 'Join', fn: () => menus['a'].join(inv.room).then(err => err && menus.toastModal(err)) }]);
    else menus.toastModal(`🎮 ${inv.from} invited you to their shop! Use Join friend with code ${inv.fromCode || inv.room}.`);
  };
  if (api.profile?.friendCode && coop.transportKind === 'p2p' && api.db) inbox.open(api.profile.friendCode);
  showMenu();
  if (debugMode && new URLSearchParams(location.search).has('autostart')) start();
  if (hasLocal()) local = loadLocal();
  void SAVE_VERSION; void THREE;
}

boot().catch(e => {
  console.error(e);
  msg.textContent = '⚠️ Something went wrong while loading: ' + (e?.message || e);
});
