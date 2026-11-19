/* Sound: Kenney CC0 samples from Patch's library + a few synthesized blips, and a lo-fi music loop. */
import { settings } from '../core/settings';

type Sfx = 'click' | 'coins' | 'coinsBig' | 'step' | 'stepCarpet' | 'chime' | 'glass' | 'back' | 'beep' | 'error' | 'levelup' | 'thud' | 'place' | 'pickup' | 'cash' | 'door' | 'repair' | 'sweep' | 'pop';
const FILES: Partial<Record<Sfx, string>> = { click: 'click_001', coins: 'handleCoins2', coinsBig: 'handleCoins', step: 'footstep_concrete_000', stepCarpet: 'footstep_carpet_000', chime: 'bong_001', glass: 'glass_001', back: 'back_001' };

class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode; sfxBus!: GainNode; musicBus!: GainNode;
  buffers = new Map<string, AudioBuffer>();
  music: HTMLAudioElement | null = null;
  musicSrc: MediaElementAudioSourceNode | null = null;
  listener = { x: 0, y: 0, z: 0 };
  private last = new Map<string, number>();

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
    this.applyVolumes();
    for (const [k, f] of Object.entries(FILES)) {
      fetch(`/audio/${f}.mp3`).then(r => r.arrayBuffer()).then(b => this.ctx!.decodeAudioData(b)).then(buf => this.buffers.set(k, buf)).catch(() => {});
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.sfxBus.gain.value = settings.sfx;
    this.musicBus.gain.value = settings.music * 0.6;
    if (this.music) this.music.volume = this.musicSrc ? 1 : settings.master * settings.music * 0.6;
  }

  startMusic() {
    if (this.music || !this.ctx) return;
    const a = new window.Audio('/audio/poor_but_happy.mp3');
    a.loop = true; a.crossOrigin = 'anonymous'; a.preload = 'auto';
    this.music = a;
    try { this.musicSrc = this.ctx.createMediaElementSource(a); this.musicSrc.connect(this.musicBus); } catch { this.musicSrc = null; }
    this.applyVolumes();
    a.play().catch(() => {});
  }
  pauseMusic(p: boolean) { if (this.music) p ? this.music.pause() : this.music.play().catch(() => {}); }

  /** play a sound; pass a world position to make it quieter with distance */
  play(name: Sfx, opts: { at?: { x: number; z: number; y?: number }; vol?: number; rate?: number; throttle?: number } = {}) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const now = performance.now();
    if (opts.throttle && now - (this.last.get(name) || 0) < opts.throttle) return;
    this.last.set(name, now);
    let vol = opts.vol ?? 1;
    if (opts.at) {
      const dx = opts.at.x - this.listener.x, dz = opts.at.z - this.listener.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      vol *= 1 / (1 + Math.max(0, d - 2) * 0.25);
      if (vol < 0.03) return;
    }
    const out = c.createGain(); out.gain.value = vol; out.connect(this.sfxBus);
    const buf = this.buffers.get(name);
    if (buf) {
      const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = opts.rate ?? (0.94 + Math.random() * 0.12); s.connect(out); s.start();
      return;
    }
    this.synth(name, out, opts.rate ?? 1);
  }

  private tone(out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol = 0.25) {
    const c = this.ctx!; const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, c.currentTime + t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.currentTime + t0 + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + t0); g.gain.exponentialRampToValueAtTime(vol, c.currentTime + t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.connect(g); g.connect(out); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  }
  private noise(out: AudioNode, t0: number, dur: number, vol: number, freq = 800) {
    const c = this.ctx!; const n = c.createBufferSource(); const len = Math.floor(c.sampleRate * dur);
    const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    n.buffer = b; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; const g = c.createGain(); g.gain.value = vol;
    n.connect(f); f.connect(g); g.connect(out); n.start(c.currentTime + t0);
  }
  private synth(name: Sfx, out: AudioNode, r: number) {
    switch (name) {
      case 'beep': this.tone(out, 'square', 1850 * r, 1850 * r, 0, 0.09, 0.12); break;
      case 'error': this.tone(out, 'sawtooth', 220, 140, 0, 0.22, 0.15); break;
      case 'cash': this.tone(out, 'triangle', 1318, 1318, 0, 0.12, 0.2); this.tone(out, 'triangle', 1760, 1760, 0.09, 0.3, 0.2); this.noise(out, 0, 0.08, 0.15, 3000); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(out, 'triangle', f, f, i * 0.09, 0.25, 0.18)); break;
      case 'thud': this.tone(out, 'sine', 140, 55, 0, 0.18, 0.4); this.noise(out, 0, 0.1, 0.2, 400); break;
      case 'place': this.tone(out, 'sine', 300, 180, 0, 0.12, 0.25); this.noise(out, 0, 0.05, 0.1, 1200); break;
      case 'pickup': this.tone(out, 'sine', 360, 620, 0, 0.1, 0.18); break;
      case 'door': this.tone(out, 'sine', 1568, 1568, 0, 0.5, 0.12); this.tone(out, 'sine', 1175, 1175, 0.18, 0.6, 0.12); break;
      case 'repair': for (let i = 0; i < 3; i++) this.noise(out, i * 0.12, 0.06, 0.25, 2500); break;
      case 'sweep': this.noise(out, 0, 0.35, 0.18, 1600); break;
      case 'pop': this.tone(out, 'sine', 600, 900, 0, 0.07, 0.15); break;
      default: this.tone(out, 'sine', 800, 800, 0, 0.06, 0.1);
    }
  }
}

export const audio = new Audio();
