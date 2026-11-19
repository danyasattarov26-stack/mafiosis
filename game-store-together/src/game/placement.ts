/* Placement mode: a ghost of the item follows your crosshair, snaps to the grid, R rotates, green = OK, red = blocked. */
import * as THREE from 'three';
import { ITEM } from '../config/items';
import type { PlacedObject } from '../core/save';
import { buildObject } from '../world/objects';
import { placeBlocked, snapCenter, rotAngle, footprint } from '../sim/layout';
import type { World } from '../sim/world';
import type { Player } from './player';
import type { ShopShell } from '../world/shop';

const OK = new THREE.MeshBasicMaterial({ color: '#80ed99', transparent: true, opacity: 0.45, depthWrite: false });
const BAD = new THREE.MeshBasicMaterial({ color: '#ff6b6b', transparent: true, opacity: 0.45, depthWrite: false });

export class Placement {
  active = false;
  item = '';
  moving: string | null = null;     // id of the object being moved, or null when placing from inventory
  rot = 0;
  ghost: THREE.Group | null = null;
  grid: THREE.Mesh | null = null;
  pos = { x: 0, z: 0, y: 1.8, wall: false };
  valid = false;
  reason = '';
  private ray = new THREE.Raycaster();

  constructor(private scene: THREE.Object3D) {}

  start(item: string, moving: PlacedObject | null = null) {
    this.stop();
    this.active = true; this.item = item; this.moving = moving?.id || null; this.rot = moving ? moving.rot : 0;
    const temp: PlacedObject = { id: 'ghost', item, x: 0, z: 0, rot: 0, mon: moving?.mon, chair: moving?.chair, desk: moving?.desk, wall: ITEM[item]?.kind === 'wall' };
    const v = buildObject(temp);
    v.root.userData.target = null;
    v.root.traverse((o: any) => { if (o.isMesh || o.isInstancedMesh) { o.material = OK; o.castShadow = false; o.renderOrder = 3; } if (o.isSprite) o.visible = false; });
    this.ghost = v.root;
    this.scene.add(this.ghost);
    if (ITEM[item]?.kind !== 'wall') {
      const [w, d] = ITEM[item].size || [1, 1];
      this.grid = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.5, d * 0.5), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.18, depthWrite: false }));
      this.grid.rotation.x = -Math.PI / 2; this.grid.position.y = 0.02;
      this.ghost.add(this.grid);
    }
  }
  stop() {
    if (this.ghost) this.ghost.removeFromParent();
    this.ghost = null; this.grid = null; this.active = false; this.moving = null;
  }

  update(world: World, player: Player, shell: ShopShell) {
    if (!this.active || !this.ghost) return;
    const def = ITEM[this.item];
    if (def.kind === 'wall') {
      this.ray.setFromCamera(new THREE.Vector2(0, 0), player.camera);
      this.ray.far = 7;
      const hit = this.ray.intersectObjects(shell.wallMeshes, false)[0];
      if (!hit || !hit.face) { this.ghost.visible = false; this.valid = false; this.reason = 'Aim at a wall inside the shop'; return; }
      this.ghost.visible = true;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      // which way the wall faces into the room → quarter turns
      const rot = Math.abs(n.x) > Math.abs(n.z) ? (n.x > 0 ? 1 : 3) : (n.z > 0 ? 0 : 2);
      const p = hit.point;
      const x = Math.round(p.x * 4) / 4, z = Math.round(p.z * 4) / 4, y = Math.min(2.5, Math.max(1.1, Math.round(p.y * 10) / 10));
      this.pos = { x: x + n.x * 0.02, z: z + n.z * 0.02, y, wall: true };
      this.rot = rot;
      this.ghost.position.set(this.pos.x, y, this.pos.z);
      this.ghost.rotation.y = rotAngle(rot);
      const clash = world.save.objects.some(o => o.wall && o.id !== this.moving && Math.hypot(o.x - this.pos.x, o.z - this.pos.z) < 0.7 && Math.abs((o.y || 1.8) - y) < 0.7);
      this.valid = !clash && n.y < 0.5; this.reason = clash ? 'Too close to another sign' : '';
    } else {
      const hit = player.floorHit(7) || player.camera.position.clone().add(player.forward().multiplyScalar(3)).setY(0);
      const sn = snapCenter(this.item, hit.x, hit.z, this.rot);
      this.pos = { x: sn.x, z: sn.z, y: 0, wall: false };
      this.ghost.visible = true;
      this.ghost.position.set(sn.x, 0.01, sn.z);
      this.ghost.rotation.y = rotAngle(this.rot);
      const why = placeBlocked(world.save, this.item, sn.x, sn.z, this.rot, this.moving || undefined);
      // don't place onto yourself
      const f = footprint(this.item, sn.x, sn.z, this.rot);
      const onMe = player.pos.x > f.x0 - 0.25 && player.pos.x < f.x1 + 0.25 && player.pos.z > f.z0 - 0.25 && player.pos.z < f.z1 + 0.25 && !def.walkable;
      this.valid = !why && !onMe; this.reason = why || (onMe ? 'Step back a little' : '');
    }
    const m = this.valid ? OK : BAD;
    this.ghost.traverse((o: any) => { if ((o.isMesh || o.isInstancedMesh) && o !== this.grid) o.material = m; });
  }

  rotate() { if (ITEM[this.item]?.kind !== 'wall') this.rot = (this.rot + 1) & 3; }
}
