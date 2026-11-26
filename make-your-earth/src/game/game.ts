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
import { Animals, loadModel } from './animals';
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

export const DAY = 1200;                // seconds per in-game day
const FIRST = ['Ada', 'Bruno', 'Clara', 'Diogo', 'Eva', 'Filipe', 'Gaia', 'Hugo', 'Inês', 'João', 'Kai', 'Lara', 'Miguel', 'Nora', 'Otto', 'Pia', 'Rui', 'Sara', 'Tiago', 'Uma', 'Vera', 'Wes', 'Yara', 'Zé'];
const LAST = ['Stone', 'River', 'Ash', 'Moss', 'Flint', 'Oak', 'Frost', 'Dune', 'Reed', 'Hart', 'Wolfe', 'Marsh', 'Vale', 'Cliff', 'Thorn', 'Brook'];
export const LOOKS = ['barbarian', 'knight', 'rogue', 'ranger'];
export const randomName = (r = Math.random) => `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;

export interface Grave { id: string; x: number; y: number; z: number; owner: string; name: string; items: Stack[]; at: number }
export interface Remote { id: string; name: string; look: number; obj: THREE.Group; mixer: THREE.AnimationMixer | null; actions: Record<string, THREE.AnimationAction>; cur: string; pos: THREE.Vector3; yaw: number; anim: string; downed: boolean; label: THREE.Sprite; seen: number }
export interface SaveData { id: string; name: string; seed: number; created: number; played: number; time: number; edits: any; player: any; graves: Grave[]; explored: string[]; waypoints: { x: number; z: number; label: string }[]; customBlocks?: CustomBlock[]; blueprints?: any[]; admin?: { banned: string[] } }

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
  net: { block?: (x: number, y: number, z: number, id: number) => void; grave?: (g: Grave | null, removeId?: string) => void; blockdef?: (c: CustomBlock) => void; blockdefs?: (l: CustomBlock[]) => void } = {};
  isGuest = false;
  private highlight: THREE.LineSegments; private crack: THREE.Mesh;
  private held = new THREE.Group(); private heldKey = ''; private swing = 0; private attackCd = 0;
  private particles: THREE.Points; private pPos: Float32Array; private pVel: Float32Array; private pLife: Float32Array; private pCol: Float32Array; private pNext = 0;
  private weatherFx: THREE.Points; private drops: { k: string; n: number; pos: THREE.Vector3; vel: THREE.Vector3; obj: THREE.Sprite; age: number }[] = [];
  private envT = 0; private saveT = 0; private sendT = 0; private exploreT = 0; private ambT = 0;
  data: SaveData;

  constructor(public renderer: THREE.WebGLRenderer, public input: Input, public atlas: Atlas, save: SaveData, profileId: string) {
    this.data = save; this.profileId = profileId;
    this.world = new World(save.seed, atlas.texture, settings.render);
    this.world.setRenderDist(settings.render);
    this.world.loadEdits(save.edits);
    // custom blocks: this world's own list first (their numbers are saved in the terrain), then your library
    resetCustom();
    this.baseBlocks = BLOCKS.length;
    save.customBlocks = save.customBlocks ?? [];
    for (const c of save.customBlocks) this.paintCustom(c);
    if (!(save as any).guest) for (const c of library()) if (!save.customBlocks.some(x => x.key === c.key) && this.paintCustom(c)) save.customBlocks.push(c);
    this.world.syncTables(this.baseBlocks);
    this.graves = save.graves ?? []; this.explored = new Set(save.explored ?? []); this.waypoints = save.waypoints ?? [];
    this.time = save.time ?? DAY * 0.3; this.day = Math.floor(this.time / DAY) + 1;
    this.scene.add(this.world.group);
    this.animals = new Animals(this.world);
    this.animals.simDist = settings.sim * CS; this.animals.cap = settings.preset === 'potato' ? 10 : settings.preset === 'low' ? 16 : 26;
    this.scene.add(this.animals.group);
    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#5a4a3a', 1.6); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dd', 1.8); this.sun.position.set(30, 80, 20); this.scene.add(this.sun);
    this.scene.add(this.camera); this.camera.add(this.held);
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

    this.world.onBlockChange = (x, y, z, id) => this.net.block?.(x, y, z, id);
    this.animals.onAttack = (b, dmg) => { if (b.pos.distanceTo(this.player.pos) < (b.def.reach ?? 1.6) + 1) { this.player.hurt(dmg, 'animal', this.inv.armorValue()); this.shake = 0.25; } };
    this.animals.onSound = (k, p) => sound.play(k, { pos: p, range: 40, vol: 0.7 });
    this.player.onStep = id => { const k = id === B.sand || id === B.red_sand ? 'step_sand' : id === B.snow || id === B.ice ? 'step_snow' : id === B.grass || id === B.dirt || id === B.dry_grass || id === B.jungle_grass || id === B.tall_grass ? 'step_grass' : 'step_stone'; sound.play(k, { vol: 0.35 }); };
    this.player.onHurt = (a) => { if (a > 1.5) { sound.play('hurt', { vol: 0.6 }); this.redFlash = 0.4; } this.onChange(); };
    this.player.onDowned = () => { sound.play('death'); this.onChange(); };
    this.player.autoStep = input.touch;
    this.inv.onChange = () => this.onChange();
    this.loadPlayer(save.player);
  }
  shake = 0; redFlash = 0; baseBlocks = 0; god = false;
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
      Object.assign(this.player.stats, p.stats ?? {}); this.inv.load(p.inv); this.player.name = p.name; this.look = p.look ?? 0;
    } else {
      const s = this.world.gen.findSpawn(Math.floor((r() - 0.5) * 4000), Math.floor((r() - 0.5) * 4000), r);
      this.player.pos.set(s.x, s.y, s.z);
      this.player.name = settings.name || randomName(r); this.look = Math.floor(r() * LOOKS.length);
      this.inv.add('stone_axe', 1);                   // you wake up holding only an axe
    }
  }
  playerJSON() { const p = this.player; return { pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch, stats: p.stats, inv: this.inv.toJSON(), name: p.name, look: this.look }; }

  save() {
    if (this.isGuest) return;
    this.data.edits = this.world.saveEdits(); this.data.player = this.playerJSON(); this.data.graves = this.graves;
    this.data.time = this.time; this.data.played = Date.now(); this.data.explored = [...this.explored].slice(-60000); this.data.waypoints = this.waypoints;
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
        if (p.pos.y < top + 1 || this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)) > 0) p.pos.y = top + 1.02;
        this.ready = true; this.onChange();
      }
      this.updateCamera(dt);
      return;
    }
    if (!this.paused) {
      p.update(dt, this.world, inp, settings.sensitivity, settings.invertY);
      this.interact(dt);
    }
    this.envT -= dt;
    if (this.envT <= 0) { this.envT = 0.5; this.sampleEnvironment(); }
    p.tickStats(dt, this.ambient, this.inv.warmth() + (this.nearFire ? 3 : 0), !!(inp.move.x || inp.move.z));
    if (p.downed > 0) { p.downed -= dt; if (p.downed <= 0) this.die(); }
    // time and sky
    this.time += dt; const nd = Math.floor(this.time / DAY) + 1; if (nd !== this.day) { this.day = nd; this.onChange(); }
    this.sky(dt);
    this.weatherTick(dt);
    const others = [...this.remotes.values()].map(r => r.pos);
    this.animals.update(dt, p, others);
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
    cam.rotation.set(p.pitch, p.yaw, p.downed > 0 ? 0.6 : 0, 'YXZ');
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
    // attack animals first
    this.attackCd -= dt;
    if ((inp.hit('attack') || (inp.primary && this.attackCd <= 0))) {
      const beast = this.animals.rayHit(o, dir, 3.6);
      if (beast && (!hit || hit.dist > o.distanceTo(beast.pos))) {
        if (this.attackCd <= 0) {
          this.attackCd = 0.55; this.swing = 1;
          const dmg = def?.tool ? def.tool.damage : 1;
          sound.play('swing', { vol: 0.5 });
          if (this.isGuest) this.netAttack?.(beast.id, dmg);
          else this.hitAnimal(beast, dmg, p.pos);
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
        this.swing = Math.max(this.swing, 0.6);
        if (Math.random() < dt * 10) { this.spray(new THREE.Vector3(hit.x + 0.5 + hit.nx * 0.5, hit.y + 0.5 + hit.ny * 0.5, hit.z + 0.5 + hit.nz * 0.5), this.blockColor(hit.id), 2); sound.play(bd.tool === 'axe' ? 'chop' : bd.tool === 'pickaxe' ? 'mine' : 'dig', { vol: 0.35 }); }
        if (this.breaking.p >= 1) this.breakBlock(hit.x, hit.y, hit.z, hit.id, def);
      }
      this.crack.visible = true; this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      (this.crack.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, (this.breaking?.p ?? 0) * 0.55);
    } else { this.breaking = null; this.crack.visible = false; }
    this.useInput(hit, held, def);
  }
  netAttack?: (id: string, dmg: number) => void;

  hitAnimal(beast: any, dmg: number, from: THREE.Vector3, to: 'me' | string = 'me') {
    const drops = this.animals.damage(beast, dmg, from);
    if (drops) {
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
    // water: drink or fill a bottle
    const wHit = this.world.raycast(this.camera.position, dir, 4, true);
    if (wHit && wHit.id === B.water && (!hit || wHit.dist <= hit.dist + 0.01)) {
      if (held?.k === 'empty_bottle') { this.inv.takeOne(this.inv.sel); this.give('dirty_water', 1); this.toast(t('hud.fillBottle')); sound.play('splash', { vol: 0.5 }); return; }
      if (held?.k === 'bucket') { this.inv.takeOne(this.inv.sel); this.give('water_bucket', 1); sound.play('splash', { vol: 0.5 }); return; }
      if (!held || !def?.block) { this.drinkRaw(); return; }
    }
    if (!hit) return;
    const bd = BLOCKS[hit.id];
    if (hit.id === B.grave) { this.openGrave(hit.x, hit.y, hit.z); return; }
    if (hit.id === B.loot_chest) { this.openLoot(hit.x, hit.y, hit.z); return; }
    if (bd.station || hit.id === B.chest || EXTRA[hit.id]?.storage) { this.onOpenStation?.(bd.station ?? 'chest'); return; }
    if ((hit.id === B.tnt || EXTRA[hit.id]?.explosive) && (held?.k === 'flint_and_steel' || held?.k === 'torch')) { this.ignite(hit.x, hit.y, hit.z); return; }
    if (held?.k === 'water_bucket' && def) { this.placeAt(hit, B.water); this.inv.slots[this.inv.sel] = { k: 'bucket', n: 1 }; this.onChange(); return; }
    if (held?.k === 'flint_and_steel') { this.placeAt(hit, B.fire); this.inv.wear(1); return; }
    if (def?.block != null) {
      if (this.placeAt(hit, def.block)) { this.inv.takeOne(this.inv.sel); sound.play('place', { vol: 0.5 }); this.swing = 0.5; }
    }
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
    const tool = held?.tool;
    const tierOk = !bd.tier || (tool && tool.type === bd.tool && tool.tier >= bd.tier);
    const needsTool = bd.tool === 'pickaxe' && (!tool || tool.type !== 'pickaxe');
    if (tierOk && !needsTool) {
      const drop = bd.drop === undefined ? bd.key : bd.drop;
      if (drop) this.give(drop, 1);
      if (bd.key.endsWith('_leaves') && Math.random() < 0.08) this.give(bd.key === 'oak_leaves' ? 'apple' : 'stick', 1);
      if (bd.key === 'tall_grass' && Math.random() < 0.15) this.give('seeds', 1);
      if (bd.key === 'gravel' && Math.random() < 0.5) this.give('gravel', 1);
    } else if (bd.tool === 'pickaxe') this.toast(t('hud.need'));
    if (held?.tool) this.inv.wear(1);
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
    this.inv.takeOne(slot);
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
    const day = new THREE.Color('#87b8e8'), dusk = new THREE.Color('#e8a070'), night = new THREE.Color('#0b1222');
    const col = night.clone().lerp(sunH > -0.05 && sunH < 0.25 ? dusk : day, Math.min(1, s * 1.1));
    if (this.weather !== 'clear') col.lerp(new THREE.Color('#6f7a86'), 0.5);
    if (!this.underwater) { (this.world.uniforms.uFogColor.value as THREE.Color).copy(col); this.scene.background = col; }
    else this.scene.background = new THREE.Color('#1d4a78');
    this.world.uniforms.uSun.value = s;
    (this.world.uniforms.uSunColor.value as THREE.Color).setRGB(1, 0.92 + 0.08 * s, 0.85 + 0.15 * s);
    this.hemi.intensity = 0.25 + s * 1.4; this.sun.intensity = s * 1.8;
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
    p.downed = 0;
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
    const s = this.world.gen.findSpawn(Math.floor(p.pos.x + (r() - 0.5) * 3000), Math.floor(p.pos.z + (r() - 0.5) * 3000), r);
    p.pos.set(s.x, s.y + 2, s.z); p.vel.set(0, 0, 0);
    p.stats = { health: 100, hunger: 80, thirst: 80, stamina: 100, temp: 37, sick: 0 };
    p.name = randomName(); this.look = Math.floor(r() * LOOKS.length);
    p.dead = false; this.ready = false;
    this.inv.add('stone_axe', 1);
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
  private updateHeld(dt: number) {
    const s = this.inv.held(), key = s?.k ?? '';
    if (key !== this.heldKey) { this.heldKey = key; this.buildHeld(key); }
    this.swing = Math.max(0, this.swing - dt * 3.2);
    const bob = Math.hypot(this.player.vel.x, this.player.vel.z) > 0.5 && this.player.onGround ? Math.sin(performance.now() / 110) * 0.02 : 0;
    const sw = Math.sin(this.swing * Math.PI);
    this.held.position.set(0.44, -0.46 + bob - sw * 0.12, -0.6 - sw * 0.12);
    this.held.rotation.set(-sw * 1.1, 0.15, 0);
    this.held.visible = this.player.downed <= 0 && !this.player.dead;
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

  dispose() { this.save(); this.world.dispose(); this.animals.clear(); for (const r of this.remotes.values()) this.scene.remove(r.obj); }
}
