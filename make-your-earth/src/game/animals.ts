/*
  Animals: spawn in herds by biome around the player, wander and graze, flee or attack depending on mood,
  swim if they're sea creatures, and drop meat, hides and bones when hunted. Models load the first time a
  species is needed. In co-op the host runs this and friends just draw the snapshots.
*/
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIMAL, BIOMES, type Animal } from '../shared/biomes';
import { BLOCKS, B } from '../shared/blocks';
import type { World } from '../world/world';
import { SEA } from '../world/gen';

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const models = new Map<string, Promise<GLTF | null>>();
export function loadModel(name: string) {
  let p = models.get(name);
  if (!p) { p = loader.loadAsync(`/models/${name}.glb`).catch(e => { console.warn('model', name, e); return null; }); models.set(name, p); }
  return p;
}

type State = 'idle' | 'walk' | 'flee' | 'chase' | 'attack' | 'dead';
export interface Beast {
  id: string; def: Animal; obj: THREE.Group; mixer: THREE.AnimationMixer | null; actions: Record<string, THREE.AnimationAction>;
  pos: THREE.Vector3; yaw: number; hp: number; state: State; timer: number; target: THREE.Vector3; attackT: number; deadT: number;
  cur: string; mats: THREE.MeshStandardMaterial[]; flash: number; radius: number; height: number; soundT: number; remote?: boolean;
}

let nextId = 1;
export class Animals {
  list: Beast[] = [];
  group = new THREE.Group();
  cap = 24; simDist = 64; spawnT = 0;
  host = true;                // false in co-op as a guest: positions come from the host
  onAttack: (b: Beast, dmg: number) => void = () => {};
  onSound: (key: string, pos: THREE.Vector3) => void = () => {};
  constructor(private world: World) {}

  groundY(x: number, z: number, fromY: number) {
    const fx = Math.floor(x), fz = Math.floor(z);
    for (let y = Math.floor(fromY) + 2; y > Math.floor(fromY) - 8; y--) {
      const id = this.world.get(fx, y, fz);
      if (id < 0) return null;
      if (id > 0 && BLOCKS[id].solid !== false) return y + 1;
    }
    return null;
  }

  async spawn(key: string, x: number, y: number, z: number, id?: string): Promise<Beast | null> {
    const def = ANIMAL[key]; if (!def) return null;
    const gltf = await loadModel(def.model); if (!gltf) return null;
    const obj = new THREE.Group();
    const model = cloneSkinned(gltf.scene) as THREE.Group;
    model.scale.setScalar(def.scale);
    const mats: THREE.MeshStandardMaterial[] = [];
    model.traverse((o: any) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.frustumCulled = false;
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      if (def.tint) m.color.multiply(new THREE.Color(def.tint)).multiplyScalar(1.6);
      o.material = m; mats.push(m);
    });
    obj.add(model);
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null;
    const actions: Record<string, THREE.AnimationAction> = {};
    if (mixer) for (const clip of gltf.animations) {
      const n = clip.name.toLowerCase();
      const k = n.startsWith('idle') ? 'idle' : n.includes('fast') || n.startsWith('run') ? 'run' : n.startsWith('walk') || n.startsWith('swim') ? 'walk' : n;
      if (!actions[k] || (n.includes('folded') === false && key === 'parrot')) actions[k] = mixer.clipAction(clip);
    }
    const b: Beast = {
      id: id ?? `a${nextId++}`, def, obj, mixer, actions, pos: new THREE.Vector3(x, y, z), yaw: Math.random() * Math.PI * 2, hp: def.hp,
      state: 'idle', timer: Math.random() * 3, target: new THREE.Vector3(x, y, z), attackT: 0, deadT: 0, cur: '', mats, flash: 0,
      radius: Math.max(size.x, size.z) * 0.5, height: size.y, soundT: 4 + Math.random() * 20,
    };
    this.play(b, 'idle');
    obj.position.copy(b.pos);
    this.group.add(obj); this.list.push(b);
    return b;
  }
  private play(b: Beast, k: string) {
    if (b.cur === k || !b.mixer) return;
    const next = b.actions[k] ?? b.actions.walk ?? b.actions.idle; if (!next) return;
    const prev = b.actions[b.cur];
    next.reset().fadeIn(0.25).play(); if (prev && prev !== next) prev.fadeOut(0.25);
    next.timeScale = k === 'run' ? 1.1 : 1;
    b.cur = k;
  }
  remove(b: Beast) { this.group.remove(b.obj); b.mixer?.stopAllAction(); this.list = this.list.filter(x => x !== b); }
  clear() { for (const b of [...this.list]) this.remove(b); }

  /** try to put a herd somewhere near the player that isn't on screen right next to them */
  private trySpawn(px: number, pz: number) {
    const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * (this.simDist - 26);
    const x = Math.floor(px + Math.cos(a) * r), z = Math.floor(pz + Math.sin(a) * r);
    const col = this.world.gen.column(x, z), biome = BIOMES[col.biome];
    const sy = this.world.surface(x, z);
    if (this.world.get(x, sy, z) < 0) return;
    const water = sy < SEA && this.world.get(x, SEA, z) === B.water;
    const pool = biome.animals.filter(k => !!ANIMAL[k].water === water);
    if (!pool.length) return;
    const key = pool[Math.floor(Math.random() * pool.length)], def = ANIMAL[key];
    const herd = 1 + Math.floor(Math.random() * (def.herd ?? 1));
    for (let i = 0; i < herd; i++) {
      const hx = x + (Math.random() - 0.5) * 6, hz = z + (Math.random() - 0.5) * 6;
      const y = water ? Math.min(SEA - 1, this.world.surface(Math.floor(hx), Math.floor(hz)) + 1 + Math.random() * Math.max(0, SEA - sy - 3)) : this.groundY(hx, hz, sy + 1);
      if (y == null) continue;
      if (!water && this.world.get(Math.floor(hx), Math.floor(y), Math.floor(hz)) === B.water) continue;
      this.spawn(key, hx, y, hz);
    }
  }

  update(dt: number, player: { pos: THREE.Vector3; downed: number }, others: THREE.Vector3[] = []) {
    const P = player.pos;
    if (this.host) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnT = 1.2; if (this.list.length < this.cap) this.trySpawn(P.x, P.z); }
    }
    for (const b of [...this.list]) {
      const d = b.pos.distanceTo(P);
      if (this.host && d > this.simDist + 40 && b.state !== 'dead') { this.remove(b); continue; }
      if (this.host) this.think(b, dt, P, d, player.downed > 0, others);
      // draw
      b.obj.position.lerp(b.pos, b.remote ? Math.min(1, dt * 10) : 1);
      const dy = b.yaw - b.obj.rotation.y; b.obj.rotation.y += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, dt * 8);
      if (b.state === 'dead') { b.obj.rotation.z = Math.min(Math.PI / 2, b.obj.rotation.z + dt * 4); }
      if (b.flash > 0) { b.flash -= dt; for (const m of b.mats) m.emissive.setRGB(b.flash > 0 ? 0.6 : 0, 0, 0); }
      if (d < this.simDist && b.state !== 'dead') b.mixer?.update(dt);
      b.obj.visible = d < this.simDist + 30;
    }
  }

  private think(b: Beast, dt: number, P: THREE.Vector3, d: number, playerDown: boolean, others: THREE.Vector3[]) {
    const def = b.def;
    if (b.state === 'dead') { b.deadT -= dt; if (b.deadT <= 0) this.remove(b); return; }
    b.timer -= dt; b.attackT -= dt; b.soundT -= dt;
    if (b.soundT <= 0) { b.soundT = 8 + Math.random() * 25; if (def.sound && d < 40) this.onSound(def.sound, b.pos); }
    // nearest player (host or guests)
    let tgt = P, td = d;
    for (const o of others) { const od = b.pos.distanceTo(o); if (od < td) { td = od; tgt = o; } }
    const hostile = def.mood === 'hostile' && !playerDown && td < (def.water ? 16 : 14);
    const scared = (def.mood === 'skittish' && td < 9) || b.state === 'flee';
    if (hostile) b.state = td < (def.reach ?? 1.5) + 0.4 ? 'attack' : 'chase';
    else if (b.state === 'chase' || b.state === 'attack') b.state = 'idle';
    if (scared && b.state !== 'chase' && b.state !== 'attack') {
      if (b.state !== 'flee') { b.state = 'flee'; b.timer = 4 + Math.random() * 3; }
      const away = b.pos.clone().sub(tgt).setY(0).normalize().multiplyScalar(14);
      b.target.copy(b.pos).add(away);
      if (b.timer <= 0) b.state = 'idle';
    }
    if (b.state === 'idle' && b.timer <= 0) {
      b.state = 'walk'; b.timer = 3 + Math.random() * 6;
      b.target.set(b.pos.x + (Math.random() - 0.5) * 16, b.pos.y, b.pos.z + (Math.random() - 0.5) * 16);
    } else if (b.state === 'walk' && (b.timer <= 0 || b.pos.distanceTo(b.target) < 0.8)) { b.state = 'idle'; b.timer = 2 + Math.random() * 6; }
    if (b.state === 'chase' || b.state === 'attack') b.target.copy(tgt);
    if (b.state === 'attack' && b.attackT <= 0) { b.attackT = 1.3; this.onAttack(b, def.damage ?? 3); }

    const speed = b.state === 'flee' || b.state === 'chase' ? def.run : b.state === 'walk' ? def.speed : 0;
    this.play(b, speed === 0 ? 'idle' : speed > def.speed * 1.5 ? 'run' : 'walk');
    if (!speed) return;
    const dir = b.target.clone().sub(b.pos); if (!def.water && !def.fly) dir.y = 0;
    const len = dir.length(); if (len < 0.3) return;
    dir.divideScalar(len);
    b.yaw = Math.atan2(dir.x, dir.z);
    const nx = b.pos.x + dir.x * speed * dt, nz = b.pos.z + dir.z * speed * dt;
    if (def.water) {
      const id = this.world.get(Math.floor(nx), Math.floor(b.pos.y + dir.y * speed * dt), Math.floor(nz));
      if (id === B.water) { b.pos.x = nx; b.pos.z = nz; b.pos.y = Math.min(SEA - 0.6, b.pos.y + dir.y * speed * dt); }
      else { b.target.set(b.pos.x - dir.x * 10, b.pos.y, b.pos.z - dir.z * 10); }
      return;
    }
    const gy = this.groundY(nx, nz, b.pos.y);
    if (gy == null || gy - b.pos.y > 1.2 || this.world.get(Math.floor(nx), Math.floor(gy), Math.floor(nz)) === B.water) {
      // blocked (cliff, wall or water): pick somewhere else
      b.target.set(b.pos.x - dir.x * 8 + (Math.random() - 0.5) * 8, b.pos.y, b.pos.z - dir.z * 8 + (Math.random() - 0.5) * 8);
      return;
    }
    b.pos.x = nx; b.pos.z = nz; b.pos.y += (gy - b.pos.y) * Math.min(1, dt * 12);
  }

  /** first living animal along a ray (for hunting) */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, reach: number): Beast | null {
    let best: Beast | null = null, bt = reach;
    const c = new THREE.Vector3();
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      c.copy(b.pos); c.y += b.height * 0.5;
      const rad = Math.max(0.35, Math.min(b.radius, b.height * 0.6)) + 0.2;
      const oc = c.clone().sub(o), t = oc.dot(d);
      if (t < 0 || t > bt) continue;
      if (oc.lengthSq() - t * t < rad * rad) { best = b; bt = t; }
    }
    return best;
  }
  /** returns drops if it died */
  damage(b: Beast, amount: number, from: THREE.Vector3): [string, number][] | null {
    b.hp -= amount; b.flash = 0.25;
    if (b.def.mood !== 'hostile') {
      if (b.def.mood === 'neutral' && b.def.damage) b.state = 'chase';
      else { b.state = 'flee'; b.timer = 6; b.target.copy(b.pos).add(b.pos.clone().sub(from).setY(0).normalize().multiplyScalar(14)); }
    }
    if (b.hp > 0) return null;
    b.state = 'dead'; b.deadT = 6; b.mixer?.stopAllAction();
    return b.def.drops.map(([k, lo, hi]) => [k, lo + Math.floor(Math.random() * (hi - lo + 1))] as [string, number]).filter(d => d[1] > 0);
  }

  // ---- co-op: the host shares positions, guests draw them ----
  snapshot() { return this.list.map(b => [b.id, b.def.key, +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2), +b.yaw.toFixed(2), b.state === 'dead' ? 1 : 0, b.cur]); }
  async applySnapshot(list: any[]) {
    const seen = new Set<string>();
    for (const [id, key, x, y, z, yaw, dead, anim] of list) {
      seen.add(id);
      let b = this.list.find(q => q.id === id);
      if (!b) { b = (await this.spawn(key, x, y, z, id)) ?? undefined; if (!b) continue; b.remote = true; b.obj.position.set(x, y, z); }
      b.pos.set(x, y, z); b.yaw = yaw; if (dead && b.state !== 'dead') { b.state = 'dead'; b.mixer?.stopAllAction(); }
      if (!dead) this.play(b, anim || 'idle');
    }
    for (const b of [...this.list]) if (!seen.has(b.id)) this.remove(b);
  }
}
