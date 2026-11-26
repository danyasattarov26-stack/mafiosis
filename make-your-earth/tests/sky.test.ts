import { describe, it, expect } from 'vitest';
import { TerrainGen, SKY_BELLS, SKY_ALTAR, CS, idx } from '../src/world/gen';
import { B } from '../src/shared/blocks';
import { ANIMAL } from '../src/shared/biomes';
import { ITEM, RECIPES } from '../src/shared/items';
import { progress, newQuest, nearestVault, STARSTONES } from '../src/game/quest';
import { VAULTS, BUILDERS } from '../src/world/structures';
import { mulberry32 } from '../src/world/noise';

const at = (g: TerrainGen, x: number, y: number, z: number) => { const cx = Math.floor(x / CS), cz = Math.floor(z / CS); return g.generate(cx, cz)[idx(x - cx * CS, y, z - cz * CS)]; };
describe('the Sky Isles', () => {
  const g = new TerrainGen(99, 'sky');
  it('has an arena, the altar home and four bells on islands', () => {
    expect(g.column(0, 0).h).toBeGreaterThan(90);
    expect(at(g, SKY_ALTAR[0], SKY_ALTAR[1], SKY_ALTAR[2])).toBe(B.sky_altar);
    for (let i = 0; i < SKY_BELLS.length; i++) { const [x, y, z] = g.bellPos(i); expect(at(g, x, y, z), `bell ${i}`).toBe(B.sky_bell); }
  });
  it('is mostly open sky with islands, never touching the ground', () => {
    let open = 0, n = 0;
    for (let z = -400; z < 400; z += 13) for (let x = -400; x < 400; x += 13) { n++; if (g.column(x, z).h === 0) open++; }
    expect(open / n).toBeGreaterThan(0.3); expect(open / n).toBeLessThan(0.95);
    const d = g.generate(5, 5); for (let i = 0; i < 16 * 16 * 40; i++) expect(d[i]).toBe(0);
  });
});
describe('the story', () => {
  it('walks through the steps in order', () => {
    const q = newQuest(), inv = new Set<string>(), has = (k: string) => inv.has(k);
    expect(progress(q, has).step).toBe('compass');
    inv.add('star_compass'); expect(progress(q, has).step).toBe('stones');
    STARSTONES.forEach(s => inv.add(s)); expect(progress(q, has).step).toBe('beacon');
    q.beacon = [0, 70, 0]; expect(progress(q, has).step).toBe('sky');
    q.visited = true; expect(progress(q, has).step).toBe('bells');
    q.bells = [0, 1, 2, 3]; expect(progress(q, has).step).toBe('colossus');
    q.colossus = true; expect(progress(q, has).step).toBe('plant');
    q.ended = true; expect(progress(q, has).step).toBe('done');
  });
  it('every Starstone can be found, and the Beacon and compass can be made', () => {
    for (const s of STARSTONES) expect(Object.values(VAULTS)).toContain(s);
    for (const k of Object.keys(VAULTS)) expect(BUILDERS[k](mulberry32(1)).cells.some(c => c[3] === B.ancient_vault), k).toBe(true);
    const made = new Set(RECIPES.map(r => r.out));
    expect(made.has('sky_beacon') && made.has('star_compass')).toBe(true);
    expect(ANIMAL.colossus.drops.some(d => d[0] === 'world_seed')).toBe(true);
    expect(ITEM.world_seed).toBeTruthy();
  });
  it('the Star Compass finds a vault', () => {
    const v = nearestVault(new TerrainGen(4242), 0, 0, new Set(STARSTONES), 30);
    expect(v).toBeTruthy();
  });
});
