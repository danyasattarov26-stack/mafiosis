import { describe, it, expect } from 'vitest';
import { BIOMES } from '../src/shared/biomes';
import { TerrainGen } from '../src/world/gen';
import { BUILDERS, siteAt, CELL } from '../src/world/structures';
import { mulberry32 } from '../src/world/noise';

describe('biomes and structures', () => {
  it('every biome shows up somewhere in a big world', () => {
    const g = new TerrainGen(4242), count = new Array(BIOMES.length).fill(0);
    for (let z = -9000; z < 9000; z += 61) for (let x = -9000; x < 9000; x += 61) count[g.column(x, z).biome]++;
    const total = count.reduce((a, b) => a + b, 0);
    console.log(BIOMES.map((b, i) => `${b.key} ${(count[i] / total * 100).toFixed(1)}%`).join(', '));
    for (let i = 0; i < BIOMES.length; i++) expect(count[i], BIOMES[i].key).toBeGreaterThan(0);
  });
  it('every structure can be built and new ones appear in the world', () => {
    for (const [k, b] of Object.entries(BUILDERS)) { const s = b(mulberry32(1)); expect(s.cells.length, k).toBeGreaterThan(5); }
    const g = new TerrainGen(4242), seen = new Set<string>();
    for (let gz = -40; gz < 40; gz++) for (let gx = -40; gx < 40; gx++) { const s = siteAt(gx, gz, 4242, (x, z) => g.column(x, z), 62); if (s) for (const p of s.parts) seen.add(p.kind); }
    console.log([...seen].join(', '));
    for (const k of ['mine_shaft', 'camp', 'stone_circle', 'log_cabin', 'swamp_shack', 'obsidian_altar']) expect(seen.has(k), k).toBe(true);
    void CELL;
  });
});
