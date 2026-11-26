import { describe, it, expect } from 'vitest';
import { BLOCKS, BLOCK_ID } from '../src/shared/blocks';
import { ITEMS, ITEM, RECIPES } from '../src/shared/items';
import { BIOMES, ANIMALS, ANIMAL } from '../src/shared/biomes';
import { en, pt } from '../src/i18n/strings';
import { TerrainGen, CS, CH } from '../src/world/gen';
import { meshChunk } from '../src/world/mesher';
import { Inventory } from '../src/game/inventory';
import { clean, cleanName } from '../src/net/coop';

describe('content registries', () => {
  it('has the launch amount of content', () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(60);
    expect(ITEMS.length).toBeGreaterThanOrEqual(200);
    expect(RECIPES.length).toBeGreaterThanOrEqual(120);
    expect(BIOMES.length).toBeGreaterThanOrEqual(8);
  });
  it('keys are unique and block ids fit in a byte', () => {
    expect(new Set(BLOCKS.map(b => b.key)).size).toBe(BLOCKS.length);
    expect(new Set(ITEMS.map(i => i.key)).size).toBe(ITEMS.length);
    expect(BLOCKS.length).toBeLessThan(256);
  });
  it('every recipe and drop points at real items', () => {
    for (const r of RECIPES) {
      expect(ITEM[r.out], r.out).toBeTruthy();
      for (const k of Object.keys(r.in)) if (!k.startsWith('#')) expect(ITEM[k], `${r.out} needs ${k}`).toBeTruthy();
    }
    for (const b of BLOCKS) if (b.drop) expect(ITEM[b.drop], `${b.key} drops ${b.drop}`).toBeTruthy();
    for (const a of ANIMALS) for (const [k] of a.drops) expect(ITEM[k], `${a.key} drops ${k}`).toBeTruthy();
  });
  it('each biome has at least five animal species that exist', () => {
    for (const b of BIOMES) { expect(b.animals.length, b.key).toBeGreaterThanOrEqual(5); for (const a of b.animals) expect(ANIMAL[a], a).toBeTruthy(); }
    for (const b of BIOMES) { expect(BLOCK_ID[b.top]).toBeDefined(); expect(BLOCK_ID[b.under]).toBeDefined(); }
  });
  it('every item and block has a Portuguese name', () => {
    for (const x of [...BLOCKS, ...ITEMS, ...BIOMES, ...ANIMALS]) expect((x as any).pt?.length, (x as any).key).toBeGreaterThan(0);
  });
});

describe('translations', () => {
  it('English and Portuguese have the same keys, none empty', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(pt)) expect(v.length, k).toBeGreaterThan(0);
  });
  it('placeholders match', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      const ph = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join();
      expect(ph(pt[k]), k).toBe(ph(en[k]));
    }
  });
});

describe('world generation', () => {
  const g = new TerrainGen(42);
  it('is deterministic', () => { expect(new TerrainGen(42).generate(3, -2)).toEqual(g.generate(3, -2)); });
  it('produces all eight biomes somewhere', () => {
    const seen = new Set<number>();
    for (let z = -30000; z < 30000; z += 400) for (let x = -30000; x < 30000; x += 400) seen.add(g.column(x, z).biome);
    expect(seen.size).toBe(BIOMES.filter(b => b.key !== 'sky').length);   // the Sky Isles are their own world
  });
  it('meshes a chunk into quads', () => {
    const c = g.generate(0, 0), m = meshChunk(c, [g.generate(-1, 0), g.generate(1, 0), g.generate(0, -1), g.generate(0, 1)]);
    expect(c.length).toBe(CS * CS * CH);
    expect(m.solid.index.length).toBeGreaterThan(0);
  });
  it('finds a dry spawn', () => { const s = g.findSpawn(0, 0, () => 0.5); expect(s.y).toBeGreaterThan(62); });
});

describe('inventory and crafting', () => {
  it('stacks, crafts and uses tags', () => {
    const inv = new Inventory();
    expect(inv.add('oak_log', 3)).toBe(0);
    const planks = RECIPES.find(r => r.out === 'oak_planks' && r.in.oak_log)!;
    expect(inv.craft(planks, 2)).toBe(2);
    expect(inv.count('oak_planks')).toBe(8);
    expect(inv.count('#planks')).toBe(8);
    const bench = RECIPES.find(r => r.out === 'workbench')!;
    expect(inv.craft(bench)).toBe(1);
    expect(inv.count('workbench')).toBe(1);
    expect(inv.count('#planks')).toBe(4);
  });
  it('does not overfill', () => { const inv = new Inventory(); expect(inv.add('stone_axe', 50)).toBe(5); });
});

describe('chat safety', () => {
  it('filters words and names', () => { expect(clean('what the fuck')).toBe('what the ****'); expect(clean('what the fuck', false)).toBe('what the fuck'); expect(cleanName('<b>Ana</b>!!')).toBe('bAnab'); });
});
