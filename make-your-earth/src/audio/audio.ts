/*
  Sound: short effects and looping ambience. Files come from Freesound (CC0), bundled in /sounds and only
  fetched when first needed. If a file is missing, a small synthesised stand-in plays instead.
*/
import * as THREE from 'three';
import { settings } from '../game/settings';

const AMBIENT = ['birds', 'wind', 'ocean', 'night', 'rain', 'fire'] as const;
type Amb = typeof AMBIENT[number];

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private amb!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private loops = new Map<Amb, { src: AudioBufferSourceNode; gain: GainNode }>();
  private listener = new THREE.Vector3(); private right = new THREE.Vector3(1, 0, 0);

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    this.ctx = new AC() as AudioContext;
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.amb = this.ctx.createGain(); this.amb.connect(this.master);
    this.volumes();
  }
  volumes() { if (!this.ctx) return; this.master.gain.value = settings.master; this.sfx.gain.value = settings.sfx; this.amb.gain.value = settings.ambience * 0.6; }
  private buf(name: string) {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetch(`/sounds/${name}.mp3`).then(r => (r.ok ? r.arrayBuffer() : null)).then(a => (a && this.ctx ? this.ctx.decodeAudioData(a) : null)).catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }
  setListener(pos: THREE.Vector3, yaw: number) { this.listener.copy(pos); this.right.set(Math.cos(yaw), 0, -Math.sin(yaw)); }

  /** play an effect; with a position it gets quieter with distance and pans left/right */
  async play(name: string, opt: { vol?: number; pos?: THREE.Vector3; pitch?: number; range?: number } = {}) {
    if (!this.ctx) return;
    let vol = opt.vol ?? 1, pan = 0;
    if (opt.pos) {
      const d = opt.pos.distanceTo(this.listener), range = opt.range ?? 30;
      if (d > range) return;
      vol *= 1 - d / range;
      pan = Math.max(-1, Math.min(1, opt.pos.clone().sub(this.listener).normalize().dot(this.right)));
    }
    const b = await this.buf(name);
    const g = this.ctx.createGain(); g.gain.value = vol;
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    if (!b) { this.synth(name, g); return; }
    const s = this.ctx.createBufferSource(); s.buffer = b;
    s.playbackRate.value = (opt.pitch ?? 1) * (0.92 + Math.random() * 0.16);
    s.connect(g); s.start();
    if (b.duration > 4) s.stop(this.ctx.currentTime + 4);
  }
  /** stand-in sounds made from noise and tones */
  private synth(name: string, out: GainNode) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const noise = (dur: number, freq: number, q = 1) => {
      const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const s = ctx.createBufferSource(); s.buffer = buf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      s.connect(f).connect(out); s.start(t);
    };
    const tone = (f0: number, f1: number, dur: number, type: OscillatorType = 'sine') => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
    };
    if (name === 'break' || name === 'mine') noise(0.18, 900, 2);
    else if (name.startsWith('step')) noise(0.08, 400, 1);
    else if (name === 'pickup' || name === 'click') tone(700, 1200, 0.08);
    else if (name === 'discover' || name === 'craft') { tone(660, 990, 0.25, 'triangle'); }
    else if (name === 'hurt') tone(220, 110, 0.2, 'sawtooth');
    else noise(0.25, 600, 1);
  }

  /** ambience: give each loop a 0..1 level; they fade smoothly */
  async ambience(levels: Partial<Record<Amb, number>>) {
    if (!this.ctx) return;
    for (const a of AMBIENT) {
      const want = levels[a] ?? 0;
      let l = this.loops.get(a);
      if (!l && want > 0.02) {
        const b = await this.buf(a); if (!b || this.loops.has(a)) continue;
        const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
        const gain = this.ctx.createGain(); gain.gain.value = 0; src.connect(gain).connect(this.amb); src.start();
        l = { src, gain }; this.loops.set(a, l);
      }
      if (l) l.gain.gain.setTargetAtTime(want, this.ctx.currentTime, 1.2);
    }
  }
  stopAmbience() { for (const l of this.loops.values()) l.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.3); }
}
export const sound = new Sound();
