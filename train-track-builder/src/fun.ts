/* The fun layer on top of driving: golden stars along the track, trick bonuses, lap times and steam puffs.
   Every carriage you pull adds one to the points multiplier. */
import * as THREE from 'three';
import { model } from './world';
import type { Track, PieceId } from './track';

export interface Award { text: string; points: number; kind: 'star' | 'trick' | 'lap' | 'speed' }

const TRICKS: Partial<Record<PieceId, { name: string; points: number }>> = {
  loop: { name: '➰ Loop-the-loop!', points: 50 },
  roll: { name: '🔄 Flip!', points: 40 },
  helixL: { name: '🌀 Spiral!', points: 30 },
  helixR: { name: '🌪️ Spiral down!', points: 30 },
};
const STAR_GAP = 9;
const starMat = new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb703', emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.35 });

/** a distance along the track wrapped to the nearest copy of `from` on a circuit */
function rel(target: number, from: number, L: number, closed: boolean) {
  if (!closed) return target - from;
  let d = (target - from) % L; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d;
}

export class Fun {
  group = new THREE.Group();
  private stars: { s: number; o: THREE.Object3D; got: boolean; pop: number }[] = [];
  private tricks: { s: number; name: string; points: number }[] = [];
  private prevS = 0; private startS = 0; private lapStart = 0; private clock = 0;
  private speedMarks = new Set<number>();
  score = 0; best = 0; lap = 1; lapTime = 0; bestLap = 0; lastLap = 0; starsGot = 0;
  mult = 1;

  setup(track: Track, startS: number, mult: number) {
    this.group.clear(); this.stars = []; this.tricks = [];
    this.mult = mult; this.score = 0; this.lap = 1; this.lapTime = 0; this.lastLap = 0; this.starsGot = 0; this.clock = 0;
    this.prevS = this.startS = startS; this.lapStart = 0; this.speedMarks.clear();
    const station = track.segs[0].len;
    for (let s = station + 6; s < track.length - (track.closed ? 2 : 4); s += STAR_GAP) {
      const smp = track.at(s);
      const o = model('star');
      o.scale.setScalar(1.6);
      o.position.copy(smp.p).addScaledVector(smp.u, 1.5);
      o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(smp.r, smp.u, smp.f));
      o.traverse((n: any) => { if (n.isMesh) { n.castShadow = false; n.material = starMat; } });
      this.group.add(o);
      this.stars.push({ s, o, got: false, pop: 0 });
    }
    for (const sg of track.segs) { const t = TRICKS[sg.id]; if (t) this.tricks.push({ s: sg.s0 + sg.len, ...t }); }
  }
  get starCount() { return this.stars.length; }

  /** call every frame while driving; returns what was just earned */
  update(dt: number, track: Track, s: number, kmh: number, now: number): Award[] {
    const out: Award[] = [];
    const L = track.length, closed = track.closed;
    this.clock += dt;
    const ds = s - this.prevS;
    const lo = Math.min(0, ds) - 0.6, hi = Math.max(0, ds) + 0.6;
    for (const st of this.stars) {
      if (st.got) continue;
      const d = rel(st.s, this.prevS, L, closed);
      if (d >= lo && d <= hi) { st.got = true; st.pop = 0.001; this.starsGot++; out.push(this.give('⭐', 10, 'star')); }
    }
    if (ds > 0) for (const t of this.tricks) {
      const d = rel(t.s, this.prevS, L, closed);
      if (d > 0 && d <= ds) out.push(this.give(t.name, t.points, 'trick'));
    }
    for (const mark of [100, 150]) if (kmh >= mark && !this.speedMarks.has(mark)) { this.speedMarks.add(mark); out.push(this.give(`🚀 ${mark} km/h!`, mark === 100 ? 25 : 60, 'speed')); }
    // laps round a circuit
    if (closed) {
      const lapNo = Math.floor((s - this.startS) / L);
      if (lapNo >= this.lap) {
        this.lastLap = this.clock - this.lapStart; this.lapStart = this.clock; this.lap = lapNo + 1;
        const record = !this.bestLap || this.lastLap < this.bestLap;
        if (record) this.bestLap = this.lastLap;
        for (const st of this.stars) { st.got = false; st.pop = 0; st.o.visible = true; st.o.scale.setScalar(1.6); }
        this.speedMarks.clear();
        out.push(this.give(record ? `🏁 Lap ${lapNo}: ${fmt(this.lastLap)} · new best!` : `🏁 Lap ${lapNo}: ${fmt(this.lastLap)}`, record ? 100 : 50, 'lap'));
      }
      this.lapTime = this.clock - this.lapStart;
    }
    this.prevS = s;
    // spin and pop
    for (const st of this.stars) {
      if (st.got) {
        if (st.pop > 0 && st.pop < 0.4) { st.pop += dt; const k = 1.6 * (1 + st.pop * 3); st.o.scale.setScalar(k); if (st.pop >= 0.4) st.o.visible = false; }
      } else st.o.rotateY(dt * 3);
    }
    void now;
    return out;
  }
  private give(text: string, points: number, kind: Award['kind']): Award {
    const p = points * this.mult; this.score += p; if (this.score > this.best) this.best = this.score;
    return { text, points: p, kind };
  }
  /** spin the stars in build mode too */
  idle(dt: number) { for (const st of this.stars) if (!st.got) st.o.rotateY(dt * 2); }
}
export const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** soft white puffs from the chimney */
export class Smoke {
  group = new THREE.Group();
  private pool: { m: THREE.Sprite; v: THREE.Vector3; life: number }[] = [];
  private t = 0;
  constructor(n = 48) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d')!; const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(240,240,240,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      m.visible = false; this.group.add(m); this.pool.push({ m, v: new THREE.Vector3(), life: 0 });
    }
  }
  update(dt: number, from: THREE.Vector3 | null, speed: number, throttle: number) {
    if (from) {
      this.t -= dt * (2 + Math.abs(speed) * 0.35) * (0.5 + Math.abs(throttle));
      if (this.t <= 0) {
        this.t = 1;
        const p = this.pool.find(p => p.life <= 0);
        if (p) { p.life = 1; p.m.position.copy(from); p.v.set((Math.random() - 0.5) * 0.8, 2.2 + Math.random(), (Math.random() - 0.5) * 0.8); p.m.visible = true; }
      }
    }
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.7;
      p.m.position.addScaledVector(p.v, dt);
      const k = 1 - p.life;
      p.m.scale.setScalar(0.6 + k * 2.6);
      (p.m.material as THREE.SpriteMaterial).opacity = Math.max(0, p.life * 0.75);
      if (p.life <= 0) p.m.visible = false;
    }
  }
  clear() { for (const p of this.pool) { p.life = 0; p.m.visible = false; } }
}
