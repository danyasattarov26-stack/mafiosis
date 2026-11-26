/* Maps every block face to a tile in the texture atlas. Shared by the mesher (worker) and the atlas painter (page). */
import { BLOCKS, type Tex } from '../shared/blocks';

export const TILE_PX = 16, ATLAS_COLS = 16;
export const TILES: Tex[] = [];
const seen = new Map<string, number>();
const tileOf = (t: Tex) => { const k = JSON.stringify(t); let i = seen.get(k); if (i == null) { i = TILES.length; TILES.push(t); seen.set(k, i); } return i; };
/** [top, side, bottom] tile per block id */
export const BLOCK_TILES: [number, number, number][] = BLOCKS.map(b => [tileOf(b.top), tileOf(b.side ?? b.top), tileOf(b.bottom ?? b.top)]);
/** extra tiles for custom blocks made in the Block Maker are appended at runtime after these */
export const BASE_TILE_COUNT = TILES.length;
export const ATLAS_ROWS = 64;   // 16 × 64 = 1024 tiles of room (custom blocks use six each)
