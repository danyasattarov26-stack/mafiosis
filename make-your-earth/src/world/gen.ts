/*
  World generation. A pure function of the seed: continents and oceans, eight biomes picked from
  temperature and humidity, mountains, rivers, caves, ore veins, trees and plants. Chunks are 16×16×256.
*/
import { Noise, hash2, hash3 } from './noise';
import { B } from '../shared/blocks';
import { BIOMES, BIOME_ID } from '../shared/biomes';
import { siteAt, rotate, CELL, type Site } from './structures';

export const CS = 16, CH = 256, SEA = 62;
export const idx = (x: number, y: number, z: number) => x + z * CS + y * CS * CS;
const PLANTS = new Set([B.tall_grass, B.flower_red, B.flower_yellow, B.berry_bush, B.dead_bush, B.fern, B.wheat, B.flower_blue, B.carrot_crop_2, B.potato_crop_2]);
const LEAVES = new Set([B.oak_leaves, B.birch_leaves, B.pine_leaves, B.jungle_leaves, B.acacia_leaves, B.palm_leaves, B.autumn_leaves, B.crimson_leaves, B.vines]);
const CANYON_BANDS = [B.terracotta, B.terracotta_orange, B.terracotta_yellow, B.terracotta_orange, B.terracotta_white, B.terracotta_red, B.terracotta_brown, B.terracotta_orange];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface Column { h: number; biome: number; river: number }

export class TerrainGen {
  private nc: Noise; private ne: Noise; private nm: Noise; private nr: Noise; private nt: Noise; private nh: Noise; private nriv: Noise; private ncave: Noise; private ncave2: Noise;
  private nw1: Noise; private nw2: Noise; private ncav: Noise; private nrav: Noise; private nravm: Noise; private nlake: Noise; private nrare: Noise; private nmesa: Noise;
  private B = BIOME_ID;
  constructor(public seed: number) {
    this.nc = new Noise(seed); this.ne = new Noise(seed + 1); this.nm = new Noise(seed + 2); this.nr = new Noise(seed + 3);
    this.nt = new Noise(seed + 4); this.nh = new Noise(seed + 5); this.nriv = new Noise(seed + 6); this.ncave = new Noise(seed + 7); this.ncave2 = new Noise(seed + 8);
    this.nw1 = new Noise(seed + 21); this.nw2 = new Noise(seed + 22); this.ncav = new Noise(seed + 23); this.nrav = new Noise(seed + 24); this.nravm = new Noise(seed + 25); this.nlake = new Noise(seed + 26); this.nrare = new Noise(seed + 27); this.nmesa = new Noise(seed + 28);
  }

  /** ravines: long, narrow, deep cracks across dry land. Returns the lowest carved y (or 999) and how central we are (0..1). */
  ravine(x: number, z: number, h: number, river: number) {
    if (river || h < SEA + 3) return null;
    const v = Math.abs(this.nrav.fbm(x / 340, z / 340, 2)), W = 0.016;
    if (v >= W) return null;
    const mask = this.nravm.n2(x / 600, z / 600);
    if (mask < 0.25) return null;
    const c = 1 - v / W;                                           // 1 in the middle, 0 at the edge
    const floor = 16 + Math.floor((this.nravm.n2(x / 90 + 50, z / 90) + 1) * 9);
    return { floor: Math.round(floor + (1 - c) * (h - floor) * 0.9), c };
  }

  /** height and biome of one column (cheap, used for trees, the map and spawning) */
  column(x: number, z: number): Column {
    const c = this.nc.fbm(x / 1400, z / 1400, 4) + 0.12;                 // continents: below −0.1 is sea
    const e = this.ne.fbm(x / 160, z / 160, 3);
    const mMask = smooth(0.18, 0.5, this.nm.fbm(x / 1700 + 40, z / 1700 - 20, 3));
    const ridge = 1 - Math.abs(this.nr.fbm(x / 420, z / 420, 4)) * 1.6;
    const land = SEA + 3 + Math.max(0, c + 0.1) * 55 + e * 7 + mMask * Math.max(0, ridge) ** 2 * 85;
    const sea = SEA - 5 + (c + 0.1) * 90 + e * 3;
    const k = smooth(-0.16, -0.06, c);
    let h = sea + (land - sea) * k;
    // rivers carve a channel across land (not through high mountains)
    const rv = Math.abs(this.nriv.fbm(x / 520, z / 520, 2));
    let river = 0;
    if (k > 0.6 && h < SEA + 34) {
      if (rv < 0.022) { river = 1; h = SEA - 3; }
      else if (rv < 0.06) h = (SEA - 3) + (h - (SEA - 3)) * smooth(0.022, 0.06, rv);
    }
    const hi = Math.floor(h);
    // climate
    const temp = this.nt.fbm(x / 2300 + 300, z / 2300, 3) - Math.max(0, hi - SEA - 20) * 0.004;
    const hum = this.nh.fbm(x / 1900, z / 1900 - 400, 3);
    const rare = this.nrare.fbm(x / 900 + 70, z / 900 - 30, 2);      // picks the rarer biomes inside the common ones
    let biome: number, h2 = hi;
    if (hi < SEA - 1 && !river) biome = this.B.ocean;
    else if (temp < -0.27) biome = this.B.tundra;
    else if (hi > SEA + 42 || (mMask > 0.6 && hi > SEA + 26)) biome = rare > 0.3 && hi < SEA + 75 && !river ? this.B.volcanic : this.B.mountains;
    else if (hi <= SEA + 2 && !river) biome = hum > 0.22 && temp > -0.1 && temp < 0.1 ? this.B.swamp : this.B.beach;
    else if (temp > 0.1 && hum < -0.06) biome = rare > 0.28 ? this.B.canyon : this.B.desert;
    else if (temp > 0.04 && hum < 0.12) biome = rare > 0.38 ? this.B.canyon : this.B.savanna;
    else if (temp > 0.02 && hum >= 0.12) biome = this.B.jungle;
    else if (hum > 0.2 && hi < SEA + 12) biome = this.B.swamp;
    else if (temp < -0.13) biome = this.B.taiga;
    else biome = rare > 0.22 ? this.B.autumn : this.B.forest;
    if (!river) {
      if (biome === this.B.swamp) {
        // flat and soggy: pools of water between low mounds
        const w = this.nlake.n2(x / 18, z / 18);
        h2 = SEA + (w > 0.25 ? 1 : w < -0.2 ? -1 : 0);
      } else if (biome === this.B.canyon) {
        // stepped mesas with flat tops
        const m = this.nmesa.fbm(x / 110, z / 110, 3), edge = Math.min(1, (rare - 0.28) * 8);
        h2 = Math.round(hi + Math.max(0, edge) * (Math.floor(Math.max(0, m + 0.15) * 45 / 6) * 6));
      } else if (biome === this.B.volcanic) h2 = hi + Math.round(Math.max(0, rare - 0.3) * 60);
    }
    return { h: h2, biome, river };
  }

  generate(cx: number, cz: number): Uint8Array {
    const d = new Uint8Array(CS * CS * CH);
    const ox = cx * CS, oz = cz * CS, seed = this.seed;
    const cols: Column[] = [];
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) cols.push(this.column(ox + x, oz + z));
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const col = cols[x + z * CS], bio = BIOMES[col.biome], wx = ox + x, wz = oz + z;
      const h = col.h, top = B[bio.top], under = B[bio.under], deep = bio.deep ? B[bio.deep] : B.stone;
      const tundra = col.biome === this.B.tundra;
      const rav = this.ravine(wx, wz, h, col.river);
      const lake = this.nlake.n2(wx / 80, wz / 80);
      // a few tunnels open onto dry land so caves can be found from the surface
      const openTop = h > SEA + 4 && !col.river && hash2(wx >> 4, wz >> 4, seed + 41) < 0.35 ? 4 : 0;
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = 0;
        if (y === 0 || (y < 3 && hash3(wx, y, wz, seed) < 0.5)) id = B.bedrock;
        else if (y > h) id = y <= SEA ? (tundra && y === SEA ? B.ice : B.water) : 0;
        else if (y === h) id = h < SEA - 1 ? (col.biome === this.B.ocean ? (h < SEA - 12 ? deep : top) : (col.river ? B.gravel : B.sand)) : (col.river ? B.gravel : top);
        else if (y > h - 4) id = h < SEA ? (col.river ? B.clay : under) : under;
        else if (y > h - 7 && bio.deep) id = deep;
        else id = B.stone;
        // mountains: snow caps, bare stone faces
        if (col.biome === this.B.mountains && y === h && h > SEA + 62) id = B.snow;
        if (col.biome === this.B.mountains && y === h && h <= SEA + 62 && h < SEA + 48) id = B.grass;
        if (col.biome === this.B.canyon && y > h - 40 && y <= h && id !== B.water) id = y === h ? B.red_sand : CANYON_BANDS[((y + (hash2(wx >> 3, wz >> 3, seed) * 2 | 0)) >> 1) % CANYON_BANDS.length];
        if (col.biome === this.B.volcanic && y === h && hash2(wx, wz, seed + 51) < 0.05) id = B.magma_rock;
        if (col.biome === this.B.volcanic && y === h && this.nlake.n2(wx / 14, wz / 14) > 0.55) id = B.lava;
        if (id === B.stone) id = this.ore(wx, y, wz, col.biome);
        // caves: three layers of winding tunnels, big caverns and the odd opening to the sky
        if (id !== 0 && id !== B.bedrock && id !== B.water && y > 4 && y < h - 3 + openTop) {
          let air = false;
          const a = this.ncave.n3(wx / 34, y / 22, wz / 34), b2 = this.ncave2.n3(wx / 34, y / 22, wz / 34);
          if (a * a + b2 * b2 < 0.0095) air = true;
          else if (y < 64) {
            const p = this.nw1.n3(wx / 46, y / 18, wz / 46), q = this.nw2.n3(wx / 46, y / 18, wz / 46);
            if (p * p + q * q < 0.006 + (y < 30 ? 0.004 : 0)) air = true;
            else if (y > 9 && y < 52 && y < h - 10) {
              // caverns: huge open rooms, flatter on the floor
              const cv = this.ncav.n3(wx / 70, y / 26, wz / 70) - Math.max(0, 22 - y) * 0.015;
              if (cv > 0.52) air = true;
            }
          }
          if (air) id = y < 11 ? B.lava : (y < 22 && lake > 0.25 && y < h - 12) ? B.water : 0;
        }
        // ravines
        if (rav && y >= rav.floor && y <= h && id !== B.bedrock) id = y < 12 ? B.lava : 0;        d[idx(x, y, z)] = id;
      }
      // plants on the surface
      const sy = h + 1;
      if (h >= SEA && sy < CH && d[idx(x, h, z)] === top && d[idx(x, sy, z)] === 0) {
        let r = hash2(wx, wz, seed + 77);
        for (const p of bio.plants) { if (r < p.chance) { d[idx(x, sy, z)] = B[p.block]; break; } r -= p.chance; }
      }
    }
    // trees: look 3 blocks beyond the chunk so crowns that hang over the border are drawn
    for (let wz = oz - 3; wz < oz + CS + 3; wz++) for (let wx = ox - 3; wx < ox + CS + 3; wx++) {
      const inside = wx >= ox && wx < ox + CS && wz >= oz && wz < oz + CS;
      const col = inside ? cols[(wx - ox) + (wz - oz) * CS] : this.column(wx, wz);
      const bio = BIOMES[col.biome];
      if (!bio.trees.length || col.h < SEA || col.river) continue;
      let r = hash2(wx, wz, seed + 13);
      for (const t of bio.trees) {
        if (r < t.chance) { this.tree(d, t.kind, wx - ox, col.h + 1, wz - oz, hash2(wx, wz, seed + 31)); break; }
        r -= t.chance;
      }
    }
    this.decorateCaves(d, cols, ox, oz);
    this.structures(d, ox, oz);
    return d;
  }

  /** cave life: glowing crystals on ceilings, crystal clusters, mushrooms and cobwebs on floors, moss by water */
  private decorateCaves(d: Uint8Array, cols: Column[], ox: number, oz: number) {
    const seed = this.seed;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = cols[x + z * CS].h, wx = ox + x, wz = oz + z;
      for (let y = 6; y < Math.min(h - 6, 70); y++) {
        const i = idx(x, y, z); if (d[i] !== 0) continue;
        const below = d[i - CS * CS], above = d[i + CS * CS];
        const r = hash3(wx, y, wz, seed + 61);
        if (below === B.stone || below === B.granite || below === B.basalt) {
          if (y < 40 && r < 0.012) d[i] = B.crystal_cluster;
          else if (r < 0.02) d[i] = B.glow_mushroom;
          else if (r < 0.032) d[i] = r < 0.026 ? B.brown_mushroom : B.red_mushroom;
          else if (r > 0.994) d[i] = B.cobweb;
          else if (r > 0.96 && (d[i - 1] === B.water || d[i + 1] === B.water)) d[i - CS * CS] = B.moss_block;
        } else if ((above === B.stone || above === B.granite) && y < 45 && r < 0.01) d[i + CS * CS] = B.glow_crystal;
        else if (above !== 0 && above !== B.water && r > 0.993) d[i] = B.cobweb;
      }
    }
  }

  // ---------------- structures ----------------
  private sites = new Map<string, Site | null>();
  site(gx: number, gz: number) {
    const k = `${gx},${gz}`;
    if (!this.sites.has(k)) { if (this.sites.size > 4000) this.sites.clear(); this.sites.set(k, siteAt(gx, gz, this.seed, (x, z) => this.column(x, z), SEA)); }
    return this.sites.get(k)!;
  }
  /** structure sites whose buildings could reach this chunk */
  sitesNear(ox: number, oz: number) {
    const out: Site[] = [], m = 56;
    for (let gz = Math.floor((oz - m) / CELL); gz <= Math.floor((oz + CS + m) / CELL); gz++)
      for (let gx = Math.floor((ox - m) / CELL); gx <= Math.floor((ox + CS + m) / CELL); gx++) { const s = this.site(gx, gz); if (s) out.push(s); }
    return out;
  }
  private structures(d: Uint8Array, ox: number, oz: number) {
    for (const site of this.sitesNear(ox, oz)) for (const part of site.parts) {
      const sh = part.shape, odd = part.rot & 1, rw = odd ? sh.d : sh.w, rd = odd ? sh.w : sh.d;
      const x0 = part.x - (rw >> 1), z0 = part.z - (rd >> 1);
      if (x0 > ox + CS || x0 + rw < ox - 1 || z0 > oz + CS || z0 + rd < oz - 1) continue;
      const y0 = this.column(part.x, part.z).h + 1;
      // foundation: fill any gap between the floor and the ground
      for (let rz = 0; rz < rd; rz++) for (let rx = 0; rx < rw; rx++) {
        const lx = x0 + rx - ox, lz = z0 + rz - oz;
        if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) continue;
        for (let y = y0 - 1; y > y0 - 10 && y > 0; y--) { const i = idx(lx, y, lz), id = d[i]; if (id && id !== B.water && !PLANTS.has(id) && !LEAVES.has(id)) break; d[i] = sh.found; }
      }
      for (const c of sh.cells) {
        const [rx, rz] = rotate(c, sh.w, sh.d, part.rot);
        const lx = x0 + rx - ox, lz = z0 + rz - oz, y = y0 + c[1];
        if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 1 || y >= CH) continue;
        d[idx(lx, y, lz)] = c[3] === 0 && y <= SEA ? B.water : c[3];
      }
    }
  }

  private ore(x: number, y: number, z: number, biome: number) {
    const r = hash3(x >> 1, y >> 1, z >> 1, this.seed + 5), r2 = hash3(x, y, z, this.seed + 9);
    if (r2 < 0.45) return B.stone;                                      // veins are lumpy, not solid cubes
    if (y < 14 && r < 0.0012) return B.uranium_ore;
    if (y < 16 && r < 0.003) return B.diamond_ore;
    if (y < 32 && r < 0.006) return B.gold_ore;
    if (y < 40 && r < 0.012) return B.sulfur_ore;
    if (y < 60 && r < 0.022) return B.iron_ore;
    if (y < 70 && r < 0.03) return B.tin_ore;
    if (y < 90 && r < 0.042) return B.copper_ore;
    if (y < 140 && r < 0.07) return B.coal_ore;
    if (biome === this.B.desert && y < 50 && r < 0.09) return B.salt_rock;
    if (biome === this.B.tundra && y < 58 && r < 0.085) return B.mammoth_bones;
    if (r > 0.97) return y < 30 ? B.basalt : y < 70 ? B.granite : B.marble;
    return B.stone;
  }

  private tree(d: Uint8Array, kind: string, x: number, y: number, z: number, r: number) {
    const set = (dx: number, dy: number, dz: number, id: number, soft = false) => {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || X >= CS || Z < 0 || Z >= CS || Y < 1 || Y >= CH) return;
      const i = idx(X, Y, Z);
      if (soft && d[i] !== 0) return;
      d[i] = id;
    };
    const blob = (cy: number, rad: number, id: number, squash = 1) => {
      for (let dy = -rad; dy <= rad; dy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + (dy * squash) * (dy * squash) + dz * dz <= rad * rad + 0.5) set(dx, cy + dy, dz, id, true);
      }
    };
    if (kind === 'oak' || kind === 'birch') {
      const hgt = 4 + Math.floor(r * 3), log = kind === 'oak' ? B.oak_log : B.birch_log, leaf = kind === 'oak' ? B.oak_leaves : B.birch_leaves;
      blob(hgt, 2, leaf); blob(hgt + 1, 1, leaf);
      for (let i = 0; i < hgt; i++) set(0, i, 0, log);
    } else if (kind === 'pine') {
      const hgt = 6 + Math.floor(r * 5);
      for (let i = 2; i <= hgt + 1; i++) { const rad = Math.max(0, Math.round((hgt + 1 - i) * 0.45)) + (i % 2); for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) if (Math.abs(dx) + Math.abs(dz) <= rad + 0.5) set(dx, i, dz, B.pine_leaves, true); }
      set(0, hgt + 2, 0, B.pine_leaves, true);
      for (let i = 0; i < hgt; i++) set(0, i, 0, B.pine_log);
    } else if (kind === 'jungle') {
      const hgt = 9 + Math.floor(r * 7);
      blob(hgt, 3, B.jungle_leaves, 1.6); blob(hgt - 3, 2, B.jungle_leaves, 1.4);
      for (let i = 0; i < hgt; i++) set(0, i, 0, B.jungle_log);
    } else if (kind === 'acacia') {
      const hgt = 4 + Math.floor(r * 2), lean = r > 0.5 ? 1 : -1;
      for (let i = 0; i < hgt; i++) set(i > 2 ? lean : 0, i, 0, B.acacia_log);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dz * dz <= 9) set(dx + lean, hgt, dz, B.acacia_leaves, true);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) set(dx + lean, hgt + 1, dz, B.acacia_leaves, true);
    } else if (kind === 'palm') {
      const hgt = 5 + Math.floor(r * 3);
      for (let i = 0; i < hgt; i++) set(i > 3 ? 1 : 0, i, 0, B.palm_log);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0], [0, 3], [0, -3]]) set(dx + 1, hgt - (Math.abs(dx) + Math.abs(dz) > 2 ? 1 : 0), dz, B.palm_leaves, true);
      set(1, hgt, 0, B.palm_leaves, true);
    } else if (kind === 'autumn') {
      const hgt = 4 + Math.floor(r * 3), leaf = r < 0.5 ? B.autumn_leaves : B.crimson_leaves;
      blob(hgt, 2, leaf); blob(hgt + 1, 1, r < 0.25 ? B.autumn_leaves : leaf);
      for (let i = 0; i < hgt; i++) set(0, i, 0, r < 0.15 ? B.birch_log : B.oak_log);
    } else if (kind === 'swamp') {
      // a squat oak with a wide, flat crown and vines hanging down
      const hgt = 4 + Math.floor(r * 2);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dz * dz <= 10) { set(dx, hgt, dz, B.oak_leaves, true); if (dx * dx + dz * dz <= 4) set(dx, hgt + 1, dz, B.oak_leaves, true); }
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2]]) { const len = 1 + Math.floor(((r * 97 + dx * 13 + dz * 7) % 1 + 1) % 1 * 3); for (let k = 1; k <= len; k++) set(dx, hgt - k, dz, B.vines, true); }
      for (let i = 0; i < hgt; i++) set(0, i, 0, B.oak_log);
    } else if (kind === 'charred') {
      const hgt = 3 + Math.floor(r * 4);
      for (let i = 0; i < hgt; i++) set(0, i, 0, B.charred_log);
      if (r > 0.4) { set(1, hgt - 1, 0, B.charred_log); set(-1, hgt - 2, 0, B.charred_log); }
    } else if (kind === 'cactus') {
      const hgt = 2 + Math.floor(r * 3);
      for (let i = 0; i < hgt; i++) set(0, i, 0, B.cactus);
    }
  }

  /** a dry, open spot near (x, z) to spawn on: not water, not inside a tree */
  findSpawn(x: number, z: number, rnd: () => number) {
    for (let tries = 0; tries < 400; tries++) {
      const r = tries < 1 ? 0 : 20 + tries * 6, a = rnd() * Math.PI * 2;
      const sx = Math.round(x + Math.cos(a) * r), sz = Math.round(z + Math.sin(a) * r);
      const c = this.column(sx, sz);
      const cold = c.biome === BIOME_ID.tundra && tries < 300;   // try hard to start somewhere you won't freeze
      if (c.h >= SEA + 1 && c.h < SEA + 40 && !cold && !c.river && c.biome !== BIOME_ID.ocean && c.biome !== BIOME_ID.mountains && c.biome !== BIOME_ID.volcanic) return { x: sx + 0.5, y: c.h + 1.05, z: sz + 0.5, biome: c.biome };
    }
    return { x: x + 0.5, y: 120, z: z + 0.5, biome: 0 };
  }
}
