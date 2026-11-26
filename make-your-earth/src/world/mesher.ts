/*
  Greedy mesher. Turns a 16×256×16 chunk (plus a one-block border from its neighbours) into as few
  quads as possible: neighbouring faces with the same texture and light are merged into one rectangle.
  Light is baked per face: sunlight (spreads down from the sky and sideways into caves) and block light
  from torches, fires and lava. Water goes to its own mesh; plants are drawn as crossed quads.
*/
import { BLOCKS } from '../shared/blocks';
import { BLOCK_TILES } from './tiles';
import { CS, CH } from './gen';

const PX = CS + 2, PL = PX * PX;
const pidx = (x: number, y: number, z: number) => (x + 1) + (z + 1) * PX + y * PL;

// per-block lookup tables (fast in the inner loops)
const N = 256;
export const RENDER = new Uint8Array(N);   // 0 none, 1 cube, 2 cross, 3 liquid
export const OPAQUE = new Uint8Array(N);   // full cube that hides faces behind it
export const TRANSP = new Uint8Array(N);
export const LIGHTEMIT = new Uint8Array(N);
export const SKYBLOCK = new Uint8Array(N); // stops sunlight (0 = passes, 1 = dims, 15 = blocks)
export function buildTables(extra: { render?: string; transparent?: boolean; light?: number; key?: string }[] = []) {
  [...BLOCKS, ...extra].forEach((b, i) => {
    if (i >= N) return;
    const r = b.render ?? 'cube';
    RENDER[i] = i === 0 ? 0 : r === 'cube' ? 1 : r === 'cross' ? 2 : r === 'liquid' ? 3 : 0;
    TRANSP[i] = b.transparent || i === 0 ? 1 : 0;
    OPAQUE[i] = RENDER[i] === 1 && !TRANSP[i] ? 1 : 0;
    LIGHTEMIT[i] = b.light ?? 0;
    SKYBLOCK[i] = OPAQUE[i] ? 15 : RENDER[i] === 3 ? 2 : (RENDER[i] === 1 && TRANSP[i] && !(b as any).key?.includes?.('glass')) ? 1 : 0;
  });
}
buildTables();
/** tile per face: +x, −x, +y (top), −y (bottom), +z, −z */
export const TILE6 = new Uint16Array(N * 6);
export function setTiles(tiles: number[][]) {
  tiles.forEach((t, i) => { const six = t.length === 6 ? t : [t[1], t[1], t[0], t[2], t[1], t[1]]; for (let f = 0; f < 6; f++) TILE6[i * 6 + f] = six[f]; });
}
setTiles(BLOCK_TILES);

export interface MeshData { pos: Float32Array; tex: Float32Array; tile: Float32Array; light: Float32Array; index: Uint32Array }
class Buf {
  pos: number[] = []; tex: number[] = []; tile: number[] = []; light: number[] = []; index: number[] = []; n = 0;
  out(): MeshData { return { pos: new Float32Array(this.pos), tex: new Float32Array(this.tex), tile: new Float32Array(this.tile), light: new Float32Array(this.light), index: new Uint32Array(this.index) }; }
}

/** neighbours: [−x, +x, −z, +z] chunk arrays (may be null at the edge of the loaded area) */
export function meshChunk(data: Uint8Array, nb: (Uint8Array | null)[]): { solid: MeshData; water: MeshData } {
  // ---- padded copy ----
  const P = new Uint8Array(PL * CH);
  let maxY = 0;
  for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) { const id = data[x + z * CS + y * CS * CS]; P[pidx(x, y, z)] = id; if (id) maxY = y; }
  for (let y = 0; y < CH; y++) for (let i = 0; i < CS; i++) {
    const s = y * CS * CS;
    P[pidx(-1, y, i)] = nb[0] ? nb[0][CS - 1 + i * CS + s] : 0;
    P[pidx(CS, y, i)] = nb[1] ? nb[1][0 + i * CS + s] : 0;
    P[pidx(i, y, -1)] = nb[2] ? nb[2][i + (CS - 1) * CS + s] : 0;
    P[pidx(i, y, CS)] = nb[3] ? nb[3][i + 0 + s] : 0;
  }
  const top = Math.min(CH - 1, maxY + 2);
  // ---- light: sky (high nibble) and block (low nibble) ----
  const L = new Uint8Array(PL * CH);
  const q: number[] = [];
  // straight-down sunlight; remember where each column stops being fully lit
  const H = new Int16Array(PX * PX);
  for (let z = -1; z <= CS; z++) for (let x = -1; x <= CS; x++) {
    let lvl = 15, y = CH - 1;
    for (; y >= 0; y--) {
      const i = pidx(x, y, z), blk = SKYBLOCK[P[i]];
      if (blk >= 15) break;
      if (blk) lvl = Math.max(0, lvl - blk);
      if (lvl <= 0) break;
      L[i] = lvl << 4;
      if (lvl < 15) break;
    }
    // keep filling the dimmed part (water, leaves) without seeding it
    for (let yy = y - 1, l2 = (L[pidx(x, Math.max(0, y), z)] >> 4); yy >= 0 && l2 > 0; yy--) {
      const i = pidx(x, yy, z), blk = SKYBLOCK[P[i]]; if (blk >= 15) break; l2 = Math.max(0, l2 - (blk || 1)); L[i] = l2 << 4;
    }
    H[(x + 1) + (z + 1) * PX] = y;
  }
  // seed only the sunlit cells that sit beside a shaded column (cave mouths, overhangs, under trees)
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const hh = H[(x + 1) + (z + 1) * PX];
    const m = Math.max(H[x + (z + 1) * PX], H[(x + 2) + (z + 1) * PX], H[(x + 1) + z * PX], H[(x + 1) + (z + 2) * PX]);
    for (let y = Math.max(0, Math.min(hh, m) - 1); y <= Math.min(top, Math.max(hh, m) + 1); y++) { const i = pidx(x, y, z); if (L[i] >> 4) q.push(i); }
  }
  for (let y = 0; y <= top; y++) for (let z = -1; z <= CS; z++) for (let x = -1; x <= CS; x++) {
    const i = pidx(x, y, z), e = LIGHTEMIT[P[i]];
    if (e) { L[i] = (L[i] & 0xf0) | e; q.push(i); }
  }
  // flood fill (sky and block light together); sunlight spreading sideways drops by one per block
  const DIRS = [1, -1, PX, -PX, PL, -PL];
  while (q.length) {
    const i = q.pop()!, l = L[i], sky = l >> 4, blk = l & 15;
    for (let k = 0; k < 6; k++) {
      const j = i + DIRS[k];
      if (j < 0 || j >= L.length) continue;
      const jx = (j % PX), jz = Math.floor((j % PL) / PX);
      if ((k === 0 && jx === 0) || (k === 1 && jx === PX - 1) || (k === 2 && jz === 0) || (k === 3 && jz === PX - 1)) continue;   // don't wrap round a row
      const b = P[j]; if (OPAQUE[b]) continue;
      const cost = 1 + (SKYBLOCK[b] && SKYBLOCK[b] < 15 ? SKYBLOCK[b] : 0);
      const ns = Math.max(0, sky - cost), nbk = Math.max(0, blk - cost), cur = L[j];
      const cs = cur >> 4, cb = cur & 15;
      if (ns > cs || nbk > cb) { L[j] = (Math.max(ns, cs) << 4) | Math.max(nbk, cb); q.push(j); }
    }
  }

  const solid = new Buf(), water = new Buf();
  const SHADE = [0.8, 0.8, 1.0, 0.55, 0.7, 0.7];   // +x −x +y −y +z −z
  const dims = [CS, CH, CS];
  const pos = [0, 0, 0], dir = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const du = d === 1 ? CS : dims[u], dv = dims[v];
    const uMax = u === 1 ? top + 1 : dims[u], vMax = v === 1 ? top + 1 : dims[v];
    const mask = new Int32Array(du * dv + dv * du);
    for (const sgn of [1, -1]) {
      const face = d * 2 + (sgn > 0 ? 0 : 1), shade = SHADE[face];
      const sMax = d === 1 ? top + 1 : dims[d];
      for (let s = 0; s < sMax; s++) {
        // build the mask for this slice
        let n = 0;
        for (let jv = 0; jv < vMax; jv++) for (let iu = 0; iu < uMax; iu++, n++) {
          pos[d] = s; pos[u] = iu; pos[v] = jv;
          const a = P[pidx(pos[0], pos[1], pos[2])];
          mask[n] = 0;
          if (!a || RENDER[a] === 2 || RENDER[a] === 0) continue;
          dir[0] = pos[0]; dir[1] = pos[1]; dir[2] = pos[2]; dir[d] += sgn;
          const b = dir[1] < 0 ? 1 : dir[1] >= CH ? 0 : P[pidx(dir[0], dir[1], dir[2])];
          if (RENDER[a] === 3) {      // water: show the surface and faces against air/plants
            if (b === a || OPAQUE[b] || (RENDER[b] === 1 && TRANSP[b])) continue;
          } else {
            if (OPAQUE[b] || (b === a && TRANSP[a])) continue;
          }
          const li = dir[1] < 0 || dir[1] >= CH ? 0xf0 : L[pidx(dir[0], dir[1], dir[2])];
          const tile = TILE6[a * 6 + face];
          mask[n] = ((tile + 1) | ((li >> 4) << 12) | ((li & 15) << 16) | (RENDER[a] === 3 ? 1 << 20 : 0));
        }
        // greedy: grow rectangles of equal keys
        n = 0;
        for (let jv = 0; jv < vMax; jv++) for (let iu = 0; iu < uMax;) {
          const key = mask[n + 0];
          if (!key) { iu++; n++; continue; }
          let w = 1; while (iu + w < uMax && mask[n + w] === key) w++;
          let h = 1, done = false;
          while (jv + h < vMax && !done) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * uMax] !== key) { done = true; break; }
            if (!done) h++;
          }
          emitQuad(key & 1 << 20 ? water : solid, d, u, v, sgn, s, iu, jv, w, h, key, shade);
          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * uMax] = 0;
          iu += w; n += w;
        }
      }
    }
  }
  // plants and other crossed sprites
  for (let y = 0; y <= top; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const a = P[pidx(x, y, z)];
    if (RENDER[a] !== 2) continue;
    const l = L[pidx(x, y, z)], sky = (l >> 4) / 15, blk = Math.max(l & 15, LIGHTEMIT[a]) / 15, t = TILE6[a * 6 + 2];
    const h = (y * 7 + x * 13 + z * 5) % 3 * 0.08;
    for (const [x0, z0, x1, z1] of [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]]) {
      for (const flip of [false, true]) {
        const b = solid.n;
        const A = flip ? [x1, z1, x0, z0] : [x0, z0, x1, z1];
        solid.pos.push(x + A[0], y, z + A[1], x + A[2], y, z + A[3], x + A[2], y + 1 - h, z + A[3], x + A[0], y + 1 - h, z + A[1]);
        solid.tex.push(0, 0, 1, 0, 1, 1, 0, 1);
        solid.tile.push(t, t, t, t);
        for (let k = 0; k < 4; k++) solid.light.push(sky * 0.9, blk * 0.9);
        solid.index.push(b, b + 1, b + 2, b, b + 2, b + 3); solid.n += 4;
      }
    }
  }
  return { solid: solid.out(), water: water.out() };
}

function emitQuad(buf: Buf, d: number, u: number, v: number, sgn: number, s: number, iu: number, jv: number, w: number, h: number, key: number, shade: number) {
  const tile = (key & 0xfff) - 1, sky = ((key >> 12) & 15) / 15, blk = ((key >> 16) & 15) / 15;
  const off = sgn > 0 ? s + 1 : s;
  const c = (a: number, b: number) => { const p = [0, 0, 0]; p[d] = off; p[u] = a; p[v] = b; return p; };
  const p0 = c(iu, jv), p1 = c(iu + w, jv), p2 = c(iu + w, jv + h), p3 = c(iu, jv + h);
  const quad = [p0, p1, p2, p3];
  // texture coordinates: side faces run v along world y so textures stand upright
  const tc = quad.map(p => d === 1 ? [p[0], p[2]] : d === 0 ? [p[2], p[1]] : [p[0], p[1]]);
  const b = buf.n;
  for (let k = 0; k < 4; k++) { buf.pos.push(quad[k][0], quad[k][1], quad[k][2]); buf.tex.push(tc[k][0], tc[k][1]); buf.tile.push(tile); buf.light.push(sky * shade, blk * shade); }
  // corners run along u then v, and u × v = +d, so that order faces +d
  if (sgn > 0) buf.index.push(b, b + 1, b + 2, b, b + 2, b + 3); else buf.index.push(b, b + 2, b + 1, b, b + 3, b + 2);
  buf.n += 4;
}
