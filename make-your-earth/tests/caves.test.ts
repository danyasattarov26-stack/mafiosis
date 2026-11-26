import { describe, it, expect } from 'vitest';
import { B } from '../src/shared/blocks';
import { TerrainGen, CS, CH, idx } from '../src/world/gen';

describe('caves and ravines', () => {
  it('carves tunnels, caverns and decorations underground, and stays fast', () => {
    const g = new TerrainGen(12345);
    const count: Record<number, number> = {};
    let air = 0, t = performance.now(), n = 0;
    for (let cz = -4; cz < 4; cz++) for (let cx = -4; cx < 4; cx++) {
      const d = g.generate(cx, cz); n++;
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        const h = g.column(cx * CS + x, cz * CS + z).h;
        for (let y = 5; y < Math.min(h - 8, CH); y++) { const id = d[idx(x, y, z)]; count[id] = (count[id] ?? 0) + 1; if (id === 0) air++; }
      }
    }
    const ms = (performance.now() - t) / n;
    const total = Object.values(count).reduce((a, b) => a + b, 0);
    console.log('cave air share', (air / total).toFixed(3), 'ms/chunk', ms.toFixed(1), 'crystals', count[B.glow_crystal] ?? 0, 'clusters', count[B.crystal_cluster] ?? 0, 'mushrooms', (count[B.glow_mushroom] ?? 0) + (count[B.red_mushroom] ?? 0), 'water', count[B.water] ?? 0, 'lava', count[B.lava] ?? 0);
    expect(air / total).toBeGreaterThan(0.04);
    expect((count[B.glow_crystal] ?? 0) + (count[B.crystal_cluster] ?? 0)).toBeGreaterThan(5);
    expect(ms).toBeLessThan(60);
  });
  it('finds ravines somewhere on land', () => {
    const g = new TerrainGen(777);
    let found = 0;
    for (let z = -3000; z < 3000 && !found; z += 7) for (let x = -3000; x < 3000; x += 37) { const c = g.column(x, z); if (g.ravine(x, z, c.h, c.river)) { found++; break; } }
    expect(found).toBeGreaterThan(0);
  });
});
