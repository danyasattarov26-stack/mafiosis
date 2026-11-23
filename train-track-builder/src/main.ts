/*
  Train Track Builder 3D: pick a region, snap track pieces together (turns, hills, loops, flips, spirals, boosters),
  then drive your train around it from behind or from the front.
*/
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { Track, PIECES, PALETTE, type PieceId, type Sample } from './track';
import { TrackMesh } from './trackMesh';
import { World, REGIONS, PROP_MODELS, loadModels, type Region } from './world';
import { Train, TRAINS, TRAIN_MODELS, type TrainType } from './train';
import { sound } from './audio';
import { findWayHome } from './autoroute';

declare const __BUILD__: string;

// ---------- renderer ----------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
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
scene.add(mesh.group, ghost.group, train.group);
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
let mode: Mode = 'menu';
let region: Region = REGIONS[0];
let trainType: TrainType = TRAINS[0];
let cam: 'chase' | 'front' = 'chase';
const save = {
  get: (k: string) => { try { return JSON.parse(localStorage.getItem('ttb-' + k) || 'null'); } catch { return null; } },
  set: (k: string, v: any) => { try { localStorage.setItem('ttb-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
trainType = TRAINS.find(t => t.id === save.get('train')) || TRAINS[0];

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

// menu
const menu = h('div', { class: 'menu' });
function renderMenu() {
  menu.innerHTML = '';
  const regions = h('div', { class: 'cards' });
  for (const r of REGIONS) {
    const saved = (save.get('track-' + r.id) || []) as PieceId[];
    regions.append(h('button', { class: 'card region-' + r.id, onclick: () => { sound.unlock(); sound.click(); startBuild(r); } },
      h('div', { class: 'emoji' }, r.emoji), h('b', {}, r.name), h('span', {}, r.blurb),
      h('em', {}, saved.length ? `${saved.length} pieces built` : 'New track'),
      r.gravity < 5 ? h('i', { class: 'tag' }, 'Low gravity!') : null));
  }
  const trains = h('div', { class: 'trains' });
  for (const t of TRAINS) trains.append(h('button', { class: 'pill' + (t.id === trainType.id ? ' on' : ''), onclick: () => { trainType = t; save.set('train', t.id); sound.unlock(); sound.click(); renderMenu(); } }, `${t.emoji} ${t.name}`));
  menu.append(h('div', { class: 'title' }, h('div', { class: 'logo' }, '🚂'), h('h1', {}, 'Train Track Builder 3D'), h('p', {}, 'Build crazy train tracks with loops, flips and spirals, then ride them!')),
    h('h2', {}, 'Pick your train'), trains, h('h2', {}, 'Pick a place to build'), regions);
}
ui.append(menu);

// build HUD
const palette = h('div', { class: 'palette' });
const buildTop = h('div', { class: 'topbar' });
const statsEl = h('span', { class: 'stats' });
buildTop.append(
  h('button', { class: 'btn ghost', onclick: () => goMenu() }, '🏠'),
  h('div', { class: 'where' }, statsEl),
  h('button', { class: 'btn', onclick: () => undo() }, '↩️ Undo'),
  h('button', { class: 'btn', title: 'Let the computer finish the track back to the station', onclick: () => finishLoop() }, '⭕ Finish loop'),
  h('button', { class: 'btn', onclick: () => clearTrack() }, '🗑️'),
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
const camBtn = h('button', { class: 'btn', onclick: () => toggleCam() }, '🎥 Front view');
const driveTop = h('div', { class: 'topbar' },
  h('button', { class: 'btn', onclick: () => startBuild(region) }, '🔧 Build'),
  h('button', { class: 'btn', onclick: () => restart() }, '⏮ Station'),
  camBtn,
  h('button', { class: 'btn', onclick: () => { sound.horn(trainType.id !== 'tram'); } }, trainType.id === 'tram' ? '🔔' : '📯'));
const goBtn = h('button', { class: 'pedal go' }, '▶', h('small', {}, 'GO'));
const brakeBtn = h('button', { class: 'pedal brake' }, '■', h('small', {}, 'BRAKE / BACK'));
const driveHud = h('div', { class: 'hud drive' }, driveTop, speedEl, h('div', { class: 'pedals' }, brakeBtn, goBtn),
  h('div', { class: 'help' }, isTouch ? 'Hold GO to speed up · hold BRAKE to stop or go backwards' : 'W / ↑ go · S / ↓ brake & reverse · C camera · Space horn · B build'));
ui.append(buildHud, driveHud);

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
  sound.unlock();
  if (mode === 'build') {
    const p = PALETTE.find(id => PIECES[id].key === e.key); if (p) addPiece(p);
    if (e.code === 'Backspace' || (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey))) undo();
    if (e.code === 'Enter') startDrive();
    if (e.code === 'KeyF') finishLoop();
  } else if (mode === 'drive') {
    if (e.code === 'KeyC') toggleCam();
    if (e.code === 'Space') { e.preventDefault(); sound.horn(trainType.id !== 'tram'); }
    if (e.code === 'KeyR') restart();
    if (e.code === 'KeyB' || e.code === 'Escape') startBuild(region);
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---------- modes ----------
function show(m: Mode) {
  mode = m;
  menu.hidden = m !== 'menu'; buildHud.hidden = m !== 'build'; driveHud.hidden = m !== 'drive';
  controls.enabled = m !== 'drive';
  arrow.visible = guide.visible = m === 'build';
  if (m !== 'drive') sound.stopDrive();
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
  if (focus) focusOn(e.p);
}
let focusTo: THREE.Vector3 | null = null;
function focusOn(p: THREE.Vector3) { focusTo = p.clone(); }

function startBuild(r: Region) {
  const fresh = mode === 'menu' || r.id !== region.id;
  if (mode === 'menu' || r.id !== region.id) loadRegion(r);
  train.setType(trainType); train.reset(track);
  show('build');
  if (fresh) { controls.target.copy(track.end.p); camera.position.copy(track.end.p).add(new THREE.Vector3(20, 22, 18)); }
  else { controls.target.copy(train.cars[0]?.o.position || track.end.p); camera.position.copy(controls.target).add(new THREE.Vector3(18, 18, 18)); }
  camera.up.set(0, 1, 0);
  if (!track.pieces.length) toast('Tap a piece to start building from the station!', 'info', 3500);
}
function goMenu() { renderMenu(); show('menu'); }

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
function clearTrack() {
  if (!track.pieces.length) return;
  if (!confirm('Clear the whole track in ' + region.name + '?')) return;
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

function startDrive() {
  sound.unlock();
  if (track.length < 20) { toast('Build some track first!', 'bad'); return; }
  train.setType(trainType); train.reset(track);
  show('drive'); preview(null);
  chase.init = false;
  toast(track.closed ? 'All aboard! Hold GO to start.' : 'All aboard! Watch out for the end of the line.', 'info', 2500);
}
function restart() { train.reset(track); chase.init = false; }
function toggleCam() { cam = cam === 'chase' ? 'front' : 'chase'; camBtn.textContent = cam === 'chase' ? '🎥 Front view' : '🎥 Behind view'; chase.init = false; sound.click(); }

// ---------- cameras ----------
const chase = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3(), init: false };
const Sample0 = function (this: any) { return { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), s: 0, boost: false }; } as any as { new (): Sample };
const S: Sample = { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), s: 0, boost: false };
function driveCamera(dt: number) {
  const back = train.v < -0.5 ? -1 : 1;
  if (cam === 'front') {
    track.at(train.s + 0.9, S);
    const want = S.p.clone().addScaledVector(S.u, 1.55);
    camera.position.copy(want);
    chase.up.lerp(S.u, 1 - Math.exp(-dt * 12)).normalize();
    camera.up.copy(chase.up);
    camera.lookAt(want.clone().addScaledVector(S.f, 10).addScaledVector(S.u, -0.4));
    camera.fov = 75;
  } else {
    // a virtual car riding the track behind the train: it follows loops and flips without cutting through them
    const trail = train.length + 7;
    track.at(back > 0 ? train.s - trail : train.s + 7, S);
    const want = S.p.clone().addScaledVector(S.u, 4.0);
    const front = track.at(train.s - (train.cars[0]?.len || 4) * 0.5, new Sample0());
    const look = front.p.clone().addScaledVector(front.u, 1.4);
    if (!chase.init) { chase.pos.copy(want); chase.look.copy(look); chase.up.copy(S.u); chase.init = true; }
    chase.pos.lerp(want, 1 - Math.exp(-dt * 10)); chase.look.lerp(look, 1 - Math.exp(-dt * 12)); chase.up.lerp(S.u.clone().add(front.u), 1 - Math.exp(-dt * 5)).normalize();
    if (chase.pos.y < 0.8) chase.pos.y = 0.8;
    camera.position.copy(chase.pos); camera.up.copy(chase.up); camera.lookAt(chase.look);
    camera.fov = 62 + Math.min(14, Math.abs(train.v) * 0.3);
  }
  if (train.bumped > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * train.bumped, (Math.random() - 0.5) * train.bumped, 0));
  camera.updateProjectionMatrix();
}

// ---------- loop ----------
let last = performance.now(), wasBoost = false, wasUpside = false, wasBump = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (mode === 'drive') {
    const go = goHeld || keys.has('KeyW') || keys.has('ArrowUp');
    const br = brakeHeld || keys.has('KeyS') || keys.has('ArrowDown');
    train.throttle = go ? 1 : 0;
    train.brake = false;
    if (br) { if (train.v > 0.4) train.brake = true; else train.throttle = -0.7; }
    // physics in small steps so loops stay smooth
    const steps = Math.ceil(dt / 0.01);
    for (let i = 0; i < steps; i++) train.update(dt / steps, track, region.gravity);
    driveCamera(dt);
    sound.drive(dt, train.v, train.throttle, trainType.id !== 'tram');
    (speedEl.firstChild as HTMLElement).textContent = String(train.kmh);
    speedEl.classList.toggle('fast', train.kmh > 100);
    if (train.onBoost && !wasBoost && Math.abs(train.v) > 0.5) { sound.boost(); toast('⚡ BOOST!', 'good', 900); }
    wasBoost = train.onBoost;
    track.at(train.s - 2, S);
    const upside = S.u.y < -0.5;
    if (upside && !wasUpside) toast(['🙃 Upside down!', '😱 Wheee!', '🤸 Flip!'][Math.floor(Math.random() * 3)], 'good', 1100);
    wasUpside = upside;
    if (train.bumped > 0.55 && wasBump <= 0.55) { sound.bump(); toast('💥 End of the line!', 'bad', 1500); }
    wasBump = train.bumped;
    world.update(dt, train.cars[0]?.o.position || S.p);
  } else {
    if (focusTo) { controls.target.lerp(focusTo, 1 - Math.exp(-dt * 4)); if (controls.target.distanceTo(focusTo) < 0.05) focusTo = null; }
    controls.update();
    if (mode === 'build') { arrow.position.y += Math.sin(now / 250) * 0.004; train.place(track); }
    world.update(dt, controls.target);
    if (mode === 'menu') { const a = now / 9000; camera.position.set(Math.cos(a) * 45, 26, Math.sin(a) * 45 - 10); camera.lookAt(0, 2, -10); }
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
const bootBar = document.getElementById('boot-bar') as HTMLElement;
(async () => {
  await loadModels([...TRAIN_MODELS, ...PROP_MODELS], k => { bootBar.style.width = Math.round(k * 100) + '%'; });
  world.setRegion(REGIONS[0]); loadRegion(REGIONS[0]);
  train.setType(trainType); train.reset(track);
  document.getElementById('boot')?.remove();
  renderMenu(); show('menu');
  requestAnimationFrame(frame);
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window as any, { __t: { track, train, world, startBuild, startDrive, addPiece, finishLoop, REGIONS, setCam: (c: any) => { cam = c; }, get mode() { return mode; }, controls, camera } });
})();

// a new version went live: offer a reload
async function checkUpdate() {
  try { const r = await fetch('/version.json', { cache: 'no-store' }); const v = await r.json(); if (v.build && v.build !== __BUILD__ && !__BUILD__.startsWith('dev')) toast('✨ New version ready: reload the page!', 'info', 8000); } catch { /* offline */ }
}
setInterval(checkUpdate, 120000); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
