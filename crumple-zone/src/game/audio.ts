/* All sound is made on the fly with Web Audio: engine, tyre squeal, wind, crunches, glass and scrapes. */
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private squeal: { f: BiquadFilterNode; g: GainNode } | null = null;
  private wind: { f: BiquadFilterNode; g: GainNode } | null = null;
  private noise!: AudioBuffer;
  volume = 0.8;
  private lastHit = 0;

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2; this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine: two detuned saws through a low-pass
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3; g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.35; o2.connect(g2).connect(f); o1.connect(f); f.connect(g).connect(this.master);
    o1.start(); o2.start(); this.eng = { o1, o2, f, g };
    this.squeal = this.loopNoise('bandpass', 1100, 6);
    this.wind = this.loopNoise('lowpass', 500, 0.7);
  }
  private loopNoise(type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; src.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master); src.start();
    return { f, g };
  }
  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  /** called every frame with the player's car */
  drive(rpm: number, throttle: number, slip: number, speed: number, cyl: number, dead: boolean) {
    if (!this.ctx || !this.eng) return;
    const t = this.ctx.currentTime, e = this.eng;
    const base = (rpm / 60) * (cyl / 2);
    e.o1.frequency.setTargetAtTime(base, t, 0.03); e.o2.frequency.setTargetAtTime(base * 0.5 * 1.01, t, 0.03);
    e.f.frequency.setTargetAtTime(300 + throttle * 1400 + rpm * 0.12, t, 0.05);
    e.g.gain.setTargetAtTime(dead ? 0 : 0.05 + throttle * 0.09, t, 0.05);
    this.squeal!.g.gain.setTargetAtTime(Math.min(0.22, Math.max(0, slip - 0.25) * 0.35), t, 0.04);
    this.squeal!.f.frequency.setTargetAtTime(900 + Math.min(600, speed * 12), t, 0.1);
    this.wind!.g.gain.setTargetAtTime(Math.min(0.25, (speed / 60) ** 2 * 0.3), t, 0.2);
  }
  silence() { if (!this.ctx || !this.eng) return; const t = this.ctx.currentTime; for (const g of [this.eng.g, this.squeal!.g, this.wind!.g]) g.gain.setTargetAtTime(0, t, 0.05); }

  private burst(dur: number, type: BiquadFilterType, freq: number, gain: number, q = 1, decay = 4) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; src.playbackRate.value = 0.7 + Math.random() * 0.6;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
    void decay;
  }
  private thump(freq: number, gain: number, dur: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(t + dur + 0.05);
  }
  crash(strength: number, near: number) {
    const now = performance.now(); if (now - this.lastHit < 70) return; this.lastHit = now;
    const s = Math.min(1, strength / 20) * near; if (s < 0.03) return;
    this.thump(70 + Math.random() * 30, 0.9 * s, 0.35);
    this.burst(0.25 + s * 0.4, 'lowpass', 1800, 0.8 * s, 0.8);
    this.burst(0.15 + s * 0.2, 'bandpass', 3200, 0.35 * s, 2);
  }
  glass(near: number) {
    if (!this.ctx || near < 0.05) return;
    this.burst(0.5, 'highpass', 4000, 0.4 * near, 0.7);
    const ctx = this.ctx;
    for (let i = 0; i < 6; i++) {
      const t = ctx.currentTime + Math.random() * 0.35, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 2500 + Math.random() * 4000;
      g.gain.setValueAtTime(0.06 * near, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
    }
  }
  scrape(near: number) { this.burst(0.18, 'bandpass', 2400 + Math.random() * 1500, 0.18 * near, 3); }
  pop(near: number) { this.thump(160, 0.5 * near, 0.15); this.burst(0.2, 'lowpass', 900, 0.4 * near); }
  beep(hi = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = hi ? 1320 : 880; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master); o.start(); o.stop(t + 0.3);
  }
}
