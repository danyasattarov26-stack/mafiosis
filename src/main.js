import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Time } from './time.js';
import { Player } from './player.js';
import { Enemies, makeEnemyTemplate, segCapsule } from './enemies.js';
import { Weapons, makePrefab, KINDS } from './weapons.js';
import { Level, LEVELS, GAUNTLET, PHRASES } from './levels.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { HUD, XRHud } from './hud.js';
import { Scores } from './scores.js';

const TITLE = 'STANDSTILL';
const Q = new URLSearchParams(location.search), DEBUG = Q.has('debug'), NOLOCK = DEBUG && Q.has('nolock');
const log = m => console.info('[standstill] ' + m);
const V = () => new THREE.Vector3();

HUD.init(TITLE);

// ---------- renderer (or a plain message without WebGL) ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no context');
} catch (e) {
  document.getElementById('nowebgl').hidden = false; document.getElementById('hud').hidden = true;
  throw new Error('WebGL is not available: ' + e.message);
}
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.xr.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f2f2f2');
scene.fog = new THREE.Fog('#f2f2f2', 22, 75);
scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d6d6, 2.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.03, 140);
const replayCam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.03, 140);
const player = new Player(camera, renderer.domElement);
scene.add(player.rig);
const level = new Level(scene);
const fx = new FX(scene);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); for (const c of [camera, replayCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); } });

// ---------- load the models ----------
async function loadModel(url) {
  try {
    if (/\.fbx$/i.test(url)) return await new FBXLoader().loadAsync(url);
    const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
    const g = await l.loadAsync(url); return g.scene;
  } catch (e) { log(`could not load ${url}: ${e.message}`); return null; }
}
const ITEMS = Object.keys(KINDS);
const loaded = await Promise.all(['enemy', ...ITEMS].map(n => loadModel(`/models/${n}.glb`)));
const enemyModel = loaded[0];
if (!enemyModel) log('enemy model missing: using a capsule stand-in');
const prefabs = Object.fromEntries(ITEMS.map((k, i) => [k, makePrefab(k, loaded[i + 1], log)]));
const enemyTemplate = makeEnemyTemplate(enemyModel, prefabs, log);
const enemies = new Enemies(scene, enemyTemplate, 8);
const weapons = new Weapons(scene, camera, prefabs, fx);
document.getElementById('loading').hidden = true;

// ---------- game state ----------
// states: start, play, paused, dead, clear, replay, end (rooms finished), over (gauntlet death)
let state = 'start', mode = 'story', cur = 0, deaths = 0, playTime = 0, clearT = 0, xr = false;
let roomKills = 0, gKills = 0, gWave = 0;
const ranks = [];
const rec = { frames: [], events: [], lastG: -1, i: 0, e: 0, t: 0 };
const fmtTime = v => v.toFixed(2) + ' s', fmtKills = v => `${v} kill${v === 1 ? '' : 's'}`;

const ctx = {
  level, fx, weapons, enemies, player,
  hitPlayer(a, b, maxT) {
    if (state !== 'play') return false;
    const t = segCapsule(a, b, player.pos.x, 0.1, player.pos.z, player.eyeY + 0.1, player.radius);
    if (t >= 0 && t <= maxT) { die(); return true; }
    return false;
  },
  punchPlayer() { if (state === 'play') die(); },
  punch(range, from = null, dirIn = null) {
    const p = from || V().set(player.pos.x, 1.3, player.pos.z), dir = dirIn || player.forward(V()).setY(0).normalize();
    let best = null, bd = range;
    for (const e of enemies.list) {
      if (!e.alive) continue;
      const to = V().set(e.pos.x - p.x, 0, e.pos.z - p.z), d = to.length();
      if (d < bd && (from || to.normalize().dot(dir) > 0.45)) { best = e; bd = d; }
    }
    if (best) best.kill(ctx, dir);
    return !!best;
  },
  /** Katana swing in first person: everyone in front within reach. */
  slash(reach) {
    const dir = player.forward(V()).setY(0).normalize();
    for (const e of enemies.list) {
      if (!e.alive) continue;
      const to = V().set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z), d = to.length();
      if (d < reach && to.normalize().dot(dir) > 0.3) e.kill(ctx, dir);
    }
  },
  aimPoint() {
    const o = camera.getWorldPosition(V()), d = camera.getWorldDirection(V()), far = o.clone().addScaledVector(d, 100);
    let t = 1; const w = level.segHit(o, far); if (w) t = w.t;
    const h = enemies.hit(o, far, 0.3); if (h && h.t < t) t = h.t;
    return o.addScaledVector(d, 100 * t);
  },
  onKill(e) { rec.events.push({ g: Time.game, p: [e.pos.x, e.pos.z] }); roomKills++; if (mode === 'gauntlet') { gKills++; gauntletLabel(); } },
};

function setupRoom(L) {
  level.build(L);
  const r = level.bounds; Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 80 }); sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(r * 0.35, 30, r * 0.25); sun.target.position.set(0, 0, 0);
  player.reset(L.start); weapons.reset('pistol'); weapons.placeProps(L.props); fx.clear(); Time.reset();
  roomKills = 0; rec.frames = []; rec.events = []; rec.lastG = -1;
  HUD.hideScreens(); HUD.banner('', false); HUD.results(''); HUD.show('replay', false); document.body.classList.remove('replaying');
  weapons.vm.visible = !xr; state = 'play';
  if (xr) { player.rig.rotation.set(0, 0, 0); xrArm(); }
}

function loadLevel(i) {
  mode = 'story'; cur = i;
  setupRoom(LEVELS[i]); enemies.onWave = null; enemies.start(LEVELS[i]);
  HUD.level(i, LEVELS.length);
}

function loadGauntlet() {
  mode = 'gauntlet'; gKills = 0; gWave = 0;
  enemies.onWave = n => { // every wave refills the arena a little
    gWave = n; gauntletLabel();
    if (n === 0) return;
    const spots = GAUNTLET.propSpots.slice().sort(() => Math.random() - 0.5), pool = ['bottle', 'glass', 'extinguisher', 'pistol'];
    const add = (k, s) => weapons.dropPickup(k, V().set(s[0], s[1] + 1, s[2]), KINDS[k].gun ? KINDS[k].ammo : 0, s[1] + 0.03);
    add(pool[Math.floor(Math.random() * pool.length)], spots[0]); add(pool[Math.floor(Math.random() * pool.length)], spots[1]);
    if (n % 3 === 0) add('katana', spots[2]);
    if (n % 4 === 0) add('rifle', spots[3]);
  };
  setupRoom(GAUNTLET); enemies.start(GAUNTLET);
  gauntletLabel();
}

function gauntletLabel() { HUD.label(`WAVE ${gWave + 1} · ${fmtKills(gKills)}`); }

function restart() { if (mode === 'gauntlet') loadGauntlet(); else loadLevel(cur); }

function die() {
  if (state !== 'play') return;
  HUD.flash('rgba(232,38,43,.85)', 700); Audio.play('death');
  if (mode === 'gauntlet') return gauntletOver();
  state = 'dead'; deaths++; HUD.show('dead');
}

function rankFor(L, gt, shots, kills) {
  const r = (gt + Math.max(0, shots - kills) * 0.75) / L.par; // misses cost time
  return r <= 0.7 ? 'S' : r <= 1 ? 'A' : r <= 1.5 ? 'B' : 'C';
}

function levelCleared() {
  const L = LEVELS[cur], gt = Time.game, shots = weapons.shots, rank = rankFor(L, gt, shots, roomKills);
  ranks[cur] = rank;
  state = 'clear'; clearT = 3.4; Audio.play('clear');
  HUD.banner(PHRASES[cur % PHRASES.length], true);
  const line = `<span class="rank">RANK ${rank}</span>${fmtTime(gt)} · ${shots} shot${shots === 1 ? '' : 's'} · ${roomKills} down`;
  HUD.results(line + '<p class="small">…</p>');
  lastResult = { title: PHRASES[cur % PHRASES.length], line: `RANK ${rank} · ${fmtTime(gt)}`, board: '' };
  const board = 'room' + (cur + 1), at = cur;
  Scores.submit(board, gt).then(res => {
    if (state !== 'clear' || cur !== at) return;
    if (!res) { const l = Scores.local(board, gt, true); HUD.results(line + `<p class="small">Your best here: ${fmtTime(l.best)}${l.isNew ? ' (new)' : ''} · leaderboard offline</p>`); return; }
    HUD.results(line + `<p class="small">#${res.rank} of ${res.count} · your best ${fmtTime(res.best)}</p>` + HUD.board(res, Scores.name, fmtTime));
    lastResult.board = `#${res.rank} of ${res.count}`;
  });
}
let lastResult = null;

function gauntletOver() {
  state = 'over'; if (document.pointerLockElement) document.exitPointerLock();
  const stats = `${fmtKills(gKills)} · reached wave <b>${gWave + 1}</b>`;
  HUD.over(stats, '<p class="small">…</p>');
  lastResult = { title: 'GAUNTLET OVER', line: `${fmtKills(gKills)} · wave ${gWave + 1}`, board: '' };
  Scores.submit('gauntlet', gKills).then(res => {
    if (state !== 'over') return;
    if (!res) { const l = Scores.local('gauntlet', gKills, false); HUD.overBoard(`<p class="small">Your best: ${fmtKills(l.best)}${l.isNew ? ' (new)' : ''} · leaderboard offline</p>`); return; }
    HUD.overBoard(`<p class="small">#${res.rank} of ${res.count} · your best ${fmtKills(res.best)}</p>` + HUD.board(res, Scores.name, fmtKills));
    lastResult.board = `#${res.rank} of ${res.count}`;
  });
}

function startReplay() {
  if (!rec.frames.length) return nextLevel();
  state = 'replay'; rec.t = rec.frames[0].g; rec.i = 0; rec.e = 0;
  HUD.banner('', false); HUD.show('replay');
  weapons.reset(null); fx.clear(); weapons.vm.visible = false; document.body.classList.add('replaying');
}

function nextLevel() {
  HUD.show('replay', false); document.body.classList.remove('replaying');
  if (cur + 1 < LEVELS.length) loadLevel(cur + 1);
  else {
    state = 'end'; if (document.pointerLockElement) document.exitPointerLock();
    const m = Math.floor(playTime / 60), s = (playTime % 60).toFixed(1).padStart(4, '0');
    const list = LEVELS.map((L, i) => `${L.name} <b>${ranks[i] || '-'}</b>`).join(' · ');
    HUD.end(`All ${LEVELS.length} rooms cleared<br>${list}<br>Total time <b>${m}:${s}</b> · Deaths <b>${deaths}</b>`);
  }
}

function begin(m = 'story') {
  Audio.init();
  if (!NOLOCK) player.lock();
  if (m === 'gauntlet') loadGauntlet();
  else { deaths = 0; playTime = 0; ranks.length = 0; loadLevel(0); }
}

function toMenu() { state = 'start'; HUD.hideScreens(); HUD.show('start'); refreshStartTop(); }

function refreshStartTop() {
  Scores.top('gauntlet').then(r => { if (r && r.top.length) HUD.startTop(`Gauntlet record: ${r.top[0].name} · ${fmtKills(r.top[0].value)}`); });
}

// name for the leaderboards
const nameInput = document.getElementById('pname');
nameInput.value = Scores.name === 'ANON' ? '' : Scores.name;
nameInput.addEventListener('input', () => { const c = Scores.setName(nameInput.value); if (c !== nameInput.value) nameInput.value = c; });
nameInput.addEventListener('keydown', e => e.stopPropagation()); // typing a name must not move the player
refreshStartTop();

player.onLock = (locked, failed) => {
  if (locked && state === 'paused') { HUD.show('pause', false); state = 'play'; }
  else if (!locked && state === 'play' && !xr && !player.touch && !NOLOCK) { state = 'paused'; HUD.show('pause'); }
  if (failed && state === 'play' && !NOLOCK && !player.touch) { state = 'paused'; HUD.show('pause'); }
};

document.getElementById('hud').addEventListener('pointerdown', e => {
  if (e.target.closest('input, label, a')) return;
  const btn = e.target.closest('[data-mode]');
  if (btn) { e.preventDefault(); if (btn.dataset.mode === 'menu') toMenu(); else begin(btn.dataset.mode); return; }
  if (state === 'start') begin('story');
  else if (state === 'paused') { if (player.touch || NOLOCK) { HUD.show('pause', false); state = 'play'; } else player.lock(); }
  else if (state === 'dead' && e.pointerType !== 'mouse') loadLevel(cur);
  else if (state === 'replay' && e.pointerType !== 'mouse') nextLevel();
  else if (state === 'clear') clearT = 0;
});
renderer.domElement.addEventListener('pointerdown', e => { if (state === 'dead' && e.pointerType !== 'mouse') loadLevel(cur); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && !xr) { state = 'paused'; HUD.show('pause'); } });

function handleActions() {
  for (const a of player.actions.splice(0)) {
    if (a === 'restart' && (state === 'play' || state === 'dead' || state === 'over')) { if (state === 'over') begin('gauntlet'); else restart(); continue; }
    if (a === 'skip' && state === 'replay') { nextLevel(); continue; }
    if (a === 'skip' && state === 'clear') { clearT = 0; continue; }
    if (state !== 'play') continue;
    if (a === 'fire') weapons.primary(ctx);
    else if (a === 'throw') weapons.throwHeld();
    else if (a === 'punch') weapons.punch(ctx);
  }
}

// ---------- WebXR (Quest): standing room-scale, plus thumbstick locomotion and snap turn ----------
// Left stick moves (it counts as moving, so it runs time), right stick snap-turns 30°.
// Trigger fires the gun in that hand; grip near an item takes it; let go with a swing to throw, gently to drop.
// A katana in hand cuts any bullet it touches and any enemy it is swung through; a fast empty fist is a punch.
// Outside of play: trigger or A / X restarts, skips, plays the rooms; B / Y plays the gauntlet.
const AMMO_PIP = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
const HOLD = { pistol: [0, -0.045, 0.07], rifle: [0, -0.05, 0.12], katana: [0, -0.02, 0.04], bottle: [0, -0.03, 0.02], glass: [0, -0.02, 0.02], extinguisher: [0, -0.12, 0.05] };
const hands = [0, 1].map(i => {
  const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
  player.rig.add(ray, grip);
  const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.042, 0), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, flatShading: true, roughness: 0.6 })); fist.scale.set(1, 0.85, 1.25); grip.add(fist);
  const h = { ray, grip, fist, kind: null, ammo: 0, items: {}, pips: {}, last: V(), speed: 0, vel: V(), src: null, btn: false, btn2: false, tipLast: V(), hasTip: false };
  // items ride the aim ray, so a barrel or blade points exactly where the controller points
  h.item = k => {
    if (!h.items[k]) {
      const o = prefabs[k].clone(); o.position.set(...HOLD[k]); o.visible = false; ray.add(o); h.items[k] = o;
      if (KINDS[k].gun) { h.pips[k] = Array.from({ length: KINDS[k].ammo }, (_, n) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.012), AMMO_PIP); p.position.set(0, k === 'rifle' ? 0.05 : 0.062, (k === 'rifle' ? 0.02 : 0.06) - n * 0.016); o.add(p); return p; }); }
    }
    return h.items[k];
  };
  h.setItem = (kind, ammo = 0) => {
    h.kind = kind; h.ammo = ammo; fist.visible = !kind; h.hasTip = false;
    for (const k in h.items) h.items[k].visible = false;
    if (kind) { h.item(kind).visible = true; if (h.pips[kind]) h.pips[kind].forEach((p, n) => { p.visible = n < ammo; }); }
  };
  ray.addEventListener('connected', e => { h.src = e.data; });
  ray.addEventListener('disconnected', () => { h.src = null; });
  ray.addEventListener('selectstart', () => {
    if (state !== 'play') return xrButton();
    const K = h.kind && KINDS[h.kind]; if (!K || !K.gun) return;
    Time.kick(0.15);
    if (h.ammo <= 0) { Audio.play('dry'); return; }
    h.setItem(h.kind, h.ammo - 1); weapons.shots++;
    const o = h.item(h.kind), m = o.getObjectByName('muzzle').getWorldPosition(V()), d = new THREE.Vector3(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion()));
    weapons.fire('player', m, d, K.speed, !!K.pierce); Audio.play(h.kind === 'rifle' ? 'rifle' : 'shot');
    const gp = h.src && h.src.gamepad; if (gp && gp.hapticActuators && gp.hapticActuators[0]) gp.hapticActuators[0].pulse(h.kind === 'rifle' ? 1 : 0.6, h.kind === 'rifle' ? 120 : 60);
  });
  grip.addEventListener('squeezestart', () => {
    if (state !== 'play' || h.kind) return;
    const k = weapons.grab(grip.getWorldPosition(V()), 0.55);
    if (k) h.setItem(k.kind, k.ammo);
  });
  grip.addEventListener('squeezeend', () => {
    if (state !== 'play' || !h.kind) return;
    const o = h.item(h.kind), p = o.getWorldPosition(V());
    if (h.vel.length() < 1.2) weapons.dropPickup(h.kind, p, h.ammo); // gentle release: drop it
    else { weapons.throwItem(h.kind, h.ammo, p, ray.getWorldQuaternion(new THREE.Quaternion()), h.vel.clone().multiplyScalar(1.4)); Time.kick(0.15); }
    h.setItem(null);
  });
  return h;
});
const xrHead = { last: V(), speed: 0, turnReady: true };
XRHud.init(camera);

function xrButton(alt = false) { // outside of play: restart, skip, play again; alt (B / Y) picks the gauntlet
  if (alt && (state === 'end' || state === 'start' || state === 'over' || state === 'paused')) return begin('gauntlet');
  if (state === 'dead') loadLevel(cur);
  else if (state === 'over') begin('gauntlet');
  else if (state === 'replay') nextLevel();
  else if (state === 'clear') clearT = 0;
  else if (state === 'end' || state === 'start') begin('story');
  else if (state === 'paused') { state = 'play'; HUD.show('pause', false); }
}

function xrArm() { hands[0].setItem(null); hands[1].setItem('pistol', KINDS.pistol.ammo); } // every room starts with a pistol in the right hand

renderer.xr.setFoveation(1);
renderer.xr.addEventListener('sessionstart', () => {
  xr = true; Audio.init(); weapons.vm.visible = false; HUD.hideScreens();
  const s = renderer.xr.getSession();
  s.addEventListener('visibilitychange', () => { // the Quest menu or a guardian break hides the session
    if (s.visibilityState !== 'visible' && state === 'play') state = 'paused';
    else if (s.visibilityState === 'visible' && state === 'paused') state = 'play';
  });
  if (state === 'start' || state === 'end') begin('story');
  else if (state === 'over') begin('gauntlet');
  else if (state !== 'play') restart();
  xrArm();
});
renderer.xr.addEventListener('sessionend', () => {
  xr = false; weapons.vm.visible = true; XRHud.hide(); player.rig.rotation.set(0, 0, 0); player.apply();
  if (state === 'play') { state = 'paused'; HUD.show('pause'); }
});
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (ok) document.body.appendChild(VRButton.createButton(renderer)); }).catch(() => {});
}

const _hp = V(), _fw = V(), _g = V(), _t = V();
function xrLocomotion(realDt) {
  for (const h of hands) {
    const gp = h.src && h.src.gamepad; if (!gp) continue;
    const ax = gp.axes, x = ax.length > 2 ? ax[2] : ax[0] || 0, y = ax.length > 3 ? ax[3] : ax[1] || 0;
    const a = gp.buttons[4] && gp.buttons[4].pressed, b = gp.buttons[5] && gp.buttons[5].pressed; // A / X and B / Y
    if (a && !h.btn) xrButton(); h.btn = !!a;
    if (b && !h.btn2 && state !== 'play') xrButton(true); h.btn2 = !!b;
    if (state !== 'play') continue;
    if (h.src.handedness === 'left' && Math.hypot(x, y) > 0.15) {
      camera.getWorldDirection(_fw).setY(0).normalize();
      const rx = -_fw.z, rz = _fw.x, sp = 2.6 * realDt;
      const head = camera.getWorldPosition(_hp), before = head.clone();
      head.x += (_fw.x * -y + rx * x) * sp; head.z += (_fw.z * -y + rz * x) * sp;
      level.collideCircle(head, player.radius);
      player.rig.position.x += head.x - before.x; player.rig.position.z += head.z - before.z;
    }
    if (h.src.handedness === 'right') {
      if (Math.abs(x) > 0.7 && xrHead.turnReady) {
        const ang = x > 0 ? -Math.PI / 6 : Math.PI / 6, head = camera.getWorldPosition(_hp);
        const off = player.rig.position.clone().sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        player.rig.position.copy(head).add(off); player.rig.rotation.y += ang; xrHead.turnReady = false;
      } else if (Math.abs(x) < 0.3) xrHead.turnReady = true;
    }
  }
}

function updateXR(realDt) {
  xrLocomotion(realDt);
  const head = camera.getWorldPosition(V());
  xrHead.speed = realDt > 0 ? Math.min(20, head.distanceTo(xrHead.last) / realDt) : 0; xrHead.last.copy(head);
  player.pos.set(head.x, 0, head.z); player.eyeY = head.y;
  let handMax = 0;
  for (const h of hands) {
    const p = h.grip.getWorldPosition(V());
    h.vel.copy(p).sub(h.last).divideScalar(Math.max(1e-4, realDt)); h.last.copy(p); h.speed = Math.min(30, h.vel.length());
    handMax = Math.max(handMax, h.speed);
    if (state !== 'play') continue;
    if (h.kind === 'katana') { // the blade cuts bullets it touches, and enemies when swung through them
      const o = h.item('katana'); o.updateWorldMatrix(true, true);
      o.getObjectByName('guard').getWorldPosition(_g); o.getObjectByName('tip').getWorldPosition(_t);
      weapons.sliceSegment(_g, _t, 0.07);
      const tipSpeed = h.hasTip ? _t.distanceTo(h.tipLast) / Math.max(1e-4, realDt) : 0;
      if (tipSpeed > 1.5) {
        const dir = _t.clone().sub(h.tipLast).setY(0).normalize();
        for (const e of enemies.list) if (e.hitTest(_g, _t, 0.3) >= 0 || e.hitTest(h.tipLast, _t, 0.3) >= 0) { e.kill(ctx, dir); Audio.play('swish'); }
      }
      h.tipLast.copy(_t); h.hasTip = true;
    } else if (h.speed > 2.5 && ctx.punch(0.45, p, h.vel.clone().setY(0).normalize())) Audio.play('punch');
  }
  return { xr: true, headSpeed: xrHead.speed, handSpeed: handMax };
}

function xrPanel() { // what the floating panel says for each state
  if (state === 'dead') XRHud.show('YOU DIED', 'Trigger or A to restart', true);
  else if (state === 'clear') XRHud.show(lastResult ? lastResult.title : PHRASES[cur % PHRASES.length], lastResult ? `${lastResult.line}${lastResult.board ? '\n' + lastResult.board : ''}` : '', true);
  else if (state === 'replay') XRHud.show('REPLAY · A to skip', '', true, true);
  else if (state === 'end') XRHud.show(TITLE, `All ${LEVELS.length} rooms · deaths ${deaths}\nTrigger: rooms · B: gauntlet`);
  else if (state === 'over') XRHud.show('GAUNTLET OVER', `${lastResult ? lastResult.line : ''}${lastResult && lastResult.board ? ' · ' + lastResult.board : ''}\nTrigger: again · A: again`, true);
  else if (state === 'paused') XRHud.show('PAUSED', 'Trigger to resume');
  else XRHud.hide();
}

// ---------- replay ----------
function record() {
  if (Time.game - rec.lastG < 1 / 60 || rec.frames.length > 30000) return;
  rec.lastG = Time.game;
  const p = camera.getWorldPosition(V()), q = camera.getWorldQuaternion(new THREE.Quaternion());
  rec.frames.push({ g: Time.game, c: [p.x, p.y, p.z, q.x, q.y, q.z, q.w], e: enemies.snapshot(), b: weapons.snapshot() });
}

function playReplay(realDt) {
  rec.t += realDt; // 1x game time: slow moments go by at their true speed
  const F = rec.frames;
  while (rec.i < F.length - 1 && F[rec.i + 1].g <= rec.t) rec.i++;
  const f = F[rec.i];
  replayCam.position.set(f.c[0], f.c[1], f.c[2]); replayCam.quaternion.set(f.c[3], f.c[4], f.c[5], f.c[6]);
  enemies.restore(f.e); weapons.restore(f.b);
  while (rec.e < rec.events.length && rec.events[rec.e].g <= rec.t) {
    const ev = rec.events[rec.e++];
    fx.burst(V().set(ev.p[0], 0, ev.p[1]), { count: 40, color: 0xe8262b, speed: [2, 6], size: [0.05, 0.15], height: [0.15, 1.75], radius: 0.25, life: 3 });
    Audio.play('shatter');
  }
  fx.update(realDt);
  if (rec.t > F[F.length - 1].g + 1) nextLevel();
}

// ---------- loop ----------
let last = performance.now(), fpsN = 0, fpsT = 0, fps = 0;
renderer.setAnimationLoop(now => {
  now = now || performance.now();
  const realDt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; // never jump forward after a stall
  handleActions();
  let cam = camera;
  if (state === 'play') {
    playTime += realDt;
    let m;
    if (xr) m = updateXR(realDt);
    else { player.update(realDt, level); m = { moveSpeed: player.moveSpeed, angSpeed: player.angSpeed }; }
    const dt = Time.update(realDt, m);
    enemies.update(dt, ctx);
    weapons.update(dt, realDt, ctx);
    if (!xr) weapons.tryPickup(player.pos);
    fx.update(dt);
    if (state === 'play') record();
    HUD.ammo(weapons.held, weapons.ammo, weapons.kind);
    if (state === 'play' && enemies.done && enemies.aliveCount === 0) levelCleared();
  } else if (state === 'dead' || state === 'over') {
    const dt = realDt * 0.05; fx.update(dt); weapons.update(dt, realDt, ctx);
  } else if (state === 'clear') {
    clearT -= realDt; fx.update(realDt * 0.2);
    if (clearT <= 0) startReplay();
  } else if (state === 'replay') { playReplay(realDt); if (!xr) cam = replayCam; } // in VR the replay plays around you
  if (xr) xrPanel();
  Audio.setRate(state === 'play' ? Time.scale : state === 'replay' ? 1 : 0.3);
  renderer.render(scene, cam);
  if (DEBUG) {
    fpsN++; fpsT += realDt; if (fpsT >= 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
    const i = renderer.info.render;
    HUD.debug(`fps ${fps.toFixed(0)} · timeScale ${Time.scale.toFixed(3)} · draw calls ${i.calls} · tris ${(i.triangles / 1000).toFixed(0)}k · ${state} · ${mode}`);
  }
});

if (DEBUG) window.__game = { Time, weapons, enemies, player, ctx, camera, renderer, hands, prefabs, get state() { return state; }, get mode() { return mode; }, begin, loadLevel, loadGauntlet, V,
  fireTest() { const p = V().set(player.pos.x, 1.5, player.pos.z - 1); weapons.fire('test', p, V().set(0, 0, -1), 18); return weapons.n - 1; } };
