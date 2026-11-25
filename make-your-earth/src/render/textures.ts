/*
  Paints every block texture (16×16 pixels) into one atlas, and draws inventory icons, all in code.
  Nothing is copied from another game: each pattern is a small procedural recipe fed with the block's colours.
*/
import * as THREE from 'three';
import { TILES, TILE_PX, ATLAS_COLS, ATLAS_ROWS, BLOCK_TILES } from '../world/tiles';
import type { Tex } from '../shared/blocks';
import { BLOCKS } from '../shared/blocks';
import { ITEM, type ItemDef } from '../shared/items';

const hex = (c: string) => { const n = parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

/** draw one 16×16 tile into an ImageData-like buffer */
export function paintTile(t: Tex, seed: number): Uint8ClampedArray {
  const N = TILE_PX, px = new Uint8ClampedArray(N * N * 4), r = rng(seed * 7919 + 13);
  const A = hex(t.c[0]), Bc = hex(t.c[1] ?? t.c[0]);
  const put = (x: number, y: number, c: number[], j = 0, a = 255) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4, k = 1 + j;
    px[i] = c[0] * k; px[i + 1] = c[1] * k; px[i + 2] = c[2] * k; px[i + 3] = a;
  };
  const fill = (c: number[], jit = 0.08) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(x, y, c, (r() - 0.5) * jit * 2); };
  const speck = (c: number[], p: number, jit = 0.08) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (r() < p) put(x, y, c, (r() - 0.5) * jit * 2); };
  const clear = () => px.fill(0);
  switch (t.p) {
    case 'noise': case 'sand': case 'snow': case 'wool': case 'clay': fill(A, t.p === 'snow' ? 0.03 : 0.07); speck(Bc, t.p === 'sand' ? 0.3 : 0.25); break;
    case 'grass': fill(A, 0.1); speck(Bc, 0.35, 0.12); break;
    case 'grassSide': fill(A); speck(Bc.map(v => v * 0.85), 0.15); for (let x = 0; x < N; x++) { const d = 3 + Math.floor(r() * 3); for (let y = 0; y < d; y++) put(x, y, Bc, (r() - 0.5) * 0.15); } break;
    case 'log': for (let x = 0; x < N; x++) { const c = (x % 4 === 0 || r() < 0.15) ? Bc : A; for (let y = 0; y < N; y++) put(x, y, c, (r() - 0.5) * 0.12); } break;
    case 'logTop': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); put(x, y, d > 6.5 ? Bc : (Math.floor(d) % 2 ? A.map(v => v * 0.88) : A), (r() - 0.5) * 0.08); } break;
    case 'planks': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const row = Math.floor(y / 4), seam = y % 4 === 3 || (x + row * 5) % 16 === 0; put(x, y, seam ? Bc.map(v => v * 0.8) : (row % 2 ? A : Bc), (r() - 0.5) * 0.08); } break;
    case 'leaves': fill(A, 0.12); speck(Bc, 0.4, 0.12); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (r() < 0.16) px[(y * N + x) * 4 + 3] = 0; break;
    case 'stone': fill(A, 0.06); for (let k = 0; k < 6; k++) { const cx = r() * N, cy = r() * N, rad = 1 + r() * 2.5; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) put(x, y, Bc, (r() - 0.5) * 0.1); } break;
    case 'cobble': case 'strata': {
      fill(A, 0.08);
      if (t.p === 'strata') { for (let y = 0; y < N; y++) if (y % 4 === 0 || r() < 0.05) for (let x = 0; x < N; x++) put(x, y, Bc, (r() - 0.5) * 0.08); break; }
      const pts = Array.from({ length: 7 }, () => [r() * N, r() * N]);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = pts.map(p => Math.hypot(p[0] - x, p[1] - y)).sort((a, b) => a - b);
        if (d[1] - d[0] < 1.1) put(x, y, Bc, -0.1);
      }
      break;
    }
    case 'ore': fill(A, 0.06); for (let k = 0; k < 5; k++) { const cx = 2 + r() * 12, cy = 2 + r() * 12; for (let n = 0; n < 4; n++) put(Math.round(cx + (r() - 0.5) * 3), Math.round(cy + (r() - 0.5) * 3), Bc, (r() - 0.5) * 0.2); } break;
    case 'brick': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const row = Math.floor(y / 4), mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7; put(x, y, mortar ? Bc : A, (r() - 0.5) * 0.1); } break;
    case 'glass': clear(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1; put(x, y, edge ? Bc : A, 0, edge ? 230 : 60); } for (let i = 3; i < 9; i++) put(i, 12 - i, Bc, 0, 160); break;
    case 'water': fill(A, 0.05); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x + Math.round(Math.sin(y * 0.8) * 2)) % 7 === 0) put(x, y, Bc); break;
    case 'lava': fill(A, 0.1); speck(Bc, 0.35, 0.1); break;
    case 'ice': fill(A, 0.04); for (let k = 0; k < 3; k++) { let x = r() * N, y = r() * N; const dx = r() - 0.5, dy = r() - 0.5; for (let s = 0; s < 10; s++) { put(Math.round(x), Math.round(y), [255, 255, 255], 0); x += dx * 2; y += dy * 2; } } break;
    case 'metal': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(x, y, (y < 2 || x < 2) ? A.map(v => Math.min(255, v * 1.12)) : (y > 13 || x > 13) ? Bc : A, (r() - 0.5) * 0.04); for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]]) put(x, y, Bc, -0.2); break;
    case 'concrete': fill(A, 0.04); speck(Bc, 0.1, 0.04); for (let x = 0; x < N; x++) put(x, 15, Bc, -0.1); for (let y = 0; y < N; y++) put(15, y, Bc, -0.1); break;
    case 'crystal': fill(A, 0.08); for (let k = 0; k < 4; k++) { const cx = r() * N, cy = r() * N; for (let i = -2; i <= 2; i++) { put(Math.round(cx + i), Math.round(cy - i), Bc, 0.1); put(Math.round(cx), Math.round(cy + i), Bc, -0.05); } } break;
    case 'tiles': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const line = x % 8 === 0 || y % 8 === 0; const deco = (x % 8 === 4 && y % 8 > 1 && y % 8 < 7) || (y % 8 === 4 && x % 8 > 1 && x % 8 < 7); put(x, y, line ? A.map(v => v * 0.8) : deco ? Bc : A, (r() - 0.5) * 0.03); } break;
    case 'cactus': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(x, y, x % 4 === 1 ? Bc : A, (r() - 0.5) * 0.08); for (let k = 0; k < 10; k++) put(Math.floor(r() * N), Math.floor(r() * N), [240, 240, 210]); break;
    case 'cactusTop': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = Math.hypot(x - 7.5, y - 7.5); put(x, y, d > 6.5 ? Bc : A, (r() - 0.5) * 0.08); } break;
    case 'plant': clear(); for (let b = 0; b < 7; b++) { let x = 2 + r() * 12; const hgt = 7 + r() * 8, lean = (r() - 0.5) * 0.5; for (let y = 15; y > 15 - hgt; y--) { put(Math.round(x), y, r() < 0.5 ? A : Bc, (r() - 0.5) * 0.15); x += lean; } } break;
    case 'flower': clear(); for (let y = 6; y < 16; y++) put(7, y, A); put(6, 10, A); put(8, 12, A); for (let y = 2; y < 7; y++) for (let x = 5; x < 10; x++) if ((x - 7) ** 2 + (y - 4) ** 2 < 6) put(x, y, (x === 7 && y === 4) ? [250, 220, 60] : Bc, (r() - 0.5) * 0.1); break;
    case 'crop': clear(); for (let b = 0; b < 6; b++) { const x = 1 + b * 2.6; for (let y = 4; y < 16; y++) put(Math.round(x), y, A.map(v => v * 0.8), (r() - 0.5) * 0.1); for (let y = 1; y < 6; y++) put(Math.round(x) + (y % 2), y, Bc, 0.1); } break;
    case 'torch': clear(); for (let y = 6; y < 16; y++) { put(7, y, A); put(8, y, A, -0.15); } for (let y = 2; y < 7; y++) for (let x = 6; x < 10; x++) if (r() < 0.85) put(x, y, Bc, (r() - 0.3) * 0.3); put(7, 2, [255, 255, 200]); break;
    case 'door': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(x, y, (x === 0 || x === 15 || y === 0 || y === 15 || y === 7) ? Bc.map(v => v * 0.7) : A, (r() - 0.5) * 0.06); put(12, 8, Bc); put(12, 9, Bc); break;
    case 'table': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(x, y, (x % 5 === 0 || y % 5 === 0) ? Bc : A, (r() - 0.5) * 0.06); break;
    case 'furnace': fill(A, 0.06); for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) put(x, y, y > 10 ? Bc : [30, 30, 32], (r() - 0.3) * 0.2); break;
    case 'chest': for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(x, y, (x < 1 || x > 14 || y < 1 || y > 14 || y === 5) ? Bc : A, (r() - 0.5) * 0.06); for (let y = 4; y < 8; y++) { put(7, y, [210, 200, 160]); put(8, y, [210, 200, 160]); } break;
  }
  return px;
}

export interface Atlas { texture: THREE.DataTexture; data: Uint8Array; canvasFor(tile: number): HTMLCanvasElement; setTile(tile: number, px: Uint8ClampedArray): void }
export function buildAtlas(): Atlas {
  const W = ATLAS_COLS * TILE_PX, H = ATLAS_ROWS * TILE_PX, data = new Uint8Array(W * H * 4);
  const setTile = (tile: number, px: Uint8ClampedArray) => {
    const ox = (tile % ATLAS_COLS) * TILE_PX, oy = Math.floor(tile / ATLAS_COLS) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const s = (y * TILE_PX + x) * 4, d = ((oy + y) * W + ox + x) * 4;   // row 0 of the texture is the top of the tile (flipY off)
      data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = px[s + 3];
    }
  };
  TILES.forEach((t, i) => setTile(i, paintTile(t, i)));
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const canvasFor = (tile: number) => {
    const c = document.createElement('canvas'); c.width = c.height = TILE_PX;
    const img = new ImageData(TILE_PX, TILE_PX), ox = (tile % ATLAS_COLS) * TILE_PX, oy = Math.floor(tile / ATLAS_COLS) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) { const d = ((oy + y) * W + ox + x) * 4, s = (y * TILE_PX + x) * 4; for (let k = 0; k < 4; k++) img.data[s + k] = data[d + k]; }
    c.getContext('2d')!.putImageData(img, 0, 0); return c;
  };
  return { texture, data, canvasFor, setTile: (tile, px) => { setTile(tile, px); texture.needsUpdate = true; } };
}

// ---------------- item icons ----------------
const iconCache = new Map<string, string>();
let atlasRef: Atlas | null = null;
export const setIconAtlas = (a: Atlas) => { atlasRef = a; iconCache.clear(); };

export function itemIcon(key: string): string {
  let url = iconCache.get(key);
  if (url) return url;
  const it = ITEM[key];
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  if (it?.block != null && atlasRef) drawBlockIcon(g, it.block);
  else if (it) drawItemIcon(g, it);
  url = c.toDataURL(); iconCache.set(key, url);
  return url;
}
function drawBlockIcon(g: CanvasRenderingContext2D, id: number) {
  const [tTop, tSide] = BLOCK_TILES[id], b = BLOCKS[id];
  const top = atlasRef!.canvasFor(tTop), side = atlasRef!.canvasFor(tSide);
  if ((b.render ?? 'cube') !== 'cube') { g.drawImage(top, 4, 4, 32, 32); return; }
  // a little isometric cube: top, left and right faces
  g.save(); g.setTransform(1, 0.5, -1, 0.5, 20, 3); g.drawImage(top, 0, 0, 16, 16); g.restore();
  g.save(); g.setTransform(1, 0.5, 0, 1, 4, 11); g.drawImage(side, 0, 0, 16, 16); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, 16, 16); g.restore();
  g.save(); g.setTransform(1, -0.5, 0, 1, 20, 19); g.drawImage(side, 0, 0, 16, 16); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, 16, 16); g.restore();
}
function drawItemIcon(g: CanvasRenderingContext2D, it: ItemDef) {
  const c1 = it.color, c2 = it.color2 ?? '#6b4a2b';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (w: number, col: string, ...p: number[]) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };
  const blob = (x: number, y: number, rx: number, ry: number, col: string, rot = 0) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  const rect = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const handle = () => line(4, c2, 10, 32, 28, 10);
  switch (it.icon) {
    case 'axe': handle(); g.fillStyle = c1; g.beginPath(); g.moveTo(22, 6); g.lineTo(32, 10); g.lineTo(30, 20); g.lineTo(22, 14); g.fill(); break;
    case 'pickaxe': handle(); line(5, c1, 12, 8, 24, 6, 34, 16); break;
    case 'shovel': handle(); blob(28, 10, 5, 7, c1, -0.8); break;
    case 'sword': line(5, c1, 10, 30, 30, 8); line(4, c2, 8, 26, 16, 34); line(4, c2, 6, 34, 10, 30); break;
    case 'hoe': handle(); line(5, c1, 22, 8, 30, 6, 32, 12); break;
    case 'knife': line(5, c1, 14, 24, 30, 8); line(5, c2, 8, 32, 14, 24); break;
    case 'spear': line(3, c2, 6, 34, 28, 12); g.fillStyle = c1; g.beginPath(); g.moveTo(26, 8); g.lineTo(34, 6); g.lineTo(32, 14); g.fill(); break;
    case 'hammer': handle(); rect(20, 4, 14, 9, c1); break;
    case 'head': blob(20, 22, 12, 11, c1); rect(8, 22, 24, 8, c1); rect(12, 26, 16, 6, '#0006'); break;
    case 'chest': rect(9, 8, 22, 24, c1); rect(4, 8, 6, 12, c1); rect(30, 8, 6, 12, c1); rect(16, 8, 8, 4, '#0005'); break;
    case 'legs': rect(10, 6, 20, 8, c1); rect(10, 12, 8, 22, c1); rect(22, 12, 8, 22, c1); break;
    case 'feet': rect(6, 18, 11, 12, c1); rect(4, 26, 14, 6, c1); rect(23, 18, 11, 12, c1); rect(22, 26, 14, 6, c1); break;
    case 'meat': blob(18, 20, 12, 9, c1, -0.4); blob(14, 18, 5, 3, c2 === '#6b4a2b' ? '#f0d0c0' : c2, -0.4); line(4, '#efe6d2', 28, 28, 34, 34); break;
    case 'fish': blob(18, 20, 12, 7, c1); g.fillStyle = c1; g.beginPath(); g.moveTo(28, 20); g.lineTo(36, 13); g.lineTo(36, 27); g.fill(); blob(12, 18, 1.6, 1.6, '#111'); break;
    case 'berries': for (const [x, y] of [[14, 18], [22, 16], [18, 24], [26, 23], [12, 26]]) blob(x, y, 5, 5, c1); break;
    case 'fruit': blob(20, 22, 11, 11, c1); line(3, '#5a3a1a', 20, 12, 22, 6); blob(26, 9, 4, 2, '#4a8a30', -0.5); break;
    case 'carrot': g.fillStyle = c1; g.beginPath(); g.moveTo(10, 30); g.lineTo(26, 10); g.lineTo(32, 16); g.fill(); line(3, '#4a8a30', 28, 12, 34, 4); break;
    case 'mushroom': rect(17, 18, 6, 14, '#efe6d2'); blob(20, 18, 12, 7, c1); break;
    case 'wheat': case 'seeds': for (let i = 0; i < 3; i++) { line(2, '#8a7a3a', 12 + i * 7, 34, 14 + i * 7, 12); blob(14 + i * 7, 12, 3, 6, c1); } break;
    case 'bread': blob(20, 22, 14, 9, c1); line(2, '#0004', 12, 20, 16, 16); line(2, '#0004', 20, 20, 24, 16); break;
    case 'bowl': blob(20, 20, 12, 5, c1); g.fillStyle = '#8a5a32'; g.beginPath(); g.arc(20, 20, 13, 0, Math.PI); g.fill(); break;
    case 'jar': rect(12, 12, 16, 20, c1); rect(14, 8, 12, 5, '#8a6a3a'); break;
    case 'powder': blob(20, 26, 13, 7, c1); blob(20, 22, 8, 6, c1); break;
    case 'ball': blob(20, 20, 10, 10, c1); break;
    case 'bottle': rect(16, 6, 8, 8, '#cfe8f5'); blob(20, 24, 10, 10, '#cfe8f5'); blob(20, 25, 8, 8, c1); rect(17, 4, 6, 4, '#8a6a3a'); break;
    case 'herb': for (let i = 0; i < 4; i++) blob(14 + i * 4, 16 + (i % 2) * 6, 4, 8, c1, 0.5); line(2, '#4a6a2a', 20, 34, 20, 20); break;
    case 'bandage': rect(8, 14, 24, 12, c1); rect(18, 14, 4, 12, '#e23b3b'); break;
    case 'pill': blob(20, 20, 12, 6, c1, -0.6); g.save(); g.beginPath(); g.rect(20, 0, 20, 40); g.clip(); blob(20, 20, 12, 6, c2, -0.6); g.restore(); break;
    case 'box': rect(8, 10, 24, 22, c1); if (it.color2) { rect(18, 14, 4, 14, c2); rect(13, 19, 14, 4, c2); } break;
    case 'stick': line(4, c1, 10, 32, 30, 8); break;
    case 'fiber': for (let i = 0; i < 5; i++) line(2, c1, 8 + i * 5, 34, 14 + i * 4, 6); break;
    case 'rope': g.strokeStyle = c1; g.lineWidth = 4; g.beginPath(); g.arc(20, 20, 10, 0, Math.PI * 1.7); g.stroke(); break;
    case 'rock': g.fillStyle = c1; g.beginPath(); g.moveTo(8, 26); g.lineTo(14, 10); g.lineTo(28, 8); g.lineTo(34, 22); g.lineTo(24, 32); g.fill(); break;
    case 'ingot': g.fillStyle = c1; g.beginPath(); g.moveTo(6, 26); g.lineTo(12, 16); g.lineTo(34, 16); g.lineTo(28, 26); g.fill(); rect(12, 14, 22, 3, '#fff5'); break;
    case 'nugget': blob(16, 22, 6, 5, c1); blob(24, 18, 5, 5, c1); break;
    case 'gem': g.fillStyle = c1; g.beginPath(); g.moveTo(20, 6); g.lineTo(32, 18); g.lineTo(20, 34); g.lineTo(8, 18); g.fill(); line(2, '#fff8', 20, 8, 14, 18); break;
    case 'hide': g.fillStyle = c1; g.beginPath(); g.moveTo(8, 10); g.lineTo(32, 8); g.lineTo(34, 30); g.lineTo(20, 34); g.lineTo(6, 28); g.fill(); break;
    case 'bone': line(5, c1, 10, 30, 30, 10); blob(9, 31, 4, 4, c1); blob(31, 9, 4, 4, c1); break;
    case 'feather': blob(20, 20, 6, 15, c1, 0.7); line(2, '#aaa', 10, 32, 30, 8); break;
    case 'pane': rect(8, 6, 24, 28, c1); line(2, '#fff', 12, 28, 26, 12); break;
    case 'gear': g.fillStyle = c1; for (let i = 0; i < 8; i++) { g.save(); g.translate(20, 20); g.rotate(i * Math.PI / 4); g.fillRect(-3, -15, 6, 8); g.restore(); } blob(20, 20, 10, 10, c1); blob(20, 20, 4, 4, '#333'); break;
    case 'chip': rect(8, 10, 24, 20, c1); for (let i = 0; i < 4; i++) { rect(10 + i * 6, 6, 2, 4, '#ccc'); rect(10 + i * 6, 30, 2, 4, '#ccc'); } rect(14, 14, 12, 12, '#222'); break;
    case 'paper': rect(9, 6, 22, 28, c1); for (let i = 0; i < 4; i++) rect(12, 12 + i * 5, 16, 1.5, '#0003'); break;
    case 'book': rect(9, 6, 22, 28, c1); rect(9, 6, 4, 28, '#0004'); break;
    case 'coin': blob(20, 20, 12, 12, c1); blob(20, 20, 8, 8, '#d8ad2a'); break;
    case 'bucket': g.fillStyle = c1; g.beginPath(); g.moveTo(8, 12); g.lineTo(32, 12); g.lineTo(28, 34); g.lineTo(12, 34); g.fill(); break;
    case 'bow': g.strokeStyle = c1; g.lineWidth = 3; g.beginPath(); g.arc(8, 20, 16, -1.2, 1.2); g.stroke(); line(1, '#eee', 14, 5, 14, 35); break;
    case 'arrow': line(2, c1, 8, 32, 30, 10); g.fillStyle = '#888'; g.beginPath(); g.moveTo(28, 8); g.lineTo(34, 6); g.lineTo(32, 12); g.fill(); break;
    case 'rod': line(3, c1, 8, 34, 30, 6); line(1, '#eee', 30, 6, 32, 30); break;
    case 'compass': blob(20, 20, 13, 13, c1); blob(20, 20, 10, 10, '#f2eee6'); line(3, '#e23b3b', 20, 20, 20, 11); break;
    case 'flint': g.fillStyle = c1; g.beginPath(); g.moveTo(8, 30); g.lineTo(16, 8); g.lineTo(30, 14); g.lineTo(26, 32); g.fill(); break;
    default: blob(20, 20, 11, 11, c1);
  }
}
