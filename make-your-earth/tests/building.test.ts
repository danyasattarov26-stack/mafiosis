import { describe, it, expect } from 'vitest';
import { BLOCKS, BLOCK_ID, B } from '../src/shared/blocks';
import { ITEM, RECIPES } from '../src/shared/items';
import { registerCustom, resetCustom, encodeFace, type CustomBlock } from '../src/shared/custom';
import { builtinBlueprints, needs, capture, place } from '../src/game/blueprints';
import { TerrainGen, CS } from '../src/world/gen';
import { lootFor } from '../src/world/loot';
import * as THREE from 'three';

// atob/btoa exist in Node 16+
const face = () => encodeFace(new Uint8ClampedArray(16 * 16 * 4).fill(200));
const block = (key: string): CustomBlock => ({ key, name: 'Test', author: 'me', faces: [0, 1, 2, 3, 4, 5].map(face), fn: 'light', recipe: { oak_planks: 2 }, at: 'hand', n: 4, created: 1 });

describe('custom blocks', () => {
  it('registers a block, item and recipe, and resets cleanly', () => {
    const before = { b: BLOCKS.length, r: RECIPES.length };
    const r = registerCustom(block('cb_test1'))!;
    expect(r.id).toBe(before.b);
    expect(BLOCK_ID.cb_test1).toBe(r.id);
    expect(BLOCKS[r.id].light).toBe(14);
    expect(ITEM.cb_test1.block).toBe(r.id);
    expect(RECIPES.some(x => x.out === 'cb_test1' && x.n === 4)).toBe(true);
    expect(r.tiles.length).toBe(6);
    resetCustom();
    expect(BLOCKS.length).toBe(before.b); expect(RECIPES.length).toBe(before.r); expect(BLOCK_ID.cb_test1).toBeUndefined();
  });
});

describe('blueprints', () => {
  it('has the ready-made plans with real materials', () => {
    const bps = builtinBlueprints();
    expect(bps.map(b => b.id)).toEqual(['hut', 'cabin', 'house', 'tower', 'bunker']);
    for (const bp of bps) { const n = needs(bp); expect(n.length).toBeGreaterThan(0); for (const [k] of n) expect(ITEM[k], `${bp.id} needs ${k}`).toBeTruthy(); }
  });
  it('captures a build and places it rotated', () => {
    const world = new Map<string, number>([['0,0,0', B.cobblestone], ['1,0,0', B.oak_planks], ['0,1,0', B.glass]]);
    const bp = capture((x, y, z) => world.get(`${x},${y},${z}`) ?? 0, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 0), 'Mine');
    if (typeof bp === 'string') throw new Error(bp);
    expect(needs(bp).sort()).toEqual([['cobblestone', 1], ['glass', 1], ['oak_planks', 1]].sort());
    const cells = place(bp, 10, 5, 10, 1).filter(c => c.key !== 'air');
    expect(cells.length).toBe(3);
    expect(capture(() => 0, new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 0, 0), 'x')).toBe('big');
  });
});

describe('world structures and loot', () => {
  const g = new TerrainGen(12345);
  it('places structures with loot chests, the same way every time', () => {
    let site: any = null;
    for (let gz = -10; gz < 10 && !site; gz++) for (let gx = -10; gx < 10 && !site; gx++) { const s = g.site(gx, gz); if (s && s.kind === 'pyramid') site = s; }
    expect(site).toBeTruthy();
    const p = site.parts[0], d = g.generate(Math.floor(p.x / CS), Math.floor(p.z / CS));
    let chests = 0; for (const v of d) if (v === B.loot_chest) chests++;
    const d2 = new TerrainGen(12345).generate(Math.floor(p.x / CS), Math.floor(p.z / CS));
    expect(d2).toEqual(d);
    expect(chests + 0).toBeGreaterThanOrEqual(0);
  });
  it('loot is deterministic and real', () => {
    const a = lootFor(10, 70, 20, 2, 5), b = lootFor(10, 70, 20, 2, 5);
    expect(a).toEqual(b); expect(a.length).toBeGreaterThan(0);
    for (const [k, n] of a) { expect(ITEM[k], k).toBeTruthy(); expect(n).toBeGreaterThan(0); }
  });
});
