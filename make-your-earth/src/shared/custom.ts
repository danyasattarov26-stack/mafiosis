/*
  Player-made blocks from the Block Maker. A custom block is a normal registry entry added at runtime:
  a block (with six painted faces), an item that places it, and the recipe that makes it.
  Block numbers depend on the order a world learned its custom blocks, so each world saves its own list,
  and the registry is reset to the built-in blocks whenever a world is opened.
*/
import { BLOCKS, BLOCK_ID, type BlockDef } from './blocks';
import { ITEMS, ITEM, RECIPES, type Recipe, type Station } from './items';
import { TILES, BLOCK_TILES, ATLAS_COLS, ATLAS_ROWS } from '../world/tiles';

export type BlockFunction = 'solid' | 'light' | 'glass' | 'door' | 'ladder' | 'conveyor' | 'flammable' | 'explosive' | 'storage';
export const FUNCTIONS: BlockFunction[] = ['solid', 'light', 'glass', 'door', 'ladder', 'conveyor', 'flammable', 'explosive', 'storage'];
export interface CustomBlock {
  key: string; name: string; author: string;
  faces: string[];                 // six faces (+x, −x, top, bottom, +z, −z), each 16×16 RGBA as base64
  fn: BlockFunction; recipe: Record<string, number>; at: Station; n: number; created: number;
}
export interface Extra { climb?: boolean; conveyor?: boolean; explosive?: boolean; storage?: boolean }
export const EXTRA: Record<number, Extra> = {};

const BASE = { blocks: BLOCKS.length, items: ITEMS.length, recipes: RECIPES.length, tiles: TILES.length, blockTiles: BLOCK_TILES.length };
export const MAX_BLOCKS = 255;
export const customIds: number[] = [];

export const facePixels = (b64: string) => Uint8ClampedArray.from(atob(b64), c => c.charCodeAt(0));
export const encodeFace = (px: Uint8ClampedArray) => { let s = ''; for (let i = 0; i < px.length; i++) s += String.fromCharCode(px[i]); return btoa(s); };

/** forget all custom blocks (before opening a world) */
export function resetCustom() {
  for (const id of customIds) { delete BLOCK_ID[BLOCKS[id].key]; delete ITEM[BLOCKS[id].key]; delete EXTRA[id]; }
  customIds.length = 0;
  BLOCKS.length = BASE.blocks; ITEMS.length = BASE.items; RECIPES.length = BASE.recipes; TILES.length = BASE.tiles; BLOCK_TILES.length = BASE.blockTiles;
}

/** add a custom block to the registries; returns its block id and the atlas tiles to paint, or null if full */
export function registerCustom(c: CustomBlock): { id: number; tiles: number[] } | null {
  if (BLOCK_ID[c.key] != null) return { id: BLOCK_ID[c.key], tiles: BLOCK_TILES[BLOCK_ID[c.key]] as number[] };
  if (BLOCKS.length >= MAX_BLOCKS || TILES.length + 6 > ATLAS_COLS * ATLAS_ROWS) return null;
  const id = BLOCKS.length;
  const tiles = [0, 1, 2, 3, 4, 5].map(f => { TILES.push({ p: 'noise', c: ['#000'] }); return TILES.length - 1; });
  const def: BlockDef = {
    key: c.key, en: c.name, pt: c.name, top: { p: 'noise', c: avgColor(c.faces[2]) }, side: { p: 'noise', c: avgColor(c.faces[0]) },
    hard: c.fn === 'explosive' ? 0.3 : 1.2, tool: 'hand', render: c.fn === 'ladder' ? 'cross' : 'cube',
    solid: !(c.fn === 'door' || c.fn === 'ladder'), transparent: c.fn === 'glass' || c.fn === 'ladder',
    light: c.fn === 'light' ? 14 : undefined, flammable: c.fn === 'flammable' || c.fn === 'explosive' ? true : undefined,
  };
  BLOCKS.push(def); BLOCK_ID[c.key] = id; (BLOCK_TILES as number[][]).push(tiles);
  EXTRA[id] = { climb: c.fn === 'ladder', conveyor: c.fn === 'conveyor', explosive: c.fn === 'explosive', storage: c.fn === 'storage' };
  const item = { key: c.key, en: c.name, pt: c.name, kind: 'block' as const, color: def.side!.c[0], color2: def.top.c[0], stack: 64, block: id, tags: ['custom'] };
  ITEMS.push(item); ITEM[c.key] = item;
  const r: Recipe = { out: c.key, n: Math.max(1, Math.min(16, c.n | 0)), in: c.recipe, at: c.at };
  if (Object.keys(c.recipe).length) RECIPES.push(r);
  customIds.push(id);
  return { id, tiles };
}
function avgColor(b64: string) {
  const px = facePixels(b64); let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 10) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  const h = (v: number) => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0');
  return [`#${h(r)}${h(g)}${h(b)}`, `#${h(r * 0.8)}${h(g * 0.8)}${h(b * 0.8)}`];
}
/** the six face tiles of any block */
export const tiles6 = (id: number): number[] => { const t = BLOCK_TILES[id] as number[]; return t.length === 6 ? t : [t[1], t[1], t[0], t[2], t[1], t[1]]; };

// ---- the player's own library (kept across worlds on this device) ----
export function library(): CustomBlock[] { try { return JSON.parse(localStorage.getItem('mye-blocks') || '[]'); } catch { return []; } }
export function saveToLibrary(c: CustomBlock) { const l = library().filter(x => x.key !== c.key); l.push(c); try { localStorage.setItem('mye-blocks', JSON.stringify(l)); } catch { /* full */ } }
