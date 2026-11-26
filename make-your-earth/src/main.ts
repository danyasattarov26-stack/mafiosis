/* Make Your Earth: start-up, the menu ↔ game switch, the render loop and co-op wiring. */
import './style.css';
import * as THREE from 'three';
import { t, onLang } from './i18n/i18n';
import { settings, saveSettings, onSettings, detectPreset } from './game/settings';
import { Globe } from './render/globe';
import { buildAtlas, setIconAtlas } from './render/textures';
import { Input } from './game/input';
import { Game, randomName, type SaveData } from './game/game';
import { Hud } from './ui/hud';
import { Menu, newWorld, type PlayChoice } from './ui/menu';
import { BlockMaker } from './ui/blockmaker';
import { Admin } from './ui/admin';
import { sound } from './audio/audio';
import { Session } from './net/session';
import { inbox, newCode, profile, type Invite } from './net/coop';
import { MAX_PLAYERS } from './net/coop';
import { RECIPES } from './shared/items';
import { BLOCK_ID } from './shared/blocks';

declare const __BUILD__: string;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

// ---------- no WebGL 2: say so instead of a blank page ----------
const probe = document.createElement('canvas');
if (!probe.getContext('webgl2')) {
  document.body.innerHTML = `<div class="nogl"><h1>${t('title')}</h1><p>${t('misc.webgl')}</p></div>`;
  throw new Error('WebGL2 unavailable');
}
const lowMem = detectPreset().lowMemory;
if (lowMem && settings.preset !== 'potato') { settings.preset = 'potato'; settings.render = 4; saveSettings(); }

const renderer = new THREE.WebGLRenderer({ antialias: settings.preset === 'high' || settings.preset === 'ultra', powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.id = 'game';
document.body.prepend(renderer.domElement);
const applyScale = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * settings.scale); renderer.setSize(innerWidth, innerHeight); };
applyScale();

const globe = new Globe();
const atlas = buildAtlas(); setIconAtlas(atlas);
const input = new Input(renderer.domElement);
let credits = { models: [] as string[], sounds: [] as any[] };
const menu = new Menu(credits);
fetch('/credits.json').then(r => r.json()).then(c => { credits.models = c.models; credits.sounds = c.sounds; (menu as any).credits = credits; }).catch(() => {});

let game: Game | null = null, hud: Hud | null = null, session: Session | null = null;
const resize = () => { applyScale(); globe.resize(innerWidth, innerHeight); game?.resize(innerWidth, innerHeight); };
addEventListener('resize', resize); resize();
onSettings(() => { applyScale(); if (game) { game.world.setRenderDist(settings.render); game.animals.simDist = settings.sim * 16; game.resize(innerWidth, innerHeight); } });
if (lowMem) setTimeout(() => toast(t('misc.lowMemory')), 800);

// ---------- invites from friends ----------
inbox.onInvite = (inv: Invite) => {
  const box = document.createElement('div'); box.className = 'invite';
  box.innerHTML = `<p>${t('friends.invited', { name: inv.from })}</p><button class="btn">${t('friends.accept')}</button><button class="btn ghost">${t('friends.decline')}</button>`;
  document.body.appendChild(box);
  (box.children[1] as HTMLElement).onclick = () => { box.remove(); if (!game) play({ mode: 'join', code: inv.room }); };
  (box.children[2] as HTMLElement).onclick = () => box.remove();
  setTimeout(() => box.remove(), 30000);
};
function toast(msg: string, kind = '') { if (hud) return hud.toast(msg, kind); const el = document.createElement('div'); el.className = 'menu-toast ' + kind; el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 3500); }

// ---------- starting a world ----------
menu.onPlay = play;
async function play(c: PlayChoice) {
  sound.start();
  if (c.mode === 'join') {
    menu.show(false); showLoading(t('play.connecting'));
    session = new Session(c.code, false);
    session.onFull = () => toast(t('play.full'), 'bad');
    const w = await session.join(settings.name || randomName());
    hideLoading();
    if (!w) { session.close(); session = null; menu.show(true); toast(t('play.notFound'), 'bad'); return; }
    let mine: any = null; try { mine = JSON.parse(localStorage.getItem('mye-guest-' + w.save.id) || 'null'); } catch { /* none */ }
    const save: SaveData = { ...w.save, guest: true, player: mine ?? { pos: w.spawn, yaw: 0, name: settings.name || randomName(), stats: undefined, inv: null } } as any;
    startGame(save, c.code, !mine);
    return;
  }
  let code: string | undefined;
  if (c.mode === 'host') {
    code = newCode(6);
    session = new Session(code, true);
    if (c.invite?.length) {
      const p = profile();
      for (const f of c.invite.slice(0, MAX_PLAYERS - 1)) inbox.invite(f, { from: settings.name || p.name || 'A friend', fromCode: p.code, room: code }).then(ok => toast(ok ? t('friends.sent') : t('friends.notOnline'), ok ? 'good' : 'bad'));
    }
  }
  startGame(c.save, code, false);
}

function startGame(save: SaveData, code?: string, newGuest = false) {
  menu.show(false);
  const p = profile();
  game = new Game(renderer, input, atlas, save, p.id);
  if (newGuest) game.inv.add('stone_axe', 1);
  game.resize(innerWidth, innerHeight);
  makeHud();
  let pending = 0;
  game.onChange = () => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; hud?.refresh(); }); };
  game.onOpenStation = s => { input.exitLock(); if (s === 'blueprint') hud!.openBlueprints(); else hud!.openInventory(s === 'chest' ? 'hand' : s); };
  game.onDeath = grave => {
    const name = game!.rebirth();
    input.exitLock();
    hud!.showDeath(name, grave ? { x: grave.x, z: grave.z } : null);
  };
  if (session) {
    session.attach(game);
    session.onToast = (m, k) => hud?.toast(m, k);
    session.onChat = () => renderChat();
    session.onKicked = banned => { const msg = t(banned ? 'admin.banned' : 'admin.kicked'); quit(); toast(msg, 'bad'); };
    hud!.coop = { code: session.room.code, players: 1 };
    inbox.status = () => ({ name: game?.player.name ?? '', playing: save.name, room: session?.room.code ?? null, players: session?.players() ?? 1 });
    if (session.host) setTimeout(() => toast(t('hud.roomCode', { code: session!.room.code })), 1500);
  }
  input.enabled = true;
  input.requestLock();
  buildChat();
}

function quit() {
  if (!game) return;
  if (game.isGuest && session) { try { localStorage.setItem('mye-guest-' + game.data.id, JSON.stringify(game.playerJSON())); } catch { /* ignore */ } }
  game.dispose(); hud?.destroy(); session?.close();
  game = null; hud = null; session = null;
  input.enabled = false; input.exitLock();
  document.querySelector('.chat')?.remove();
  menu.show(true);
}
addEventListener('beforeunload', () => { if (game?.isGuest && session) localStorage.setItem('mye-guest-' + game.data.id, JSON.stringify(game.playerJSON())); game?.save(); });

// ---------- chat (co-op only) ----------
let chatOpen = false;
function buildChat() {
  document.querySelector('.chat')?.remove();
  if (!session) return;
  const el = document.createElement('div'); el.className = 'chat';
  el.innerHTML = `<div class="lines"></div><input maxlength="200" placeholder="${t('chat.placeholder')}" hidden>`;
  document.body.appendChild(el);
  const inp = el.querySelector('input')!;
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { session?.say(inp.value); inp.value = ''; closeChat(); }
    if (e.key === 'Escape') closeChat();
  });
}
function openChat() { const inp = document.querySelector<HTMLInputElement>('.chat input'); if (!inp) return; chatOpen = true; input.exitLock(); inp.hidden = false; inp.focus(); input.enabled = false; }
function closeChat() { const inp = document.querySelector<HTMLInputElement>('.chat input'); if (inp) { inp.hidden = true; inp.blur(); } chatOpen = false; input.enabled = true; input.requestLock(); }
function renderChat() {
  const box = document.querySelector('.chat .lines'); if (!box || !session) return;
  box.innerHTML = session.chat.slice(-8).map(l => `<p><b>${l.from.replace(/</g, '&lt;')}</b> ${l.text.replace(/</g, '&lt;')}</p>`).join('');
}

// ---------- loading overlay for joining ----------
function showLoading(text: string) { let el = $('#joining'); if (!el) { el = document.createElement('div'); el.id = 'joining'; document.body.appendChild(el); } el.innerHTML = `<div class="spinner"></div><p>${text}</p>`; el.hidden = false; }
function hideLoading() { const el = $('#joining'); if (el) el.hidden = true; }

// ---------- the loop ----------
let last = performance.now(), fpsT = 0, frames = 0;
(window as any).__mye = { get game() { return game; }, get session() { return session; }, renderer, play, quit, settings, fps: 0, recipes: RECIPES, blocks: BLOCK_ID };
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  frames++; fpsT += dt; if (fpsT >= 1) { (window as any).__mye.fps = frames / fpsT; frames = 0; fpsT = 0; }
  if (!game) { globe.update(dt); renderer.render(globe.scene, globe.camera); return; }
  input.poll(dt);
  // keyboard shortcuts for panels
  if (hud) {
    if (overlay) { if (input.hit('menu')) overlay.close(); }
    else {
    if (input.hit('blockmaker') && !hud.open) openBlockMaker();
    if (input.hit('admin') && !hud.open) openAdmin();
    if (input.hit('menu') && (game.ghost || game.selecting)) { game.cancelGhost(); game.selecting = null; input.endFrame(); }
    const esc = input.hit('menu'), lost = input.hit('unlocked') && !hud.open && !chatOpen && !overlay;
    if (esc && hud.open && hud.open !== 'dead') { hud.close(); input.requestLock(); }
    else if ((esc || lost) && !hud.open) { input.exitLock(); hud.openPause(() => openSettingsInGame()); }
    if (input.hit('inventory') && !game.downedFriendNear()) { if (hud.open === 'inv') { hud.close(); input.requestLock(); } else if (!hud.open) { input.exitLock(); hud.openInventory('hand'); } }
    if (input.hit('map')) { if (hud.open === 'map') { hud.close(); input.requestLock(); } else if (!hud.open) { input.exitLock(); hud.openMap(); } }
    }
    if (input.hit('chat') && session && !hud.open) openChat();
  }
  const inPanel = !!hud?.open || chatOpen;
  if (inPanel) { input.look.x = 0; input.look.y = 0; input.move.x = 0; input.move.z = 0; input.primary = false; }
  game.paused = inPanel && hud?.open !== 'dead';
  game.update(dt);
  session?.tick(dt, input.key('inventory'));
  if (hud && session) hud.coop = { code: session.room.code, players: session.players() };
  hud?.frame();
  input.endFrame();
  renderer.render(game.scene, game.camera);
});

let overlay: BlockMaker | Admin | null = null;
function openBlockMaker() {
  if (!game || !hud || overlay) return;
  input.exitLock(); hud.open = 'bm'; game.paused = true;
  overlay = new BlockMaker(game, () => { overlay = null; if (hud) { hud.open = null; } input.requestLock(); });
}
function openAdmin() {
  if (!game || !hud || overlay) return;
  if (game.isGuest) { toast(t('admin.onlyOwner'), 'bad'); return; }
  input.exitLock(); hud.open = 'admin'; game.paused = true;
  overlay = new Admin(game, session, () => { overlay = null; if (hud) hud.open = null; input.requestLock(); });
}
function openSettingsInGame() {
  const wrap = document.createElement('div'); wrap.className = 'overlay';
  const body = document.createElement('div'); body.className = 'body settings-overlay'; wrap.appendChild(body);
  document.body.appendChild(wrap);
  menu.renderSettings(body, () => wrap.remove());
}
function makeHud() {
  if (!game) return;
  hud?.destroy();
  hud = new Hud(game);
  game.toast = (m, k) => hud?.toast(m, k);
  hud.onRebirth = () => input.requestLock();
  hud.onQuit = () => quit();
  hud.onBlockMaker = () => openBlockMaker();
  hud.onAdmin = () => openAdmin();
  if (session) hud.coop = { code: session.room.code, players: session.players() };
  hud.refresh();
}
onLang(() => { if (game) makeHud(); });
console.info('Make Your Earth', __BUILD__);
