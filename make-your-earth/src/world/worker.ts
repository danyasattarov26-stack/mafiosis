/* World worker: generates chunks and builds their meshes off the main thread. */
import { TerrainGen, CS, idx } from './gen';
import { meshChunk, buildTables, setTiles } from './mesher';

let gen: TerrainGen | null = null;
const chunks = new Map<string, Uint8Array>();
const key = (x: number, z: number) => `${x},${z}`;

function get(cx: number, cz: number) {
  let c = chunks.get(key(cx, cz));
  if (!c) { c = gen!.generate(cx, cz); chunks.set(key(cx, cz), c); }
  return c;
}

type Msg =
  | { t: 'init'; seed: number }
  | { t: 'gen'; cx: number; cz: number; edits: [number, number][] }
  | { t: 'mesh'; cx: number; cz: number; seq: number }
  | { t: 'set'; x: number; y: number; z: number; id: number }
  | { t: 'drop'; cx: number; cz: number }
  | { t: 'tables'; extra: any[]; tiles: number[][] };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  switch (m.t) {
    case 'init': gen = new TerrainGen(m.seed); chunks.clear(); break;
    case 'tables': buildTables(m.extra); setTiles(m.tiles); break;
    case 'gen': {
      const c = get(m.cx, m.cz);
      for (const [i, id] of m.edits) c[i] = id;
      const copy = c.slice();
      (self as any).postMessage({ t: 'chunk', cx: m.cx, cz: m.cz, data: copy }, [copy.buffer]);
      break;
    }
    case 'mesh': {
      const c = chunks.get(key(m.cx, m.cz)); if (!c) break;
      const nb = [chunks.get(key(m.cx - 1, m.cz)) ?? null, chunks.get(key(m.cx + 1, m.cz)) ?? null, chunks.get(key(m.cx, m.cz - 1)) ?? null, chunks.get(key(m.cx, m.cz + 1)) ?? null];
      const { solid, water } = meshChunk(c, nb);
      const bufs = [solid.pos, solid.tex, solid.tile, solid.light, solid.index, water.pos, water.tex, water.tile, water.light, water.index].map(a => a.buffer);
      (self as any).postMessage({ t: 'mesh', cx: m.cx, cz: m.cz, seq: m.seq, solid, water }, bufs);
      break;
    }
    case 'set': {
      const cx = Math.floor(m.x / CS), cz = Math.floor(m.z / CS), c = chunks.get(key(cx, cz));
      if (c) c[idx(m.x - cx * CS, m.y, m.z - cz * CS)] = m.id;
      break;
    }
    case 'drop': chunks.delete(key(m.cx, m.cz)); break;
  }
};
