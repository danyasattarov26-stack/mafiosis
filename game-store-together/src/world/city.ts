/*
  The city around your lot: KayKit road tiles and buildings, street lights that switch on at night,
  traffic with simple signals, and pedestrians on the sidewalks. Friends' shops get their own signs.
*/
import * as THREE from 'three';
import { instance, loaded } from '../engine/assets';
import { preset, settings } from '../core/settings';
import { rng, rand, pick, clamp } from '../core/util';
import { CharView } from './chars';
import { textCanvas, mat } from './props';
import { CUSTOMERS } from '../config/npcs';
import type { AABB } from './shop';

export const T = 9.6;
const ROAD_Z = 7.2;          // main road centre
const BACK_Z = -21.6;        // road behind the block
const CROSS_X = 2 * T;       // cross streets at ±19.2
const Y = -0.48;             // tiles are 0.48 thick; sink them so the pavement top is at y = 0

export interface Neighbour { code: string; name: string; shopName: string; online: boolean; level: number }
interface Car { obj: THREE.Object3D; lane: number; s: number; v: number; vmax: number }
interface Lane { axis: 'x' | 'z'; c: number; dir: 1 | -1; min: number; max: number; stops: number[]; cross: boolean }

export class City {
  group = new THREE.Group();
  colliders: AABB[] = [];
  targets: THREE.Object3D[] = [];
  private tiles: THREE.Object3D[] = [];
  private bulbs: THREE.MeshStandardMaterial;
  private lampLights: THREE.PointLight[] = [];
  private cars: Car[] = [];
  private lanes: Lane[] = [];
  private peds: { v: CharView; s: number; z: number; dir: number; speed: number; min: number; max: number }[] = [];
  private roadY = -0.2;
  private phase = 0;
  private lastCull = 0;
  private signs: THREE.Group = new THREE.Group();

  constructor() {
    this.bulbs = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd27a', emissiveIntensity: 0.1, toneMapped: false });
  }

  build() {
    const r = rng(1234);
    const put = (name: string, x: number, z: number, ry = 0) => {
      const o = instance(name); o.position.set(x, Y, z); o.rotation.y = ry;
      o.traverse((m: any) => { if (m.isMesh) { m.castShadow = name.startsWith('building'); m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); } });
      this.group.add(o); this.tiles.push(o); return o;
    };
    const buildings = ['building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G'];
    const bld = (x: number, z: number, ry: number) => {
      const name = buildings[Math.floor(r() * buildings.length)];
      put(name, x, z, ry);
      this.colliders.push({ x0: x - 3.9, x1: x + 3.9, z0: z - 3.4, z1: z + 3.4 });
    };
    for (let i = -4; i <= 4; i++) {
      const x = i * T;
      const cross = Math.abs(i) === 2;
      // main road and back road
      put(cross ? 'road_junction' : 'road_straight', x, ROAD_Z, Math.PI / 2);
      put(cross ? 'road_junction' : 'road_straight', x, BACK_Z, Math.PI / 2);
      for (const z of [-2.4, -12.0]) {
        if (cross) put('road_straight', x, z, 0);
        else if (Math.abs(i) <= 1) put('base', x, z, 0);
        else bld(x, z, 0);
      }
      for (const z of [16.8, 26.4]) {
        if (cross) put(z === 16.8 ? 'road_straight_crossing' : 'road_straight', x, z, 0);
        else bld(x, z, Math.PI);
      }
      if (!cross) bld(x, -31.2, 0);
    }
    // street lights along both sides of the main road + bushes and benches by the shop
    for (let i = -4; i <= 4; i++) for (const side of [-1, 1]) {
      const x = i * T + T / 2, z = side < 0 ? 2.05 : 12.35;
      if (Math.abs(x - CROSS_X) < 3 || Math.abs(x + CROSS_X) < 3) continue;
      const l = instance('streetlight'); l.position.set(x, 0, z); l.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2; this.group.add(l);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.bulbs); bulb.userData.ownGeo = true;
      bulb.position.set(x, 4.35, z + (side < 0 ? 1.05 : -1.05)); this.group.add(bulb);
      if (Math.abs(x) < 16 && side < 0 && this.lampLights.length < Math.max(0, preset().lights - 1)) { const L = new THREE.PointLight('#ffcf8a', 0, 14, 1.6); L.position.copy(bulb.position).add(new THREE.Vector3(0, -0.3, 0)); this.lampLights.push(L); this.group.add(L); }
    }
    for (const x of [-12.6, 12.6]) { const b = instance('bench'); b.position.set(x, 0, 1.7); b.rotation.y = Math.PI; this.group.add(b); }
    for (const x of [-7, 7, -14, 14]) { const b = instance('bush'); b.scale.setScalar(0.7); b.position.set(x, 0, 2.05); this.group.add(b); }
    this.group.add(this.signs);

    // lanes: main road both directions, cross streets both directions
    this.lanes = [
      { axis: 'x', c: ROAD_Z - 1.55, dir: 1, min: -45, max: 45, stops: [-CROSS_X - 5, CROSS_X - 5], cross: false },
      { axis: 'x', c: ROAD_Z + 1.55, dir: -1, min: -45, max: 45, stops: [CROSS_X + 5, -CROSS_X + 5], cross: false },
      { axis: 'z', c: CROSS_X + 1.55, dir: -1, min: -35, max: 38, stops: [ROAD_Z + 5.5], cross: true },
      { axis: 'z', c: -CROSS_X - 1.55, dir: 1, min: -35, max: 38, stops: [ROAD_Z - 5.5], cross: true },
    ];
    this.group.updateMatrixWorld(true);
    // measure the road surface height once
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, ROAD_Z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(this.tiles, true)[0];
    if (hit) this.roadY = hit.point.y;
    this.spawnTraffic();
    this.spawnPeds();
  }

  private spawnTraffic() {
    for (const c of this.cars) c.obj.removeFromParent();
    this.cars = [];
    const names = ['car_sedan', 'car_hatchback', 'car_taxi', 'car_stationwagon', 'car_police'];
    const n = preset().cars;
    for (let i = 0; i < n; i++) {
      const lane = i % this.lanes.length, L = this.lanes[lane];
      const obj = instance(i % 9 === 4 ? 'car_police' : pick(names.slice(0, 4)));
      obj.traverse((m: any) => { if (m.isMesh) m.castShadow = false; });
      const s = L.min + ((i / this.lanes.length) * 37 + rand(0, 6)) % (L.max - L.min);
      const car: Car = { obj, lane, s, v: 6, vmax: rand(6, 9) };
      this.group.add(obj);
      this.cars.push(car);
    }
  }
  private spawnPeds() {
    for (const p of this.peds) p.v.dispose();
    this.peds = [];
    const models = Object.values(CUSTOMERS).flatMap(c => c.models);
    const n = preset().pedestrians;
    for (let i = 0; i < n; i++) {
      const name = pick(models); if (!loaded(name)) continue;
      const v = new CharView(name, { tint: i });
      const far = i % 2 === 1;
      const p = { v, s: rand(-40, 40), z: far ? 13.1 + rand(-0.3, 0.3) : 1.9 + rand(-0.2, 0.2), dir: Math.random() < 0.5 ? 1 : -1, speed: rand(1.0, 1.4), min: -44, max: 44 };
      v.root.position.set(p.s, 0, p.z);
      this.group.add(v.root);
      this.peds.push(p);
    }
  }

  /** friends' shops: their names on the neighbouring buildings across the street */
  setNeighbours(list: Neighbour[]) {
    for (const c of [...this.signs.children]) { c.traverse((o: any) => { if (o.material?.map) o.material.map.dispose(); }); }
    this.signs.clear();
    this.targets = [];
    const spots = [[0, 16.8], [-T, 16.8], [T, 16.8], [-3 * T, -2.4], [3 * T, -2.4], [-3 * T, 16.8], [3 * T, 16.8], [-4 * T, -2.4], [4 * T, -2.4]];
    list.slice(0, spots.length).forEach((n, i) => {
      const [x, z] = spots[i];
      const front = z > 10 ? -1 : 1;
      const g = new THREE.Group();
      const t = textCanvas(n.shopName || `${n.name}'s Store`, { w: 1024, h: 180, bg: '#1a1033', fg: n.online ? '#80ed99' : '#ffd166', glow: n.online ? '#80ed99' : '#ff9e64', border: n.online ? '#80ed99' : '#ffd166' });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.92), new THREE.MeshStandardMaterial({ map: t, emissive: '#fff', emissiveMap: t, emissiveIntensity: 0.6 }));
      sign.userData.ownGeo = true;
      sign.position.set(0, 4.2, 0); g.add(sign);
      const sub = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.42), new THREE.MeshBasicMaterial({ map: textCanvas(`${n.name} · Lv ${n.level}${n.online ? ' · ONLINE' : ''}`, { w: 512, h: 72, bg: '#2b2d42', fg: '#fff' }) }));
      sub.userData.ownGeo = true; sub.position.set(0, 3.55, 0.01); g.add(sub);
      // an invisible door you can walk up to
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
      door.position.set(0, 1.3, 0.3); door.userData.ownGeo = true; door.userData.target = { kind: 'visit', id: n.code, name: n.name };
      g.add(door);
      g.position.set(x, 0, z + front * 3.65); g.rotation.y = front > 0 ? 0 : Math.PI;
      this.signs.add(g);
      this.targets.push(door);
    });
  }

  update(dt: number, time: number, night: number, cam: THREE.Vector3, players: { x: number; z: number }[]) {
    this.bulbs.emissiveIntensity = 0.1 + night * 3.5;
    for (const L of this.lampLights) L.intensity = night * 9; // never toggle visibility: that recompiles every shader
    // signals: main road green 12 s, cross street green 6 s
    this.phase = (this.phase + dt) % 18;
    const mainGreen = this.phase < 12;
    for (const c of this.cars) {
      const L = this.lanes[c.lane];
      const ahead = this.cars.filter(o => o !== c && o.lane === c.lane).map(o => (o.s - c.s) * L.dir).filter(d => d > 0);
      let target = c.vmax;
      const gap = ahead.length ? Math.min(...ahead) : 99;
      if (gap < 7) target = Math.min(target, Math.max(0, (gap - 5) * 2));
      const red = L.cross ? mainGreen : !mainGreen || this.phase > 11;
      if (red) for (const st of L.stops) { const d = (st - c.s) * L.dir; if (d > 0 && d < 9) target = Math.min(target, Math.max(0, (d - 0.5) * 1.5)); }
      // brake for players standing in the lane
      for (const p of players) {
        const along = ((L.axis === 'x' ? p.x : p.z) - c.s) * L.dir, side = Math.abs((L.axis === 'x' ? p.z : p.x) - L.c);
        if (side < 1.6 && along > 0 && along < 8) target = Math.min(target, Math.max(0, (along - 3) * 1.5));
      }
      c.v += clamp(target - c.v, -10 * dt, 3 * dt);
      c.s += c.v * dt * L.dir;
      if (c.s > L.max) c.s = L.min; if (c.s < L.min) c.s = L.max;
      if (L.axis === 'x') { c.obj.position.set(c.s, this.roadY, L.c); c.obj.rotation.y = L.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { c.obj.position.set(L.c, this.roadY, c.s); c.obj.rotation.y = L.dir > 0 ? 0 : Math.PI; }
    }
    for (const p of this.peds) {
      p.s += p.dir * p.speed * dt;
      if (p.s > p.max || p.s < p.min) p.dir *= -1;
      p.v.root.position.set(p.s, 0, p.z);
      p.v.root.rotation.y = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      p.v.update(dt, 'walk', cam);
    }
    // render distance: hide far tiles (cheap visibility cull every half second)
    this.lastCull -= dt;
    if (this.lastCull <= 0) {
      this.lastCull = 0.5;
      const rd2 = (settings.renderDistance + T) ** 2;
      for (const t of this.tiles) t.visible = (t.position.x - cam.x) ** 2 + (t.position.z - cam.z) ** 2 < rd2;
      for (const c of this.cars) c.obj.visible = (c.obj.position.x - cam.x) ** 2 + (c.obj.position.z - cam.z) ** 2 < rd2;
    }
    void time;
  }

  rebuildForQuality() { this.spawnTraffic(); this.spawnPeds(); }
}
export { mat };
