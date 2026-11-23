/*
  Crumple Zone: the page side. Runs the menus, sends inputs to the physics worker, steps it in lock-step,
  draws whatever it sends back, and runs the three modes (free roam, crash lab, race).
*/
import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SPECS, SPEC, type Spec } from './cars/specs';
import { buildCar } from './cars/build';
import { getMap, MAP_LIST, heightAt, surfAt, type MapDef } from './sim/maps';
import type { SimEvent } from './sim/physics';
import { CarView, type CarState } from './render/carMesh';
import { WorldView, loadTrees } from './render/world';
import { FX } from './render/fx';
import { Controls } from './game/input';
import { Audio } from './game/audio';
import { VR } from './game/vr';

declare const __BUILD__: string;

// ---------------- settings ----------------
const coarse = matchMedia('(pointer: coarse)').matches;
interface Settings { map: string; car: string; color: string; quality: 'low' | 'high'; volume: number; traffic: number; rivals: number; aids: boolean; power: number; grip: number; strength: number; tilt: boolean; cam: number; gravity: number }
const DEF: Settings = { map: 'valley', car: 'vesper', color: SPECS[0].colors[0], quality: coarse ? 'low' : 'high', volume: 0.7, traffic: coarse ? 1 : 3, rivals: coarse ? 1 : 2, aids: true, power: 1, grip: 1, strength: 1, tilt: false, cam: 0, gravity: 9.81 };
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const set: Settings = store.get('cz-settings', DEF);
const best: Record<string, number> = store.get('cz-best', {});
const saveSettings = () => store.set('cz-settings', set);
const low = () => set.quality === 'low';

// ---------------- three ----------------
const renderer = new THREE.WebGLRenderer({ antialias: !coarse, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, low() ? 1.25 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.domElement.id = 'game';
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 1400);
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const fx = new FX(low()); scene.add(fx.group);
const controls = new Controls();
const audio = new Audio(); audio.setVolume(set.volume);
const vr = new VR(renderer, scene, camera);
vr.onStart = () => { audio.start(); if (mode !== 'drive') startDrive(); closeMenu(); vr.say('Grip the wheel · triggers = gas / brake'); };
vr.onEnd = () => { camSnap = true; };
const fxScale = () => fx.setScale(innerHeight * renderer.getPixelRatio() / (2 * Math.tan((camera.fov * Math.PI) / 360)));
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); fxScale(); });
fxScale();

// ---------------- physics worker ----------------
const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
interface Live extends CarState { key: string; rpm: number; gear: number; dead: boolean; damage: number; throttle: number }
interface CarRec { key: string; spec: Spec; color: string; view: CarView; st: Live | null; fresh: boolean; ai: boolean; stuck: number; parked?: boolean }
const cars = new Map<string, CarRec>();
let waiting = false, readyResolve: (() => void) | null = null, simMs = 0, pendingDt = 0;
worker.onmessage = e => {
  const m = e.data;
  if (m.t === 'ready') { readyResolve?.(); readyResolve = null; return; }
  if (m.t === 'state') {
    waiting = false; simMs = simMs * 0.9 + m.ms * 0.1;
    for (const c of m.cars as Live[]) { const r = cars.get(c.key); if (r) { r.st = c; r.fresh = true; } }
    for (const ev of m.events as SimEvent[]) onEvent(ev);
  }
};
worker.onerror = e => console.error('physics worker:', e.message, e.filename, e.lineno);
const post = (m: unknown) => worker.postMessage(m);

// ---------------- game state ----------------
type Mode = 'menu' | 'drive';
let mode: Mode = 'menu';
let map: MapDef = getMap('lab');
let world: WorldView | null = null;
let camMode = set.cam % 4;
const CAMS = ['Chase', 'Hood', 'Cockpit', 'Orbit'];
let slow = false, shake = 0, menuOpen = false, flyOn = false;
let orbit = { yaw: 0.6, pitch: 0.35, dist: 9 };
const race = { cp: 1, lap: 0, start: 0, lapStart: 0, running: false, count: 0, last: 0, lastCp: 0, lapTimes: [] as number[] };

function spawnCar(key: string, specId: string, color: string, x: number, z: number, yaw: number, ai: number | null = null, aiSpeed?: number) {
  const old = cars.get(key); if (old) { scene.remove(old.view.group); old.view.dispose(); }
  const spec = SPEC[specId];
  const view = new CarView(buildCar(spec), color, envTex, true);
  scene.add(view.group); view.group.visible = false;
  cars.set(key, { key, spec, color, view, st: null, fresh: false, ai: ai != null, stuck: 0 });
  post({ t: 'spawn', key, spec: specId, x, z, yaw, ai, aiSpeed });
  if (key === 'me') { post({ t: 'tune', key, power: set.power, grip: set.grip, strength: set.strength, aids: set.aids }); flyOn = false; $('#tfly').hidden = !(coarse && spec.flight); }
}
function removeCar(key: string) { const r = cars.get(key); if (!r) return; scene.remove(r.view.group); r.view.dispose(); cars.delete(key); post({ t: 'remove', key }); }

async function loadMap(id: string) {
  for (const k of [...cars.keys()]) removeCar(k);
  if (world) { scene.remove(world.group); world = null; }
  fx.skids.clear();
  map = getMap(id);
  const ready = new Promise<void>(r => (readyResolve = r));
  post({ t: 'map', id }); await ready;
  post({ t: 'gravity', g: set.gravity });
  world = new WorldView(map, scene, low()); scene.add(world.group);
}

function startPoint() {
  if (map.lab) return map.lab.launch[0];
  return map.spawns[0];
}

// ---------------- events from the physics ----------------
const TOAST_NAMES: Record<string, string> = { 'front bumper': 'Front bumper torn off!', 'rear bumper': 'Rear bumper torn off!', wheel: 'A wheel came off!' };
let lastGlassToast = 0;
function nearness(x?: number, y?: number, z?: number) { if (x == null) return 1; return Math.max(0, 1 - camera.position.distanceTo(new THREE.Vector3(x, y, z)) / 70); }
function onEvent(ev: SimEvent) {
  const me = ev.car === 'me', near = nearness(ev.x, ev.y, ev.z);
  const r = cars.get(ev.car);
  switch (ev.t) {
    case 'glass': fx.glass(ev.x!, ev.y!, ev.z!); audio.glass(Math.max(near, me ? 0.8 : 0)); if (me && performance.now() - lastGlassToast > 1500) { toast(ev.id === 'windshield' ? 'Windshield shattered!' : 'Glass smashed!'); lastGlassToast = performance.now(); } break;
    case 'light': if (r?.st) fx.debris(r.st.com[0], r.st.com[1], r.st.com[2], ev.id?.startsWith('head') ? 1 : 1, ev.id?.startsWith('head') ? 1 : 0.2, ev.id?.startsWith('head') ? 0.9 : 0.15, 8); break;
    case 'part': if (me) toast(TOAST_NAMES[ev.id || ''] || 'Something fell off!'); audio.crash(8, me ? 1 : near); break;
    case 'spark': fx.spark(ev.x!, ev.y!, ev.z!, ev.v || 8); if (Math.random() < 0.5) audio.scrape(me ? 0.7 : near); break;
    case 'crash': audio.crash(ev.v || 5, me ? 1 : near); if (me) { shake = Math.min(0.6, shake + (ev.v || 5) / 40); if (vr.active) vr.rumble((ev.v || 5) / 15); } break;
    case 'tyre': if (me) toast('Flat tyre!'); audio.pop(me ? 1 : near); break;
    case 'engine': if (me) toast('Engine destroyed! Press R to recover.', 3500); break;
  }
}

// ---------------- UI ----------------
const ui = document.getElementById('ui')!;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
function toast(text: string, ms = 2200) {
  vr.say(text);
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
  $('#toasts').appendChild(t);
  while ($('#toasts').children.length > 3) $('#toasts').firstElementChild!.remove();
  setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 400);
}
const statBar = (v: number) => `<span class="sbar"><i style="width:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%"></i></span>`;
const fmtT = (t: number) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };

ui.innerHTML = `
  <div id="title" class="screen">
    <div class="title-inner">
      <header><h1>CRUMPLE<span>ZONE</span></h1><p>Soft-body driving. Every panel dents, every window can shatter.</p></header>
      <section><h2>Where</h2><div id="maps" class="cards"></div></section>
      <section><h2>What</h2><div id="cars" class="cards"></div><div id="colors" class="colors"></div></section>
      <div class="go-row"><button id="go" class="big">Drive ▶</button><button id="title-settings" class="ghost">⚙ Settings</button><button id="title-vr" class="ghost vr-only">🥽 Play in VR</button></div>
      <p class="hint">${coarse ? 'Hold your phone sideways. Gas and brake on the right, steering on the left.' : 'WASD / arrows to drive · Space handbrake · R recover · C camera · Esc menu · Gamepads work too'}</p>
    </div>
  </div>
  <div id="hud" hidden>
    <div id="mode-info"></div>
    <div id="topbtns">
      <button id="b-menu" title="Menu (Esc)">☰</button>
      <button id="b-cam" title="Camera (C)">🎥</button>
      <button id="b-reset" title="Recover (R)">🔧</button>
      <button id="b-slow" title="Slow motion (M)">🐢</button>
      <button id="b-vr" class="vr-only" title="Play in VR">🥽</button>
    </div>
    <div id="toasts"></div>
    <div id="dash">
      <div id="dmg"><div class="car-ico"></div><div><b id="dmg-t">Mint</b><span class="hbar"><i id="hp"></i></span><small id="hp-t">Engine 100%</small></div></div>
      <div id="speedo"><div id="rpm"><i></i></div><b id="spd">0</b><small>km/h</small><span id="gear">1</span></div>
    </div>
    <div id="lab" hidden>
      <label>Target <select id="lab-target"></select></label>
      <label>Speed <input id="lab-speed" type="range" min="20" max="200" step="5" value="60"><b id="lab-speed-v">60 km/h</b></label>
      <div class="lab-btns"><button id="lab-go" class="big">Launch!</button><button id="lab-drop">Drop 15 m</button><label class="chk"><input id="lab-slow" type="checkbox"> Slow-mo</label></div>
    </div>
    <div id="countdown" hidden></div>
    <div id="touch" ${coarse ? '' : 'hidden'}>
      <div class="tl"><button id="t-left">◀</button><button id="t-right">▶</button></div>
      <div class="tf" id="tfly" hidden><button id="t-fly">FLY</button><button id="t-up">▲</button><button id="t-down">▼</button><button id="t-boost">🚀</button></div>
      <div class="tr"><button id="t-hand">HB</button><button id="t-brake">BRAKE</button><button id="t-gas">GAS</button></div>
    </div>
  </div>
  <div id="menu" class="overlay" hidden></div>
  <div id="rotate">↻ Turn your phone sideways to drive</div>
`;

// title screen
let pickMap = set.map, pickCar = set.car, pickColor = set.color;
function renderTitle() {
  $('#maps').innerHTML = MAP_LIST.map(m => `<button class="card ${m.id === pickMap ? 'sel' : ''}" data-map="${m.id}"><span class="emo">${m.emoji}</span><b>${m.name}</b><small>${m.blurb}</small></button>`).join('');
  const maxP = Math.max(...SPECS.map(s => s.power / s.mass));
  $('#cars').innerHTML = SPECS.map(s => `<button class="card ${s.id === pickCar ? 'sel' : ''}" data-car="${s.id}"><span class="emo">${s.emoji}</span><b>${s.name}</b><small>${s.blurb}</small>
    <div class="stats"><span>Speed</span>${statBar((s.power / s.mass) / maxP)}<span>Weight</span>${statBar(s.mass / 11000 + 0.1)}<span>Tough</span>${statBar(s.strength / 1.8)}</div></button>`).join('');
  const spec = SPEC[pickCar];
  if (!spec.colors.includes(pickColor)) pickColor = spec.colors[0];
  $('#colors').innerHTML = spec.colors.map(c => `<button class="sw ${c === pickColor ? 'sel' : ''}" data-color="${c}" style="background:${c}" aria-label="colour ${c}"></button>`).join('');
}
$('#title').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
  audio.start();
  if (b.dataset.map) { pickMap = b.dataset.map; renderTitle(); }
  if (b.dataset.car) { pickCar = b.dataset.car; renderTitle(); showroom(); }
  if (b.dataset.color) { pickColor = b.dataset.color; renderTitle(); cars.get('me')?.view.setColor(pickColor); }
  if (b.id === 'go') startDrive();
  if (b.id === 'title-settings') openMenu('settings');
  if (b.id === 'title-vr') enterVR();
});

async function showroom() {
  if (map.id !== 'lab' || !world) await loadMap('lab');
  spawnCar('me', pickCar, pickColor, 0, -60, 0.4);
  orbit = { yaw: 0.9, pitch: 0.18, dist: SPEC[pickCar].stations.at(-1)!.z * 2.4 + 3 };
}

async function startDrive() {
  set.map = pickMap; set.car = pickCar; set.color = pickColor; saveSettings();
  $('#title').hidden = true; $('#hud').hidden = false;
  mode = 'drive'; camMode = set.cam % 4;
  boot(true, 'Building the world…');
  await loadMap(set.map);
  const sp = startPoint();
  spawnCar('me', set.car, set.color, sp.x, sp.z, sp.yaw);
  setupMode();
  boot(false);
  if (!sessionStorage.getItem('cz-help')) { sessionStorage.setItem('cz-help', '1'); toast(coarse ? 'Hold GAS to go. ◀ ▶ to steer. 🔧 recovers the car.' : 'W to go, S to brake/reverse, A/D steer, Space handbrake, R recover, C camera', 5000); }
}

function setupMode() {
  $('#lab').hidden = !map.lab;
  if (map.id === 'valley') spawnTraffic();
  if (map.id === 'race') startRace();
  if (map.lab) {
    const sel = $<HTMLSelectElement>('#lab-target');
    sel.innerHTML = LAB_TARGETS.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
  }
}

// ---------------- free roam traffic ----------------
const TRAFFIC = ['vesper', 'brutus', 'hauler', 'bus', 'brutus', 'vesper'];
function spawnTraffic() {
  for (const k of [...cars.keys()]) if (k.startsWith('ai')) removeCar(k);
  for (let i = 0; i < set.traffic; i++) spawnAI(i);
}
function spawnAI(i: number) {
  const route = map.ai[i % map.ai.length]; if (!route) return;
  const me = cars.get('me')?.st?.com ?? [startPoint().x, 0, startPoint().z];
  let best = 0, tries = 0;
  do { best = Math.floor(Math.random() * route.length); tries++; } while (tries < 40 && Math.hypot(route[best][0] - me[0], route[best][1] - me[2]) < 70);
  const p = route[best], q = route[(best + 1) % route.length];
  const spec = TRAFFIC[(i + Math.floor(Math.random() * 3)) % TRAFFIC.length], s = SPEC[spec];
  spawnCar('ai' + i, spec, s.colors[Math.floor(Math.random() * s.colors.length)], p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1]), i % map.ai.length, spec === 'bus' || spec === 'hauler' ? 11 : 13 + Math.random() * 4);
}
function manageTraffic(dt: number) {
  for (const r of cars.values()) {
    if (!r.ai || !r.st || r.key.startsWith('rival')) continue;
    const bad = r.st.dead || r.st.up[1] < 0.3 || Math.abs(r.st.speed) < 0.5;
    r.stuck = bad ? r.stuck + dt : 0;
    if (r.stuck > 8) { const i = +r.key.slice(2); removeCar(r.key); spawnAI(i); }
  }
}

// ---------------- crash lab ----------------
const LAB_TARGETS = [
  { name: '🧱 Concrete wall', x: 0, z: 30 }, { name: '🚦 Pole', x: -30, z: 30 }, { name: '🚧 Barriers', x: 30, z: 30 },
  { name: '🛞 Tyre wall', x: -60, z: 30 }, { name: '⤴️ Ramps', x: 62, z: -20 }, { name: '◧ Offset wall (half the car)', x: -86, z: 30 },
  { name: '▭ Kerb step', x: 95, z: 30 }, { name: '🚌 Side of a parked bus', x: -150, z: 0, target: 'bus' }, { name: '🚘 Head-on with a muscle car', x: 150, z: 0, target: 'brutus', headon: true },
];
function labLaunch(drop = false) {
  const t = LAB_TARGETS[+$<HTMLSelectElement>('#lab-target').value || 0];
  const kmh = +$<HTMLInputElement>('#lab-speed').value;
  removeCar('target');
  if (t.target) {
    const s = SPEC[t.target];
    if (t.headon) { spawnCar('target', t.target, s.colors[0], t.x, 60, Math.PI); }
    else spawnCar('target', t.target, s.colors[0], t.x, 50, Math.PI / 2);
  }
  post({ t: 'place', key: 'me', x: t.x, z: t.z, yaw: 0, repair: true, drop: drop ? 15 : 0 });
  if (!drop) post({ t: 'launch', key: 'me', speed: kmh / 3.6 });
  if (t.headon && !drop) post({ t: 'launch', key: 'target', speed: kmh / 3.6 });
  fx.skids.clear();
  slow = $<HTMLInputElement>('#lab-slow').checked;
  camMode = 0; camSnap = true;
}
$('#lab-speed').addEventListener('input', () => { $('#lab-speed-v').textContent = `${$<HTMLInputElement>('#lab-speed').value} km/h`; });
$('#lab-go').addEventListener('click', () => labLaunch());
$('#lab-drop').addEventListener('click', () => labLaunch(true));

// ---------------- race ----------------
function startRace() {
  const cps = map.checkpoints!;
  for (const k of [...cars.keys()]) if (k.startsWith('rival')) removeCar(k);
  const sp = map.spawns[0], f = [Math.sin(sp.yaw), Math.cos(sp.yaw)], side = [f[1], -f[0]];
  for (let i = 0; i < set.rivals; i++) {
    const spec = ['brutus', 'vesper', 'brutus'][i % 3], s = SPEC[spec];
    const back = 9 + i * 8, lat = i % 2 ? -3.2 : 3.2;
    spawnCar('rival' + i, spec, s.colors[(i + 1) % s.colors.length], sp.x - f[0] * back + side[0] * lat, sp.z - f[1] * back + side[1] * lat, sp.yaw, 0, 22 + i * 3 + Math.random() * 2);
  }
  post({ t: 'place', key: 'me', x: sp.x, z: sp.z, yaw: sp.yaw, repair: true });
  Object.assign(race, { cp: 1, lap: 1, running: false, count: 3.5, last: 0, lastCp: 0, lapTimes: [] });
  world?.setNextGate(1);
  void cps;
}
function raceTick(dt: number) {
  const me = cars.get('me')?.st; if (!me || !map.checkpoints) return;
  const cps = map.checkpoints;
  if (!race.running) {
    const before = Math.ceil(race.count);
    race.count -= dt;
    const n = Math.ceil(race.count);
    $('#countdown').hidden = false; $('#countdown').textContent = n > 0 ? String(n) : 'GO!';
    if (n !== before) audio.beep(n <= 0);
    if (race.count <= 0) { race.running = true; race.start = race.lapStart = performance.now(); setTimeout(() => ($('#countdown').hidden = true), 700); }
    return;
  }
  const cp = cps[race.cp];
  if (Math.hypot(me.com[0] - cp.x, me.com[2] - cp.z) < cp.w * 0.75) {
    race.lastCp = race.cp;
    if (race.cp === 0) {
      const t = (performance.now() - race.lapStart) / 1000;
      race.lapTimes.push(t);
      const key = `race:${set.car}`, isBest = !best[key] || t < best[key];
      if (isBest) { best[key] = t; store.set('cz-best', best); }
      toast(`Lap ${race.lap}: ${fmtT(t)}${isBest ? '  ★ best!' : ''}`, 3000); audio.beep(true);
      race.lap++; race.lapStart = performance.now();
    } else audio.beep();
    race.cp = (race.cp + 1) % cps.length;
    world?.setNextGate(race.cp);
  }
}

// ---------------- menu (pause / spawn & tune / settings) ----------------
let menuTab = 'car';
function openMenu(tab = menuTab) {
  menuTab = tab; menuOpen = true; renderMenu(); $('#menu').hidden = false;
}
function closeMenu() { menuOpen = false; $('#menu').hidden = true; }
function renderMenu() {
  const inGame = mode === 'drive';
  const tabs = inGame ? [['car', '🚗 Vehicle'], ['world', '🌍 World'], ['settings', '⚙ Settings'], ['help', '🎮 Controls']] : [['settings', '⚙ Settings'], ['help', '🎮 Controls']];
  if (!tabs.some(t => t[0] === menuTab)) menuTab = tabs[0][0];
  const slider = (id: string, label: string, v: number, min: number, max: number, step: number, fmt: (x: number) => string) =>
    `<label class="row"><span>${label}</span><input type="range" data-set="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><b>${fmt(v)}</b></label>`;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  let body = '';
  if (menuTab === 'car') {
    const spec = SPEC[set.car];
    body = `<div class="cards small">${SPECS.map(s => `<button class="card ${s.id === set.car ? 'sel' : ''}" data-swap="${s.id}"><span class="emo">${s.emoji}</span><b>${s.name}</b></button>`).join('')}</div>
      <div class="colors">${spec.colors.map(c => `<button class="sw ${c === set.color ? 'sel' : ''}" data-paint="${c}" style="background:${c}"></button>`).join('')}</div>
      ${slider('power', 'Engine power', set.power, 0.5, 2.5, 0.1, pct)}
      ${slider('grip', 'Tyre grip', set.grip, 0.5, 1.6, 0.05, pct)}
      ${slider('strength', 'Body toughness', set.strength, 0.3, 3, 0.1, pct)}
      <label class="row chk"><input type="checkbox" data-set="aids" ${set.aids ? 'checked' : ''}> <span>Traction control and ABS</span></label>
      <div class="btns"><button data-act="repair">🔧 Repair here</button><button data-act="home">🏁 Back to start</button></div>`;
  } else if (menuTab === 'world') {
    const g = set.gravity;
    body = `${map.id === 'valley' ? slider('traffic', 'Traffic cars', set.traffic, 0, coarse ? 3 : 6, 1, x => String(x)) : ''}
      ${map.id === 'race' ? slider('rivals', 'Race rivals', set.rivals, 0, 3, 1, x => String(x)) + '<div class="btns"><button data-act="restart">🔁 Restart race</button></div>' : ''}
      <div class="row"><span>Gravity</span><div class="seg">${[['Earth', 9.81], ['Mars', 3.71], ['Moon', 1.62]].map(([n, v]) => `<button data-grav="${v}" class="${Math.abs(g - (v as number)) < 0.01 ? 'sel' : ''}">${n}</button>`).join('')}</div></div>
      <label class="row chk"><input type="checkbox" data-set="slow" ${slow ? 'checked' : ''}> <span>Slow motion (M)</span></label>
      <div class="btns"><button data-act="parked">🚙 Park a car ahead of me</button><button data-act="drop">🪂 Drop me from 20 m</button></div>
      <div class="btns"><button data-act="title">🏠 Main menu</button></div>
      ${map.id === 'race' && Object.keys(best).some(k => k.startsWith('race:')) ? `<p class="best">Best laps: ${SPECS.filter(s => best['race:' + s.id]).map(s => `${s.name} ${fmtT(best['race:' + s.id])}`).join(' · ')}</p>` : ''}`;
  } else if (menuTab === 'settings') {
    body = `<div class="row"><span>Graphics</span><div class="seg">${['low', 'high'].map(q => `<button data-quality="${q}" class="${set.quality === q ? 'sel' : ''}">${q === 'low' ? 'Fast' : 'Pretty'}</button>`).join('')}</div></div>
      ${slider('volume', 'Sound', set.volume, 0, 1, 0.05, pct)}
      ${coarse ? `<label class="row chk"><input type="checkbox" data-set="tilt" ${set.tilt ? 'checked' : ''}> <span>Tilt the phone to steer</span></label>` : ''}
      <p class="small-note">Physics: ${simMs.toFixed(1)} ms per frame · build ${__BUILD__}</p>`;
  } else {
    body = `<table class="keys">
      <tr><td>W / ↑ · RT</td><td>Throttle</td></tr><tr><td>S / ↓ · LT</td><td>Brake, hold to reverse</td></tr>
      <tr><td>A D / ← → · stick</td><td>Steer</td></tr><tr><td>Space · A</td><td>Handbrake</td></tr>
      <tr><td>R · B</td><td>Recover (repair, upright)</td></tr><tr><td>T · X</td><td>Back to start</td></tr>
      <tr><td>C · Y</td><td>Change camera</td></tr><tr><td>M · Back</td><td>Slow motion</td></tr>
      <tr><td>L / Enter · RB</td><td>Launch (crash lab)</td></tr><tr><td>F · LB</td><td>Thrusters on/off (Zephyr X)</td></tr><tr><td>E / Q · D-pad</td><td>Climb / descend</td></tr><tr><td>Shift · RB</td><td>Rocket boost</td></tr><tr><td>Esc · Start</td><td>Menu</td></tr>
      <tr><td>Mouse drag</td><td>Look around (orbit camera)</td></tr></table>`;
  }
  $('#menu').innerHTML = `<div class="panel"><div class="tabs">${tabs.map(([id, n]) => `<button data-tab="${id}" class="${id === menuTab ? 'sel' : ''}">${n}</button>`).join('')}<button class="close" data-act="close">✕</button></div><div class="body">${body}</div>
    ${inGame ? '<button class="big resume" data-act="close">Resume ▶</button>' : ''}</div>`;
}
$('#menu').addEventListener('input', e => {
  const el = e.target as HTMLInputElement, k = el.dataset.set; if (!k) return;
  const v = el.type === 'checkbox' ? el.checked : +el.value;
  if (k === 'slow') slow = v as boolean;
  else (set as any)[k] = v;
  if (el.type === 'range') { const b = el.parentElement!.querySelector('b'); if (b) b.textContent = k === 'traffic' || k === 'rivals' ? String(v) : `${Math.round((v as number) * 100)}%`; }
  if (['power', 'grip', 'strength', 'aids'].includes(k)) post({ t: 'tune', key: 'me', [k]: v });
  if (k === 'volume') audio.setVolume(v as number);
  if (k === 'tilt') { controls.useTilt = v as boolean; askTilt(); }
  saveSettings();
});
$('#menu').addEventListener('change', e => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.set === 'traffic') spawnTraffic();
  if (el.dataset.set === 'rivals') startRace();
});
$('#menu').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
  if (e.target === $('#menu')) { closeMenu(); return; }
  const d = b.dataset;
  if (d.tab) { menuTab = d.tab; renderMenu(); return; }
  if (d.swap) { set.car = d.swap; set.color = SPEC[d.swap].colors[0]; saveSettings(); respawnMe(); renderMenu(); return; }
  if (d.paint) { set.color = d.paint; saveSettings(); cars.get('me')?.view.setColor(d.paint); renderMenu(); return; }
  if (d.grav) { set.gravity = +d.grav; saveSettings(); post({ t: 'gravity', g: set.gravity }); renderMenu(); return; }
  if (d.quality) { set.quality = d.quality as 'low' | 'high'; saveSettings(); toast('Graphics change applies after reload'); renderMenu(); return; }
  switch (d.act) {
    case 'close': closeMenu(); break;
    case 'repair': recover(); closeMenu(); break;
    case 'home': backToStart(); closeMenu(); break;
    case 'restart': startRace(); closeMenu(); break;
    case 'parked': parkAhead(); closeMenu(); break;
    case 'drop': { const st = cars.get('me')?.st; if (st) post({ t: 'place', key: 'me', x: st.com[0], z: st.com[2], yaw: Math.atan2(st.fwd[0], st.fwd[2]), repair: true, drop: 20 }); closeMenu(); break; }
    case 'title': closeMenu(); toTitle(); break;
  }
});
$('#menu').addEventListener('pointerdown', e => { if (e.target === $('#menu')) closeMenu(); });

function respawnMe() {
  const st = cars.get('me')?.st, sp = startPoint();
  const x = st ? st.com[0] : sp.x, z = st ? st.com[2] : sp.z, yaw = st ? Math.atan2(st.fwd[0], st.fwd[2]) : sp.yaw;
  spawnCar('me', set.car, set.color, x, z, yaw);
}
function recover() {
  const st = cars.get('me')?.st; if (!st) return;
  post({ t: 'place', key: 'me', x: st.com[0], z: st.com[2], yaw: Math.atan2(st.fwd[0], st.fwd[2]), repair: true });
  fx.skids.lift('me0'); toast('Recovered', 900);
}
function backToStart() {
  if (map.id === 'race' && race.lastCp >= 0) {
    const cp = map.checkpoints![race.running ? race.lastCp : 0];
    post({ t: 'place', key: 'me', x: cp.x, z: cp.z, yaw: cp.yaw, repair: true });
  } else { const sp = startPoint(); post({ t: 'place', key: 'me', x: sp.x, z: sp.z, yaw: sp.yaw, repair: true }); }
  camSnap = true;
}
function parkAhead() {
  const st = cars.get('me')?.st; if (!st) return;
  const fl = Math.hypot(st.fwd[0], st.fwd[2]) || 1, fx_ = st.fwd[0] / fl, fz = st.fwd[2] / fl;
  const kinds = ['brutus', 'hauler', 'bus', 'vesper'], k = kinds[Math.floor(Math.random() * kinds.length)];
  spawnCar('parked', k, SPEC[k].colors[1], st.com[0] + fx_ * 30, st.com[2] + fz * 30, Math.atan2(fx_, fz) + Math.PI / 2);
  toast(`A parked ${SPEC[k].name} appeared 30 m ahead`);
}
async function toTitle() {
  mode = 'menu'; $('#hud').hidden = true; $('#title').hidden = false; $('#countdown').hidden = true; audio.silence();
  pickMap = set.map; pickCar = set.car; pickColor = set.color; renderTitle();
  await showroom();
}
function askTilt() {
  const D = (window as any).DeviceOrientationEvent;
  if (controls.useTilt && D?.requestPermission) D.requestPermission().catch(() => toast('Tilt steering needs motion access'));
}
controls.useTilt = set.tilt;

// top buttons + touch pedals
const tap = (id: string, fn: () => void) => $(id).addEventListener('click', () => { audio.start(); fn(); });
tap('#b-menu', () => (menuOpen ? closeMenu() : openMenu()));
tap('#b-cam', () => cycleCam());
tap('#b-reset', () => recover());
tap('#b-vr', () => enterVR());
tap('#b-slow', () => { slow = !slow; toast(slow ? 'Slow motion on' : 'Slow motion off', 900); });
for (const [id, k] of [['#t-left', 'left'], ['#t-right', 'right'], ['#t-gas', 'gas'], ['#t-brake', 'brake'], ['#t-hand', 'hand'], ['#t-up', 'up'], ['#t-down', 'down'], ['#t-boost', 'boost']] as const) controls.bindButton($(id), k, () => audio.start());
addEventListener('keydown', () => audio.start(), { once: true });
$('#t-fly').addEventListener('click', () => toggleFly());
function enterVR() {
  pickMap = pickMap || set.map;
  vr.enter().catch(e => toast('Could not start VR: ' + (e?.message || e), 4000));
}
function toggleFly() {
  const spec = SPEC[set.car]; if (!spec.flight) return;
  flyOn = !flyOn; $('#t-fly').classList.toggle('on', flyOn);
  toast(flyOn ? (coarse ? 'Thrusters on: ▲ climb, ▼ descend, 🚀 boost' : 'Thrusters on: E climb, Q descend, Shift boost, F to land') : 'Thrusters off', 1800);
}
function cycleCam() { camMode = (camMode + 1) % 4; set.cam = camMode; saveSettings(); toast(`${CAMS[camMode]} camera`, 800); camSnap = true; }

// orbit camera: drag on the canvas
let drag: { x: number; y: number; id: number } | null = null;
renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  orbit.yaw -= dx * 0.008; orbit.pitch = Math.max(-0.1, Math.min(1.3, orbit.pitch + dy * 0.006));
  if (mode === 'drive' && camMode === 0 && Math.abs(dx) + Math.abs(dy) > 3) { lookT = 2.5; }
});
addEventListener('pointerup', () => (drag = null));
renderer.domElement.addEventListener('wheel', e => { orbit.dist = Math.max(3, Math.min(40, orbit.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });

// ---------------- camera ----------------
let camSnap = true, lookT = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let chaseYaw = 0;
function carLength(spec: Spec) { return spec.stations.at(-1)!.z - spec.stations[0].z; }
function updateCamera(dt: number) {
  const me = cars.get('me'); if (!me?.st) return;
  const st = me.st, spec = me.spec, v = me.view;
  const com = new THREE.Vector3(...st.com);
  const L = carLength(spec), H = spec.stations.reduce((a, s) => Math.max(a, s.yt), 0);
  if (mode === 'menu') {
    orbit.yaw += dt * 0.15;
    const p = com.clone().add(new THREE.Vector3(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)).multiplyScalar(orbit.dist));
    camera.position.copy(p); camera.up.set(0, 1, 0); camera.lookAt(com.x, com.y + 0.2, com.z);
    // keep the car on the right of the menu on wide screens
    camera.setViewOffset(innerWidth, innerHeight, innerWidth > 900 || innerHeight < 500 ? -innerWidth * 0.2 : 0, innerHeight > innerWidth ? innerHeight * 0.18 : 0, innerWidth, innerHeight);
    return;
  }
  camera.clearViewOffset();
  const f = new THREE.Vector3(...st.fwd), up = new THREE.Vector3(...st.up);
  if (camMode === 0) {
    // chase: swing behind the direction of travel, smoothly
    const flat = Math.atan2(f.x, f.z);
    if (camSnap) chaseYaw = flat;
    let d = flat - chaseYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (st.up[1] > 0.3) chaseYaw += d * (1 - Math.exp(-dt * (st.speed < -2 ? 1 : 3.2)));
    lookT -= dt;
    const yaw = lookT > 0 ? orbit.yaw : chaseYaw + (st.speed < -3 ? Math.PI : 0);
    if (lookT <= 0) orbit.yaw = chaseYaw;
    const dist = Math.max(5.5, L * 1.25) + Math.min(3, Math.abs(st.speed) * 0.04);
    const pitch = lookT > 0 ? orbit.pitch : 0.2;
    const want = com.clone().add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch) * dist, Math.max(1.5, H * 0.9) + Math.sin(pitch) * dist * 0.6, -Math.cos(yaw) * Math.cos(pitch) * dist));
    const g = heightAt(map, want.x, want.z) + 0.6; if (want.y < g) want.y = g;
    if (camSnap) camPos.copy(want); else camPos.lerp(want, 1 - Math.exp(-dt * 10));
    camLook.copy(com).addScaledVector(new THREE.Vector3(0, 1, 0), H * 0.45);
    camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(camLook);
  } else if (camMode === 3) {
    if (camSnap) { orbit.yaw = Math.atan2(f.x, f.z) + 0.5; orbit.pitch = 0.3; orbit.dist = Math.max(7, L * 1.6); }
    const p = com.clone().add(new THREE.Vector3(-Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), -Math.cos(orbit.yaw) * Math.cos(orbit.pitch)).multiplyScalar(orbit.dist));
    const g = heightAt(map, p.x, p.z) + 0.4; if (p.y < g) p.y = g;
    camera.position.copy(p); camera.up.set(0, 1, 0); camera.lookAt(com);
  } else {
    // hood or cockpit: bolted to the body
    const front = spec.stations.at(-1)!;
    const local = camMode === 1 ? new THREE.Vector3(0, Math.max(front.yt, spec.stations.at(-3)!.yt) + 0.28, front.z - L * 0.22) : new THREE.Vector3(spec.driver.x, spec.driver.y + 0.12, spec.driver.z);
    const p = v.toWorld(st, local);
    const right = new THREE.Vector3().crossVectors(f, up).normalize(), u2 = new THREE.Vector3().crossVectors(right, f).normalize();
    camera.position.copy(p);
    camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, u2, f.clone().negate()));
  }
  if (shake > 0.001) { camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake).multiplyScalar(0.5)); shake *= Math.exp(-dt * 6); }
  const wantFov = camMode === 2 ? 72 : 62 + Math.min(14, Math.abs(st.speed) * 0.18);
  if (Math.abs(camera.fov - wantFov) > 0.05) { camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); fxScale(); }
  camSnap = false;
}

// ---------------- per-frame effects from car states ----------------
const tmpV = new THREE.Vector3(), sideV = new THREE.Vector3();
function carEffects(r: CarRec, dt: number) {
  const st = r.st!; const W = st.wheels, v = r.view;
  const near = nearness(st.com[0], st.com[1], st.com[2]);
  if (near <= 0 && r.key !== 'me') return;
  const f = new THREE.Vector3(...st.fwd); sideV.set(f.z, 0, -f.x).normalize();
  for (let i = 0; i < r.spec.axles.length * 2; i++) {
    const slip = W[i * 6 + 4], R = W[i * 6 + 5], lost = W[i * 6 + 3] > 0.5;
    v.wheelPos(st, i, tmpV); tmpV.y -= R * 0.95;
    const key = r.key + i;
    if (slip > 0.3 && !lost) {
      const s = surfAt(map, tmpV.x, tmpV.z), soft = s === 0 || s === 3;
      if (!soft) fx.skids.add(key, tmpV, sideV, r.spec.wheelW * 0.9, (slip - 0.3) * 2);
      if (Math.random() < Math.min(1, (slip - 0.3) * 2.2) * dt * 40) {
        if (soft) fx.kick(tmpV.x, tmpV.y, tmpV.z, s === 3 ? 0.55 : 0.42, s === 3 ? 0.43 : 0.36, s === 3 ? 0.3 : 0.22);
        else if (slip > 0.55) fx.puff(tmpV.x, tmpV.y + 0.2, tmpV.z, 0, st.fwd[0] * st.speed, st.fwd[2] * st.speed);
      }
    } else fx.skids.lift(key);
  }
  if (st.jets && st.jets[0] > 0.05) {
    const h = st.com[1] - heightAt(map, st.com[0], st.com[2]);
    if (h < 6 && Math.random() < dt * 30) { const a = Math.random() * 6.28, r = 1 + Math.random() * 2; fx.kick(st.com[0] + Math.cos(a) * r, st.com[1] - h, st.com[2] + Math.sin(a) * r, 0.7, 0.72, 0.75); }
  }
  if (st.health < 0.55 && Math.random() < dt * (st.dead ? 14 : 6)) {
    const s = r.spec, z = s.engineAt === 'front' ? s.stations.at(-2)!.z : s.stations[1].z, y = s.stations.at(-2)!.yl + 0.15;
    v.toWorld(st, new THREE.Vector3(0, y, z), tmpV);
    fx.puff(tmpV.x, tmpV.y, tmpV.z, st.dead ? 0.9 : 0.4);
  }
}

// ---------------- HUD ----------------
let hudT = 0;
function updateHud(dt: number) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.08;
  const me = cars.get('me')?.st; if (!me) return;
  const spec = SPEC[set.car];
  $('#spd').textContent = String(Math.round(Math.abs(me.speed) * 3.6));
  $('#gear').textContent = me.gear < 0 ? 'R' : me.speed < 0.3 && me.throttle < 0.05 ? 'N' : String(me.gear);
  ($('#rpm i') as HTMLElement).style.width = `${Math.min(100, (me.rpm / spec.maxRpm) * 100)}%`;
  ($('#rpm i') as HTMLElement).classList.toggle('red', me.rpm > spec.maxRpm * 0.9);
  const hp = Math.round(me.health * 100);
  ($('#hp') as HTMLElement).style.width = `${hp}%`;
  ($('#hp') as HTMLElement).className = hp > 60 ? '' : hp > 25 ? 'warn' : 'bad';
  $('#hp-t').textContent = me.dead ? 'Engine dead' : `Engine ${hp}%`;
  const d = me.damage, parts = me.parts.length + me.windows.length * 0.2;
  $('#dmg-t').textContent = d < 0.4 && !parts ? 'Mint' : d < 2 ? 'Scratched' : d < 6 ? 'Dented' : d < 14 ? 'Smashed' : 'Wrecked';
  let info = '';
  if (map.id === 'race') {
    const now = race.running ? (performance.now() - race.lapStart) / 1000 : 0, b = best[`race:${set.car}`];
    info = `<b>Lap ${race.lap}</b> <span>${fmtT(now)}</span><small>Gate ${race.cp === 0 ? map.checkpoints!.length : race.cp}/${map.checkpoints!.length}${b ? ` · Best ${fmtT(b)}` : ''}</small>`;
  } else if (map.lab) info = `<b>Crash Lab</b><small>Pick a target and speed, then Launch</small>`;
  else info = `<b>${map.name}</b><small>${set.traffic ? `${set.traffic} traffic car${set.traffic > 1 ? 's' : ''}` : 'No traffic'}</small>`;
  if (flyOn) info += '<small class="slow">✈ Flying</small>';
  if (slow) info += '<small class="slow">🐢 Slow motion</small>';
  if (simMs > 30) info += '<small class="slow">Physics is struggling: try fewer cars</small>';
  $('#mode-info').innerHTML = info;
}

// ---------------- boot / loading ----------------
function boot(on: boolean, msg = '') {
  const b = $('#boot'); b.classList.toggle('gone', !on);
  if (msg) $('#boot-msg').textContent = msg;
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (document.hidden) return;
  const me = cars.get('me');
  // input
  if (mode === 'drive' && !menuOpen) {
    if (controls.hit('menu')) openMenu();
    if (controls.hit('camera')) cycleCam();
    if (controls.hit('reset')) recover();
    if (controls.hit('repair')) backToStart();
    if (controls.hit('slow')) { slow = !slow; toast(slow ? 'Slow motion on' : 'Slow motion off', 900); }
    if (controls.hit('launch') && map.lab && !(me?.spec.flight && flyOn)) labLaunch();
    if (controls.hit('fly')) toggleFly();
    const inp = controls.read(dt, me?.st?.speed ?? 0);
    if (vr.active && me?.st) {
      vr.update(dt, me.view, me.st, me.spec);
      inp.throttle = Math.max(inp.throttle, vr.throttle); inp.brake = Math.max(inp.brake, vr.brake);
      inp.steer = vr.steer; inp.hand = Math.max(inp.hand, vr.hand);
      if (vr.lift) inp.lift = vr.lift; inp.boost = Math.max(inp.boost, vr.boost);
      if (vr.hit('recover')) recover();
      if (vr.hit('home')) backToStart();
      if (vr.hit('fly')) toggleFly();
      if (vr.hit('launch') && map.lab && !me.spec.flight) labLaunch();
    }
    if (map.id === 'race' && !race.running) { inp.throttle = 0; inp.brake = 0; inp.hand = 1; }
    post({ t: 'input', key: 'me', ...inp, fly: flyOn, gear: vr.active ? vr.gearFor(SPEC[set.car]) : null });
  } else {
    if (menuOpen && controls.hit('menu')) closeMenu();
    post({ t: 'input', key: 'me', throttle: 0, brake: 0, steer: 0, hand: 1 });
  }
  controls.endFrame();
  // physics: one request in flight at a time
  pendingDt += dt;
  if (!waiting && cars.size) { waiting = true; post({ t: 'step', dt: Math.min(0.066, pendingDt), scale: slow ? 0.25 : 1 }); pendingDt = 0; }
  // draw
  for (const r of cars.values()) {
    if (!r.st) continue;
    if (r.fresh) { r.view.update(r.st, dt); r.view.group.visible = true; r.fresh = false; }
    if (mode === 'drive') carEffects(r, dt);
  }
  if (mode === 'drive') {
    manageTraffic(dt);
    if (map.id === 'race') raceTick(dt);
    if (me?.st) {
      const W = me.st.wheels; let slip = 0; for (let i = 0; i < W.length / 6; i++) slip = Math.max(slip, W[i * 6 + 4]);
      audio.drive(me.st.rpm, me.st.throttle, slip, Math.abs(me.st.speed), me.spec.style === 'muscle' ? 8 : me.spec.style === 'super' ? 10 : 6, me.st.dead);
      audio.jet(me.st.jets ? Math.max(me.st.jets[0] * 0.6, me.st.jets[1]) : 0);
    }
    updateHud(dt);
  }
  fx.update(slow ? dt * 0.25 : dt, (x, z) => heightAt(map, x, z));
  if (!vr.active) updateCamera(dt);
  world?.update(me?.st ? new THREE.Vector3(...me.st.com) : camera.position);
  renderer.render(scene, camera);
}

// ---------------- start ----------------
(async () => {
  $('#boot-bar').style.width = '30%';
  await loadTrees();
  $('#boot-bar').style.width = '70%';
  renderTitle();
  await showroom();
  $('#boot-bar').style.width = '100%';
  setTimeout(() => boot(false), 250);
  renderer.setAnimationLoop(frame);
  (window as any).__cz = { cars, post, worker, set, get map() { return map; }, startDrive, labLaunch, openMenu, toTitle, get simMs() { return simMs; }, camera, vr, renderer, scene, setCam: (i: number) => { camMode = i; camSnap = true; } };
})();

// a new build went live while the game was open: offer a reload
setInterval(async () => {
  try { const r = await fetch('/version.json', { cache: 'no-store' }); const v = await r.json(); if (v.build && v.build !== __BUILD__ && !__BUILD__.startsWith('dev')) toast('A new version is ready: reload to update', 6000); } catch { /* offline */ }
}, 5 * 60 * 1000);
