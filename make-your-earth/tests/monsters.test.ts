import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { BLOCKS, BLOCK_ID } from '../src/shared/blocks';
import { ITEM, RECIPES } from '../src/shared/items';
import { ANIMALS, ANIMAL } from '../src/shared/biomes';
import { newFurnace, newChest, tickFurnace, smeltResult, fuelOf, contents, CHEST_SLOTS } from '../src/game/containers';
import { MAX_BLOCKS } from '../src/shared/custom';

describe('monsters and new animals', () => {
  it('every species has a model file (or is built in code)', () => {
    for (const a of ANIMALS) for (const m of a.models ?? [a.model]) {
      if (m.startsWith('proc:')) continue;
      expect(existsSync(`public/models/${m}.glb`), `${a.key}: ${m}`).toBe(true);
    }
  });
  it('has the four kinds of monster, burning undead and a tameable wolf', () => {
    for (const k of ['zombie', 'skeleton_archer', 'skeleton', 'giant_spider', 'cave_spider', 'cave_beast', 'bandit']) expect(ANIMAL[k], k).toBeTruthy();
    expect(ANIMAL.zombie.undead && ANIMAL.skeleton_archer.ranged && ANIMAL.cave_beast.cave).toBe(true);
    expect(ANIMAL.wolf.tame).toBe('bone'); expect(ANIMAL[ANIMAL.wolf.tameTo!].pet).toBe(true);
    expect(ITEM[ANIMAL.cat.tame!]).toBeTruthy();
  });
});

describe('blocks and items', () => {
  it('leaves room for at least 80 player-made blocks', () => {
    expect(MAX_BLOCKS - BLOCKS.length).toBeGreaterThanOrEqual(80);
  });
  it('has crops in three stages, coloured blocks and windows', () => {
    for (const f of ['wheat', 'carrot', 'potato']) for (let i = 0; i < 3; i++) expect(BLOCK_ID[`${f}_crop_${i}`], `${f} ${i}`).toBeDefined();
    for (const k of ['window', 'glass_red', 'wool_blue', 'concrete_black', 'terracotta_red', 'bed', 'lantern', 'wooden_door_open']) expect(BLOCK_ID[k], k).toBeDefined();
    for (const k of ['seeds', 'carrot', 'potato']) expect(BLOCK_ID[ITEM[k].plant!], k).toBeDefined();
    expect(ITEM.wooden_door_open).toBeUndefined();           // an open door is not an item
    expect(ITEM.iron_shield.shield!.block).toBeGreaterThan(ITEM.wooden_shield.shield!.block);
  });
  it('every coloured block can be made', () => {
    const made = new Set(RECIPES.map(r => r.out));
    for (const k of ['wool_red', 'glass_purple', 'concrete_yellow', 'terracotta_blue', 'window', 'bed', 'lantern', 'wooden_shield', 'iron_shield', 'shears']) expect(made.has(k), k).toBe(true);
  });
});

describe('furnace', () => {
  it('knows what smelts and what burns', () => {
    expect(smeltResult('raw_iron')!.out).toBe('iron_ingot');
    expect(smeltResult('oak_log')!.out).toBe('charcoal');       // tag recipe (#log)
    expect(smeltResult('dirt')).toBeNull();
    expect(fuelOf('coal')).toBeGreaterThan(fuelOf('stick'));
    expect(fuelOf('cobblestone')).toBe(0);
  });
  it('smelts one item every few seconds while it has fuel', () => {
    const f = newFurnace(); f.input = { k: 'raw_iron', n: 3 }; f.fuel = { k: 'coal', n: 1 };
    for (let t = 0; t < 40; t += 0.5) tickFurnace(f, 0.5);
    expect(f.out).toEqual({ k: 'iron_ingot', n: 3 });
    expect(f.input).toBeNull(); expect(f.fuel).toBeNull();
  });
  it('stops without fuel and spills what it holds', () => {
    const f = newFurnace(); f.input = { k: 'sand', n: 2 };
    for (let t = 0; t < 20; t += 0.5) tickFurnace(f, 0.5);
    expect(f.out).toBeNull();
    expect(contents(f)).toEqual([{ k: 'sand', n: 2 }]);
    const c = newChest(); expect(c.slots.length).toBe(CHEST_SLOTS); c.slots[3] = { k: 'diamond', n: 2 };
    expect(contents(c)).toEqual([{ k: 'diamond', n: 2 }]);
  });
});

import { registerCustom, resetCustom, encodeFace } from '../src/shared/custom';
describe('custom blocks', () => {
  it('a painted block with see-through pixels is transparent, so the ground next to it still draws', () => {
    resetCustom();
    const solid = new Uint8ClampedArray(16 * 16 * 4).fill(255), holes = solid.slice(); holes[3] = 0;
    const mk = (key: string, px: Uint8ClampedArray) => ({ key, name: key, author: 't', faces: new Array(6).fill(encodeFace(px)), fn: 'solid' as const, recipe: {}, at: 'hand' as const, n: 1, created: 0 });
    const a = registerCustom(mk('cb_solidx', solid))!, b = registerCustom(mk('cb_holesx', holes))!;
    expect(BLOCKS[a.id].transparent).toBe(false);
    expect(BLOCKS[b.id].transparent).toBe(true);
    resetCustom();
  });
});

describe('boats', () => {
  it('a rowing boat can be made at a workbench', () => {
    expect(ITEM.boat).toBeTruthy();
    expect(RECIPES.some(r => r.out === 'boat' && r.at === 'workbench')).toBe(true);
  });
});
