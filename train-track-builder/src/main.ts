/*
  Train Track Builder 3D: pick a region, snap track pieces together (turns, hills, loops, flips, spirals, boosters),
  hook carriages onto your engine, then drive it round: collect stars, pull off tricks, beat your lap time,
  and don't take the bends too fast or the whole train flies off the rails.
*/
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { Track, PIECES, PALETTE, type PieceId, type Sample } from './track';
import { TrackMesh } from './trackMesh';
import { World, REGIONS, PROP_MODELS, loadModels, type Region } from './world';
import { Train, ENGINES, CAR_TYPES, CAR, MAX_CARS, TRAIN_MODELS, WARN_AT, type Engine } from './train';
import { Fun, Smoke, fmt, type Award } from './fun';
import { sound } from './audio';
import { findWayHome } from './autoroute';

declare const __BUILD__: string;
const patchEnv = (window as any).patch as { quality?: string; addEventListener?: (t: string, f: () => void) => void } | undefined;
const params = new URLSearchParams(location.search);
const inPatchTest = params.has('patch-test');

// ---------- renderer ----------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.type = THREE.PCFShadowMap;
const applyQuality = () => { renderer.shadowMap.enabled = (patchEnv?.quality ?? 'high') !== 'low'; };
applyQuality(); patchEnv?.addEventListener?.('qualitychange', applyQuality);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

const world = new World(scene);
const track = new Track();
const mesh = new TrackMesh();
const ghost = new TrackMesh();
const train = new Train();
const fun = new Fun();
const smoke = new Smoke();
scene.add(mesh.group, ghost.group, train.group, fun.group, smoke.group);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.04; controls.minDistance = 5; controls.maxDistance = 180;
controls.target.set(0, 0, -10); camera.position.set(22, 22, 14);

// end-of-track arrow and a dotted guide back to the station
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
scene.add(arrow);
const guide = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 1, gapSize: 0.8, transparent: true, opacity: 0.7 }));
scene.add(guide);

// ---------- state ----------
type Mode = 'menu' | 'build' | 'drive';
type Cam = 'chase' | 'front' | 'drone';
let mode: Mode = 'menu';
let paused = false;
let region: Region = REGIONS[0];
let cam: Cam = 'chase';
const save = {
  get: (k: string) => { try { return JSON.parse(localStorage.getItem('ttb-' + k) || 'null'); } catch { return null; } },
  set: (k: string, v: any) => { try { localStorage.setItem('ttb-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let engine: Engine = ENGINES.find(t => t.id === save.get('train')) || ENGINES[0];
const carsFor = (e: Engine): string[] => { const c = save.get('cars-' + e.id); return Array.isArray(c) ? c.filter((x: string) => CAR[x]).slice(0, MAX_CARS) : [...e.cars]; };
let consist = carsFor(engine);
let derailOn = save.get('derail') !== false;
const setConsist = (c: string[]) => { consist = c.slice(0, MAX_CARS); save.set('cars-' + engine.id, consist); train.setTrain(engine, consist); train.reset(track); };
const multFor = (n: number) => 1 + n;

// ---------- UI ----------
const ui = document.getElementById('ui')!;
const h = (tag: string, attrs: Record<string, any> = {}, ...kids: (Node | string | null | false)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) (e as any)[k] = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  for (const c of kids) if (c) e.append(c);
  return e;
};
let toastT = 0;
const toastEl = h('div', { class: 'toast' }); ui.append(toastEl);
function toast(msg: string, kind: 'good' | 'bad' | 'info' = 'info', ms = 2200) {
  toastEl.textContent = msg; toastEl.className = 'toast show ' + kind;
  clearTimeout(toastT); toastT = window.setTimeout(() => { toastEl.className = 'toast'; }, ms);
}
/** little "+40" numbers that float up */
const popLayer = h('div', { class: 'pops' }); ui.append(popLayer);
function popup(text: string, big = false) {
  const e = h('div', { class: 'pop' + (big ? ' big' : '') }, text);
  e.style.left = `${50 + (Math.random() - 0.5) * (big ? 6 : 24)}%`;
  popLayer.append(e); setTimeout(() => e.remove(), big ? 1600 : 900);
}

// menu
const menu = h('div', { class: 'menu' });
function renderMenu() {
  const scroll = menu.scrollTop;
  menu.innerHTML = '';
  const regions = h('div', { class: 'cards' });
  for (const r of REGIONS) {
    const saved = (save.get('track-' + r.id) || []) as PieceId[];
    const best = save.get('best-' + r.id) as number | null;
    regions.append(h('button', { class: 'card region-' + r.id, onclick: () => { sound.unlock(); sound.click(); startBuild(r); } },
      h('div', { class: 'emoji' }, r.emoji), h('b', {}, r.name), h('span', {}, r.blurb),
      h('em', {}, saved.length ? `${saved.length} pieces built` : 'New track'),
      best ? h('em', { class: 'best' }, `🏆 Best ${best} points`) : null,
      r.gravity < 5 ? h('i', { class: 'tag' }, 'Low gravity!') : null));
  }
  const engines = h('div', { class: 'trains' });
  for (const t of ENGINES) engines.append(h('button', { class: 'pill' + (t.id === engine.id ? ' on' : ''), title: t.blurb, onclick: () => pickEngine(t) }, `${t.emoji} ${t.name}`));

  // the carriage yard: your train as it is, and every carriage you could hook on
  const strip = h('div', { class: 'consist' }, h('span', { class: 'chip engine' }, engine.emoji, h('small', {}, engine.name)));
  consist.forEach((id, i) => strip.append(h('button', { class: 'chip', title: 'Tap to unhook', onclick: () => { consist.splice(i, 1); setConsist(consist); sound.click(); renderMenu(); } }, CAR[id].emoji, h('small', {}, CAR[id].name), h('i', {}, '✕'))));
  if (!consist.length) strip.append(h('span', { class: 'empty' }, 'No carriages yet: tap one below to hook it on!'));
  const yard = h('div', { class: 'yard' });
  for (const c of CAR_TYPES) yard.append(h('button', { class: 'car' + (consist.length >= MAX_CARS ? ' full' : ''), onclick: () => {
    if (consist.length >= MAX_CARS) { sound.error(); toast(`That’s the longest train allowed: ${MAX_CARS} carriages!`, 'bad'); return; }
    setConsist([...consist, c.id]); sound.place(); renderMenu();
  } }, h('span', { class: 'ic' }, c.emoji), h('span', { class: 'nm' }, c.name)));
  const n = consist.length;
  menu.append(
    h('div', { class: 'title' }, h('div', { class: 'logo' }, '🚂'), h('h1', {}, 'Train Track Builder 3D'), h('p', {}, 'Build crazy tracks, hook on carriages, collect stars and ride the loops!')),
    h('h2', {}, '1. Pick your engine'), engines, h('p', { class: 'sub' }, engine.blurb),
    h('h2', {}, `2. Hook on carriages (${n}/${MAX_CARS})`),
    h('p', { class: 'sub' }, n ? `Every carriage makes your points bigger: ×${multFor(n)} points! But heavy trains speed up slower.` : 'Every carriage you hook on makes your points bigger!'),
    strip, yard,
    h('div', { class: 'trains' },
      h('button', { class: 'pill', onclick: () => { setConsist(randomTrain()); sound.cheer(); renderMenu(); } }, '🎲 Surprise me'),
      h('button', { class: 'pill', onclick: () => { setConsist([...engine.cars]); sound.click(); renderMenu(); } }, '↺ Its own carriages'),
      h('button', { class: 'pill', onclick: () => { setConsist([]); sound.click(); renderMenu(); } }, '🧹 Unhook all'),
      h('button', { class: 'pill' + (derailOn ? ' on' : ''), title: 'Take a bend too fast and your train flies off the rails', onclick: () => { derailOn = !derailOn; save.set('derail', derailOn); sound.click(); renderMenu(); } }, derailOn ? '💥 Crashes: ON' : '🛡️ Crashes: OFF')),
    h('h2', {}, '3. Pick a place to build'), regions,
    h('p', { class: 'credits' }, 'Models by Kenney (CC0), from Patch’s asset library.'));
  menu.scrollTop = scroll;
}
function pickEngine(t: Engine) {
  engine = t; save.set('train', t.id); consist = carsFor(t);
  train.setTrain(engine, consist); train.reset(track);
  sound.unlock(); sound.horn(t.horn); renderMenu();
}
function randomTrain() {
  const n = 3 + Math.floor(Math.random() * 6);
  return Array.from({ length: n }, () => CAR_TYPES[Math.floor(Math.random() * CAR_TYPES.length)].id);
}
ui.append(menu);

// build HUD
const palette = h('div', { class: 'palette' });
const buildTop = h('div', { class: 'topbar' });
const statsEl = h('span', { class: 'stats' });
const clearBtn = h('button', { class: 'btn', onclick: () => clearTrack() }, '🗑️');
buildTop.append(
  h('button', { class: 'btn ghost', onclick: () => goMenu() }, '🏠'),
  h('div', { class: 'where' }, statsEl),
  h('button', { class: 'btn', onclick: () => undo() }, '↩️ Undo'),
  h('button', { class: 'btn', title: 'Let the computer finish the track back to the station', onclick: () => finishLoop() }, '⭕ Finish loop'),
  clearBtn,
  h('button', { class: 'btn go', onclick: () => startDrive() }, '▶ Drive!'));
for (const id of PALETTE) {
  const p = PIECES[id];
  const b = h('button', { class: 'piece', title: `${p.name}: ${p.tip}${p.key ? ` (key ${p.key})` : ''}`, onclick: () => addPiece(id) },
    h('span', { class: 'ic' }, p.icon), h('span', { class: 'nm' }, p.name));
  b.addEventListener('pointerenter', e => { if ((e as PointerEvent).pointerType === 'mouse') preview(id); });
  b.addEventListener('pointerleave', () => preview(null));
  palette.append(b);
}
const buildHud = h('div', { class: 'hud build' }, buildTop, palette, h('div', { class: 'help' }, isTouch ? 'Drag to look around · pinch to zoom' : 'Drag to look around · scroll to zoom · keys 1–0 add pieces'));

// drive HUD
const speedEl = h('div', { class: 'speed' }, h('b', {}, '0'), h('span', {}, 'km/h'));
const scoreEl = h('div', { class: 'score' });
const camNames: Record<Cam, string> = { chase: '🎥 Behind', front: '🎥 Driver', drone: '🎥 Drone' };
const camBtn = h('button', { class: 'btn', onclick: () => toggleCam() }, camNames.chase);
const hornBtn = h('button', { class: 'btn', onclick: () => sound.horn(engine.horn) }, '📯');
const driveTop = h('div', { class: 'topbar' },
  h('button', { class: 'btn', title: 'Pause', onclick: () => openPause() }, '⏸️'),
  h('button', { class: 'btn', onclick: () => startBuild(region) }, '🔧 Build'),
  h('button', { class: 'btn', onclick: () => restart() }, '⏮ Station'),
  camBtn, hornBtn);
const goBtn = h('button', { class: 'pedal go' }, '▶', h('small', {}, 'GO'));
const brakeBtn = h('button', { class: 'pedal brake' }, '■', h('small', {}, 'BRAKE / BACK'));
const warnEl = h('div', { class: 'warn' });
const driveHelp = h('div', { class: 'help' }, isTouch ? 'Hold GO to speed up · hold BRAKE to stop or go backwards' : 'W / ↑ go · S / ↓ brake & reverse · C camera · Space horn · Esc pause');
const driveHud = h('div', { class: 'hud drive' }, warnEl, driveTop, speedEl, scoreEl, h('div', { class: 'pedals' }, brakeBtn, goBtn), driveHelp);
ui.append(buildHud, driveHud);

// pause
const pauseEl = h('div', { class: 'pause' });
function renderPause() {
  pauseEl.innerHTML = '';
  const inDrive = mode === 'drive';
  pauseEl.append(h('div', { class: 'panel' }, h('h2', {}, '⏸ Paused'),
    h('button', { class: 'btn go', onclick: () => closePause() }, '▶ Resume'),
    inDrive ? h('button', { class: 'btn', onclick: () => { closePause(); restart(); } }, '⏮ Back to the station') : null,
    inDrive ? h('button', { class: 'btn', onclick: () => { closePause(); startBuild(region); } }, '🔧 Build more track') : null,
    h('button', { class: 'btn', onclick: () => { closePause(); goMenu(); } }, '🏠 Main menu'),
    h('button', { class: 'btn', onclick: () => { sound.setMuted(!sound.muted); save.set('muted', sound.muted); renderPause(); } }, sound.muted ? '🔇 Sound: off' : '🔊 Sound: on'),
    h('p', { class: 'keys' }, 'Drive: W/↑ go · S/↓ brake & reverse · C camera · Space horn · R station · B build', h('br'), 'Controller: right trigger go · left trigger brake · top button camera · left button horn')));
}
function openPause() { if (mode === 'menu' || paused) return; paused = true; renderPause(); pauseEl.hidden = false; sound.stopDrive(); focusFirst(pauseEl); }
function closePause() { paused = false; pauseEl.hidden = true; last = performance.now(); }
pauseEl.hidden = true; ui.append(pauseEl);
sound.setMuted(!!save.get('muted'));

// pedals (touch + mouse)
let goHeld = false, brakeHeld = false;
const hold = (el: HTMLElement, set: (v: boolean) => void) => {
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(true); el.classList.add('on'); sound.unlock(); });
  const up = () => { set(false); el.classList.remove('on'); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
};
hold(goBtn, v => (goHeld = v)); hold(brakeBtn, v => (brakeHeld = v));

// keyboard
const keys = new Set<string>();
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  sound.unlock(); usingPad(false);
  if (e.code === 'Escape') { if (paused) closePause(); else openPause(); return; }
  if (paused || mode === 'menu') {
    const dir = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, number[]>)[e.code];
    if (dir) { e.preventDefault(); navMove(dir[0], dir[1]); }
    if ((e.code === 'Enter' || e.code === 'Space') && focused && document.body.contains(focused)) { e.preventDefault(); focused.click(); }
    return;
  }
  if (mode === 'build') {
    const p = PALETTE.find(id => PIECES[id].key === e.key); if (p) addPiece(p);
    if (e.code === 'Backspace' || (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey))) undo();
    if (e.code === 'Enter') startDrive();
    if (e.code === 'KeyF') finishLoop();
  } else if (mode === 'drive') {
    if (e.code === 'KeyC') toggleCam();
    if (e.code === 'Space') { e.preventDefault(); sound.horn(engine.horn); }
    if (e.code === 'KeyR') restart();
    if (e.code === 'KeyB') startBuild(region);
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (mode === 'drive') openPause(); });

// ---------- controller ----------
let focused: HTMLElement | null = null;
const padPrev: boolean[] = []; let padStick = [0, 0];
function usingPad(on: boolean) {
  document.body.classList.toggle('pad', on);
  driveHelp.textContent = on ? 'Right trigger go · left trigger brake & reverse · top button camera · Start pause'
    : isTouch ? 'Hold GO to speed up · hold BRAKE to stop or go backwards' : 'W / ↑ go · S / ↓ brake & reverse · C camera · Space horn · Esc pause';
}
const navRoot = () => paused ? pauseEl : mode === 'menu' ? menu : mode === 'build' ? buildHud : null;
function navButtons(root: HTMLElement) {
  return [...root.querySelectorAll('button')].filter(b => !(b as HTMLButtonElement).disabled && b.offsetParent !== null) as HTMLElement[];
}
function setFocus(b: HTMLElement | null) {
  focused?.classList.remove('padfocus'); focused = b;
  if (b) { b.classList.add('padfocus'); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (mode === 'build' && b.classList.contains('piece')) { const id = PALETTE[[...palette.children].indexOf(b)]; preview(id); } }
}
function focusFirst(root: HTMLElement) { setFocus(navButtons(root)[0] || null); }
function navMove(dx: number, dy: number) {
  const root = navRoot(); if (!root) return;
  const list = navButtons(root);
  if (!focused || !list.includes(focused)) { setFocus(list[0] || null); return; }
  const a = focused.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, bestD = Infinity;
  for (const b of list) {
    if (b === focused) continue;
    const r = b.getBoundingClientRect(), bx = r.left + r.width / 2, by = r.top + r.height / 2;
    const along = (bx - ax) * dx + (by - ay) * dy; if (along <= 4) continue;
    const across = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
    const d = along + across * 2.5; if (d < bestD) { bestD = d; best = b; }
  }
  if (best) { setFocus(best); sound.click(); }
}
function readPad() {
  if (inPatchTest || !navigator.getGamepads) return null;
  for (const g of navigator.getGamepads()) if (g && g.connected && g.mapping === 'standard') return g;
  return null;
}
/** buttons pressed this frame, and the throttle and brake */
function pollPad() {
  const g = readPad(); if (!g) return { go: 0, brake: 0, pressed: (_: number) => false };
  const now = g.buttons.map(b => b.pressed);
  const pressed = (i: number) => !!now[i] && !padPrev[i];
  const ax = g.axes[0] || 0, ay = g.axes[1] || 0, mag = Math.hypot(ax, ay);
  const stick = mag > 0.5 ? (Math.abs(ax) > Math.abs(ay) ? [Math.sign(ax), 0] : [0, Math.sign(ay)]) : [0, 0];
  const stickPress = (stick[0] || stick[1]) && (stick[0] !== padStick[0] || stick[1] !== padStick[1]);
  if (now.some((b, i) => b && i !== 16) || mag > 0.5) { usingPad(true); sound.unlock(); }
  const res = {
    go: Math.max(g.buttons[7]?.value || 0, now[0] ? 1 : 0),
    brake: Math.max(g.buttons[6]?.value || 0, now[1] ? 1 : 0),
    pressed, stick: stickPress ? stick : null as number[] | null,
  };
  padPrev.length = 0; padPrev.push(...now); padStick = stick;
  return res;
}
function padFrame() {
  const p = pollPad() as ReturnType<typeof pollPad> & { stick?: number[] | null };
  if (!readPad()) return p;
  const root = navRoot();
  if (p.pressed(9)) { if (paused) closePause(); else if (mode === 'build') startDrive(); else openPause(); return p; }
  if (root) {
    if (p.pressed(12)) navMove(0, -1); if (p.pressed(13)) navMove(0, 1); if (p.pressed(14)) navMove(-1, 0); if (p.pressed(15)) navMove(1, 0);
    if (p.stick) navMove(p.stick[0], p.stick[1]);
    if (p.pressed(0)) { if (focused && document.body.contains(focused)) focused.click(); else focusFirst(root); }
    if (p.pressed(1)) { if (paused) closePause(); else if (mode === 'build') undo(); }
    if (mode === 'build' && !paused && p.pressed(3)) finishLoop();
    if (mode === 'build' && !paused && p.pressed(8)) goMenu();
  } else if (mode === 'drive') {
    if (p.pressed(3)) toggleCam();
    if (p.pressed(2)) sound.horn(engine.horn);
    if (p.pressed(8)) restart();
  }
  return p;
}
function rumble(strong: number, ms: number) {
  const g = readPad() as any; g?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: strong / 2 })?.catch?.(() => {});
}

// ---------- modes ----------
function show(m: Mode) {
  mode = m;
  menu.hidden = m !== 'menu'; buildHud.hidden = m !== 'build'; driveHud.hidden = m !== 'drive';
  controls.enabled = m !== 'drive';
  arrow.visible = guide.visible = m === 'build';
  fun.group.visible = m !== 'menu';
  if (m !== 'drive') { sound.stopDrive(); smoke.clear(); warnEl.className = 'warn'; }
  const root = navRoot(); if (root && document.body.classList.contains('pad')) focusFirst(root); else setFocus(null);
}

function loadRegion(r: Region) {
  if (region.id !== r.id || !world.group.children.length) { region = r; world.setRegion(r); }
  track.reset();
  for (const id of (save.get('track-' + r.id) || []) as PieceId[]) if (PIECES[id]) track.add(id, true);
  mesh.stationName = `${r.emoji} ${r.name}`;
  rebuild(false);
}
function persist() { save.set('track-' + region.id, track.pieces); }

function rebuild(focus = true) {
  mesh.build(track);
  world.clearAround(track);
  const e = track.end;
  arrow.position.copy(e.p).add(new THREE.Vector3(0, 1.8, 0).applyQuaternion(e.q)).add(new THREE.Vector3(0, 0, 1.2).applyQuaternion(e.q));
  arrow.quaternion.copy(e.q);
  arrow.visible = mode === 'build' && !track.closed;
  // guide line back to the station
  const pts = track.closed ? [] : [e.p.clone(), track.start.p.clone()];
  guide.geometry.dispose(); guide.geometry = new THREE.BufferGeometry().setFromPoints(pts.length ? pts : [new THREE.Vector3(), new THREE.Vector3()]);
  guide.computeLineDistances(); guide.visible = mode === 'build' && !track.closed;
  statsEl.textContent = `${region.emoji} ${region.name} · ${track.pieces.length} pieces · ${Math.round(track.length)} m${track.closed ? ' · ✅ full circuit' : ''}`;
  fun.setup(track, train.length + 2.5, multFor(consist.length));
  if (focus) focusOn(e.p);
}
let focusTo: THREE.Vector3 | null = null;
function focusOn(p: THREE.Vector3) { focusTo = p.clone(); }

function startBuild(r: Region) {
  const fresh = mode === 'menu' || r.id !== region.id;
  if (mode === 'menu' || r.id !== region.id) loadRegion(r);
  train.setTrain(engine, consist); train.reset(track);
  show('build');
  if (fresh) { controls.target.copy(track.end.p); camera.position.copy(track.end.p).add(new THREE.Vector3(20, 22, 18)); }
  else { controls.target.copy(train.cars[0]?.o.position || track.end.p); camera.position.copy(controls.target).add(new THREE.Vector3(18, 18, 18)); }
  camera.up.set(0, 1, 0);
  if (!track.pieces.length) toast('Tap a piece to start building from the station!', 'info', 3500);
}
function goMenu() { train.setTrain(engine, consist); train.reset(track); renderMenu(); show('menu'); }

function addPiece(id: PieceId) {
  sound.unlock();
  const why = track.add(id);
  preview(null);
  if (why) { sound.error(); toast(why, 'bad'); palette.classList.remove('shake'); void palette.offsetWidth; palette.classList.add('shake'); return; }
  sound.place();
  persist(); rebuild();
  if (track.closed) { sound.cheer(); toast('🎉 Full circuit! Your train can go round and round. Press Drive!', 'good', 4500); }
}
let finishing = false;
async function finishLoop() {
  if (finishing) return;
  if (track.closed) { toast('Your track is already a full circuit!', 'good'); return; }
  const route = findWayHome(track);
  if (!route) { sound.error(); toast('I couldn’t find a way back from here. Try turning towards the station, or undo a piece.', 'bad', 3500); return; }
  finishing = true;
  const before = track.pieces.length;
  for (const id of route) {
    const why = track.add(id);
    if (why) {
      while (track.pieces.length > before) track.undo();
      persist(); rebuild(); finishing = false; sound.error();
      toast('Hmm, the way back is blocked. Move the end a bit and try again!', 'bad', 3000); return;
    }
    sound.place(); rebuild();
    await new Promise(r => setTimeout(r, 110));
  }
  finishing = false; persist(); rebuild();
  if (track.closed) { sound.cheer(); toast(`🎉 Added ${route.length} pieces: it’s a full circuit now!`, 'good', 3500); }
}
function undo() { if (!track.pieces.length) return; track.undo(); sound.click(); persist(); rebuild(); }
let clearArmed = 0;
function clearTrack() {
  if (!track.pieces.length) return;
  if (performance.now() - clearArmed > 2500) {
    clearArmed = performance.now(); clearBtn.textContent = '🗑️ Sure?'; sound.error();
    toast(`Tap 🗑️ again to clear the whole track in ${region.name}`, 'bad', 2500);
    setTimeout(() => { clearBtn.textContent = '🗑️'; }, 2500); return;
  }
  clearArmed = 0; clearBtn.textContent = '🗑️';
  track.reset(); persist(); rebuild(); controls.target.copy(track.end.p);
}
function preview(id: PieceId | null) {
  ghost.dispose();
  if (!id || mode !== 'build' || track.closed) return;
  const t2 = new Track(); t2.segs = [...track.segs];
  t2.add(id, true);
  const tmp = new Track(); tmp.segs = [t2.segs[t2.segs.length - 1]];
  ghost.build(tmp, true);
}

let derailShown = false;
function startDrive() {
  sound.unlock();
  if (track.length < 20) { toast('Build some track first!', 'bad'); return; }
  train.setTrain(engine, consist); train.derailOn = derailOn;
  const room = track.closed ? track.length - 6 : track.length - 3;
  if (train.length > room) { sound.error(); toast(`Your train is ${Math.round(train.length)} m long: too long for this track! Build more, or unhook carriages in the menu.`, 'bad', 4000); return; }
  train.reset(track);
  show('drive'); preview(null);
  newRun();
  toast(track.closed ? `All aboard! ${fun.starCount} stars to grab. Hold GO!` : 'All aboard! Grab the stars and watch out for the end of the line.', 'info', 2800);
}
function newRun() {
  fun.best = save.get('best-' + region.id) || 0;
  fun.bestLap = save.get(`lap-${region.id}-${engine.id}`) || 0;
  fun.setup(track, train.s, multFor(consist.length));
  chase.init = false; derailShown = false; smoke.clear();
}
function restart() { train.reset(track); newRun(); }
function toggleCam() { cam = cam === 'chase' ? 'front' : cam === 'front' ? 'drone' : 'chase'; camBtn.textContent = camNames[cam]; chase.init = false; sound.click(); }

// ---------- cameras ----------
const chase = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3(), init: false };
const mk = (): Sample => ({ p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), s: 0, boost: false });
const S = mk(), S2 = mk();
function driveCamera(dt: number) {
  const back = train.v < -0.5 ? -1 : 1;
  const k = 1 - Math.exp(-dt * 10);
  if (train.derailed) {
    // hold still and watch the wreck
    const c = train.cars[Math.min(1, train.cars.length - 1)].o.position;
    chase.look.lerp(c, 1 - Math.exp(-dt * 6)); chase.up.lerp(new THREE.Vector3(0, 1, 0), k).normalize();
    if (chase.pos.distanceTo(c) > 30) chase.pos.lerp(c, dt * 0.8);
    if (chase.pos.y < 1.5) chase.pos.y = 1.5;
    camera.position.copy(chase.pos); camera.up.copy(chase.up); camera.lookAt(chase.look); camera.fov = 62;
  } else if (cam === 'front') {
    track.at(train.s + 0.9, S);
    const want = S.p.clone().addScaledVector(S.u, 1.55);
    camera.position.copy(want);
    chase.up.lerp(S.u, 1 - Math.exp(-dt * 12)).normalize();
    camera.up.copy(chase.up);
    camera.lookAt(want.clone().addScaledVector(S.f, 10).addScaledVector(S.u, -0.4));
    camera.fov = 75;
    chase.pos.copy(camera.position); chase.look.copy(want);
  } else if (cam === 'drone') {
    // high up and to the side, looking down on the whole train
    const mid = train.cars[Math.floor(train.cars.length / 2)].o.position;
    track.at(train.s, S);
    const side = new THREE.Vector3(S.f.z, 0, -S.f.x).normalize();
    const d = 14 + Math.min(30, train.length * 0.45);
    const want = mid.clone().addScaledVector(side, d * 0.7).add(new THREE.Vector3(0, d * 0.75, 0)).addScaledVector(new THREE.Vector3(S.f.x, 0, S.f.z).normalize(), -d * 0.4);
    if (!chase.init) { chase.pos.copy(want); chase.look.copy(mid); chase.init = true; }
    chase.pos.lerp(want, 1 - Math.exp(-dt * 2.5)); chase.look.lerp(mid, 1 - Math.exp(-dt * 6)); chase.up.set(0, 1, 0);
    camera.position.copy(chase.pos); camera.up.set(0, 1, 0); camera.lookAt(chase.look); camera.fov = 55;
  } else {
    // a virtual car riding the track a few carriages behind the engine: it follows loops and flips without cutting through them
    const trail = Math.min(train.length, 16) + 6;
    track.at(back > 0 ? train.s - trail : train.s + 7, S);
    const want = S.p.clone().addScaledVector(S.u, 4.4);
    const front = track.at(train.s - (train.cars[0]?.len || 4) * 0.5, S2);
    const look = front.p.clone().addScaledVector(front.u, 1.6);
    if (!chase.init) { chase.pos.copy(want); chase.look.copy(look); chase.up.copy(S.u); chase.init = true; }
    chase.pos.lerp(want, k); chase.look.lerp(look, 1 - Math.exp(-dt * 12)); chase.up.lerp(S.u.clone().add(front.u), 1 - Math.exp(-dt * 5)).normalize();
    if (chase.pos.y < 0.8) chase.pos.y = 0.8;
    camera.position.copy(chase.pos); camera.up.copy(chase.up); camera.lookAt(chase.look);
    camera.fov = 62 + Math.min(14, Math.abs(train.v) * 0.3);
  }
  const shake = Math.max(train.bumped, train.derailed && train.derailed < 0.8 ? 0.8 - train.derailed : 0, Math.abs(train.lateral) > WARN_AT ? 0.12 : 0);
  if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
  camera.updateProjectionMatrix();
}

// ---------- scoring ----------
function renderScore() {
  const lapLine = track.closed ? `🏁 Lap ${fun.lap} · ${fmt(fun.lapTime)}${fun.bestLap ? ` · best ${fmt(fun.bestLap)}` : ''}` : '';
  scoreEl.innerHTML = '';
  scoreEl.append(...[h('b', {}, `⭐ ${fun.score}`), h('span', { class: 'mult' }, `×${fun.mult}`),
    h('small', {}, `${fun.starsGot}/${fun.starCount} stars${track.closed ? ' this lap' : ''}`), lapLine && h('small', {}, lapLine),
    fun.best > 0 && h('small', {}, `🏆 best ${fun.best}`)].filter(Boolean) as HTMLElement[]);
}
let starRun = 0, starRunT = 0;
function award(a: Award) {
  if (a.kind === 'star') {
    starRunT = 0.8; sound.star(starRun++); popup(`+${a.points}`); rumble(0.15, 40);
  } else {
    if (a.kind === 'lap') { sound.lap(); save.set(`lap-${region.id}-${engine.id}`, fun.bestLap); } else sound.trick();
    popup(`${a.text} +${a.points}`, true); rumble(0.4, 120);
  }
  if (fun.score >= fun.best) save.set('best-' + region.id, fun.best);
}

// ---------- loop ----------
let last = performance.now(), wasBoost = false, wasUpside = false, wasBump = 0, warnT = 0, scoreT = 0;
const tmpV = new THREE.Vector3();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const pad = padFrame();
  if (paused) { renderer.render(scene, camera); return; }
  if (mode === 'drive') {
    const go = goHeld || keys.has('KeyW') || keys.has('ArrowUp') ? 1 : pad.go;
    const brv = brakeHeld || keys.has('KeyS') || keys.has('ArrowDown') ? 1 : pad.brake;
    train.throttle = go > 0.05 ? go : 0;
    train.brake = false;
    if (brv > 0.3) { if (train.v > 0.4) train.brake = true; else train.throttle = -0.7 * brv; }
    // physics in small steps so loops stay smooth
    const steps = Math.ceil(dt / 0.01);
    for (let i = 0; i < steps; i++) train.update(dt / steps, track, region.gravity);
    driveCamera(dt);
    if (train.derailed) {
      if (!derailShown) {
        derailShown = true; sound.crash(); rumble(1, 600);
        toast(`💥 Off the rails! Too fast for that bend. Score: ${fun.score}`, 'bad', 3000);
        warnEl.className = 'warn';
      }
      if (train.derailed > 3.2) { restart(); toast('Back at the station. Brake before the bends!', 'info', 2200); }
      sound.stopDrive(); (speedEl.firstChild as HTMLElement).textContent = '0';
    } else {
      sound.drive(dt, train.v, train.throttle, !!engine.smoke);
      (speedEl.firstChild as HTMLElement).textContent = String(train.kmh);
      speedEl.classList.toggle('fast', train.kmh > 100);
      if (train.onBoost && !wasBoost && Math.abs(train.v) > 0.5) { sound.boost(); toast('⚡ BOOST!', 'good', 900); }
      wasBoost = train.onBoost;
      track.at(train.s - 2, S);
      const upside = S.u.y < -0.5;
      if (upside && !wasUpside) toast(['🙃 Upside down!', '😱 Wheee!', '🤸 Flip!'][Math.floor(Math.random() * 3)], 'good', 1100);
      wasUpside = upside;
      if (train.bumped > 0.55 && wasBump <= 0.55) { sound.bump(); rumble(0.8, 200); toast('💥 End of the line!', 'bad', 1500); }
      wasBump = train.bumped;
      // too fast for the bend: squeal, shake and go red before it flies off
      const lat = Math.abs(train.lateral);
      const danger = derailOn && !engine.grippy && lat > WARN_AT;
      warnEl.className = 'warn' + (danger ? ' on' : '');
      warnT -= dt;
      if (danger && warnT <= 0) { warnT = 0.3; sound.squeal(); rumble(0.3, 80); if (lat > WARN_AT * 1.1) toast('⚠️ Too fast for the bend! BRAKE!', 'bad', 900); }
      for (const a of fun.update(dt, track, train.s, train.kmh, now)) award(a);
      starRunT -= dt; if (starRunT <= 0) starRun = 0;
    }
    smoke.update(dt, engine.smoke && !region.stars && !train.derailed ? train.chimney(tmpV) : null, train.v, train.throttle);
    scoreT -= dt; if (scoreT <= 0) { scoreT = 0.1; renderScore(); }
    world.update(dt, train.cars[0]?.o.position || S.p);
  } else {
    if (focusTo) { controls.target.lerp(focusTo, 1 - Math.exp(-dt * 4)); if (controls.target.distanceTo(focusTo) < 0.05) focusTo = null; }
    controls.update();
    if (mode === 'build') { arrow.position.y += Math.sin(now / 250) * 0.004; train.place(track); fun.idle(dt); }
    world.update(dt, controls.target);
    if (mode === 'menu') {
      // circle round your train so you can see what you hooked on
      const c = train.cars[Math.floor(train.cars.length / 2)]?.o.position || new THREE.Vector3(0, 0, -10);
      const a = now / 9000, r = 16 + train.length * 0.35;
      camera.position.set(c.x + Math.cos(a) * r, c.y + 6 + r * 0.25, c.z + Math.sin(a) * r); camera.lookAt(c.x, c.y + 1.5, c.z);
    }
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
const bootBar = document.getElementById('boot-bar') as HTMLElement;
(async () => {
  await loadModels([...TRAIN_MODELS, ...PROP_MODELS, 'star'], k => { bootBar.style.width = Math.round(k * 100) + '%'; });
  world.setRegion(REGIONS[0]); loadRegion(REGIONS[0]);
  train.setTrain(engine, consist); train.reset(track);
  document.getElementById('boot')?.remove();
  renderMenu(); show('menu');
  requestAnimationFrame(frame);
  if (params.has('debug')) Object.assign(window as any, { __t: { track, train, world, fun, startBuild, startDrive, addPiece, finishLoop, pickEngine, setConsist, toggleCam, openPause, REGIONS, ENGINES, setCam: (c: Cam) => { cam = c; camBtn.textContent = camNames[c]; chase.init = false; }, get mode() { return mode; }, controls, camera, keys } });
})();

// a new version went live: offer a reload
async function checkUpdate() {
  try { const r = await fetch('version.json', { cache: 'no-store' }); const v = await r.json(); if (v.build && v.build !== __BUILD__ && !__BUILD__.startsWith('dev')) toast('✨ New version ready: reload the page!', 'info', 8000); } catch { /* offline */ }
}
setInterval(checkUpdate, 120000); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
