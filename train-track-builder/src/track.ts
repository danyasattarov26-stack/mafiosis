/*
  The track: a chain of pieces that snap onto the end of the line. Each piece is a little curve in its own
  space (x = right, y = up, z = forward) with a "right" direction so it can bank, loop and roll.
  Pieces are sampled every ~25 cm; the train rides those samples.
*/
import * as THREE from 'three';

export type PieceId = 'station' | 'straight' | 'left' | 'right' | 'up' | 'down' | 'loop' | 'roll' | 'boost' | 'helixL' | 'helixR';

interface Local { p: THREE.Vector3; r: THREE.Vector3 }
export interface PieceDef { id: PieceId; name: string; icon: string; key?: string; at: (t: number) => Local; boost?: boolean; tip: string }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ss = (t: number) => t * t * (3 - 2 * t);
const UP = V(0, 1, 0), X = V(1, 0, 0);
const BANK = 0.3;
const TAU = Math.PI * 2;

const turn = (dir: 1 | -1, R: number, climb = 0, angle = Math.PI / 2): ((t: number) => Local) => t => {
  const a = t * angle;
  // dir = -1: left (towards -x), +1: right
  const p = V(dir * (R - R * Math.cos(a)), climb * ss(t), R * Math.sin(a));
  const f = V(dir * Math.sin(a), 0, Math.cos(a));
  const r0 = V(f.z, 0, -f.x);
  const b = BANK * Math.sin(Math.PI * t);
  const r = r0.multiplyScalar(Math.cos(b)).addScaledVector(UP, -dir * Math.sin(b));   // lean into the turn
  return { p, r };
};

export const PIECES: Record<PieceId, PieceDef> = {
  station: { id: 'station', name: 'Station', icon: '🚉', tip: '', at: t => ({ p: V(0, 0, 16 * t), r: X }) },
  straight: { id: 'straight', name: 'Straight', icon: '⬆️', key: '1', tip: 'A short straight bit.', at: t => ({ p: V(0, 0, 4 * t), r: X }) },
  left: { id: 'left', name: 'Left', icon: '↰', key: '2', tip: 'Turn left.', at: turn(-1, 8) },
  right: { id: 'right', name: 'Right', icon: '↱', key: '3', tip: 'Turn right.', at: turn(1, 8) },
  up: { id: 'up', name: 'Up', icon: '⤴️', key: '4', tip: 'Climb a hill.', at: t => ({ p: V(0, 3 * ss(t), 8 * t), r: X }) },
  down: { id: 'down', name: 'Down', icon: '⤵️', key: '5', tip: 'Go down a hill.', at: t => ({ p: V(0, -3 * ss(t), 8 * t), r: X }) },
  loop: {
    id: 'loop', name: 'Loop', icon: '➰', key: '6', tip: 'A loop-the-loop! You need speed.',
    at: t => { const a = TAU * t; return { p: V(4 * (t - Math.sin(a) / TAU), 7.5 * (1 - Math.cos(a)), 7.5 * Math.sin(a) + 8 * t), r: X }; },
  },
  roll: {
    id: 'roll', name: 'Flip', icon: '🔄', key: '7', tip: 'Spin the train upside down and back.',
    at: t => { const a = TAU * ss(t), h = 1.1; return { p: V(h * Math.sin(a), h - h * Math.cos(a), 16 * t), r: V(Math.cos(a), Math.sin(a), 0) }; },
  },
  boost: { id: 'boost', name: 'Boost', icon: '⚡', key: '8', boost: true, tip: 'Speeds the train up.', at: t => ({ p: V(0, 0, 8 * t), r: X }) },
  helixL: { id: 'helixL', name: 'Spiral', icon: '🌀', key: '9', tip: 'Climb in a big spiral.', at: turn(-1, 7, 6, Math.PI * 2) },
  helixR: { id: 'helixR', name: 'Spiral down', icon: '🌪️', key: '0', tip: 'Spiral down.', at: turn(1, 7, -6, Math.PI * 2) },
};
export { samplePiece };
export const PALETTE: PieceId[] = ['straight', 'left', 'right', 'up', 'down', 'loop', 'roll', 'boost', 'helixL', 'helixR'];

export interface Sample { p: THREE.Vector3; f: THREE.Vector3; u: THREE.Vector3; r: THREE.Vector3; s: number; boost: boolean }
export interface Seg { id: PieceId; samples: Sample[]; s0: number; len: number; end: Frame }
export interface Frame { p: THREE.Vector3; q: THREE.Quaternion }

const START: Frame = { p: V(0, 0.35, -20), q: new THREE.Quaternion() };
const STEP = 0.25;

/** sample one piece placed at a frame */
function samplePiece(id: PieceId, frame: Frame, s0: number): Seg {
  const def = PIECES[id];
  // measure the length first so samples come out evenly spaced
  let len = 0; let prev = def.at(0).p;
  for (let i = 1; i <= 400; i++) { const p = def.at(i / 400).p; len += p.distanceTo(prev); prev = p; }
  const n = Math.max(2, Math.ceil(len / STEP));
  const samples: Sample[] = [];
  const e = 1 / (n * 4);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const { p, r: rRef } = def.at(t);
    const a = def.at(Math.max(0, t - e)).p, b = def.at(Math.min(1, t + e)).p;
    const f = b.sub(a).normalize();
    const r = rRef.clone().addScaledVector(f, -f.dot(rRef)).normalize();
    const u = f.clone().cross(r).normalize();
    samples.push({
      p: p.applyQuaternion(frame.q).add(frame.p), f: f.applyQuaternion(frame.q), u: u.applyQuaternion(frame.q), r: r.applyQuaternion(frame.q),
      s: s0 + (len * i) / n, boost: !!def.boost,
    });
  }
  const last = samples[samples.length - 1];
  // snap the end to clean numbers so pieces keep lining up perfectly
  const snap = (v: THREE.Vector3) => { for (const k of ['x', 'y', 'z'] as const) { const r = Math.round(v[k]); if (Math.abs(v[k] - r) < 0.06) v[k] = r; } return v.normalize(); };
  const f = snap(last.f.clone()), u = snap(last.u.clone());
  const r = u.clone().cross(f).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f));
  const ep = last.p.clone(); for (const k of ['x', 'y', 'z'] as const) { ep[k] = Math.round(ep[k] * 1000) / 1000; const r = Math.round(ep[k] * 20) / 20; if (Math.abs(ep[k] - r) < 0.02) ep[k] = r; }
  last.p.copy(ep); last.f.copy(f); last.u.copy(u); last.r.copy(r);
  return { id, samples, s0, len, end: { p: ep, q } };
}

export class Track {
  segs: Seg[] = [];
  closed = false;
  constructor(pieces: PieceId[] = []) { this.reset(); for (const p of pieces) this.add(p, true); }

  get pieces(): PieceId[] { return this.segs.slice(1).map(s => s.id); }
  get length() { const l = this.segs[this.segs.length - 1]; return l.s0 + l.len; }
  get end(): Frame { return this.segs[this.segs.length - 1].end; }
  get start(): Frame { return START; }

  reset() { this.segs = [samplePiece('station', START, 0)]; this.closed = false; }

  /** try to add a piece; returns why not, or null when it fit */
  add(id: PieceId, force = false): string | null {
    if (this.closed && !force) return 'Your track is already a full circuit! Undo a piece to change it.';
    const seg = samplePiece(id, this.end, this.length);
    if (!force) {
      const why = this.check(seg);
      if (why) return why;
    }
    this.segs.push(seg);
    this.closed = this.isClosed();
    return null;
  }
  undo() { if (this.segs.length > 1) { this.segs.pop(); this.closed = this.isClosed(); } }

  private isClosed() {
    if (this.segs.length < 4) return false;
    const e = this.end, s = START;
    const fe = V(0, 0, 1).applyQuaternion(e.q), ue = V(0, 1, 0).applyQuaternion(e.q);
    return e.p.distanceTo(s.p) < 0.3 && fe.z > 0.99 && ue.y > 0.99;
  }

  /** would this piece go underground, crash into the track or leave the map? */
  private check(seg: Seg): string | null {
    const closing = (() => {
      const fe = V(0, 0, 1).applyQuaternion(seg.end.q);
      return seg.end.p.distanceTo(START.p) < 0.3 && fe.z > 0.99;
    })();
    for (const sm of seg.samples) {
      if (sm.p.y < 0.3) return 'That would go underground! Try going up first.';
      if (sm.p.y > 70) return 'That’s too high, even for a train!';
      if (Math.abs(sm.p.x) > 230 || Math.abs(sm.p.z) > 230) return 'That’s the edge of the map!';
    }
    // crash test: a grid of the existing track, every metre
    const cell = (v: THREE.Vector3) => `${Math.floor(v.x / 3)},${Math.floor(v.y / 3)},${Math.floor(v.z / 3)}`;
    const grid = new Map<string, Sample[]>();
    const total = this.length;
    for (const sg of this.segs) for (let i = 0; i < sg.samples.length; i += 4) {
      const sm = sg.samples[i];
      if (sm.s > total - 4) continue;                          // the bit we're joining onto
      const k = cell(sm.p); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(sm);
    }
    for (const sm of seg.samples) {
      const local = sm.s - seg.s0;
      if (local < 3) continue;
      const cx = Math.floor(sm.p.x / 3), cy = Math.floor(sm.p.y / 3), cz = Math.floor(sm.p.z / 3);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const a = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
        for (const o of a) {
          if (closing && local > seg.len - 4 && o.s < 4) continue;  // joining back onto the station
          if (o.p.distanceToSquared(sm.p) < 2.6 * 2.6) return 'Crash! That would run into your track.';
        }
      }
    }
    return null;
  }

  /** position and orientation at a distance along the track (wraps on a closed circuit) */
  at(s: number, out?: Sample): Sample {
    const L = this.length;
    if (this.closed) s = ((s % L) + L) % L; else s = Math.max(0, Math.min(L, s));
    // find the piece, then the samples
    let lo = 0, hi = this.segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.segs[m].s0 <= s) lo = m; else hi = m - 1; }
    const seg = this.segs[lo], sm = seg.samples;
    const k = Math.min(sm.length - 2, Math.max(0, Math.floor(((s - seg.s0) / seg.len) * (sm.length - 1))));
    const a = sm[k], b = sm[k + 1];
    const t = Math.max(0, Math.min(1, (s - a.s) / Math.max(1e-6, b.s - a.s)));
    const o = out || { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), s: 0, boost: false };
    o.p.lerpVectors(a.p, b.p, t); o.f.lerpVectors(a.f, b.f, t).normalize(); o.u.lerpVectors(a.u, b.u, t).normalize();
    o.r.copy(o.u).cross(o.f).normalize(); o.s = s; o.boost = a.boost;
    return o;
  }

  /** every sample in order (for drawing) */
  *all() { for (const sg of this.segs) for (const s of sg.samples) yield s; }
}
