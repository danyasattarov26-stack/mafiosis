/*
  Blueprints: ready-made plans (hut, log cabin, house, watchtower, nuclear bunker) and plans you save from
  anything you've built. Use one at the blueprint table (costs a sheet of blueprint paper), place the ghost
  outline where you want it, and it builds itself block by block from what's in your inventory.
*/
import * as THREE from 'three';
import { BLOCKS, B, BLOCK_ID } from '../shared/blocks';
import { BUILDERS, type Shape } from '../world/structures';
import { mulberry32 } from '../world/noise';

export interface Blueprint { id: string; name: string; nameKey?: string; w: number; h: number; d: number; y0: number; cells: [number, number, number, string][]; builtin?: boolean }

const fromShape = (id: string, nameKey: string, sh: Shape, y0 = 0): Blueprint => ({
  id, name: id, nameKey, w: sh.w, h: sh.h, d: sh.d, y0, builtin: true,
  cells: sh.cells.filter(c => c[3] !== B.water).map(c => [c[0], c[1], c[2], c[3] === B.loot_chest ? 'chest' : c[3] === 0 ? 'air' : BLOCKS[c[3]].key]),
});

function bunker(): Shape {
  // a shelter dug into the ground: reinforced walls, a blast door, an air filter, beds and a store room
  const cells: Shape['cells'] = [], W = 9, D = 9, H = 6;
  const set = (x: number, y: number, z: number, id: number) => cells.push([x, y, z, id]);
  for (let y = -5; y <= 0; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const wall = x === 0 || x === W - 1 || z === 0 || z === D - 1 || y === -5 || y === 0;
    set(x, y, z, wall ? B.reinforced_concrete : 0);
  }
  for (let y = -4; y <= 0; y++) set(4, y, 0, 0);
  for (let y = -4; y <= 1; y++) set(4, y, 1, B.ladder);
  set(4, 1, 0, B.blast_door);
  set(1, -4, 7, B.wool); set(2, -4, 7, B.wool); set(6, -4, 7, B.wool); set(7, -4, 7, B.wool);
  set(1, -4, 1, B.chest); set(7, -4, 1, B.chest); set(7, -4, 4, B.air_filter); set(1, -2, 4, B.torch); set(7, -2, 6, B.torch); set(4, -4, 4, B.workbench);
  return { cells, w: W, d: D, h: H + 2, found: B.reinforced_concrete };
}
function hut(): Shape {
  const cells: Shape['cells'] = [];
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
    const edge = x === 0 || x === 4 || z === 0 || z === 4;
    if (y === 0) cells.push([x, y, z, B.cobblestone]);
    else if (y <= 2) cells.push([x, y, z, edge ? B.oak_log : 0]);
    else if (y === 3) cells.push([x, y, z, B.thatch]);
    else if (x > 0 && x < 4 && z > 0 && z < 4) cells.push([x, y, z, B.thatch]);
  }
  cells.push([2, 1, 0, 0], [2, 2, 0, 0], [1, 1, 3, B.campfire]);
  return { cells, w: 5, d: 5, h: 5, found: B.cobblestone };
}
export function builtinBlueprints(): Blueprint[] {
  const r = mulberry32(7);
  return [
    fromShape('hut', 'bp.hut', hut()),
    fromShape('cabin', 'bp.cabin', BUILDERS.cabin(r)),
    fromShape('house', 'bp.house', BUILDERS.house(() => 0.2)),
    fromShape('tower', 'bp.tower', BUILDERS.tower(r)),
    fromShape('bunker', 'bp.bunker', bunker()),
  ];
}

/** materials a plan needs (air is free) */
export function needs(bp: Blueprint) {
  const m = new Map<string, number>();
  for (const c of bp.cells) if (c[3] !== 'air') m.set(c[3], (m.get(c[3]) ?? 0) + 1);
  return [...m];
}

/** read a box of the world into a plan */
export function capture(get: (x: number, y: number, z: number) => number, a: THREE.Vector3, b: THREE.Vector3, name: string): Blueprint | 'big' | 'empty' {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), z0 = Math.min(a.z, b.z), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), z1 = Math.max(a.z, b.z);
  if (x1 - x0 >= 24 || y1 - y0 >= 24 || z1 - z0 >= 24) return 'big';
  const cells: Blueprint['cells'] = []; let solid = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = get(x, y, z);
    if (id < 0 || id === B.water || id === B.lava || id === B.grave || id === B.fire || id === B.bedrock) { cells.push([x - x0, y - y0, z - z0, 'air']); continue; }
    if (id === 0) { cells.push([x - x0, y - y0, z - z0, 'air']); continue; }
    cells.push([x - x0, y - y0, z - z0, BLOCKS[id].key === 'loot_chest' ? 'chest' : BLOCKS[id].key]); solid++;
  }
  if (!solid) return 'empty';
  return { id: 'bp_' + Date.now().toString(36), name, w: x1 - x0 + 1, h: y1 - y0 + 1, d: z1 - z0 + 1, y0: 0, cells };
}

export function myBlueprints(): Blueprint[] { try { return JSON.parse(localStorage.getItem('mye-blueprints') || '[]'); } catch { return []; } }
export function saveBlueprint(bp: Blueprint) { const l = myBlueprints().filter(x => x.id !== bp.id); l.push(bp); try { localStorage.setItem('mye-blueprints', JSON.stringify(l)); } catch { /* full */ } }
export function deleteBlueprint(id: string) { try { localStorage.setItem('mye-blueprints', JSON.stringify(myBlueprints().filter(x => x.id !== id))); } catch { /* ignore */ } }

/** where each cell lands for a placement (origin = front-left-bottom corner, rot = quarter turns) */
export function place(bp: Blueprint, ox: number, oy: number, oz: number, rot: number) {
  return bp.cells.map(([x, y, z, k]) => {
    let rx = x, rz = z;
    switch (rot & 3) { case 1: rx = bp.d - 1 - z; rz = x; break; case 2: rx = bp.w - 1 - x; rz = bp.d - 1 - z; break; case 3: rx = z; rz = bp.w - 1 - x; break; }
    return { x: ox + rx, y: oy + y, z: oz + rz, id: k === 'air' ? 0 : (BLOCK_ID[k] ?? -1), key: k };
  });
}

/** the translucent preview of a plan */
export class Ghost {
  mesh: THREE.InstancedMesh;
  constructor(public bp: Blueprint, scene: THREE.Scene) {
    const solid = bp.cells.filter(c => c[3] !== 'air');
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.96, 0.96), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.38, depthWrite: false }), Math.max(1, solid.length));
    this.mesh.frustumCulled = false;
    solid.forEach((c, i) => { const id = BLOCK_ID[c[3]]; this.mesh.setColorAt(i, new THREE.Color(id != null ? (BLOCKS[id].side ?? BLOCKS[id].top).c[0] : '#ff00ff')); });
    scene.add(this.mesh);
  }
  update(ox: number, oy: number, oz: number, rot: number, ok: boolean) {
    const m = new THREE.Matrix4(); let i = 0;
    for (const c of place(this.bp, ox, oy, oz, rot)) { if (c.key === 'air') continue; m.makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5); this.mesh.setMatrixAt(i++, m); }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).color.set(ok ? '#ffffff' : '#ff6666');
  }
  dispose(scene: THREE.Scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}
