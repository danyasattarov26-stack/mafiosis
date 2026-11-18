import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Time } from './time.js';
import { Player } from './player.js';
import { Enemies, makeEnemyTemplate, segCapsule } from './enemies.js';
import { Weapons, makeGunPrefab } from './weapons.js';
import { Level, LEVELS, PHRASES } from './levels.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { HUD, XRHud } from './hud.js';

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

// ---------- load the two models ----------
async function loadModel(url) {
  try {
    if (/\.fbx$/i.test(url)) return await new FBXLoader().loadAsync(url);
    const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
    const g = await l.loadAsync(url); return g.scene;
  } catch (e) { log(`could not load ${url}: ${e.message}`); return null; }
}
const [enemyModel, gunModel] = await Promise.all([loadModel('/models/enemy.glb'), loadModel('/models/pistol.glb')]);
if (!enemyModel) log('enemy model missing: using a capsule stand-in');
if (!gunModel) log('pistol model missing: using a box stand-in');
const gunPrefab = makeGunPrefab(gunModel, log);
const enemyTemplate = makeEnemyTemplate(enemyModel, gunPrefab, log);
const enemies = new Enemies(scene, enemyTemplate, 8);
const weapons = new Weapons(scene, camera, gunPrefab, fx);
document.getElementById('loading').hidden = true;

// ---------- game state ----------
let state = 'start', cur = 0, deaths = 0, playTime = 0, clearT = 0, xr = false;
const rec = { frames: [], events: [], lastG: -1, i: 0, e: 0, t: 0 };

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
  aimPoint() {
    const o = camera.getWorldPosition(V()), d = camera.getWorldDirection(V()), far = o.clone().addScaledVector(d, 100);
    let t = 1; const w = level.segHit(o, far); if (w) t = w.t;
    const h = enemies.hit(o, far, 0.3); if (h && h.t < t) t = h.t;
    return o.addScaledVector(d, 100 * t);
  },
  onKill(e) { rec.events.push({ g: Time.game, p: [e.pos.x, e.pos.z] }); },
};

function loadLevel(i) {
  cur = i; const L = LEVELS[i];
  level.build(L);
  const r = level.bounds; Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 80 }); sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(r * 0.35, 30, r * 0.25); sun.target.position.set(0, 0, 0);
  player.reset(L.start); weapons.reset(true); fx.clear(); enemies.start(L); Time.reset();
  rec.frames = []; rec.events = []; rec.lastG = -1;
  HUD.hideScreens(); HUD.banner('', false); HUD.show('replay', false); HUD.level(i, LEVELS.length); HUD.ammo(weapons.armed, weapons.ammo);
  weapons.vm.visible = !xr; state = 'play';
  if (xr) { player.rig.rotation.set(0, 0, 0); xrArm(); }
}

function die() {
  if (state !== 'play') return;
  state = 'dead'; deaths++;
  HUD.flash('rgba(232,38,43,.85)', 700); HUD.show('dead'); Audio.play('death');
}

function levelCleared() {
  state = 'clear'; clearT = 1.7; Audio.play('clear');
  HUD.banner(PHRASES[cur % PHRASES.length], true);
}

function startReplay() {
  if (!rec.frames.length) return nextLevel();
  state = 'replay'; rec.t = rec.frames[0].g; rec.i = 0; rec.e = 0;
  HUD.banner('', false); HUD.show('replay');
  weapons.reset(false); fx.clear(); weapons.vm.visible = false; document.body.classList.add('replaying');
}

function nextLevel() {
  HUD.show('replay', false); document.body.classList.remove('replaying');
  if (cur + 1 < LEVELS.length) loadLevel(cur + 1);
  else {
    state = 'end'; if (document.pointerLockElement) document.exitPointerLock();
    const m = Math.floor(playTime / 60), s = (playTime % 60).toFixed(1).padStart(4, '0');
    HUD.end(`All ${LEVELS.length} rooms cleared<br>Total time <b>${m}:${s}</b> · Deaths <b>${deaths}</b>`);
  }
}

function begin() {
  Audio.init(); deaths = 0; playTime = 0;
  if (!NOLOCK) player.lock();
  loadLevel(0);
}

player.onLock = (locked, failed) => {
  if (locked && state === 'paused') { HUD.show('pause', false); state = 'play'; }
  else if (!locked && state === 'play' && !xr && !player.touch && !NOLOCK) { state = 'paused'; HUD.show('pause'); }
  if (failed && state === 'play' && !NOLOCK && !player.touch) { state = 'paused'; HUD.show('pause'); }
};

document.getElementById('hud').addEventListener('pointerdown', e => {
  if (state === 'start' || state === 'end') begin();
  else if (state === 'paused') { if (player.touch || NOLOCK) { HUD.show('pause', false); state = 'play'; } else player.lock(); }
  else if (state === 'dead' && e.pointerType !== 'mouse') loadLevel(cur);
  else if (state === 'replay' && e.pointerType !== 'mouse') nextLevel();
});
renderer.domElement.addEventListener('pointerdown', e => { if (state === 'dead' && e.pointerType !== 'mouse') loadLevel(cur); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && !xr) { state = 'paused'; HUD.show('pause'); } });

function handleActions() {
  for (const a of player.actions.splice(0)) {
    if (a === 'restart' && (state === 'play' || state === 'dead')) { loadLevel(cur); continue; }
    if (a === 'skip' && state === 'replay') { nextLevel(); continue; }
    if (a === 'skip' && state === 'clear') { clearT = 0; continue; }
    if (state !== 'play') continue;
    if (a === 'fire') weapons.shoot(ctx);
    else if (a === 'throw') weapons.throwGun(ctx);
    else if (a === 'punch') weapons.punch(ctx);
  }
}

// ---------- WebXR (Quest): standing room-scale, plus thumbstick locomotion and snap turn ----------
// Left stick moves (it counts as moving, so it runs time), right stick snap-turns 30°.
// Trigger fires the gun in that hand; grip grabs a pistol near the hand, releasing it with a swing throws it,
// releasing it gently drops it; a fast swing into an enemy is a punch. A / X or the trigger restarts and skips.
const AMMO_PIP = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
const hands = [0, 1].map(i => {
  const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
  player.rig.add(ray, grip);
  const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.042, 0), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, flatShading: true, roughness: 0.6 })); fist.scale.set(1, 0.85, 1.25); grip.add(fist);
  // the gun rides the aim ray, so the barrel points exactly where the controller points
  const gun = gunPrefab.clone(); gun.visible = false; gun.position.set(0, -0.045, 0.07); ray.add(gun);
  const pips = []; for (let k = 0; k < 6; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.012), AMMO_PIP); p.position.set(0, 0.062, 0.06 - k * 0.016); gun.add(p); pips.push(p); }
  const h = { ray, grip, gun, pips, fist, armed: false, ammo: 0, last: V(), speed: 0, vel: V(), src: null, btn: false };
  h.setGun = (armed, ammo = 0) => { h.armed = armed; h.ammo = ammo; gun.visible = armed; fist.visible = !armed; h.pips.forEach((p, k) => { p.visible = k < ammo; }); };
  ray.addEventListener('connected', e => { h.src = e.data; });
  ray.addEventListener('disconnected', () => { h.src = null; });
  ray.addEventListener('selectstart', () => {
    if (state !== 'play') return xrButton();
    if (!h.armed) return;
    Time.kick(0.15);
    if (h.ammo <= 0) { Audio.play('dry'); return; }
    h.setGun(true, h.ammo - 1);
    const m = gun.getObjectByName('muzzle').getWorldPosition(V()), d = new THREE.Vector3(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion()));
    weapons.fire('player', m, d, 40); Audio.play('shot');
    const gp = h.src && h.src.gamepad; if (gp && gp.hapticActuators && gp.hapticActuators[0]) gp.hapticActuators[0].pulse(0.6, 60);
  });
  grip.addEventListener('squeezestart', () => {
    if (state !== 'play' || h.armed) return;
    const p = grip.getWorldPosition(V());
    const k = weapons.pick.find(k => k.on && k.o.position.distanceTo(p) < 0.55);
    if (k) { k.on = false; k.o.visible = false; h.setGun(true, k.ammo); Audio.play('pickup'); }
  });
  grip.addEventListener('squeezeend', () => {
    if (state !== 'play' || !h.armed) return;
    const p = gun.getWorldPosition(V());
    if (h.vel.length() < 1.2) { weapons.dropPickup(p, h.ammo); h.setGun(false); return; } // gentle release: drop it
    const t = weapons.thrown.find(x => !x.on); if (!t) return;
    t.o.position.copy(p); t.o.quaternion.copy(ray.getWorldQuaternion(new THREE.Quaternion()));
    t.v.copy(h.vel).multiplyScalar(1.4); t.w.set(8, 1, 0); t.on = true; t.o.visible = true; t.ammo = h.ammo;
    h.setGun(false); Time.kick(0.15); Audio.play('whoosh');
  });
  return h;
});
const xrHead = { last: V(), speed: 0, turnReady: true };
XRHud.init(camera);

function xrButton() { // trigger or A / X outside of play: restart, skip, play again
  if (state === 'dead') loadLevel(cur);
  else if (state === 'replay') nextLevel();
  else if (state === 'clear') clearT = 0;
  else if (state === 'end' || state === 'start') begin();
  else if (state === 'paused') { state = 'play'; HUD.show('pause', false); }
}

function xrArm() { hands[0].setGun(false); hands[1].setGun(true, 6); } // every room starts with a pistol in the right hand

renderer.xr.setFoveation(1);
renderer.xr.addEventListener('sessionstart', () => {
  xr = true; Audio.init(); weapons.vm.visible = false; HUD.hideScreens();
  const s = renderer.xr.getSession();
  s.addEventListener('visibilitychange', () => { // the Quest menu or a guardian break hides the session
    if (s.visibilityState !== 'visible' && state === 'play') state = 'paused';
    else if (s.visibilityState === 'visible' && state === 'paused') state = 'play';
  });
  if (state !== 'play') loadLevel(state === 'end' || state === 'start' ? 0 : cur);
  if (state === 'start') { deaths = 0; playTime = 0; }
  xrArm();
});
renderer.xr.addEventListener('sessionend', () => {
  xr = false; weapons.vm.visible = true; XRHud.hide(); player.rig.rotation.set(0, 0, 0); player.apply();
  if (state === 'play') { state = 'paused'; HUD.show('pause'); }
});
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (ok) document.body.appendChild(VRButton.createButton(renderer)); }).catch(() => {});
}

const _hp = V(), _fw = V();
function xrLocomotion(realDt) {
  for (const h of hands) {
    const gp = h.src && h.src.gamepad; if (!gp) continue;
    const ax = gp.axes, x = ax.length > 2 ? ax[2] : ax[0] || 0, y = ax.length > 3 ? ax[3] : ax[1] || 0;
    const a = gp.buttons[4] && gp.buttons[4].pressed; // A on the right controller, X on the left
    if (a && !h.btn) xrButton(); h.btn = !!a;
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
    if (state === 'play' && h.speed > 2.5 && ctx.punch(0.45, p, h.vel.clone().setY(0).normalize())) Audio.play('punch');
  }
  return { xr: true, headSpeed: xrHead.speed, handSpeed: handMax };
}

function xrPanel() { // what the floating panel says for each state
  if (state === 'dead') XRHud.show('YOU DIED', 'Trigger or A to restart', true);
  else if (state === 'clear') XRHud.show(PHRASES[cur % PHRASES.length], '', true);
  else if (state === 'replay') XRHud.show('REPLAY · A to skip', '', true, true);
  else if (state === 'end') XRHud.show(TITLE, `All ${LEVELS.length} rooms · deaths ${deaths}\nTrigger to play again`);
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
    if (!xr && weapons.tryPickup(player.pos)) HUD.ammo(weapons.armed, weapons.ammo);
    fx.update(dt);
    if (state === 'play') record();
    HUD.ammo(weapons.armed, weapons.ammo);
    if (state === 'play' && enemies.done && enemies.aliveCount === 0) levelCleared();
  } else if (state === 'dead') {
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
    HUD.debug(`fps ${fps.toFixed(0)} · timeScale ${Time.scale.toFixed(3)} · draw calls ${i.calls} · tris ${(i.triangles / 1000).toFixed(0)}k · ${state}`);
  }
});

if (DEBUG) window.__game = { Time, weapons, enemies, player, ctx, camera, renderer, hands, get state() { return state; }, begin, loadLevel, V,
  fireTest() { const p = V().set(player.pos.x, 1.5, player.pos.z - 1); weapons.fire('test', p, V().set(0, 0, -1), 18); return weapons.n - 1; } };
