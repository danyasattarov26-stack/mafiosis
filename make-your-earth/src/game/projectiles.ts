/*
  Arrows in flight: yours (from a bow) and the skeletons'. They fall under gravity, stick into blocks,
  and hit creatures or players along their path. Arrows from other players are drawn but don't hit anything
  here: the player who shot it works out what it hit.
*/
import * as THREE from 'three';
import type { World } from '../world/world';
import type { Animals, Beast } from './animals';
import { BLOCKS } from '../shared/blocks';

export type ArrowOwner = 'me' | 'mob' | 'ghost';
interface Arrow { pos: THREE.Vector3; vel: THREE.Vector3; mesh: THREE.Object3D; owner: ArrowOwner; dmg: number; life: number; stuck: boolean; shooter?: Beast }

const shaft = new THREE.BoxGeometry(0.03, 0.03, 0.6); shaft.translate(0, 0, -0.1);
const tip = new THREE.ConeGeometry(0.035, 0.1, 4); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, -0.45);
const fletch = new THREE.BoxGeometry(0.1, 0.005, 0.12); fletch.translate(0, 0, 0.15);
const wood = new THREE.MeshLambertMaterial({ color: '#c8a870' }), iron = new THREE.MeshLambertMaterial({ color: '#6a6e74' }), feather = new THREE.MeshLambertMaterial({ color: '#f2f2f2' });

export class Projectiles {
  list: Arrow[] = [];
  group = new THREE.Group();
  onHitBeast: (b: Beast, dmg: number, from: THREE.Vector3) => void = () => {};
  /** a mob arrow reached a player: `target` is null for you, or the other player's id */
  onHitPlayer: (target: string | null, dmg: number, from: THREE.Vector3) => void = () => {};
  onStick: (pos: THREE.Vector3) => void = () => {};
  constructor(private world: World, private animals: Animals) {}

  fire(from: THREE.Vector3, vel: THREE.Vector3, owner: ArrowOwner, dmg: number, shooter?: Beast) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(shaft, wood), new THREE.Mesh(tip, iron), new THREE.Mesh(fletch, feather));
    const f2 = new THREE.Mesh(fletch, feather); f2.rotation.z = Math.PI / 2; mesh.add(f2);
    mesh.position.copy(from);
    this.group.add(mesh);
    this.list.push({ pos: from.clone(), vel: vel.clone(), mesh, owner, dmg, life: 12, stuck: false, shooter });
  }
  /** aim at a point with a little lift for the drop */
  static aim(from: THREE.Vector3, at: THREE.Vector3, speed: number, spread = 0) {
    const d = at.clone().sub(from), dist = d.length();
    const t = dist / speed;
    d.divideScalar(Math.max(0.001, t)); d.y += 0.5 * 14 * t;
    d.x += (Math.random() - 0.5) * spread; d.y += (Math.random() - 0.5) * spread; d.z += (Math.random() - 0.5) * spread;
    return d;
  }

  update(dt: number, me: THREE.Vector3, others: { id: string; pos: THREE.Vector3 }[], hostSim: boolean) {
    const step = new THREE.Vector3(), c = new THREE.Vector3();
    for (const a of [...this.list]) {
      a.life -= dt;
      if (a.life <= 0) { this.remove(a); continue; }
      if (a.stuck) continue;
      a.vel.y -= 14 * dt;
      step.copy(a.vel).multiplyScalar(dt);
      const len = step.length(), dir = step.clone().divideScalar(len || 1);
      // creatures
      if (a.owner === 'me') {
        const b = this.animals.rayHit(a.pos, dir, len + 0.2, q => !!q.owner);
        if (b) { this.onHitBeast(b, a.dmg, a.pos.clone().sub(dir)); this.remove(a); continue; }
      }
      // players
      if (a.owner === 'mob') {
        let hit: string | null | undefined;
        const near = (p: THREE.Vector3) => { c.copy(p); c.y += 1; const oc = c.sub(a.pos), t = Math.max(0, Math.min(len, oc.dot(dir))); return oc.lengthSq() - t * t < 0.25 && oc.length() < len + 0.6; };
        if (near(me)) hit = null;
        else if (hostSim) for (const o of others) if (near(o.pos)) { hit = o.id; break; }
        if (hit !== undefined) { this.onHitPlayer(hit, a.dmg, a.pos.clone().sub(dir.clone().multiplyScalar(2))); this.remove(a); continue; }
      }
      // blocks
      const nx = a.pos.x + step.x, ny = a.pos.y + step.y, nz = a.pos.z + step.z;
      const id = this.world.get(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (id > 0 && BLOCKS[id].solid !== false) { a.stuck = true; a.life = Math.min(a.life, 8); this.onStick(a.pos); }
      else a.pos.set(nx, ny, nz);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.pos.clone().sub(dir));
    }
  }
  private remove(a: Arrow) { this.group.remove(a.mesh); this.list = this.list.filter(q => q !== a); }
  clear() { for (const a of [...this.list]) this.remove(a); }
}
