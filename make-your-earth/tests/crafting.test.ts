import { describe, it, expect } from 'vitest';
import { matchGrid, consume } from '../src/game/crafting';

const hand = new Set(['hand']), bench = new Set(['hand', 'workbench']);
describe('grid crafting', () => {
  it('a log in the grid makes planks', () => {
    const m = matchGrid([{ k: 'oak_log', n: 1 }, null, null, null], hand);
    expect(m[0].r.out).toBe('oak_planks'); expect(m[0].times).toBe(1);
  });
  it('four planks can be sticks or a workbench, workbench first because it uses them all', () => {
    const g = [{ k: 'oak_planks', n: 1 }, { k: 'birch_planks', n: 1 }, { k: 'oak_planks', n: 1 }, { k: 'oak_planks', n: 1 }];
    const outs = matchGrid(g, hand).map(m => m.r.out);
    expect(outs[0]).toBe('workbench'); expect(outs).toContain('stick');
  });
  it('extra items that are not in the recipe stop it matching', () => {
    expect(matchGrid([{ k: 'stick', n: 1 }, { k: 'coal', n: 1 }, { k: 'dirt', n: 1 }], hand).some(m => m.r.out === 'torch')).toBe(false);
    expect(matchGrid([{ k: 'stick', n: 1 }, { k: 'coal', n: 1 }], hand)[0].r.out).toBe('torch');
  });
  it('station recipes need the station, and crafting takes one batch out', () => {
    const g = [{ k: 'cobblestone', n: 4 }, { k: 'cobblestone', n: 4 }, null, null, null, null, null, null, null];
    expect(matchGrid(g, hand).some(m => m.r.out === 'furnace')).toBe(false);
    const m = matchGrid(g, bench).find(x => x.r.out === 'furnace')!;
    expect(m).toBeTruthy();
    expect(consume(g, m.r)).toBe(true);
    expect(g.filter(Boolean).length).toBe(0);
  });
});
