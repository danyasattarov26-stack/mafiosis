/*
  Structures that spawn in the world: villages, cabins, watchtowers, desert pyramids and wells, jungle temples,
  igloos and mammoth-hunter camps, beach huts, shipwrecks and old ruins. They are picked per biome on a coarse
  grid from the seed, so every player (and every chunk) agrees on where they are. Each building sits on its own
  patch of ground: the space inside is cleared and a foundation fills any gap underneath.
  Old chests inside hold loot (see loot.ts) the first time someone opens them.
*/
import { B } from '../shared/blocks';
import { hash2, mulberry32 } from './noise';
import { BIOME_ID } from '../shared/biomes';

export type Cell = [number, number, number, number];         // x, y, z, block id (0 = clear to air)
export interface Shape { cells: Cell[]; w: number; d: number; h: number; found: number }   // found: foundation block

class S {
  cells = new Map<string, Cell>();
  constructor(public w: number, public d: number, public h: number, public found = B.cobblestone) {}
  set(x: number, y: number, z: number, id: number) { this.cells.set(`${x},${y},${z}`, [x, y, z, id]); }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, hollow = false) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (hollow && x > x0 && x < x1 && z > z0 && z < z1 && y > y0 && y < y1) this.set(x, y, z, 0);
      else this.set(x, y, z, id);
    }
  }
  clear() { this.box(0, 0, 0, this.w - 1, this.h - 1, this.d - 1, 0); return this; }
  done(): Shape { return { cells: [...this.cells.values()], w: this.w, d: this.d, h: this.h, found: this.found }; }
}

/** a gabled or pyramid roof over a w×d footprint starting at height y */
function roof(s: S, y: number, w: number, d: number, id: number) {
  for (let k = 0; k < Math.ceil(Math.min(w, d) / 2) + 1; k++) {
    const x0 = k - 1, x1 = w - k, z0 = k - 1, z1 = d - k;
    if (x0 > x1 || z0 > z1) break;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (x === x0 || x === x1 || z === z0 || z === z1) s.set(x, y + k, z, id);
  }
}

export const BUILDERS: Record<string, (r: () => number) => Shape> = {
  cabin: r => {
    const s = new S(7, 7, 9, B.cobblestone).clear();
    s.box(0, 0, 0, 6, 0, 6, B.oak_planks);
    s.box(0, 1, 0, 6, 3, 6, B.oak_planks, true);
    for (const [x, z] of [[0, 0], [6, 0], [0, 6], [6, 6]]) s.box(x, 1, z, x, 3, z, B.oak_log);
    s.set(3, 1, 0, B.wooden_door); s.set(3, 2, 0, B.wooden_door);
    s.set(0, 2, 3, B.window); s.set(6, 2, 3, B.window); s.set(3, 2, 6, B.window);
    roof(s, 4, 7, 7, r() < 0.5 ? B.thatch : B.pine_planks);
    s.set(1, 1, 5, B.workbench); s.set(5, 1, 5, B.loot_chest); s.set(5, 1, 1, B.bed); s.set(1, 2, 1, B.torch); s.set(1, 1, 1, B.bookshelf);
    return s.done();
  },
  house: r => {
    const big = r() < 0.5, w = big ? 7 : 5, d = big ? 7 : 6;
    const s = new S(w, d, 8, B.cobblestone).clear();
    s.box(0, 0, 0, w - 1, 0, d - 1, B.cobblestone);
    s.box(0, 1, 0, w - 1, 3, d - 1, r() < 0.5 ? B.oak_planks : B.birch_planks, true);
    for (const [x, z] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]]) s.box(x, 1, z, x, 3, z, B.oak_log);
    const door = Math.floor(w / 2); s.set(door, 1, 0, B.wooden_door); s.set(door, 2, 0, B.wooden_door);
    s.set(0, 2, Math.floor(d / 2), B.window); s.set(w - 1, 2, Math.floor(d / 2), B.window);
    roof(s, 4, w, d, B.thatch);
    s.set(1, 1, d - 2, B.bed); s.set(w - 2, 1, d - 2, r() < 0.6 ? B.loot_chest : B.hay_bale); s.set(1, 2, 1, B.torch);
    return s.done();
  },
  smithy: () => {
    const s = new S(7, 6, 7, B.cobblestone).clear();
    s.box(0, 0, 0, 6, 0, 5, B.stone_bricks);
    s.box(0, 1, 5, 6, 3, 5, B.cobblestone); s.box(0, 1, 0, 0, 3, 5, B.cobblestone); s.box(6, 1, 0, 6, 3, 5, B.cobblestone);
    for (const x of [0, 6]) s.box(x, 1, 0, x, 3, 0, B.oak_log);
    s.box(0, 4, 0, 6, 4, 5, B.stone_bricks);
    s.set(1, 1, 4, B.furnace); s.set(2, 1, 4, B.furnace); s.set(4, 1, 3, B.anvil); s.set(5, 1, 4, B.loot_chest); s.set(3, 3, 4, B.torch);
    return s.done();
  },
  well: () => {
    const s = new S(5, 5, 5, B.cobblestone).clear();
    s.box(0, -3, 0, 4, 0, 4, B.cobblestone); s.box(1, -2, 1, 3, 0, 3, B.water);
    s.box(0, 1, 0, 4, 1, 4, B.cobblestone, false); s.box(1, 1, 1, 3, 1, 3, B.water);
    for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) s.box(x, 2, z, x, 3, z, B.oak_log);
    s.box(0, 4, 0, 4, 4, 4, B.oak_planks);
    return s.done();
  },
  farm: () => {
    const s = new S(9, 7, 2, B.dirt).clear();
    s.box(0, 0, 0, 8, 0, 6, B.oak_log);
    s.box(1, 0, 1, 7, 0, 5, B.farmland);
    for (let x = 1; x <= 7; x++) s.set(x, 0, 3, B.water);
    for (let z = 1; z <= 5; z++) for (let x = 1; x <= 7; x++) if (z !== 3) s.set(x, 1, z, B.wheat);
    return s.done();
  },
  tower: () => {
    const s = new S(5, 5, 14, B.stone_bricks).clear();
    s.box(0, 0, 0, 4, 10, 4, B.stone_bricks, true);
    s.box(0, 0, 0, 4, 0, 4, B.stone_bricks);
    s.set(2, 1, 0, 0); s.set(2, 2, 0, 0);
    for (let y = 1; y <= 10; y++) s.set(2, y, 3, B.ladder);
    for (const y of [4, 7]) { s.set(0, y, 2, B.iron_bars); s.set(4, y, 2, B.iron_bars); }
    s.box(-1, 11, -1, 5, 11, 5, B.stone_bricks); s.set(2, 11, 3, 0);
    for (const [x, z] of [[-1, -1], [5, -1], [-1, 5], [5, 5], [2, -1], [2, 5], [-1, 2], [5, 2]]) s.set(x, 12, z, B.stone_bricks);
    s.set(1, 12, 1, B.lantern); s.set(3, 12, 1, B.loot_chest);
    return s.done();
  },
  pyramid: () => {
    const N = 15, s = new S(N, N, 10, B.sandstone).clear();
    for (let k = 0; k < 8; k++) s.box(k, k, k, N - 1 - k, k, N - 1 - k, k % 3 === 2 ? B.chiseled_sandstone : B.sandstone);
    s.box(4, 1, 4, 10, 3, 10, 0);
    s.box(7, 1, 0, 7, 2, 4, 0);
    s.set(5, 1, 5, B.loot_chest); s.set(9, 1, 9, B.loot_chest); s.set(5, 1, 9, B.torch); s.set(9, 1, 5, B.torch);
    s.box(6, 0, 6, 8, 0, 8, B.chiseled_sandstone);
    return s.done();
  },
  desert_well: () => {
    const s = new S(5, 5, 4, B.sandstone).clear();
    s.box(0, 0, 0, 4, 0, 4, B.sandstone); s.box(1, -3, 1, 3, 0, 3, B.sandstone); s.set(2, 0, 2, B.water); s.set(2, -1, 2, B.water);
    s.box(0, 1, 0, 4, 1, 4, B.chiseled_sandstone); s.box(1, 1, 1, 3, 1, 3, 0); s.set(2, 1, 2, B.water);
    for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) s.set(x, 2, z, B.sandstone);
    s.box(0, 3, 0, 4, 3, 4, B.sandstone);
    return s.done();
  },
  temple: () => {
    const s = new S(11, 11, 10, B.mossy_cobble).clear();
    for (let k = 0; k < 4; k++) s.box(k, k * 2, k, 10 - k, k * 2 + 1, 10 - k, k % 2 ? B.mossy_bricks : B.mossy_cobble);
    s.box(2, 1, 2, 8, 4, 8, 0); s.box(5, 1, 0, 5, 2, 2, 0);
    s.set(3, 1, 7, B.loot_chest); s.set(7, 1, 7, B.loot_chest); s.set(5, 1, 5, B.gold_block); s.set(3, 3, 3, B.torch); s.set(7, 3, 3, B.torch);
    s.set(5, 8, 5, B.cracked_bricks);
    return s.done();
  },
  igloo: () => {
    const s = new S(9, 9, 6, B.snow).clear();
    for (let y = 0; y <= 4; y++) for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) {
      const d = Math.hypot(x - 4, y * 1.1, z - 4);
      if (d <= 4.3 && d > 3.2) s.set(x, y, z, B.snow_bricks);
      else if (d <= 3.2) s.set(x, y, z, 0);
    }
    s.box(4, 0, 0, 4, 1, 1, 0); s.set(4, 0, 4, B.campfire); s.set(2, 0, 5, B.loot_chest); s.set(6, 0, 5, B.wool);
    return s.done();
  },
  hunters_camp: () => {
    const s = new S(9, 9, 4, B.snow).clear();
    s.set(4, 0, 4, B.campfire);
    for (const [x, z] of [[1, 1], [7, 2], [2, 7], [6, 7]]) { s.set(x, 0, z, B.mammoth_bones); s.set(x, 1, z, B.mammoth_bones); }
    s.box(0, 0, 3, 0, 2, 5, B.pine_log); s.box(0, 3, 3, 2, 3, 5, B.wool);
    s.set(7, 0, 4, B.loot_chest); s.set(8, 0, 6, B.hay_bale);
    return s.done();
  },
  beach_hut: () => {
    const s = new S(6, 6, 8, B.palm_log).clear();
    for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) s.box(x, 0, z, x, 2, z, B.palm_log);
    s.box(0, 2, 0, 5, 2, 5, B.birch_planks);
    for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) s.box(x, 3, z, x, 4, z, B.palm_log);
    roof(s, 5, 6, 6, B.thatch);
    s.set(4, 3, 4, B.loot_chest); s.set(1, 3, 4, B.wool);
    s.set(2, 0, -1, B.ladder); s.set(2, 1, -1, B.ladder); s.set(2, 2, -1, B.ladder);
    return s.done();
  },
  shipwreck: () => {
    const s = new S(5, 13, 6, B.sand).clear();
    for (let z = 0; z < 13; z++) {
      const half = z < 2 || z > 10 ? 1 : 2;
      for (let x = 2 - half; x <= 2 + half; x++) s.set(x, 0, z, B.oak_planks);
      for (let y = 1; y <= 2; y++) { s.set(2 - half, y, z, B.oak_planks); s.set(2 + half, y, z, z % 4 === 1 ? 0 : B.oak_planks); }
    }
    s.box(2, 1, 6, 2, 5, 6, B.oak_log); s.box(1, 5, 6, 3, 5, 6, B.wool);
    s.set(2, 1, 9, B.loot_chest); s.set(1, 1, 3, B.loot_chest);
    return s.done();
  },
  ruins: r => {
    const s = new S(9, 9, 5, B.cobblestone);
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) {
      if (x === 0 || x === 8 || z === 0 || z === 8) { const hgt = Math.floor(r() * 4); for (let y = 0; y <= hgt; y++) s.set(x, y, z, r() < 0.4 ? B.mossy_bricks : r() < 0.5 ? B.cracked_bricks : B.stone_bricks); }
      else s.set(x, 0, z, r() < 0.3 ? B.mossy_cobble : B.cobblestone);
    }
    s.set(4, 1, 4, B.loot_chest);
    return s.done();
  },
};

/** structures that can appear in each biome, with how many grid cells hold one */
const KINDS: Record<number, { kind: string; w: number }[]> = {
  [BIOME_ID.forest]: [{ kind: 'village', w: 3 }, { kind: 'cabin', w: 3 }, { kind: 'tower', w: 1 }, { kind: 'ruins', w: 2 }],
  [BIOME_ID.savanna]: [{ kind: 'village', w: 3 }, { kind: 'ruins', w: 1 }],
  [BIOME_ID.desert]: [{ kind: 'pyramid', w: 2 }, { kind: 'desert_well', w: 3 }, { kind: 'ruins', w: 1 }],
  [BIOME_ID.jungle]: [{ kind: 'temple', w: 3 }, { kind: 'ruins', w: 1 }],
  [BIOME_ID.tundra]: [{ kind: 'igloo', w: 3 }, { kind: 'hunters_camp', w: 3 }],
  [BIOME_ID.mountains]: [{ kind: 'tower', w: 2 }, { kind: 'ruins', w: 1 }],
  [BIOME_ID.beach]: [{ kind: 'beach_hut', w: 3 }, { kind: 'shipwreck', w: 2 }],
};
export const CELL = 144;              // one chance of a structure per 144×144 blocks
const CHANCE = 0.55;

export interface Part { x: number; z: number; rot: number; shape: Shape; kind: string }
export interface Site { kind: string; x: number; z: number; parts: Part[] }

/** the structure (if any) whose site is in grid cell (gx, gz) */
export function siteAt(gx: number, gz: number, seed: number, column: (x: number, z: number) => { h: number; biome: number; river: number }, SEA: number): Site | null {
  if (hash2(gx, gz, seed + 991) > CHANCE) return null;
  const x = gx * CELL + 24 + Math.floor(hash2(gx, gz, seed + 992) * (CELL - 48)), z = gz * CELL + 24 + Math.floor(hash2(gx, gz, seed + 993) * (CELL - 48));
  const col = column(x, z);
  const opts = KINDS[col.biome]; if (!opts || col.river) return null;
  const tot = opts.reduce((a, o) => a + o.w, 0); let pick = hash2(gx, gz, seed + 994) * tot, kind = opts[0].kind;
  for (const o of opts) { if (pick < o.w) { kind = o.kind; break; } pick -= o.w; }
  const r = mulberry32(Math.floor(hash2(gx, gz, seed + 995) * 2 ** 31));
  const parts: Part[] = [];
  const add = (k: string, px: number, pz: number, tries = 1) => {
    // try a few nearby spots: buildings need dry, fairly level ground
    for (let i = 0; i < tries; i++) {
      const qx = i ? Math.round(px + (r() - 0.5) * 14) : px, qz = i ? Math.round(pz + (r() - 0.5) * 14) : pz;
      const c = column(qx, qz);
      if (k !== 'shipwreck' && (c.h < SEA + 1 || c.river)) continue;
      if (k !== 'shipwreck' && Math.abs(c.h - col.h) > 8 && parts.length) continue;
      if (parts.some(p => Math.abs(p.x - qx) < 9 && Math.abs(p.z - qz) < 9)) continue;   // don't overlap neighbours
      parts.push({ x: qx, z: qz, rot: Math.floor(r() * 4), shape: BUILDERS[k](r), kind: k });
      return;
    }
  };
  if (kind === 'village') {
    add('well', x, z);
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r() * 0.5, d = 13 + r() * 10; add(i === 0 ? 'smithy' : i === n - 1 && r() < 0.6 ? 'farm' : 'house', Math.round(x + Math.cos(a) * d), Math.round(z + Math.sin(a) * d), 6); }
  } else if (kind === 'shipwreck') {
    if (col.h >= SEA + 4) return null;
    add('shipwreck', x, z);
  } else add(kind, x, z);
  return parts.length ? { kind, x, z, parts } : null;
}

/** rotate a cell inside a w×d footprint by rot quarter turns */
export function rotate(c: Cell, w: number, d: number, rot: number): [number, number] {
  const [x, , z] = c;
  switch (rot & 3) { case 1: return [d - 1 - z, x]; case 2: return [w - 1 - x, d - 1 - z]; case 3: return [z, w - 1 - x]; default: return [x, z]; }
}
