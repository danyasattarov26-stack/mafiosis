/*
  One running world: the voxel terrain, you, the animals, other players in co-op, day and night, weather,
  everything you can do with your hands (chop, mine, build, eat, drink, hunt), dying and being reborn,
  and saving. The page's UI reads its state; co-op reads and writes through a few hooks.
*/
import * as THREE from 'three';
import { World } from '../world/world';
import { CS, SEA } from '../world/gen';
import { mulberry32 } from '../world/noise';
import { Player, EYE } from './player';
import { Input } from './input';
import { Inventory, type Stack } from './inventory';
import { Animals, loadModel, type Beast, type PetSave } from './animals';
import { Projectiles } from './projectiles';
import { Boats, type Boat, type BoatSave } from './boats';
import { MOD_BLOCKS, runHooks, modIds } from '../mods/mods';
import { newQuest, progress, nearestVault, STARSTONES, type QuestData } from './quest';
import { SKY_ALTAR, SKY_TOP, SKY_BELLS, type Dim } from '../world/gen';
import { BUILDERS, rotate } from '../world/structures';
import { newChest, newFurnace, posKey, tickFurnace, contents, type Container } from './containers';
import { BLOCKS, B } from '../shared/blocks';
import { ITEM } from '../shared/items';
import { BIOMES } from '../shared/biomes';
import { settings } from './settings';
import { sound } from '../audio/audio';
import { t, nm } from '../i18n/i18n';
import { itemIcon, type Atlas } from '../render/textures';
import { lootFor } from '../world/loot';
import { resetCustom, registerCustom, library, facePixels, tiles6, EXTRA, customIds, type CustomBlock } from '../shared/custom';
import { forgetIcon } from '../render/textures';
import { Ghost, place, capture, needs, type Blueprint } from './blueprints';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** first-person moves, as keyframes: [time, x, y, z, rotX, rotY, rotZ] */
const POSES: Record<string, number[][]> = {
  chop: [[0, 0, 0, 0, 0, 0, 0], [0.25, 0.02, 0.1, 0.05, 0.95, 0, -0.15], [0.55, -0.12, -0.17, -0.22, -1.35, 0, 0.3], [1, 0, 0, 0, 0, 0, 0]],
  slash: [[0, 0, 0, 0, 0, 0, 0], [0.2, 0.12, 0.05, 0.02, 0.25, 0.95, -0.55], [0.55, -0.46, -0.05, -0.18, -0.15, -1.25, 0.65], [1, 0, 0, 0, 0, 0, 0]],
  thrust: [[0, 0, 0, 0, 0, 0, 0], [0.25, 0, 0.02, 0.16, 0.12, 0, 0], [0.5, -0.08, 0.05, -0.55, -0.15, 0, 0], [1, 0, 0, 0, 0, 0, 0]],
  punch: [[0, 0, 0, 0, 0, 0, 0], [0.35, -0.06, 0.05, -0.22, -0.38, 0, 0], [1, 0, 0, 0, 0, 0, 0]],
  eat: [[0, 0, 0, 0, 0, 0, 0], [0.25, -0.32, 0.24, 0.14, 0.45, -0.65, 0], [0.8, -0.32, 0.24, 0.14, 0.45, -0.65, 0], [1, 0, 0, 0, 0, 0, 0]],
  release: [[0, -0.3, 0.12, 0.06, 0.05, -0.15, 0.12], [0.25, -0.3, 0.14, -0.04, 0.12, -0.15, 0.12], [1, 0, 0, 0, 0, 0, 0]],
};
function pose(kind: string, u: number) {
  const ks = POSES[kind] ?? POSES.punch;
  for (let i = 1; i < ks.length; i++) {
    if (u > ks[i][0]) continue;
    const a = ks[i - 1], b = ks[i], f = (u - a[0]) / Math.max(1e-4, b[0] - a[0]), e = f * f * (3 - 2 * f);
    return [1, 2, 3, 4, 5, 6].map(j => a[j] + (b[j] - a[j]) * e);
  }
  return [0, 0, 0, 0, 0, 0];
}
/** swords, knives, spears, hammers and the bow, made of simple parts */
function buildWeapon(d: { key: string; color: string; tool?: { type: string } }): { g: THREE.Group; pull?: (k: number) => void } | null {
  const type = d.key === 'bow' ? 'bow' : d.tool?.type;
  if (!type || !['sword', 'knife', 'spear', 'hammer', 'bow'].includes(type)) return null;
  const g = new THREE.Group(), metal = new THREE.MeshLambertMaterial({ color: d.color }), wood = new THREE.MeshLambertMaterial({ color: '#6b4a2b' }), dark = new THREE.MeshLambertMaterial({ color: '#3a2a1e' });
  const box = (w: number, h: number, dd: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); o.position.set(x, y, z); g.add(o); return o; };
  if (type === 'sword' || type === 'knife') {
    const L = type === 'sword' ? 0.62 : 0.3;
    box(0.06, L, 0.016, metal, 0, 0.1 + L / 2, 0); box(0.022, L * 0.9, 0.02, new THREE.MeshLambertMaterial({ color: new THREE.Color(d.color).multiplyScalar(0.75) }), 0, 0.1 + L / 2, 0);
    box(0.2, 0.035, 0.05, dark, 0, 0.1, 0); box(0.04, 0.16, 0.04, wood, 0, 0.0, 0); box(0.055, 0.04, 0.055, dark, 0, -0.09, 0);
    g.rotation.set(-0.95, 0.2, 0.45); g.position.set(0, -0.1, -0.1);
  } else if (type === 'spear') {
    box(0.035, 1.25, 0.035, wood, 0, 0.3, 0);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), metal); tip.position.y = 1.02; g.add(tip);
    g.rotation.set(-1.25, 0, 0); g.position.set(0, -0.05, -0.1);
  } else if (type === 'hammer') {
    box(0.04, 0.5, 0.04, wood, 0, 0.1, 0); box(0.26, 0.13, 0.13, metal, 0, 0.36, 0);
    g.rotation.set(-0.45, Math.PI / 2, 0.1); g.position.set(0, -0.12, -0.08);
  } else {
    // the bow: a curved stave, a string and an arrow that appears as you draw
    const stave = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.018, 5, 18, Math.PI * 0.86), wood);
    stave.rotation.z = -Math.PI * 0.43; g.add(stave);
    const tipY = Math.sin(Math.PI * 0.43) * 0.36, tipX = Math.cos(Math.PI * 0.43) * 0.36;
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const str = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: '#e8e2d0' })); g.add(str);
    const arrow = new THREE.Group(); const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.012), new THREE.MeshLambertMaterial({ color: '#c8a870' })); shaft.position.x = 0.31; arrow.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 4), new THREE.MeshLambertMaterial({ color: '#6a6e74' })); head.rotation.z = -Math.PI / 2; head.position.x = 0.64; arrow.add(head);
    arrow.visible = false; g.add(arrow);
    const pull = (k: number) => {
      const nock = tipX - k * 0.38, a = sg.getAttribute('position') as THREE.BufferAttribute;
      a.setXYZ(0, tipX, tipY, 0); a.setXYZ(1, nock, 0, 0); a.setXYZ(2, tipX, -tipY, 0); a.needsUpdate = true;
      arrow.visible = k > 0.02; arrow.position.set(nock, 0, 0);
    };
    pull(0);
    g.rotation.set(0, Math.PI / 2, 0.1); g.position.set(-0.05, 0.05, -0.2);
    return { g, pull };
  }
  return { g };
}

/** soft, tileable clouds painted from overlapping blobs */
function makeCloudTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!; const r = mulberry32(99);
  for (let i = 0; i < 70; i++) {
    const x = r() * N, y = r() * N, rad = 8 + r() * 26, a = 0.12 + r() * 0.22;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
export const DAY = 1200;                // seconds per in-game day
export const CROP_STAGE = 100;          // game seconds per crop growth stage (three stages)
const TILLABLE = new Set([B.dirt, B.grass, B.dry_grass, B.jungle_grass]);
const CROP_FAMILY: Record<number, string> = {};
for (const f of ['wheat', 'carrot', 'potato']) for (let i = 0; i < 3; i++) CROP_FAMILY[B[`${f}_crop_${i}`]] = f;
const FIRST = ['Ada', 'Bruno', 'Clara', 'Diogo', 'Eva', 'Filipe', 'Gaia', 'Hugo', 'Inês', 'João', 'Kai', 'Lara', 'Miguel', 'Nora', 'Otto', 'Pia', 'Rui', 'Sara', 'Tiago', 'Uma', 'Vera', 'Wes', 'Yara', 'Zé'];
const LAST = ['Stone', 'River', 'Ash', 'Moss', 'Flint', 'Oak', 'Frost', 'Dune', 'Reed', 'Hart', 'Wolfe', 'Marsh', 'Vale', 'Cliff', 'Thorn', 'Brook'];
export const LOOKS = ['barbarian', 'knight', 'rogue', 'ranger'];
export const randomName = (r = Math.random) => `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;

export interface Grave { id: string; x: number; y: number; z: number; owner: string; name: string; items: Stack[]; at: number }
export interface Remote { id: string; name: string; look: number; obj: THREE.Group; mixer: THREE.AnimationMixer | null; actions: Record<string, THREE.AnimationAction>; cur: string; pos: THREE.Vector3; yaw: number; anim: string; downed: boolean; label: THREE.Sprite; seen: number }
export interface SaveData { id: string; name: string; seed: number; created: number; played: number; time: number; edits: any; player: any; graves: Grave[]; explored: string[]; waypoints: { x: number; z: number; label: string }[]; customBlocks?: CustomBlock[]; mods?: string[]; dim?: Dim; skyEdits?: any; skyContainers?: Record<string, Container>; skyCrops?: Record<string, number>; quest?: QuestData; boats?: BoatSave[]; blueprints?: any[]; admin?: { banned: string[] }; baseBlocks?: number; containers?: Record<string, Container>; crops?: Record<string, number>; pets?: PetSave[] }

export class Game {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1200);
  world: World; player = new Player(); inv = new Inventory(); animals: Animals;
  time = DAY * 0.3;      // 0 = midnight; starts around 7am
  day = 1; sunLevel = 1;
  hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight;
  stations = new Set<string>(['hand']);
  breaking: { x: number; y: number; z: number; p: number } | null = null;
  target: { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number } | null = null;
  graves: Grave[] = []; explored = new Set<string>(); waypoints: { x: number; z: number; label: string }[] = [];
  remotes = new Map<string, Remote>();
  weather: 'clear' | 'rain' | 'storm' = 'clear'; weatherT = 240;
  biome = 0; ambient = 15; nearFire = 0;
  ready = false; paused = false; profileId: string; look = 0;
  toast: (msg: string, kind?: string) => void = () => {};
  onChange: () => void = () => {};        // inventory/stats changed: refresh UI
  net: { block?: (x: number, y: number, z: number, id: number) => void; grave?: (g: Grave | null, removeId?: string) => void; blockdef?: (c: CustomBlock) => void; blockdefs?: (l: CustomBlock[]) => void;
    hurt?: (peer: string, dmg: number, from: THREE.Vector3) => void; travel?: () => void; dim?: (to: Dim, at: [number, number, number]) => void;
    beam?: (x: number, y: number, z: number) => void; ending?: () => void; ended?: () => void; toastAll?: (key: string, vars?: Record<string, any>) => void; arrow?: (from: THREE.Vector3, vel: THREE.Vector3) => void; cont?: (key: string, c: Container | null) => void;
    sleep?: () => void; tame?: (id: string) => void; saddle?: (id: string) => void; ride?: (b: Beast) => void; boat?: (op: 'add' | 'move' | 'rm', b: Boat) => void; crop?: (key: string, t: number | null) => void } = {};
  isGuest = false;
  private highlight: THREE.LineSegments; private crack: THREE.Mesh;
  private held = new THREE.Group(); private heldKey = ''; private offHeld = new THREE.Group(); private offKey = ''; private swing = 0; private attackCd = 0;
  private particles: THREE.Points; private pPos: Float32Array; private pVel: Float32Array; private pLife: Float32Array; private pCol: Float32Array; private pNext = 0;
  private weatherFx: THREE.Points; private drops: { k: string; n: number; pos: THREE.Vector3; vel: THREE.Vector3; obj: THREE.Sprite; age: number }[] = [];
  private envT = 0; private saveT = 0; private sendT = 0; private exploreT = 0; private ambT = 0;
  data: SaveData;

  constructor(public renderer: THREE.WebGLRenderer, public input: Input, public atlas: Atlas, save: SaveData, profileId: string) {
    this.data = save; this.profileId = profileId;
    this.dim = save.dim ?? 'earth';
    save.quest = { ...newQuest(), ...(save.quest ?? {}) };
    this.world = new World(save.seed, atlas.texture, settings.render, this.dim);
    this.world.setRenderDist(settings.render);
    // custom blocks: this world's own list first (their numbers are saved in the terrain), then your library
    resetCustom();
    this.baseBlocks = BLOCKS.length;
    // worlds saved before new built-in blocks were added: custom block numbers move up to make room
    const oldBase = save.baseBlocks ?? 92;
    if (oldBase !== this.baseBlocks) for (const ed of [save.edits, save.skyEdits]) if (ed) for (const list of Object.values(ed as Record<string, [number, number][]>)) for (const e of list) if (e[1] >= oldBase) e[1] += this.baseBlocks - oldBase;
    save.baseBlocks = this.baseBlocks;
    this.world.loadEdits(this.dim === 'sky' ? save.skyEdits : save.edits);
    save.customBlocks = save.customBlocks ?? [];
    for (const c of save.customBlocks) this.paintCustom(c);
    if (!(save as any).guest) for (const c of [...MOD_BLOCKS, ...library()]) if (!save.customBlocks.some(x => x.key === c.key) && this.paintCustom(c)) save.customBlocks.push(c);
    save.mods = modIds();
    this.world.syncTables(this.baseBlocks);
    this.graves = save.graves ?? []; this.explored = new Set(save.explored ?? []); this.waypoints = save.waypoints ?? [];
    this.time = save.time ?? DAY * 0.3; this.day = Math.floor(this.time / DAY) + 1;
    this.scene.add(this.world.group);
    this.animals = new Animals(this.world);
    this.animals.simDist = settings.sim * CS; this.animals.cap = settings.preset === 'potato' ? 10 : settings.preset === 'low' ? 16 : 26;
    this.scene.add(this.animals.group);
    this.animals.monsterCap = settings.preset === 'potato' ? 6 : settings.preset === 'low' ? 9 : 14;
    this.projectiles = new Projectiles(this.world, this.animals); this.scene.add(this.projectiles.group);
    this.boats = new Boats(this.world); this.scene.add(this.boats.group);
    if (this.dim === 'earth') this.boats.load(save.boats);
    this.containers = (this.dim === 'sky' ? save.skyContainers : save.containers) ?? {}; this.crops = (this.dim === 'sky' ? save.skyCrops : save.crops) ?? {};
    this.animals.setWorld(this.world, this.dim);
    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#5a4a3a', 1.6); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dd', 1.8); this.sun.position.set(30, 80, 20); this.scene.add(this.sun);
    this.scene.add(this.camera); this.camera.add(this.held); this.camera.add(this.offHeld);
    // block outline and cracks
    this.highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: '#111', transparent: true, opacity: 0.6 }));
    this.highlight.visible = false; this.scene.add(this.highlight);
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0, depthWrite: false }));
    this.crack.visible = false; this.scene.add(this.crack);
    // particles: block bits and blood
    const N = settings.particles ? 400 : 60;
    this.pPos = new Float32Array(N * 3).fill(-9999); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pCol = new Float32Array(N * 3);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.12, vertexColors: true })); this.particles.frustumCulled = false; this.scene.add(this.particles);
    // rain / snow around the camera
    const W = settings.particles ? 1600 : 400, wp = new Float32Array(W * 3);
    for (let i = 0; i < W; i++) wp.set([(Math.random() - 0.5) * 40, Math.random() * 30, (Math.random() - 0.5) * 40], i * 3);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    this.weatherFx = new THREE.Points(wg, new THREE.PointsMaterial({ color: '#aac8e8', size: 0.08, transparent: true, opacity: 0.7 })); this.weatherFx.frustumCulled = false; this.weatherFx.visible = false;
    this.scene.add(this.weatherFx);

    this.hookWorld();
    // clouds: one big soft layer that drifts with the wind
    if (settings.preset !== 'potato') {
      this.cloudTex = makeCloudTexture(); this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping; this.cloudTex.repeat.set(3, 3);
      this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.85, side: THREE.DoubleSide }));
      this.clouds.rotation.x = -Math.PI / 2; this.clouds.renderOrder = -1; this.scene.add(this.clouds);
    }
    this.animals.onAttack = (b, dmg, target, area) => {
      const near = (p: THREE.Vector3) => area || b.pos.distanceTo(p) < (b.def.reach ?? 1.6) + 1;
      if (target === this.player.pos) { if (near(this.player.pos)) { this.hurtBy(dmg, b.pos, false); if (b.def.poison) this.player.stats.sick = Math.min(1, this.player.stats.sick + b.def.poison); } return; }
      for (const r of this.remotes.values()) if (r.pos === target && near(r.pos)) this.net.hurt?.(r.id, dmg, b.pos);
    };
    this.animals.onShoot = (b, from, at) => {
      const vel = Projectiles.aim(from, at, 24, 1.6);
      this.projectiles.fire(from, vel, 'mob', b.def.boss ? 6 : b.def.damage ?? 4, b); this.net.arrow?.(from, vel);
      sound.play('bow', { pos: from, range: 30, vol: 0.6 });
    };
    this.animals.onFx = (k, pos) => { if (k === 'slam') { this.spray(pos.clone().setY(pos.y + 0.3), [0.7, 0.6, 0.9], 40); this.shake = Math.max(this.shake, 0.5); sound.play('thunder', { pos, vol: 0.6, range: 60 }); } else if (k === 'fire') this.spray(pos, [1, 0.55, 0.1], 2); else if (k === 'hearts') this.spray(pos, [1, 0.4, 0.6], 14); else this.spray(pos, [0.5, 0.5, 0.5], 6); };
    this.animals.onPetKill = (drops, at) => { for (const [k, n] of drops) this.dropItem(k, n, at.clone().setY(at.y + 0.6), false); };
    this.animals.ownerPos = owner => owner === this.profileId ? this.player.pos : this.remotes.get(owner)?.pos ?? null;
    this.projectiles.onHitBeast = (b, dmg, from) => {
      sound.play('arrow_hit', { pos: b.pos, vol: 0.6 });
      this.spray(b.pos.clone().setY(b.pos.y + b.height * 0.6), [0.6, 0.05, 0.05], 6);
      if (this.isGuest) this.netAttack?.(b.id, dmg); else this.hitAnimal(b, dmg, from);
    };
    this.projectiles.onHitPlayer = (target, dmg, from) => { if (target === null) this.hurtBy(dmg, from, true); else this.net.hurt?.(target, dmg, from); };
    this.projectiles.onStick = pos => sound.play('arrow_hit', { pos, vol: 0.4, range: 20 });
    this.animals.onSound = (k, p) => sound.play(k, { pos: p, range: 40, vol: 0.7 });
    this.player.onStep = id => { const k = id === B.sand || id === B.red_sand ? 'step_sand' : id === B.snow || id === B.ice ? 'step_snow' : id === B.grass || id === B.dirt || id === B.dry_grass || id === B.jungle_grass || id === B.tall_grass ? 'step_grass' : 'step_stone'; sound.play(k, { vol: 0.35 }); };
    this.player.onHurt = (a) => {
      // every real hit flashes red, jolts the view and grunts; slow damage (cold, hunger, lava) does it in ticks
      this.hurtAcc += a;
      if ((a >= 1 || this.hurtAcc >= 2) && this.hurtCd <= 0) { this.hurtFx(Math.max(a, this.hurtAcc)); this.hurtAcc = 0; }
      this.onChange();
    };
    this.player.onDowned = () => { sound.play('death'); this.onChange(); };
    this.player.autoStep = input.touch;
    this.inv.onChange = () => this.onChange();
    this.loadPlayer(save.player);
    if (!(save as any).guest) this.animals.loadPets(save.pets);
  }
  projectiles: Projectiles;
  boats: Boats; boating: Boat | null = null; private boatSendT = 0;
  private clouds: THREE.Mesh | null = null; private cloudTex: THREE.CanvasTexture | null = null;
  containers: Record<string, Container> = {};
  crops: Record<string, number> = {};          // farmland crops: block position → game time planted
  riding: Beast | null = null;
  bed: [number, number, number] | null = null;
  sleepFade = 0;
  onContainer?: (key: string) => void;          // a chest or furnace you have open changed
  private furnT = 0; private contSendT = 0; private cropT = 0; private bowCd = 0; private dirtyCont = new Set<string>();
  shake = 0; redFlash = 0; baseBlocks = 0; god = false; tilt = 0;
  private hurtAcc = 0; private hurtCd = 0; private started = false; private freshLife = false;
  /** the "ouch": red screen, a shake and a tilt of the head, a grunt and a thud */
  hurtFx(amount: number) {
    this.redFlash = Math.min(0.9, 0.5 + amount / 25);
    this.shake = Math.max(this.shake, Math.min(0.5, 0.22 + amount / 40));
    this.tilt = (Math.random() < 0.5 ? -1 : 1) * Math.min(0.22, 0.1 + amount / 80);
    this.hurtCd = 0.45;
    sound.play('hurt', { vol: 0.75, pitch: 0.95 + Math.random() * 0.15 });
    sound.play('hit', { vol: 0.55 });
  }
  /** register a custom block and paint its six faces into the atlas */
  paintCustom(c: CustomBlock) {
    const r = registerCustom(c); if (!r) return false;
    r.tiles.forEach((tile, f) => this.atlas.setTile(tile, facePixels(c.faces[f])));
    forgetIcon(c.key);
    return true;
  }
  /** a block made in the Block Maker joins this world (the host decides the numbers in co-op) */
  addCustomBlock(c: CustomBlock) {
    if (this.isGuest) { this.net.blockdef?.(c); return true; }
    if (this.data.customBlocks!.some(x => x.key === c.key)) return true;
    if (!this.paintCustom(c)) { this.toast(t('bm.full'), 'bad'); return false; }
    this.data.customBlocks!.push(c);
    this.world.syncTables(this.baseBlocks);
    this.net.blockdefs?.(this.data.customBlocks!);
    this.save(); this.onChange();
    return true;
  }
  /** co-op guests: take the host's list (same order as the host) */
  applyCustomList(list: CustomBlock[]) {
    let changed = false;
    for (const c of list) if (!customIds.some(id => BLOCKS[id].key === c.key)) { this.paintCustom(c); changed = true; }
    if (changed) { this.world.syncTables(this.baseBlocks); this.onChange(); }
  }

  private loadPlayer(p: any) {
    const r = mulberry32((this.data.seed ^ Date.now()) >>> 0);
    if (p?.pos) {
      this.player.pos.set(p.pos[0], p.pos[1], p.pos[2]); this.player.yaw = p.yaw ?? 0; this.player.pitch = p.pitch ?? 0;
      Object.assign(this.player.stats, p.stats ?? {}); this.inv.load(p.inv); this.player.name = p.name; this.look = p.look ?? 0; this.bed = p.bed ?? null;
    } else {
      const s = this.world.gen.findSpawn(Math.floor((r() - 0.5) * 4000), Math.floor((r() - 0.5) * 4000), r);
      this.player.pos.set(s.x, s.y, s.z);
      this.player.name = settings.name || randomName(r); this.look = Math.floor(r() * LOOKS.length);
      this.inv.add('stone_axe', 1);                   // you wake up holding only an axe
      this.freshLife = true;
    }
  }
  playerJSON() { const p = this.player; return { pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch, stats: p.stats, inv: this.inv.toJSON(), name: p.name, look: this.look, bed: this.bed }; }

  save() {
    if (this.isGuest) return;
    this.storeDim(); this.data.player = this.playerJSON(); this.data.graves = this.graves;
    this.data.time = this.time; this.data.played = Date.now(); this.data.explored = [...this.explored].slice(-60000); this.data.waypoints = this.waypoints;
    if (this.dim === 'earth') this.data.pets = this.animals.pets(this.profileId);
    try { localStorage.setItem('mye-world-' + this.data.id, JSON.stringify(this.data)); } catch (e) { console.warn('save failed', e); }
  }

  resize(w: number, h: number) { this.camera.aspect = w / h; this.camera.fov = settings.fov; this.camera.updateProjectionMatrix(); }

  // ======================= frame =======================
  update(dt: number) {
    const p = this.player, inp = this.input;
    dt = Math.min(dt, 0.05);
    const missing = this.world.update(p.pos.x, p.pos.z, dt);
    if (!this.ready) {
      // wait until the ground under you exists, then drop you onto it
      const here = this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z));
      const near = this.world.chunkAt(p.pos.x, p.pos.z);
      if (near && here >= 0 && (missing < 8 || this.world.chunks.size > 20)) {
        const top = this.world.surface(Math.floor(p.pos.x), Math.floor(p.pos.z));
        const inside = this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z));
        if ((p.pos.y < top + 1 && !this.bed) || (inside > 0 && BLOCKS[inside].solid !== false)) p.pos.y = top + 1.02;
        this.ready = true; this.onChange();
        if (!this.started) { this.started = true; runHooks('start', this); }
        if (this.freshLife) { this.freshLife = false; runHooks('newLife', this); }
      }
      this.updateCamera(dt);
      return;
    }
    if (!this.paused) {
      if (this.riding) this.rideTick(dt);
      else if (this.boating) this.boatTick(dt);
      else p.update(dt, this.world, inp, settings.sensitivity, settings.invertY);
      this.interact(dt);
    }
    if (!this.paused) runHooks('tick', this, dt);
    this.envT -= dt;
    if (this.envT <= 0) { this.envT = 0.5; this.sampleEnvironment(); }
    p.tickStats(dt, this.ambient, this.inv.warmth() + (this.nearFire ? 3 : 0), !!(inp.move.x || inp.move.z));
    if (p.downed > 0) { p.downed -= dt; if (p.downed <= 0) this.die(); }
    // time and sky
    this.time += dt; const nd = Math.floor(this.time / DAY) + 1; if (nd !== this.day) { this.day = nd; this.onChange(); }
    this.sky(dt);
    this.weatherTick(dt);
    const others = [...this.remotes.values()].map(r => r.pos);
    this.animals.sun = this.sunLevel;
    this.animals.update(dt, p, others);
    this.projectiles.update(dt, p.pos, [...this.remotes.values()], !this.isGuest);
    this.boats.update(dt, this.time); this.lidTick(dt);
    this.bowCd -= dt; this.bowTick(dt); this.player.slowed = this.bowCharge >= 0; this.sleepFade = Math.max(0, this.sleepFade - dt * 0.5);
    if (!this.isGuest) { this.furnaceTick(dt); this.cropTick(dt); }
    this.questTick(dt); this.beamTick(dt);
    if (this.slowFall > 0) { this.slowFall -= dt; p.vel.y = Math.max(p.vel.y, -2.5); (p as any).fallStart = p.pos.y; }
    // fell off the Sky Isles: the sky catches you
    if (this.dim === 'sky' && p.pos.y < 40 && !p.dead) { p.pos.set(SKY_ALTAR[0] + 2.5, SKY_ALTAR[1] + 12, SKY_ALTAR[2] + 2.5); p.vel.set(0, 0, 0); this.slowFall = 4; p.hurt(8, 'fall'); this.toast(t('sky.caught'), 'bad'); }
    this.updateRemotes(dt);
    this.updateDrops(dt);
    this.tickFuses(dt);
    if (this.site) this.siteTick(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.updateHeld(dt);
    sound.setListener(this.camera.position, p.yaw);
    this.exploreT -= dt; if (this.exploreT <= 0) { this.exploreT = 1; this.explore(); }
    this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 30; this.save(); this.expireGraves(); }
    this.ambT -= dt; if (this.ambT <= 0) { this.ambT = 1; this.ambienceTick(); }
  }

  private updateCamera(dt: number) {
    const p = this.player, cam = this.camera;
    const eye = p.downed > 0 ? 0.35 : p.crouching ? EYE - 0.3 : EYE;
    cam.position.set(p.pos.x, p.pos.y + eye, p.pos.z);
    if (this.shake > 0) { cam.position.x += (Math.random() - 0.5) * this.shake * 0.3; cam.position.y += (Math.random() - 0.5) * this.shake * 0.3; this.shake = Math.max(0, this.shake - dt); }
    this.hurtCd -= dt; this.tilt *= Math.pow(0.002, dt);
    cam.rotation.set(p.pitch, p.yaw, (p.downed > 0 ? 0.6 : 0) + this.tilt, 'YXZ');
    // under water: blue fog
    const under = this.world.get(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z)) === B.water;
    const u = this.world.uniforms;
    if (under) { (u.uFogColor.value as THREE.Color).set('#1d4a78'); u.uFogNear.value = 1; u.uFogFar.value = 18; }
    else { u.uFogNear.value = settings.render * CS * 0.55; u.uFogFar.value = settings.render * CS * 0.95; }
    this.underwater = under;
  }
  underwater = false;

  // ======================= interaction =======================
  private reach() { return this.input.touch ? 5.5 : 5; }
  private interact(dt: number) {
    const p = this.player, inp = this.input;
    if (p.downed > 0) { this.breaking = null; this.highlight.visible = false; return; }
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const o = this.camera.position.clone();
    const hit = this.world.raycast(o, dir, this.reach());
    this.target = hit;
    this.highlight.visible = !!hit;
    if (hit) this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    // hotbar
    for (let i = 0; i < 9; i++) if (inp.hit('slot' + i)) { this.inv.sel = i; this.onChange(); }
    if (inp.hit('next')) { this.inv.sel = (this.inv.sel + 1) % 9; this.onChange(); }
    if (inp.hit('prev')) { this.inv.sel = (this.inv.sel + 8) % 9; this.onChange(); }
    if (inp.hit('pick') && hit) { const k = BLOCKS[hit.id].key; const i = this.inv.slots.findIndex((s, j) => j < 9 && s?.k === k); if (i >= 0) { this.inv.sel = i; this.onChange(); } }
    const held = this.inv.held(), def = held ? ITEM[held.k] : null;
    if (this.ghost) { this.ghostTick(hit, dir); this.breaking = null; this.crack.visible = false; return; }
    if (this.selecting) {
      if (hit && (inp.hit('attack') || inp.hit('use'))) {
        const v = new THREE.Vector3(hit.x, hit.y, hit.z); inp.primary = false;
        if (!this.selecting.a) { this.selecting.a = v; this.spray(v.clone().addScalar(0.5), [1, 0.85, 0.2], 10); }
        else { const r = capture((x, y, z) => this.world.get(x, y, z), this.selecting.a, v, this.selecting.name); this.selecting = null; this.onCaptured?.(r); }
      }
      return;
    }
    // hit a boat to pick it back up
    if (inp.hit('attack') && !this.boating) {
      const bt = this.boats.rayHit(o, dir, 4);
      if (bt && !bt.rider && (!hit || hit.dist > o.distanceTo(bt.pos))) { this.boats.remove(bt); this.net.boat?.('rm', bt); this.give('boat', 1); this.startAct(this.swingKind(), 0.42); sound.play('wood_break', { vol: 0.6 }); return; }
    }
    // attack animals first
    this.attackCd -= dt;
    if ((inp.hit('attack') || (inp.primary && this.attackCd <= 0))) {
      const beast = this.animals.rayHit(o, dir, 3.6, b => b.owner === this.profileId || b === this.riding);
      if (beast && (!hit || hit.dist > o.distanceTo(beast.pos))) {
        if (this.attackCd <= 0) {
          this.attackCd = 0.55; this.swing = 1; this.startAct(this.swingKind(), 0.42);
          const dmg = def?.tool ? def.tool.damage : 1;
          sound.play('swing', { vol: 0.5 });
          if (this.isGuest) this.netAttack?.(beast.id, dmg);
          else this.hitAnimal(beast, dmg, p.pos, 'me', def?.tool?.type === 'sword' || def?.tool?.type === 'spear' || def?.tool?.type === 'hammer' ? 1.4 : 1);
          sound.play('hit', { pos: beast.pos, vol: 0.45 });
          this.spray(beast.pos.clone().setY(beast.pos.y + beast.height * 0.6), [0.6, 0.05, 0.05], 8);
          if (def?.tool) this.inv.wear(1);
        }
        this.breaking = null; this.crack.visible = false;
        this.useInput(hit, held, def);
        return;
      }
    }
    // breaking blocks
    if (inp.primary && hit) {
      const bd = BLOCKS[hit.id];
      if (!this.breaking || this.breaking.x !== hit.x || this.breaking.y !== hit.y || this.breaking.z !== hit.z) this.breaking = { x: hit.x, y: hit.y, z: hit.z, p: 0 };
      if (bd.hard >= 0) {
        const tool = def?.tool, right = !!tool && tool.type === bd.tool;
        const speed = right ? tool!.speed : (bd.tool === 'pickaxe' ? 0.3 : 1);
        this.breaking.p += dt * speed / Math.max(0.05, bd.hard * 1.5);
        this.swing = Math.max(this.swing, 0.6); this.mining = true;
        if (Math.random() < dt * 10) { this.spray(new THREE.Vector3(hit.x + 0.5 + hit.nx * 0.5, hit.y + 0.5 + hit.ny * 0.5, hit.z + 0.5 + hit.nz * 0.5), this.blockColor(hit.id), 2); sound.play(bd.tool === 'axe' ? 'chop' : bd.tool === 'pickaxe' ? 'mine' : 'dig', { vol: 0.35 }); }
        if (this.breaking.p >= 1) this.breakBlock(hit.x, hit.y, hit.z, hit.id, def);
      }
      this.crack.visible = true; this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      (this.crack.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, (this.breaking?.p ?? 0) * 0.55);
    } else { this.breaking = null; this.crack.visible = false; }
    this.useInput(hit, held, def);
  }
  netAttack?: (id: string, dmg: number) => void;

  hitAnimal(beast: any, dmg: number, from: THREE.Vector3, to: 'me' | string = 'me', knock = 1) {
    const drops = this.animals.damage(beast, dmg, from, knock);
    if (drops) {
      const q = this.data.quest!;
      if (beast.def.monster || beast.def.bandit || beast.def.boss) q.kills++;
      if (beast.def.boss && !this.isGuest) { q.colossus = true; this.toast(t('quest.colossusDown'), 'good'); sound.play('discover'); this.net.toastAll?.('quest.colossusDown'); }
      runHooks('kill', this, { key: beast.def.key, x: beast.pos.x, y: beast.pos.y, z: beast.pos.z, by: to });
      if (to === 'me') { for (const [k, n] of drops) this.give(k, n); this.toast(drops.map(([k, n]) => `+${n} ${nm(ITEM[k])}`).join(', '), 'good'); }
      else this.giveTo?.(to, drops);
    }
  }
  giveTo?: (peer: string, items: [string, number][]) => void;

  private useInput(hit: any, held: Stack | null, def: any) {
    const inp = this.input;
    if (inp.hit('eat') || (inp.hit('use') && def && (def.kind === 'food' || def.kind === 'drink' || def.kind === 'medicine') && !(hit && BLOCKS[hit.id].station))) { if (held && def?.food) this.consume(this.inv.sel); return; }
    if (inp.hit('drop') && held) { const one = this.inv.takeOne(this.inv.sel); if (one) this.dropItem(one.k, 1, this.camera.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)), true); }
    if (!inp.hit('use')) return;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (this.riding) { this.dismount(); return; }
    if (this.boating) { this.leaveBoat(); return; }
    const boat = this.boats.rayHit(this.camera.position, dir, 4);
    if (boat && (!hit || hit.dist > this.camera.position.distanceTo(boat.pos)) && !boat.rider) { this.board(boat); return; }
    // bow: shoot an arrow
    if (held?.k === 'bow') { this.startDraw(dir); return; }
    // creatures in front of you: tame, saddle, ride, shear
    const beast = this.animals.rayHit(this.camera.position, dir, 3.5);
    if (beast && (!hit || hit.dist > this.camera.position.distanceTo(beast.pos)) && this.useOnBeast(beast, held)) return;
    // water: drink or fill a bottle
    const wHit = this.world.raycast(this.camera.position, dir, 4, true);
    if (wHit && wHit.id === B.water && (!hit || wHit.dist <= hit.dist + 0.01)) {
      if (held?.k === 'boat') {
        const top = this.boats.waterTop(wHit.x + 0.5, wHit.z + 0.5, wHit.y);
        if (top != null) { const b = this.boats.add(wHit.x + 0.5, top - 0.18, wHit.z + 0.5, this.player.yaw); this.inv.takeOne(this.inv.sel); this.net.boat?.('add', b); sound.play('splash', { vol: 0.5 }); this.toast(t('boat.placed')); }
        return;
      }
      if (held?.k === 'empty_bottle') { this.inv.takeOne(this.inv.sel); this.give('dirty_water', 1); this.toast(t('hud.fillBottle')); sound.play('splash', { vol: 0.5 }); return; }
      if (held?.k === 'bucket') { this.inv.takeOne(this.inv.sel); this.give('water_bucket', 1); sound.play('splash', { vol: 0.5 }); return; }
      if (!held || !def?.block) { this.drinkRaw(); return; }
    }
    if (!hit) return;
    const bd = BLOCKS[hit.id];
    if (hit.id === B.grave) { this.openGrave(hit.x, hit.y, hit.z); return; }
    if (hit.id === B.loot_chest) { this.openLoot(hit.x, hit.y, hit.z); return; }
    if (hit.id === B.wooden_door || hit.id === B.wooden_door_open) { this.toggleDoor(hit.x, hit.y, hit.z); return; }
    if (hit.id === B.ancient_vault) { this.openVault(hit.x, hit.y, hit.z); return; }
    if (hit.id === B.sky_beacon || hit.id === B.sky_altar) { this.useBeacon(hit.x, hit.y, hit.z, held); return; }
    if (hit.id === B.sky_bell) { this.world.set(hit.x, hit.y, hit.z, B.sky_bell_rung); sound.play('bell', { pos: new THREE.Vector3(hit.x, hit.y, hit.z), range: 200 }); this.spray(new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5), [0.5, 0.85, 1], 30); this.toast(t('quest.bellRung'), 'good'); this.questT = 0; return; }
    if (hit.id === B.bed) { this.sleep(hit.x, hit.y, hit.z); return; }
    if (hit.id === B.chest || hit.id === B.barrel || EXTRA[hit.id]?.storage) { this.openContainer(hit.x, hit.y, hit.z, 'chest'); return; }
    if (hit.id === B.furnace) { this.openContainer(hit.x, hit.y, hit.z, 'furnace'); return; }
    // farming: till with a hoe, plant on farmland, bone meal makes crops grow
    const above = this.world.get(hit.x, hit.y + 1, hit.z);
    if (def?.tool?.type === 'hoe' && TILLABLE.has(hit.id) && (above === 0 || (above > 0 && BLOCKS[above].render === 'cross' && !CROP_FAMILY[above]))) {
      if (above > 0) this.world.set(hit.x, hit.y + 1, hit.z, 0);
      this.world.set(hit.x, hit.y, hit.z, B.farmland); this.inv.wear(1); this.swing = 0.8; this.startAct('chop', 0.4); sound.play('dig', { vol: 0.6 });
      if (Math.random() < 0.1) this.give('seeds', 1);
      return;
    }
    if (def?.plant && hit.id === B.farmland && above === 0) {
      this.world.set(hit.x, hit.y + 1, hit.z, B[def.plant]); this.inv.takeOne(this.inv.sel); sound.play('place', { vol: 0.4 });
      const k = posKey(hit.x, hit.y + 1, hit.z); this.crops[k] = this.time; this.net.crop?.(k, this.time);
      return;
    }
    if (held?.k === 'white_dye' && CROP_FAMILY[hit.id] && !BLOCKS[hit.id].key.endsWith('_2')) {
      const k = posKey(hit.x, hit.y, hit.z); this.inv.takeOne(this.inv.sel);
      this.crops[k] = (this.crops[k] ?? this.time) - CROP_STAGE; this.net.crop?.(k, this.crops[k]); this.spray(new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5), [0.5, 1, 0.4], 10);
      this.cropT = 0; return;
    }
    if (bd.station) { this.onOpenStation?.(bd.station); return; }
    if ((hit.id === B.tnt || EXTRA[hit.id]?.explosive) && (held?.k === 'flint_and_steel' || held?.k === 'torch')) { this.ignite(hit.x, hit.y, hit.z); return; }
    if (held?.k === 'water_bucket' && def) { this.placeAt(hit, B.water); this.inv.slots[this.inv.sel] = { k: 'bucket', n: 1 }; this.onChange(); return; }
    if (held?.k === 'flint_and_steel') { this.placeAt(hit, B.fire); this.inv.wear(1); return; }
    if (def?.block != null) {
      if (def.block === B.wooden_door) {
        // doors are two blocks tall
        const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
        if (this.world.get(x, y + 1, z) !== 0 || this.world.get(x, y - 1, z) <= 0) return;
        if (this.placeAt(hit, def.block)) { this.world.set(x, y + 1, z, B.wooden_door); this.inv.takeOne(this.inv.sel); sound.play('door_close', { vol: 0.5 }); }
        return;
      }
      if (this.placeAt(hit, def.block)) {
        this.inv.takeOne(this.inv.sel); sound.play('place', { vol: 0.5 }); this.swing = 0.5; this.startAct('punch', 0.25);
        if (def.block === B.sky_beacon && this.dim === 'earth') { this.data.quest!.beacon = [hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz]; this.toast(t('quest.beaconPlaced'), 'good'); }
      }
    }
  }

  // ---------------- worlds, the quest and the ending ----------------
  dim: Dim = 'earth';
  slowFall = 0; questT = 0; compass: { x: number; z: number; label: string; dist: number } | null = null;
  private beam: { x: number; y: number; z: number; t: number; mesh: THREE.Group } | null = null; private lift = 0; private compassT = 0;
  onEnding?: () => void;
  onDimChange?: () => void;
  private hookWorld() { this.world.onBlockChange = (x, y, z, id) => this.net.block?.(x, y, z, id); }
  /** keep this world's changes in the save (each world has its own) */
  private storeDim() {
    if (this.dim === 'earth') { this.data.edits = this.world.saveEdits(); this.data.containers = this.containers; this.data.crops = this.crops; this.data.boats = this.boats.save(); }
    else { this.data.skyEdits = this.world.saveEdits(); this.data.skyContainers = this.containers; this.data.skyCrops = this.crops; }
  }
  /** move everyone here to the other world */
  switchDim(to: Dim) {
    if (to === this.dim) return;
    this.storeDim();
    if (this.dim === 'earth' && !this.isGuest) this.data.pets = this.animals.pets(this.profileId);
    this.dismount(); this.cancelGhost(); this.site = null; this.selecting = null;
    this.leaveBoat(); this.animals.clear(); this.projectiles.clear(); this.clearBeam(); this.boats.clear();
    for (const d of this.drops) this.scene.remove(d.obj); this.drops = [];
    this.scene.remove(this.world.group); this.world.dispose();
    this.dim = to; this.data.dim = to;
    this.world = new World(this.data.seed, this.atlas.texture, settings.render, to);
    this.world.setRenderDist(settings.render);
    this.world.loadEdits(to === 'sky' ? this.data.skyEdits : this.data.edits);
    this.world.syncTables(this.baseBlocks);
    this.hookWorld(); this.scene.add(this.world.group);
    this.animals.setWorld(this.world, to); this.projectiles.world = this.world; this.boats.world = this.world;
    if (to === 'earth') this.boats.load(this.data.boats);
    this.containers = (to === 'sky' ? this.data.skyContainers : this.data.containers) ?? {};
    this.crops = (to === 'sky' ? this.data.skyCrops : this.data.crops) ?? {};
    if (to === 'earth' && !this.isGuest) this.animals.loadPets(this.data.pets);
    if (to === 'sky') this.data.quest!.visited = true;
    this.ready = false; this.onDimChange?.(); this.onChange();
  }
  /** where you arrive in a world */
  arrival(to: Dim): [number, number, number] {
    if (to === 'sky') return [SKY_ALTAR[0] + 2.5, SKY_ALTAR[1] + 14, SKY_ALTAR[2] + 3.5];
    const b = this.data.quest!.beacon;
    if (b) return [b[0] + 2.5, b[1] + 14, b[2] + 0.5];
    if (this.bed) return [this.bed[0] + 0.5, this.bed[1] + 3, this.bed[2] + 0.5];
    const s = this.world.gen.findSpawn(0, 0, Math.random); return [s.x, s.y + 10, s.z];
  }
  /** the host takes everyone across; a friend asks the host */
  travel() {
    const to: Dim = this.dim === 'earth' ? 'sky' : 'earth';
    if (this.isGuest) { this.net.travel?.(); return; }
    this.switchDim(to);
    const a = this.arrival(to);
    this.player.pos.set(a[0], a[1], a[2]); this.player.vel.set(0, 0, 0); this.slowFall = 5; this.sleepFade = 1.2;
    this.net.dim?.(to, a);
    this.toast(t(to === 'sky' ? 'sky.arrive' : 'sky.home'), 'good');
  }
  /** a friend: the host moved everyone */
  followDim(to: Dim, at: [number, number, number]) {
    this.switchDim(to);
    this.player.pos.set(at[0] + (Math.random() - 0.5) * 3, at[1], at[2] + (Math.random() - 0.5) * 3); this.player.vel.set(0, 0, 0); this.slowFall = 5; this.sleepFade = 1.2;
    this.toast(t(to === 'sky' ? 'sky.arrive' : 'sky.home'), 'good');
  }
  /** a column of light: step in and it lifts you to the other world */
  showBeam(x: number, y: number, z: number, secs = 40) {
    this.clearBeam();
    const g = new THREE.Group(), mk = (r: number, o: number, c: string) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 220, 20, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.position.y = 110; g.add(m); return m; };
    mk(1.1, 0.25, '#ffe9a0'); mk(0.45, 0.55, '#fffbe8');
    g.position.set(x + 0.5, y + 1, z + 0.5); this.scene.add(g);
    this.beam = { x, y, z, t: secs, mesh: g };
    sound.play('discover', { vol: 0.8 }); sound.play('bell', { vol: 0.5 });
  }
  private clearBeam() { if (this.beam) { this.scene.remove(this.beam.mesh); this.beam = null; } this.lift = 0; }
  private beamTick(dt: number) {
    const bm = this.beam; if (!bm) return;
    bm.t -= dt; bm.mesh.rotation.y += dt * 0.6;
    bm.mesh.children.forEach((m, i) => { ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (i ? 0.5 : 0.22) * Math.min(1, bm.t / 3) * (0.85 + Math.sin(this.time * 6 + i) * 0.15); });
    if (Math.random() < dt * 30) this.spray(new THREE.Vector3(bm.x + 0.5 + (Math.random() - 0.5), bm.y + 1 + Math.random() * 4, bm.z + 0.5 + (Math.random() - 0.5)), [1, 0.9, 0.5], 1);
    if (bm.t <= 0) { this.clearBeam(); return; }
    const p = this.player.pos, inside = Math.hypot(p.x - bm.x - 0.5, p.z - bm.z - 0.5) < 1.2 && p.y > bm.y - 0.5 && p.y < bm.y + 60;
    if (inside && this.player.downed <= 0) {
      this.lift += dt; this.player.vel.y = Math.max(this.player.vel.y, 5 + this.lift * 3); (this.player as any).fallStart = p.y;
      this.flash = Math.min(0.8, this.lift * 0.3);
      if (this.lift > 2.6) { this.clearBeam(); this.travel(); }
    } else this.lift = Math.max(0, this.lift - dt);
  }
  /** the Skyward Beacon (Earth) or the Sky Altar: light the way across, or plant the World Seed */
  private useBeacon(x: number, y: number, z: number, held: Stack | null) {
    if (held?.k === 'world_seed' && this.dim === 'earth') {
      if (this.data.quest!.ended) { this.toast(t('quest.alreadyEnded')); return; }
      this.inv.takeOne(this.inv.sel);
      if (this.isGuest) this.net.ending?.(); else this.ending(x, y, z);
      return;
    }
    this.showBeam(x, y, z); this.net.beam?.(x, y, z);
    this.toast(t('sky.stepIn'));
  }
  /** the end of the story: a great tree grows from the Beacon and the sky lights up */
  ending(x: number, y: number, z: number) {
    const q = this.data.quest!; if (q.ended) return;
    q.ended = true;
    const set = (dx: number, dy: number, dz: number, id: number) => { const cur = this.world.get(x + dx, y + dy, z + dz); if (cur === 0 || (cur > 0 && BLOCKS[cur].render === 'cross')) this.world.set(x + dx, y + dy, z + dz, id); };
    for (let dy = 1; dy <= 13; dy++) for (const [dx, dz] of [[2, 0], [3, 0], [2, 1], [3, 1]]) set(dx, dy - 1, dz, B.skywood_log);
    for (let dy = -4; dy <= 4; dy++) for (let dz = -6; dz <= 7; dz++) for (let dx = -4; dx <= 9; dx++) { const d = (dx - 2.5) ** 2 + (dy * 1.5) ** 2 + (dz - 0.5) ** 2; if (d < 36 && Math.random() < 0.92) set(dx, 14 + dy, dz, B.sky_leaves); }
    for (let k = 0; k < 24; k++) { const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 7, fx = Math.round(Math.cos(a) * r), fz = Math.round(Math.sin(a) * r), sy = this.world.surface(x + fx, z + fz); if (this.world.get(x + fx, sy + 1, z + fz) === 0) this.world.set(x + fx, sy + 1, z + fz, B.starlight_flower); }
    this.showBeam(x, y, z, 30);
    this.net.ended?.();
    this.save();
    this.onEnding?.();
  }
  /** an ancient vault gives the Starstone of its land, once */
  private openVault(x: number, y: number, z: number) {
    const biome = BIOMES[this.world.gen.column(x, z).biome].key;
    const byBiome: Record<string, string> = { volcanic: 'starstone_ember', tundra: 'starstone_frost', jungle: 'starstone_verdant', ocean: 'starstone_tide', beach: 'starstone_tide' };
    let item = byBiome[biome] ?? STARSTONES.find(s => this.inv.count(s) === 0) ?? 'starstone_tide';
    this.world.set(x, y, z, B.chest);
    if (this.inv.count(item) > 0) { this.give('crystal_shard', 3); this.give('gold_nugget', 4); this.toast(t('quest.vaultHave')); }
    else { this.give(item, 1); this.toast(t('quest.found', { item: nm(ITEM[item]) }), 'good'); }
    this.spray(new THREE.Vector3(x + 0.5, y + 1, z + 0.5), [1, 0.85, 0.4], 30); sound.play('discover');
    this.compassT = 0;
  }
  /** the host keeps the story moving: bells rung, the Colossus wakes */
  private questTick(dt: number) {
    const q = this.data.quest!;
    this.compassT -= dt;
    if (this.compassT <= 0) { this.compassT = 2; this.updateCompass(); }
    if (this.isGuest || this.dim !== 'sky') return;
    this.questT -= dt; if (this.questT > 0) return; this.questT = 1.5;
    for (let i = 0; i < SKY_BELLS.length; i++) {
      if (q.bells.includes(i)) continue;
      const [bx, by, bz] = this.world.gen.bellPos(i);
      if (this.world.get(bx, by, bz) === B.sky_bell_rung || this.world.edits.get(`${Math.floor(bx / CS)},${Math.floor(bz / CS)}`)?.get((bx - Math.floor(bx / CS) * CS) + (bz - Math.floor(bz / CS) * CS) * CS + by * CS * CS) === B.sky_bell_rung) {
        q.bells.push(i); this.toast(t('quest.bells', { n: q.bells.length }), 'good'); this.net.toastAll?.('quest.bells', { n: q.bells.length });
      }
    }
    const P = this.player.pos;
    if (q.bells.length >= 4 && !q.colossus && !this.animals.bossAlive() && Math.hypot(P.x, P.z) < 60 && !this.waking) {
      this.waking = true;
      this.toast(t('quest.colossusWakes'), 'bad'); this.net.toastAll?.('quest.colossusWakes');
      sound.play('thunder', { vol: 1 }); this.shake = 0.8;
      this.animals.spawn('colossus', 0.5, SKY_TOP + 1, -6).then(() => { this.waking = false; });
    }
  }
  private waking = false;
  private updateCompass() {
    this.compass = null;
    if (!this.inv.slots.some(s => s?.k === 'star_compass')) return;
    const q = this.data.quest!, P = this.player.pos;
    if (this.dim === 'sky') {
      const left = SKY_BELLS.map((_, i) => i).filter(i => !q.bells.includes(i));
      if (left.length) {
        const pts = left.map(i => this.world.gen.bellPos(i)).sort((a, b) => Math.hypot(a[0] - P.x, a[2] - P.z) - Math.hypot(b[0] - P.x, b[2] - P.z));
        this.compass = { x: pts[0][0], z: pts[0][2], label: t('quest.cBell'), dist: Math.hypot(pts[0][0] - P.x, pts[0][2] - P.z) };
      } else if (!q.colossus) this.compass = { x: 0, z: 0, label: t('quest.cArena'), dist: Math.hypot(P.x, P.z) };
      else this.compass = { x: SKY_ALTAR[0], z: SKY_ALTAR[2], label: t('quest.cAltar'), dist: Math.hypot(SKY_ALTAR[0] - P.x, SKY_ALTAR[2] - P.z) };
      return;
    }
    if (q.beacon && (q.colossus || this.inv.count('world_seed'))) { this.compass = { x: q.beacon[0], z: q.beacon[2], label: t('quest.cBeacon'), dist: Math.hypot(q.beacon[0] - P.x, q.beacon[2] - P.z) }; return; }
    const need = new Set(STARSTONES.filter(s => this.inv.count(s) === 0));
    if (q.beacon || !need.size) return;
    const v = nearestVault(this.world.gen, P.x, P.z, need);
    if (v) this.compass = { x: v.x, z: v.z, label: nm(ITEM[v.item]), dist: v.d };
  }
  /** what to do next, for the HUD */
  questProgress() { return progress(this.data.quest!, k => this.inv.count(k) > 0); }
  /** admin: build a structure in front of you */
  spawnStructure(kind: string) {
    const make = BUILDERS[kind]; if (!make) return false;
    const shape = make(mulberry32(Math.floor(Math.random() * 1e9))), rot = Math.floor(Math.random() * 4);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize();
    const odd = rot & 1, rw = odd ? shape.d : shape.w, rd = odd ? shape.w : shape.d;
    const cx = Math.floor(this.player.pos.x + dir.x * (Math.max(rw, rd) / 2 + 4)), cz = Math.floor(this.player.pos.z + dir.z * (Math.max(rw, rd) / 2 + 4));
    const x0 = cx - (rw >> 1), z0 = cz - (rd >> 1), y0 = this.world.surface(cx, cz) + 1;
    for (let rz = 0; rz < rd; rz++) for (let rx = 0; rx < rw; rx++) for (let y = y0 - 1; y > y0 - 8; y--) { const id = this.world.get(x0 + rx, y, z0 + rz); if (id > 0 && BLOCKS[id].solid !== false) break; this.world.set(x0 + rx, y, z0 + rz, shape.found); }
    for (const c of shape.cells) { const [rx, rz] = rotate(c, shape.w, shape.d, rot); this.world.set(x0 + rx, y0 + c[1], z0 + rz, c[3]); }
    return true;
  }

  // ---------------- doors, beds, chests, furnaces ----------------
  private toggleDoor(x: number, y: number, z: number) {
    const isDoor = (id: number) => id === B.wooden_door || id === B.wooden_door_open;
    const opening = this.world.get(x, y, z) === B.wooden_door, to = opening ? B.wooden_door_open : B.wooden_door;
    const y0 = isDoor(this.world.get(x, y - 1, z)) ? y - 1 : y;
    if (!opening) {   // don't shut a door on someone
      const p = this.player.pos; if (Math.floor(p.x) === x && Math.floor(p.z) === z && p.y < y0 + 2 && p.y + 1.8 > y0) return;
    }
    for (const yy of [y0, y0 + 1]) if (isDoor(this.world.get(x, yy, z))) this.world.set(x, yy, z, to);
    sound.play(opening ? 'door_open' : 'door_close', { pos: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), vol: 0.7 });
  }
  /** a bed sets where your next life starts; at night it skips to morning */
  private sleep(x: number, y: number, z: number) {
    const had = this.bed && this.bed[0] === x && this.bed[1] === y && this.bed[2] === z;
    this.bed = [x, y, z];
    if (!had) this.toast(t('bed.spawnSet'), 'good');
    if (this.sunLevel > 0.35) { if (had) this.toast(t('bed.day')); return; }
    if (this.animals.monstersNear(this.player.pos, 12)) { this.toast(t('bed.monsters'), 'bad'); return; }
    if (this.isGuest) { this.net.sleep?.(); this.toast(t('bed.asked')); return; }
    this.skipNight();
  }
  skipNight() {
    const day = Math.floor(this.time / DAY); let to = day * DAY + DAY * 0.27; if (to <= this.time) to += DAY;
    this.time = to; this.day = Math.floor(this.time / DAY) + 1; this.sleepFade = 1.6;
    this.player.stats.stamina = 100; this.onSlept?.(); this.toast(t('bed.morning'), 'good'); this.onChange();
  }
  onSlept?: () => void;
  onOpenContainer?: (key: string) => void;
  openContainer(x: number, y: number, z: number, kind: 'chest' | 'furnace') {
    const k = posKey(x, y, z);
    if (!this.containers[k] || this.containers[k].kind !== kind) this.containers[k] = kind === 'chest' ? newChest() : newFurnace();
    sound.play(kind === 'chest' ? 'chest_open' : 'click', { vol: 0.6 });
    if (kind === 'chest') this.openLid(x, y, z);
    this.onOpenContainer?.(k);
  }
  // the lid of the chest you're looking into swings open, and shuts when you're done
  private lid: { g: THREE.Group; pivot: THREE.Group; t: number; open: boolean; axis: 'x' | 'z'; sign: number } | null = null;
  private openLid(x: number, y: number, z: number) {
    this.closeLid(true);
    const id = this.world.get(x, y, z); if (id <= 0) return;
    const tex = (tile: number) => { const tx = new THREE.CanvasTexture(this.atlas.canvasFor(tile)); tx.magFilter = THREE.NearestFilter; tx.colorSpace = THREE.SRGBColorSpace; return tx; };
    const six = tiles6(id), mats = six.map(tile => new THREE.MeshLambertMaterial({ map: tex(tile) }));
    // hinge on the far side from you, so it opens towards you
    const dx = x + 0.5 - this.player.pos.x, dz = z + 0.5 - this.player.pos.z, alongZ = Math.abs(dz) >= Math.abs(dx), sign = alongZ ? Math.sign(dz) || 1 : Math.sign(dx) || 1;
    const g = new THREE.Group(), pivot = new THREE.Group(); g.position.set(x + 0.5, y + 0.68, z + 0.5);
    const geo = new THREE.BoxGeometry(1.03, 0.34, 1.03);
    if (alongZ) { geo.translate(0, 0.17, -sign * 0.515); pivot.position.z = sign * 0.515; } else { geo.translate(-sign * 0.515, 0.17, 0); pivot.position.x = sign * 0.515; }
    pivot.add(new THREE.Mesh(geo, mats)); g.add(pivot);
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ color: '#1a120a' })); inside.rotation.x = -Math.PI / 2; inside.position.y = 0.335; g.add(inside);
    this.scene.add(g);
    this.lid = { g, pivot, t: 0, open: true, axis: alongZ ? 'x' : 'z', sign };
  }
  closeLid(now = false) {
    if (!this.lid) return;
    if (now) { this.scene.remove(this.lid.g); this.lid = null; return; }
    if (this.lid.open) { this.lid.open = false; sound.play('chest_close', { vol: 0.5 }); }
  }
  private lidTick(dt: number) {
    const l = this.lid; if (!l) return;
    l.t = Math.max(0, Math.min(1, l.t + (l.open ? dt * 4 : -dt * 5)));
    const a = (1 - (1 - l.t) ** 3) * 1.25;
    if (l.axis === 'x') l.pivot.rotation.x = l.sign * a; else l.pivot.rotation.z = -l.sign * a;
    if (!l.open && l.t <= 0) this.closeLid(true);
  }
  /** the UI changed a container: share it */
  containerChanged(k: string) { this.net.cont?.(k, this.containers[k] ?? null); }
  setContainer(k: string, c: Container | null) { if (c) this.containers[k] = c; else delete this.containers[k]; this.onContainer?.(k); }
  private furnaceTick(dt: number) {
    this.furnT -= dt; this.contSendT -= dt;
    if (this.furnT <= 0) {
      this.furnT = 0.5;
      for (const [k, c] of Object.entries(this.containers)) if (c.kind === 'furnace' && tickFurnace(c, 0.5)) { this.dirtyCont.add(k); this.onContainer?.(k); }
    }
    if (this.contSendT <= 0) { this.contSendT = 1; for (const k of this.dirtyCont) this.net.cont?.(k, this.containers[k] ?? null); this.dirtyCont.clear(); }
  }
  setCrop(k: string, at: number | null) { if (at == null) delete this.crops[k]; else this.crops[k] = at; }
  private cropTick(dt: number) {
    this.cropT -= dt; if (this.cropT > 0) return; this.cropT = 2;
    for (const [k, t0] of Object.entries(this.crops)) {
      const [x, y, z] = k.split(',').map(Number), cur = this.world.get(x, y, z);
      if (cur < 0) continue;                                         // not loaded: grows when you come back
      const fam = CROP_FAMILY[cur]; if (!fam) { delete this.crops[k]; continue; }
      const stage = Math.min(2, Math.floor((this.time - t0) / CROP_STAGE)), want = B[`${fam}_crop_${stage}`];
      if (want !== cur && stage > +BLOCKS[cur].key.slice(-1)) this.world.set(x, y, z, want);
      if (stage >= 2) delete this.crops[k];
    }
  }

  // ---------------- combat ----------------
  /** start drawing the bow: hold to pull it back further (on a phone, a tap shoots at once) */
  private startDraw(dir: THREE.Vector3) {
    if (this.bowCd > 0 || this.bowCharge >= 0) return;
    if (this.inv.count('arrow') < 1) { this.toast(t('combat.noArrows'), 'bad'); return; }
    if (this.input.touch) { this.shootBow(dir, 0.75); return; }
    this.bowCharge = 0; sound.play('bow', { vol: 0.35, pitch: 0.7 });
  }
  private bowTick(dt: number) {
    if (this.bowCharge < 0) return;
    if (this.inv.held()?.k !== 'bow' || this.player.downed > 0 || this.paused) { this.bowCharge = -1; return; }
    if (this.input.secondary) { this.bowCharge = Math.min(1, this.bowCharge + dt * 1.1); return; }
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.shootBow(dir, 0.2 + this.bowCharge * 0.8); this.bowCharge = -1;
  }
  private shootBow(dir: THREE.Vector3, power: number) {
    if (this.inv.count('arrow') < 1) return;
    this.inv.remove('arrow', 1); this.bowCd = 0.3; this.swing = 0.7; this.startAct('release', 0.3);
    const from = this.camera.position.clone().addScaledVector(dir, 0.6), vel = dir.clone().multiplyScalar(12 + 26 * power);
    this.projectiles.fire(from, vel, 'me', ((ITEM.bow.tool?.damage ?? 6) + 2) * (0.35 + 0.65 * power)); this.net.arrow?.(from, vel);
    sound.play('bow', { vol: 0.5 + power * 0.4, pitch: 0.9 + power * 0.3 }); this.inv.wear(1);
  }
  bowCharge = -1;
  /** something hit you: a shield in your off hand stops some of a hit from the front (all of it while crouching) */
  hurtBy(dmg: number, from: THREE.Vector3, arrow: boolean) {
    const p = this.player; if (p.downed > 0 || p.dead) return;
    const off = this.inv.offhand, sh = off && ITEM[off.k]?.shield;
    if (off && sh) {
      const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize();
      const to = from.clone().sub(p.pos).setY(0).normalize();
      if (look.dot(to) > 0.25) {
        dmg *= 1 - (p.crouching ? 1 : sh.block);
        sound.play('shield', { vol: 0.7 }); this.shieldBump = 0.3;
        this.spray(p.pos.clone().addScaledVector(to, 0.7).setY(p.pos.y + 1.2), [0.85, 0.85, 0.85], 6);
        off.d = (off.d ?? 0) + 1; if (off.d >= sh.durability) { this.inv.offhand = null; this.toast(t('combat.shieldBroke'), 'bad'); }
        this.onChange();
        if (dmg < 0.3) return;
      }
    }
    const away = p.pos.clone().sub(from).setY(0); if (away.lengthSq() > 0.0001) away.normalize();
    const k = arrow ? 3 : 6.5; p.vel.x += away.x * k; p.vel.z += away.z * k; if (p.onGround) p.vel.y = Math.max(p.vel.y, 4.5);
    p.hurt(dmg, 'animal', this.inv.armorValue());
  }
  shieldBump = 0;
  /** tame, saddle, ride or shear the creature you're looking at */
  private useOnBeast(b: Beast, held: Stack | null) {
    if (held && b.def.tame === held.k && !b.owner) {
      this.inv.takeOne(this.inv.sel);
      if (Math.random() < (b.def.tameTo ? 0.35 : 0.5)) {
        if (this.isGuest) this.net.tame?.(b.id); else this.animals.tame(b, this.profileId);
        this.toast(t('pet.tamed', { name: nm(b.def.tameTo ? { en: 'Dog', pt: 'Cão' } as any : b.def) }), 'good'); sound.play('discover', { vol: 0.6 });
      } else { this.spray(b.pos.clone().setY(b.pos.y + b.height), [0.5, 0.5, 0.5], 6); this.toast(t('pet.notYet')); }
      return true;
    }
    if (held?.k === 'saddle' && b.def.rideable && !b.saddled) {
      this.inv.takeOne(this.inv.sel);
      if (this.isGuest) this.net.saddle?.(b.id); else this.animals.saddle(b);
      b.saddled = true; this.toast(t('ride.saddled'), 'good'); sound.play('chest_close');
      return true;
    }
    if (b.saddled) { this.mount(b); return true; }
    if (b.def.rideable && !b.saddled) { this.toast(t('ride.needSaddle')); return true; }
    if (held?.k === 'shears' && b.def.key === 'sheep' && !(b as any).sheared) {
      (b as any).sheared = true; this.give('wool', 1 + Math.floor(Math.random() * 3)); this.inv.wear(1); sound.play('chop', { vol: 0.5 });
      return true;
    }
    return false;
  }
  // ---------------- boats ----------------
  private board(b: Boat) {
    this.dismount(); this.boating = b; b.rider = this.profileId; this.player.crouching = true;
    this.toast(this.input.touch ? t('boat.hintTouch') : t('boat.hint'));
  }
  leaveBoat() {
    const b = this.boating; if (!b) return;
    this.boating = null; b.rider = null; b.speed = 0; this.player.crouching = false;
    // step onto the nearest dry ground, or just out beside the boat
    let best: THREE.Vector3 | null = null, bd = 99;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const x = Math.floor(b.pos.x) + dx, z = Math.floor(b.pos.z) + dz, y = this.world.surface(x, z), id = this.world.get(x, y, z), d = Math.hypot(dx, dz);
      if (id > 0 && id !== B.water && BLOCKS[id].solid !== false && Math.abs(y - b.pos.y) < 3 && d < bd) { bd = d; best = new THREE.Vector3(x + 0.5, y + 1.05, z + 0.5); }
    }
    this.player.pos.copy(best ?? b.pos.clone().add(new THREE.Vector3(Math.cos(b.yaw) * 1.3, 0.6, -Math.sin(b.yaw) * 1.3)));
    this.player.vel.set(0, 0, 0); (this.player as any).fallStart = this.player.pos.y;
    this.net.boat?.('move', b);
  }
  private boatTick(dt: number) {
    const b = this.boating!, p = this.player, inp = this.input;
    if (!this.boats.list.includes(b) || p.downed > 0) { this.leaveBoat(); return; }
    p.turn(inp, settings.sensitivity, settings.invertY);
    if (inp.crouch && !this.input.touch) { this.leaveBoat(); return; }
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    const dir = new THREE.Vector3(inp.move.x * c + inp.move.z * s, 0, -inp.move.x * s + inp.move.z * c);
    if (dir.lengthSq() > 0.01) dir.normalize();
    this.boats.steer(b, dir, inp.sprint, dt);
    p.pos.set(b.pos.x, b.pos.y + 0.12, b.pos.z); p.vel.set(0, 0, 0); p.onGround = true; p.crouching = true; (p as any).fallStart = p.pos.y;
    if (Math.abs(b.speed) > 0.5 && Math.random() < dt * 6) this.spray(b.pos.clone().add(new THREE.Vector3(Math.sin(b.yaw) * 1.1, 0.1, Math.cos(b.yaw) * 1.1)), [0.8, 0.9, 1], 2);
    this.boatSendT -= dt; if (this.boatSendT <= 0) { this.boatSendT = 0.1; this.net.boat?.('move', b); }
  }

  private mount(b: Beast) {
    this.riding = b; b.localRide = this.isGuest; b.state = 'idle';
    this.toast(this.input.touch ? t('ride.hintTouch') : t('ride.hint'));
  }
  dismount() {
    const b = this.riding; if (!b) return;
    this.riding = null; b.localRide = false;
    const side = new THREE.Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
    this.player.pos.set(b.pos.x + side.x * 1.2, b.pos.y + 0.3, b.pos.z + side.z * 1.2); this.player.vel.set(0, 0, 0);
    (this.player as any).fallStart = this.player.pos.y;
  }
  private rideTick(dt: number) {
    const b = this.riding!, p = this.player, inp = this.input;
    if (!this.animals.list.includes(b) || b.state === 'dead' || p.downed > 0) { this.dismount(); return; }
    p.turn(inp, settings.sensitivity, settings.invertY);
    if (inp.crouch) { this.dismount(); return; }
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    const dir = new THREE.Vector3(inp.move.x * c + inp.move.z * s, 0, -inp.move.x * s + inp.move.z * c);
    if (dir.lengthSq() > 0.01) dir.normalize();
    this.animals.drive(b, dir, inp.sprint ? b.def.run : b.def.speed * 2.6, dt);
    p.pos.set(b.pos.x, b.pos.y + b.height * 0.62, b.pos.z); p.vel.set(0, 0, 0); p.onGround = true;
    (p as any).fallStart = p.pos.y;
    if (this.isGuest) this.net.ride?.(b);
  }
  onOpenStation?: (s: string) => void;
  private fuses: { x: number; y: number; z: number; t: number }[] = [];

  // ---------------- blueprints ----------------
  ghost: { bp: Blueprint; g: Ghost; rot: number; o: [number, number, number] | null } | null = null;
  site: { bp: Blueprint; name: string; cells: ReturnType<typeof place>; i: number; t: number; missing: string[]; done: number; total: number; at: THREE.Vector3 } | null = null;
  selecting: { a: THREE.Vector3 | null; name: string } | null = null;
  onCaptured?: (r: Blueprint | 'big' | 'empty') => void;
  startGhost(bp: Blueprint) { this.cancelGhost(); this.ghost = { bp, g: new Ghost(bp, this.scene), rot: 0, o: null }; }
  cancelGhost() { if (this.ghost) { this.ghost.g.dispose(this.scene); this.ghost = null; } }
  startSelecting(name: string) { this.cancelGhost(); this.selecting = { a: null, name }; }
  private ghostTick(hit: any, dir: THREE.Vector3) {
    const gh = this.ghost!, inp = this.input;
    if (inp.hit('rotate')) gh.rot = (gh.rot + 1) & 3;
    let o: [number, number, number] | null = null;
    if (hit) {
      const odd = gh.rot & 1, w = odd ? gh.bp.d : gh.bp.w, d = odd ? gh.bp.w : gh.bp.d;
      // centre the plan on where you look, a little in front of you
      o = [hit.x + hit.nx - (w >> 1) + Math.round(dir.x * (d / 2)), hit.y + hit.ny, hit.z + hit.nz - (d >> 1) + Math.round(dir.z * (d / 2))];
    }
    gh.o = o;
    gh.g.mesh.visible = !!o;
    if (o) gh.g.update(o[0], o[1], o[2], gh.rot, true);
    if (o && (inp.hit('attack') || inp.hit('use'))) {
      const cells = place(gh.bp, o[0], o[1], o[2], gh.rot).filter(c => c.id >= 0);
      // build from the bottom up, clearing space first in each layer
      cells.sort((a, b) => a.y - b.y || (a.id === 0 ? -1 : 0) - (b.id === 0 ? -1 : 0));
      const name = gh.bp.nameKey ? t(gh.bp.nameKey as any) : gh.bp.name;
      this.site = { bp: gh.bp, name, cells, i: 0, t: 0, missing: [], done: 0, total: cells.filter(c => c.id > 0).length, at: new THREE.Vector3(o[0], o[1], o[2]) };
      this.cancelGhost();
      this.toast(t('bp.stayNear'));
      inp.primary = false;
    }
  }
  private siteTick(dt: number) {
    const s = this.site!;
    if (s.at.distanceTo(this.player.pos) > 40) return;
    s.t -= dt;
    while (s.t <= 0 && this.site) {
      if (s.i >= s.cells.length) { this.toast(t('bp.done', { name: s.name }), 'good'); sound.play('discover'); this.site = null; return; }
      const c = s.cells[s.i], cur = this.world.get(c.x, c.y, c.z);
      if (cur < 0) { s.t = 0.5; return; }                                   // not loaded yet
      if (c.id === 0) { if (cur !== 0 && BLOCKS[cur].hard >= 0 && cur !== B.grave) this.world.set(c.x, c.y, c.z, 0); s.i++; continue; }
      if (cur === c.id) { s.i++; s.done++; continue; }
      if (this.inv.count(c.key) > 0) {
        this.inv.remove(c.key, 1); this.world.set(c.x, c.y, c.z, c.id); s.i++; s.done++; s.missing = [];
        s.t += 0.06; if (Math.random() < 0.3) sound.play('place', { pos: new THREE.Vector3(c.x, c.y, c.z), vol: 0.4 });
      } else {
        // count what's still needed from here on
        const left = new Map<string, number>();
        for (let k = s.i; k < s.cells.length; k++) { const q = s.cells[k]; if (q.id > 0 && this.world.get(q.x, q.y, q.z) !== q.id) left.set(q.key, (left.get(q.key) ?? 0) + 1); }
        s.missing = [...left].map(([k, n]) => `${Math.max(0, n - this.inv.count(k))}× ${nm(ITEM[k])}`).filter(x => !x.startsWith('0×'));
        s.t = 1; return;
      }
    }
  }
  siteStatus() {
    if (this.selecting) return t('bp.cornerHint') + ` (${this.selecting.a ? 2 : 1}/2)`;
    if (this.ghost) return this.input.touch ? t('bp.touchHint') : t('bp.rotateHint');
    if (!this.site) return '';
    const s = this.site;
    return t('bp.building', { name: s.name, done: s.done, total: s.total }) + (s.missing.length ? ' · ' + t('bp.waiting', { list: s.missing.slice(0, 4).join(', ') }) : '');
  }
  planNeeds(bp: Blueprint) { return needs(bp).map(([k, n]) => ({ k, n, have: this.inv.count(k) })); }
  ignite(x: number, y: number, z: number) { if (!this.fuses.some(f => f.x === x && f.y === y && f.z === z)) { this.fuses.push({ x, y, z, t: 2.5 }); sound.play('fire', { pos: new THREE.Vector3(x, y, z) }); } }
  private tickFuses(dt: number) {
    for (const f of [...this.fuses]) {
      f.t -= dt;
      if (Math.random() < dt * 20) this.spray(new THREE.Vector3(f.x + 0.5, f.y + 1, f.z + 0.5), [1, 0.7, 0.2], 1);
      if (f.t > 0) continue;
      this.fuses = this.fuses.filter(q => q !== f);
      this.explode(f.x + 0.5, f.y + 0.5, f.z + 0.5, 3.2);
    }
  }
  /** blow a round hole; chain-reacts other explosives and hurts you if you're close */
  explode(cx: number, cy: number, cz: number, r: number) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy, z = Math.floor(cz) + dz, id = this.world.get(x, y, z);
      if (id <= 0 || BLOCKS[id].hard < 0 || id === B.reinforced_concrete || id === B.blast_door) continue;
      if ((id === B.tnt || EXTRA[id]?.explosive) && !(dx === 0 && dy === 0 && dz === 0)) { this.ignite(x, y, z); continue; }
      this.world.set(x, y, z, 0);
    }
    this.spray(new THREE.Vector3(cx, cy, cz), [0.4, 0.4, 0.4], 40); this.spray(new THREE.Vector3(cx, cy, cz), [1, 0.6, 0.1], 30);
    sound.play('thunder', { pos: new THREE.Vector3(cx, cy, cz), range: 80 }); this.shake = 0.6;
    const d = this.player.pos.distanceTo(new THREE.Vector3(cx, cy, cz));
    if (d < r * 2.2) this.player.hurt((r * 2.2 - d) * 14, 'fire', this.inv.armorValue());
    for (const b of this.animals.list) { const bd = b.pos.distanceTo(new THREE.Vector3(cx, cy, cz)); if (bd < r * 2) this.animals.damage(b, (r * 2 - bd) * 20, new THREE.Vector3(cx, cy, cz)); }
  }
  /** an old chest in a ruin or village: its loot is yours the first time it's opened */
  openLoot(x: number, y: number, z: number) {
    const items = lootFor(x, y, z, this.world.gen.column(x, z).biome, this.world.seed);
    this.world.set(x, y, z, B.chest);
    for (const [k, n] of items) this.give(k, n);
    this.toast(items.map(([k, n]) => `+${n} ${nm(ITEM[k])}`).join(', '), 'good');
    sound.play('discover');
  }
  private placeAt(hit: any, id: number) {
    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    const cur = this.world.get(x, y, z);
    if (cur < 0 || (cur > 0 && BLOCKS[cur].solid !== false && BLOCKS[cur].render !== 'liquid')) return false;
    // don't build inside yourself
    const p = this.player.pos;
    if (BLOCKS[id].solid !== false && x + 1 > p.x - 0.3 && x < p.x + 0.3 && z + 1 > p.z - 0.3 && z < p.z + 0.3 && y + 1 > p.y && y < p.y + 1.8) return false;
    if (BLOCKS[id].render === 'cross' && BLOCKS[this.world.get(x, y - 1, z)]?.solid === false) return false;
    return this.world.set(x, y, z, id);
  }
  private breakBlock(x: number, y: number, z: number, id: number, held: any) {
    const bd = BLOCKS[id];
    this.world.set(x, y, z, 0);
    this.breaking = null;
    // what was inside spills out
    const ck = posKey(x, y, z), cont = this.containers[ck];
    if (cont) { for (const st of contents(cont)) this.dropItem(st.k, st.n, new THREE.Vector3(x + 0.5, y + 0.6, z + 0.5), false); delete this.containers[ck]; this.net.cont?.(ck, null); }
    if (this.crops[ck] != null) { delete this.crops[ck]; this.net.crop?.(ck, null); }
    if (id === B.sky_beacon && this.dim === 'earth') this.data.quest!.beacon = null;
    // the other half of a door goes too
    if (id === B.wooden_door || id === B.wooden_door_open) for (const dy of [-1, 1]) { const o = this.world.get(x, y + dy, z); if (o === B.wooden_door || o === B.wooden_door_open) this.world.set(x, y + dy, z, 0); }
    const tool = held?.tool;
    const tierOk = !bd.tier || (tool && tool.type === bd.tool && tool.tier >= bd.tier);
    const needsTool = bd.tool === 'pickaxe' && (!tool || tool.type !== 'pickaxe');
    if (tierOk && !needsTool) {
      const drop = bd.drop === undefined ? bd.key : bd.drop;
      if (drop) this.give(drop, 1);
      if (bd.key.endsWith('_leaves') && Math.random() < 0.08) this.give(bd.key === 'oak_leaves' ? 'apple' : 'stick', 1);
      if (bd.key === 'tall_grass' && Math.random() < 0.15) this.give('seeds', 1);
      if (bd.key === 'gravel' && Math.random() < 0.5) this.give('gravel', 1);
      if (bd.key === 'wheat_crop_2') { this.give('wheat_item', Math.random() < 0.5 ? 1 : 0); this.give('seeds', 1 + Math.floor(Math.random() * 2)); }
      if (bd.key === 'carrot_crop_2' || bd.key === 'potato_crop_2') this.give(bd.drop!, 1 + Math.floor(Math.random() * 3));
      if (bd.key === 'pumpkin' && Math.random() < 0.3) this.give('seeds', 1);
    } else if (bd.tool === 'pickaxe') this.toast(t('hud.need'));
    if (held?.tool) this.inv.wear(1);
    if (tierOk && !needsTool) runHooks('blockBreak', this, { x, y, z, key: bd.key, tool: held?.key ?? null });
    this.spray(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), this.blockColor(id), 14);
    sound.play(bd.tool === 'axe' ? 'wood_break' : 'break', { vol: 0.6 });
    // things standing on it fall (plants, torches)
    const above = this.world.get(x, y + 1, z);
    if (above > 0 && BLOCKS[above].render === 'cross') this.breakBlock(x, y + 1, z, above, null);
    // trees: a felled trunk brings its logs down with it (a bit more realistic than floating trees)
    if (bd.key.endsWith('_log')) for (let k = 1; k < 16; k++) { const up = this.world.get(x, y + k, z); if (up !== id) break; this.world.set(x, y + k, z, 0); this.give(bd.key, 1); }
  }
  give(k: string, n: number) {
    const left = this.inv.add(k, n);
    if (left > 0) { this.dropItem(k, left, this.player.pos.clone().setY(this.player.pos.y + 1), false); this.toast(t('hud.full')); }
    else sound.play('pickup', { vol: 0.4 });
  }
  consume(slot: number) {
    const s = this.inv.slots[slot]; if (!s) return;
    const d = ITEM[s.k]; if (!d?.food) return;
    const f = d.food, st = this.player.stats;
    st.hunger = Math.min(100, st.hunger + (f.hunger ?? 0)); st.thirst = Math.max(0, Math.min(100, st.thirst + (f.thirst ?? 0)));
    st.health = Math.min(100, st.health + (f.health ?? 0));
    if (f.warm) st.temp = Math.min(38, st.temp + f.warm * 0.15);
    if (f.sick && Math.random() < f.sick) { st.sick = Math.min(1, st.sick + 0.45); this.toast(t('hud.gotSick'), 'bad'); }
    if (f.cure) { const was = st.sick; st.sick = Math.max(0, st.sick - f.cure); if (was > 0.05 && st.sick < 0.05) this.toast(t('hud.cured'), 'good'); }
    this.inv.takeOne(slot); this.startAct('eat', 0.75);
    if (d.kind === 'drink' || (d.kind === 'medicine' && d.icon === 'bottle')) { this.give('empty_bottle', 1); this.toast(t('hud.drank', { item: nm(d) })); sound.play('drink'); }
    else { this.toast(t('hud.ate', { item: nm(d) })); sound.play('eat'); }
  }
  private drinkRaw() {
    const st = this.player.stats;
    st.thirst = Math.min(100, st.thirst + 15);
    const salty = BIOMES[this.biome]?.key === 'ocean' || BIOMES[this.biome]?.key === 'beach';
    if (salty) st.thirst = Math.max(0, st.thirst - 20);
    if (Math.random() < 0.22) { st.sick = Math.min(1, st.sick + 0.35); this.toast(t('hud.gotSick'), 'bad'); } else this.toast(t('hud.drinkWater'));
    sound.play('drink'); this.onChange();
  }

  // ======================= environment =======================
  private sampleEnvironment() {
    const p = this.player.pos, col = this.world.gen.column(Math.floor(p.x), Math.floor(p.z));
    this.biome = col.biome;
    const b = BIOMES[col.biome];
    // fires and heat near you
    let fire = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      const id = this.world.get(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz);
      if (id === B.campfire || id === B.fire || id === B.lava || id === B.furnace) fire = Math.max(fire, 1 - Math.hypot(dx, dz) / 6);
    }
    this.nearFire = fire;
    // stations within reach
    this.stations = new Set(['hand']);
    for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const id = this.world.get(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz);
      if (id > 0 && BLOCKS[id].station) this.stations.add(BLOCKS[id].station!);
    }
    const night = 1 - this.sunLevel;
    const altitude = Math.max(0, p.y - SEA - 30) * 0.12;
    const wet = this.player.inWater ? 8 : 0, rain = this.weather === 'clear' ? 0 : b.weather === 'snow' ? 6 : b.weather === 'rain' ? 3 : 0;
    this.ambient = b.temp - night * (b.key === 'desert' ? 22 : 9) - altitude - wet - rain + fire * 26;
  }
  private sky(dt: number) {
    const f = (this.time % DAY) / DAY;                       // 0 midnight, .5 noon
    const sunH = Math.sin((f - 0.25) * Math.PI * 2);         // −1..1
    this.sunLevel = THREE.MathUtils.clamp(sunH * 1.8 + 0.35, 0.06, 1) * (this.weather === 'clear' ? 1 : this.weather === 'rain' ? 0.75 : 0.55);
    const s = this.sunLevel;
    const sky = this.dim === 'sky';
    const day = new THREE.Color(sky ? '#a8b8ff' : '#87b8e8'), dusk = new THREE.Color(sky ? '#ffb0d8' : '#e8a070'), night = new THREE.Color(sky ? '#1a1240' : '#0b1222');
    if (this.data.quest?.ended && !sky) night.lerp(new THREE.Color(Math.sin(this.time * 0.05) > 0 ? '#0e3a3a' : '#2a1448'), 0.6 + Math.sin(this.time * 0.3) * 0.2);
    const col = night.clone().lerp(sunH > -0.05 && sunH < 0.25 ? dusk : day, Math.min(1, s * 1.1));
    if (this.weather !== 'clear') col.lerp(new THREE.Color('#6f7a86'), 0.5);
    if (!this.underwater) { (this.world.uniforms.uFogColor.value as THREE.Color).copy(col); this.scene.background = col; }
    else this.scene.background = new THREE.Color('#1d4a78');
    this.world.uniforms.uSun.value = s;
    (this.world.uniforms.uSunColor.value as THREE.Color).setRGB(1, 0.92 + 0.08 * s, 0.85 + 0.15 * s);
    this.hemi.intensity = 0.25 + s * 1.4; this.sun.intensity = s * 1.8;
    this.world.uniforms.uWind.value = !settings.foliage ? 0 : this.weather === 'storm' ? 2.4 : this.weather === 'rain' ? 1.5 : 1;
    if (this.clouds && this.cloudTex) {
      const c = this.camera.position, size = 1800 / 3;
      this.clouds.position.set(c.x, 192, c.z);
      this.cloudTex.offset.set((c.x + this.time * 1.6) / size, -(c.z + this.time * 0.6) / size);
      const m = this.clouds.material as THREE.MeshBasicMaterial;
      m.color.setRGB(0.25 + s * 0.8, 0.27 + s * 0.78, 0.32 + s * 0.72);
      if (this.weather !== 'clear') m.color.multiplyScalar(0.72);
      m.opacity = this.weather === 'clear' ? 0.8 : 0.95;
    }
    this.sun.position.set(Math.cos(f * Math.PI * 2) * 60, sunH * 80, 30);
    void dt;
  }
  private weatherTick(dt: number) {
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      const r = Math.random();
      this.weather = r < 0.6 ? 'clear' : r < 0.9 ? 'rain' : 'storm';
      this.weatherT = 120 + Math.random() * 300;
    }
    const kind = BIOMES[this.biome]?.weather;
    const on = this.weather !== 'clear' && kind !== 'dry';
    this.weatherFx.visible = on && settings.particles;
    if (!this.weatherFx.visible) return;
    const snow = kind === 'snow';
    const m = this.weatherFx.material as THREE.PointsMaterial;
    m.color.set(snow ? '#ffffff' : '#9ab8d8'); m.size = snow ? 0.14 : 0.07;
    const pos = this.weatherFx.geometry.getAttribute('position') as THREE.BufferAttribute, a = pos.array as Float32Array;
    const fall = (snow ? 2.5 : 18) * dt;
    for (let i = 0; i < a.length; i += 3) { a[i + 1] -= fall; if (snow) a[i] += Math.sin(this.time + i) * dt * 0.5; if (a[i + 1] < -5) { a[i + 1] = 25; a[i] = (Math.random() - 0.5) * 40; a[i + 2] = (Math.random() - 0.5) * 40; } }
    pos.needsUpdate = true;
    this.weatherFx.position.set(this.player.pos.x, this.player.pos.y - 3, this.player.pos.z);
    if (this.weather === 'storm' && Math.random() < dt * 0.04) { sound.play('thunder', { vol: 0.8 }); this.flash = 0.25; }
  }
  flash = 0;
  private ambienceTick() {
    const b = BIOMES[this.biome]?.key, night = this.sunLevel < 0.3, rain = this.weather !== 'clear' && BIOMES[this.biome]?.weather === 'rain';
    const nearSea = Math.abs(this.player.pos.y - SEA) < 12 && (b === 'beach' || b === 'ocean');
    sound.ambience({
      birds: !night && !rain && (b === 'forest' || b === 'jungle' || b === 'savanna') ? 0.5 : 0,
      night: night && b !== 'tundra' && b !== 'desert' ? 0.45 : 0,
      wind: b === 'tundra' || b === 'mountains' || b === 'desert' || this.weather === 'storm' ? 0.55 : 0.12,
      ocean: nearSea ? 0.6 : 0,
      rain: rain ? 0.7 : 0,
      fire: this.nearFire > 0.3 ? 0.5 * this.nearFire : 0,
    });
  }
  private explore() {
    const p = this.player.pos, R = Math.min(settings.render, 6) * CS;
    for (let z = -R; z <= R; z += 8) for (let x = -R; x <= R; x += 8) if (x * x + z * z <= R * R) this.explored.add(`${(Math.floor(p.x + x) >> 3)},${(Math.floor(p.z + z) >> 3)}`);
  }

  // ======================= death and graves =======================
  giveUp() { if (this.player.downed > 0) this.die(); }
  revive() { const p = this.player; if (p.downed <= 0) return; p.downed = 0; p.stats.health = 30; this.onChange(); }
  die() {
    const p = this.player;
    p.downed = 0; this.dismount(); this.leaveBoat(); this.data.quest!.deaths++;
    // leave everything in a grave only you can open
    const items = this.inv.all();
    const g: Grave | null = items.length ? this.placeGrave(p.pos, items) : null;
    this.inv.clear();
    p.dead = true;
    this.onDeath?.(g);
  }
  onDeath?: (g: Grave | null) => void;
  /** you come back as a different person somewhere else in the world */
  rebirth() {
    const p = this.player, r = Math.random;
    if (this.dim === 'sky') {
      p.pos.set(SKY_ALTAR[0] + 2.5, SKY_ALTAR[1] + 2, SKY_ALTAR[2] + 2.5); p.vel.set(0, 0, 0);
      p.stats = { health: 100, hunger: 80, thirst: 80, stamina: 100, temp: 37, sick: 0 };
      p.name = randomName(); this.look = Math.floor(r() * LOOKS.length); p.dead = false; this.ready = false;
      this.inv.add('stone_axe', 1); this.freshLife = true; this.onChange(); this.save();
      return p.name;
    }
    const bedOk = this.bed && (() => { const id = this.world.get(this.bed![0], this.bed![1], this.bed![2]); return id === B.bed || id < 0; })();
    if (bedOk) { p.pos.set(this.bed![0] + 0.5, this.bed![1] + 1.1, this.bed![2] + 0.5); }
    else {
      this.bed = null;
      const s = this.world.gen.findSpawn(Math.floor(p.pos.x + (r() - 0.5) * 3000), Math.floor(p.pos.z + (r() - 0.5) * 3000), r);
      p.pos.set(s.x, s.y + 2, s.z);
    }
    p.vel.set(0, 0, 0);
    p.stats = { health: 100, hunger: 80, thirst: 80, stamina: 100, temp: 37, sick: 0 };
    p.name = randomName(); this.look = Math.floor(r() * LOOKS.length);
    p.dead = false; this.ready = false;
    this.inv.add('stone_axe', 1); this.freshLife = true;
    this.onChange(); this.save();
    return p.name;
  }
  placeGrave(at: THREE.Vector3, items: Stack[]): Grave {
    let x = Math.floor(at.x), y = Math.max(1, Math.floor(at.y)), z = Math.floor(at.z);
    for (let k = 0; k < 6; k++) { const id = this.world.get(x, y, z); if (id === 0 || (id > 0 && BLOCKS[id].solid === false)) break; y++; }
    const g: Grave = { id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), x, y, z, owner: this.profileId, name: this.player.name, items, at: Date.now() };
    this.graves.push(g); this.world.set(x, y, z, B.grave);
    this.net.grave?.(g);
    this.save();
    return g;
  }
  openGrave(x: number, y: number, z: number) {
    const g = this.graves.find(q => q.x === x && q.y === y && q.z === z);
    if (!g) { this.world.set(x, y, z, 0); return; }
    if (g.owner !== this.profileId) { this.toast(t('hud.notYours'), 'bad'); return; }
    for (const s of g.items) { const left = this.inv.add(s.k, s.n); if (left) this.dropItem(s.k, left, new THREE.Vector3(x + 0.5, y + 1, z + 0.5), false); }
    this.removeGrave(g);
    sound.play('discover');
  }
  removeGrave(g: Grave) { this.graves = this.graves.filter(q => q !== g); if (this.world.get(g.x, g.y, g.z) === B.grave) this.world.set(g.x, g.y, g.z, 0); this.net.grave?.(null, g.id); }
  /** graves crumble after two real hours */
  expireGraves() { const now = Date.now(); for (const g of [...this.graves]) if (now - g.at > 2 * 3600 * 1000) this.removeGrave(g); }
  myGraves() { return this.graves.filter(g => g.owner === this.profileId); }

  // ======================= items on the ground =======================
  dropItem(k: string, n: number, at: THREE.Vector3, thrown: boolean) {
    const tex = new THREE.TextureLoader().load(itemIcon(k)); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex })); obj.scale.setScalar(0.4); obj.position.copy(at);
    const vel = thrown ? new THREE.Vector3(0, 2, -4).applyQuaternion(this.camera.quaternion) : new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2);
    this.scene.add(obj); this.drops.push({ k, n, pos: at.clone(), vel, obj, age: 0 });
  }
  private updateDrops(dt: number) {
    for (const d of [...this.drops]) {
      d.age += dt; d.vel.y -= 18 * dt;
      const next = d.pos.clone().addScaledVector(d.vel, dt);
      const id = this.world.get(Math.floor(next.x), Math.floor(next.y - 0.2), Math.floor(next.z));
      if (id > 0 && BLOCKS[id].solid !== false) { d.vel.set(0, 0, 0); next.y = Math.floor(next.y - 0.2) + 1.2; }
      d.pos.copy(next); d.obj.position.copy(d.pos); d.obj.position.y += Math.sin(d.age * 3) * 0.06;
      if (d.age > 1 && d.pos.distanceTo(this.player.pos.clone().setY(this.player.pos.y + 0.8)) < 1.6 && this.player.downed <= 0) {
        const left = this.inv.add(d.k, d.n);
        if (left < d.n) sound.play('pickup', { vol: 0.5 });
        d.n = left;
      }
      if (d.n <= 0 || d.age > 300) { this.scene.remove(d.obj); this.drops = this.drops.filter(q => q !== d); }
    }
  }

  // ======================= effects =======================
  private blockColor(id: number) { const c = new THREE.Color((BLOCKS[id].side ?? BLOCKS[id].top).c[0]); return [c.r, c.g, c.b]; }
  spray(at: THREE.Vector3, col: number[], n: number) {
    const N = this.pLife.length;
    for (let i = 0; i < n; i++) {
      const k = this.pNext; this.pNext = (this.pNext + 1) % N;
      this.pPos.set([at.x + (Math.random() - 0.5) * 0.4, at.y + (Math.random() - 0.5) * 0.4, at.z + (Math.random() - 0.5) * 0.4], k * 3);
      this.pVel.set([(Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4], k * 3);
      const j = 0.85 + Math.random() * 0.3; this.pCol.set([col[0] * j, col[1] * j, col[2] * j], k * 3);
      this.pLife[k] = 0.6 + Math.random() * 0.5;
    }
  }
  private updateParticles(dt: number) {
    for (let k = 0; k < this.pLife.length; k++) {
      if (this.pLife[k] <= 0) continue;
      this.pLife[k] -= dt; const j = k * 3;
      if (this.pLife[k] <= 0) { this.pPos[j + 1] = -9999; continue; }
      this.pVel[j + 1] -= 14 * dt;
      this.pPos[j] += this.pVel[j] * dt; this.pPos[j + 1] += this.pVel[j + 1] * dt; this.pPos[j + 2] += this.pVel[j + 2] * dt;
    }
    (this.particles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.particles.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  // ======================= what you hold =======================
  // ---- first-person animations: each kind of tool moves its own way ----
  private act: { kind: string; t: number; dur: number } | null = null;
  private mining = false; private mineT = 0; private bowPull: ((k: number) => void) | null = null;
  private startAct(kind: string, dur: number) { this.act = { kind, t: 0, dur }; }
  private swingKind() {
    const tt = ITEM[this.inv.held()?.k ?? '']?.tool?.type;
    return tt === 'sword' || tt === 'knife' ? 'slash' : tt === 'spear' ? 'thrust' : tt ? 'chop' : 'punch';
  }
  private updateHeld(dt: number) {
    const s = this.inv.held(), key = s?.k ?? '';
    if (key !== this.heldKey) { this.heldKey = key; this.bowPull = null; this.buildHeld(key); }
    this.swing = Math.max(0, this.swing - dt * 3.2);
    const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 0.5 && this.player.onGround;
    const bob = moving ? Math.sin(performance.now() / 110) * 0.02 : Math.sin(performance.now() / 900) * 0.006;
    // pose offsets: x, y, z, rotX, rotY, rotZ
    let o = [0, 0, 0, 0, 0, 0];
    if (this.act) {
      this.act.t += dt; const u = Math.min(1, this.act.t / this.act.dur);
      o = pose(this.act.kind, u);
      if (this.act.kind === 'eat' && u > 0.25 && u < 0.8) o[1] += Math.sin(this.act.t * 38) * 0.025;
      if (u >= 1) this.act = null;
    } else if (this.mining) {
      // keep chopping while you hold the button on a block
      this.mineT += dt * 2.6; o = pose(this.swingKind() === 'slash' ? 'slash' : 'chop', this.mineT % 1);
    } else this.mineT = 0;
    this.mining = false;
    if (this.bowCharge >= 0) {
      // draw: bow up in front of you, string pulled back, a shiver at full draw
      const k = this.bowCharge, sh = k >= 1 ? (Math.random() - 0.5) * 0.008 : 0;
      o = [-0.3 + sh, 0.12 + sh, 0.06 * k, 0.05, -0.15, 0.12];
      this.bowPull?.(k);
    } else this.bowPull?.(0);
    const want = settings.fov - (this.bowCharge > 0 ? this.bowCharge * 9 : 0);
    if (Math.abs(this.camera.fov - want) > 0.05) { this.camera.fov += (want - this.camera.fov) * Math.min(1, dt * 10); this.camera.updateProjectionMatrix(); }
    this.held.position.set(0.44 + o[0], -0.46 + bob + o[1], -0.6 + o[2]);
    this.held.rotation.set(o[3], 0.15 + o[4], o[5]);
    this.held.visible = this.player.downed <= 0 && !this.player.dead && !this.riding;
    // shield on the left: raised while crouching, bumps when it takes a hit
    const ok = this.inv.offhand?.k ?? '';
    if (ok !== this.offKey) { this.offKey = ok; this.buildOffhand(ok); }
    this.shieldBump = Math.max(0, this.shieldBump - dt);
    const up = this.player.crouching ? 1 : 0, bump = Math.sin(this.shieldBump / 0.3 * Math.PI) * 0.06;
    this.offHeld.position.set(-0.5 + up * 0.22, -0.5 + up * 0.18 + bob, -0.62 + up * 0.12 + bump);
    this.offHeld.rotation.set(0, 0.35 - up * 0.3, 0);
    this.offHeld.visible = this.held.visible;
  }
  private buildOffhand(key: string) {
    this.offHeld.clear();
    const d = ITEM[key]; if (!d) return;
    if (d.shield) {
      const g = new THREE.Group();
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.04), new THREE.MeshLambertMaterial({ color: d.color }));
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.03), new THREE.MeshLambertMaterial({ color: d.color2 ?? '#4a4d52' })); rim.position.z = 0.02;
      const boss = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), new THREE.MeshLambertMaterial({ color: d.color2 ?? '#4a4d52' })); boss.position.z = -0.03;
      g.add(rim, face, boss); this.offHeld.add(g); return;
    }
    const tex = new THREE.TextureLoader().load(itemIcon(key)); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    this.offHeld.add(sp);
  }
  private async buildHeld(key: string) {
    this.held.clear();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: '#c99a78' }));
    arm.position.set(0.05, -0.05, 0.25); this.held.add(arm);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.2), new THREE.MeshLambertMaterial({ color: ['#6b4a2b', '#2f5d9a', '#5a6a3a', '#7a2a2a'][this.look % 4] }));
    sleeve.position.set(0.05, -0.05, 0.45); this.held.add(sleeve);
    if (!key) return;
    const d = ITEM[key];
    if (d?.block != null) {
      const six = tiles6(d.block), mats = six.map(tile => { const tx = new THREE.CanvasTexture(this.atlas.canvasFor(tile)); tx.magFilter = THREE.NearestFilter; tx.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: tx, transparent: true, alphaTest: 0.4 }); });
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mats); cube.position.set(-0.02, 0.14, -0.14); cube.rotation.y = 0.6; this.held.add(cube);
      return;
    }
    // weapons and the bow are built in code so they can move properly
    const made = d && buildWeapon(d);
    if (made) { this.held.add(made.g); this.bowPull = made.pull ?? null; return; }
    const toolModel: Record<string, string> = { axe: 'tool-axe', pickaxe: 'tool-pickaxe', shovel: 'tool-shovel', hoe: 'tool-hoe' };
    const tm = d?.tool && toolModel[d.tool.type];
    if (tm) {
      const g = await loadModel(tm); if (!g || this.heldKey !== key) return;
      const m = g.scene.clone(true);
      m.traverse((o: any) => { if (o.isMesh) { o.material = o.material.clone(); if (/head|blade|metal|stone/i.test(o.material.name || '') || o.material.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45) o.material.color.set(d.color); } });
      m.scale.setScalar(1.05); m.rotation.set(-0.35, Math.PI / 2, 0.15); m.position.set(0, -0.18, -0.08); this.held.add(m);
      return;
    }
    const tex = new THREE.TextureLoader().load(itemIcon(key)); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    sp.position.set(-0.02, 0.18, -0.14); sp.rotation.y = -0.4; this.held.add(sp);
  }

  // ======================= other players =======================
  async upsertRemote(id: string, s: { name: string; look: number; x: number; y: number; z: number; yaw: number; anim: string; downed: boolean }) {
    let r = this.remotes.get(id);
    if (!r) {
      const obj = new THREE.Group(); const label = this.makeLabel(s.name); label.position.y = 2.15; obj.add(label);
      r = { id, name: s.name, look: s.look, obj, mixer: null, actions: {}, cur: '', pos: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yaw, anim: 'idle', downed: false, label, seen: performance.now() };
      this.remotes.set(id, r); this.scene.add(obj);
      const g = await loadModel(LOOKS[s.look % LOOKS.length]);
      if (g && this.remotes.get(id) === r) {
        const m = cloneSkinned(g.scene); m.scale.setScalar(0.95); obj.add(m);
        r.mixer = new THREE.AnimationMixer(m);
        for (const c of g.animations) r.actions[c.name] = r.mixer.clipAction(c);
      }
    }
    if (r.name !== s.name) { r.obj.remove(r.label); r.label = this.makeLabel(s.name); r.label.position.y = 2.15; r.obj.add(r.label); r.name = s.name; }
    r.pos.set(s.x, s.y, s.z); r.yaw = s.yaw; r.anim = s.anim; r.downed = s.downed; r.seen = performance.now();
  }
  removeRemote(id: string) { const r = this.remotes.get(id); if (!r) return; this.scene.remove(r.obj); this.remotes.delete(id); }
  private makeLabel(text: string) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(10,14,22,0.7)'; g.beginPath(); g.roundRect(2, 4, 252, 40, 12); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 26px system-ui'; g.textAlign = 'center'; g.fillText(text.slice(0, 18), 128, 33);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); s.scale.set(1.4, 0.26, 1); return s;
  }
  private updateRemotes(dt: number) {
    for (const r of this.remotes.values()) {
      r.obj.position.lerp(r.pos, Math.min(1, dt * 10));
      const d = r.yaw + Math.PI - r.obj.rotation.y; r.obj.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 10);
      const want = r.downed ? 'Lie_Idle' : r.anim === 'run' ? 'Running_A' : r.anim === 'walk' ? 'Walking_A' : r.anim === 'chop' ? 'Chopping' : 'Idle_A';
      if (want !== r.cur && r.actions[want]) { const prev = r.actions[r.cur]; r.actions[want].reset().fadeIn(0.2).play(); prev?.fadeOut(0.2); r.cur = want; }
      r.mixer?.update(dt);
    }
  }
  /** what others should see of you */
  myState() {
    const p = this.player, moving = Math.hypot(p.vel.x, p.vel.z);
    return { name: p.name, look: this.look, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(2), anim: this.swing > 0.2 ? 'chop' : moving > 5 ? 'run' : moving > 0.5 ? 'walk' : 'idle', downed: p.downed > 0 };
  }
  /** friend nearby who is down? */
  downedFriendNear(): Remote | null { for (const r of this.remotes.values()) if (r.downed && r.pos.distanceTo(this.player.pos) < 2.5) return r; return null; }
  sendTick(dt: number) { this.sendT -= dt; if (this.sendT > 0) return false; this.sendT = 0.1; return true; }

  dispose() { this.save(); this.world.dispose(); this.animals.clear(); this.projectiles.clear(); for (const r of this.remotes.values()) this.scene.remove(r.obj); }
}
