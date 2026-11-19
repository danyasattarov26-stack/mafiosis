/* Grid pathfinding inside the shop (0.5 m cells, 8-way A*, no corner cutting) plus string-pulling. */
import { ITEM } from '../config/items';
import type { SaveData } from '../core/save';
import { CELL, footprint, shopSize, DOOR, type V2 } from './layout';

export class Nav {
  w = 0; d = 0; cols = 0; rows = 0;
  blocked = new Uint8Array(0);
  ver = -1;

  rebuild(s: SaveData) {
    const { w, d } = shopSize(s);
    this.w = w; this.d = d;
    this.cols = Math.round(w / CELL); this.rows = Math.round(d / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (const o of s.objects) {
      if (o.wall || ITEM[o.item]?.walkable) continue;
      const f = footprint(o.item, o.x, o.z, o.rot);
      const c0 = Math.max(0, Math.floor((f.x0 + w / 2) / CELL + 0.01)), c1 = Math.min(this.cols - 1, Math.ceil((f.x1 + w / 2) / CELL - 0.01) - 1);
      const r0 = Math.max(0, Math.floor((f.z0 + d) / CELL + 0.01)), r1 = Math.min(this.rows - 1, Math.ceil((f.z1 + d) / CELL - 0.01) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.blocked[r * this.cols + c] = 1;
    }
  }

  cellOf(p: V2) { return { c: Math.floor((p.x + this.w / 2) / CELL), r: Math.floor((p.z + this.d) / CELL) }; }
  centre(c: number, r: number): V2 { return { x: -this.w / 2 + (c + 0.5) * CELL, z: -this.d + (r + 0.5) * CELL }; }
  inside(c: number, r: number) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  free(c: number, r: number) { return this.inside(c, r) && !this.blocked[r * this.cols + c]; }

  /** nearest walkable cell to a point */
  nearestFree(p: V2): { c: number; r: number } | null {
    const s = this.cellOf(p);
    for (let rad = 0; rad < 8; rad++) {
      let best: any = null, bd = 1e9;
      for (let r = s.r - rad; r <= s.r + rad; r++) for (let c = s.c - rad; c <= s.c + rad; c++) {
        if (Math.max(Math.abs(r - s.r), Math.abs(c - s.c)) !== rad || !this.free(c, r)) continue;
        const q = this.centre(c, r); const dd = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (dd < bd) { bd = dd; best = { c, r }; }
      }
      if (best) return best;
    }
    return null;
  }

  path(from: V2, to: V2): V2[] {
    const a = this.nearestFree(from), b = this.nearestFree(to);
    if (!a || !b) return [to];
    const N = this.cols * this.rows, start = a.r * this.cols + a.c, goal = b.r * this.cols + b.c;
    if (start === goal) return [to];
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open: number[] = [start]; g[start] = 0;
    const h = (i: number) => { const c = i % this.cols, r = (i / this.cols) | 0; const dx = Math.abs(c - b.c), dz = Math.abs(r - b.r); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const f = new Float32Array(N).fill(Infinity); f[start] = h(start);
    let found = false, guard = 0;
    while (open.length && guard++ < 5000) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue; closed[cur] = 1;
      const cc = cur % this.cols, cr = (cur / this.cols) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nc = cc + dx, nr = cr + dz;
        if (!this.free(nc, nr)) continue;
        if (dx && dz && (!this.free(cc + dx, cr) || !this.free(cc, cr + dz))) continue;
        const ni = nr * this.cols + nc; if (closed[ni]) continue;
        const ng = g[cur] + (dx && dz ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; f[ni] = ng + h(ni); open.push(ni); }
      }
    }
    if (!found) return [to];
    const cells: number[] = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map(i => this.centre(i % this.cols, (i / this.cols) | 0));
    // string pull: skip points while there is a clear line
    const out: V2[] = [];
    let k = 0;
    while (k < pts.length - 1) {
      let j = pts.length - 1;
      while (j > k + 1 && !this.clear(pts[k], pts[j])) j--;
      out.push(pts[j]); k = j;
    }
    out.push(to);
    return out;
  }

  clear(a: V2, b: V2) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.35));
    for (let i = 1; i < n; i++) {
      const t = i / n, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      for (const o of [[0, 0], [0.18, 0.18], [-0.18, 0.18], [0.18, -0.18], [-0.18, -0.18]]) {
        const q = this.cellOf({ x: p.x + o[0], z: p.z + o[1] });
        if (!this.free(q.c, q.r)) return false;
      }
    }
    return true;
  }

  /** route from anywhere (inside or on the sidewalk) to an inside target */
  route(from: V2, to: V2): V2[] {
    const outside = from.z > -0.05;
    const toOutside = to.z > -0.05;
    if (outside && toOutside) return [to];
    if (outside) return [DOOR.outside, { x: 0, z: -0.3 }, ...this.path(DOOR.inside, to)];
    if (toOutside) return [...this.path(from, DOOR.inside), { x: 0, z: -0.3 }, DOOR.outside, to];
    return this.path(from, to);
  }
}
