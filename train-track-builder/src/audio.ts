/* Little synthesized sounds: the engine chuff, wheels clacking, wind, the horn, boosters and cheers. */
class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private chuffT = 0; private clackT = 0;
  muted = false;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination);
    // continuous wind, louder with speed
    const buf = this.noiseBuf(2);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 600; this.windFilter.Q.value = 0.6;
    this.wind = this.ctx.createGain(); this.wind.gain.value = 0;
    src.connect(this.windFilter); this.windFilter.connect(this.wind); this.wind.connect(this.master); src.start();
  }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }

  private noiseBuf(sec: number) {
    const c = this.ctx!, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass') {
    const c = this.ctx; if (!c) return;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf(dur);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  private tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'square', delay = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  /** call every frame while driving */
  drive(dt: number, speed: number, throttle: number, steam: boolean) {
    if (!this.ctx) return;
    const v = Math.abs(speed);
    if (this.wind && this.windFilter) { this.wind.gain.value = Math.min(0.35, v / 120); this.windFilter.frequency.value = 400 + v * 25; }
    if (steam && v > 0.3) {
      this.chuffT -= dt * Math.min(12, 1 + v * 0.6) * (0.6 + Math.abs(throttle) * 0.6);
      if (this.chuffT <= 0) { this.chuffT = 1; this.burst(0.18, 0.18 + Math.abs(throttle) * 0.2, 900); }
    }
    if (v > 0.5) {
      this.clackT -= dt * v / 4.5;
      if (this.clackT <= 0) { this.clackT = 1; this.burst(0.05, 0.12, 2500, 'highpass'); setTimeout(() => this.burst(0.05, 0.1, 2500, 'highpass'), 90); }
    }
  }
  stopDrive() { if (this.wind) this.wind.gain.value = 0; }

  horn(steam: boolean) {
    if (steam) { this.tone(440, 430, 0.9, 0.12, 'sawtooth'); this.tone(554, 545, 0.9, 0.1, 'sawtooth'); this.tone(659, 650, 0.9, 0.08, 'sawtooth'); }
    else { this.tone(880, 880, 0.18, 0.12, 'square'); this.tone(660, 660, 0.25, 0.12, 'square', 0.2); }
  }
  click() { this.tone(900, 1200, 0.06, 0.08, 'triangle'); }
  place() { this.tone(300, 520, 0.12, 0.15, 'triangle'); this.burst(0.08, 0.1, 1500); }
  error() { this.tone(220, 150, 0.25, 0.12, 'sawtooth'); }
  bump() { this.burst(0.35, 0.5, 300); this.tone(120, 60, 0.3, 0.2, 'sine'); }
  boost() { this.tone(300, 1200, 0.35, 0.1, 'sawtooth'); }
  cheer() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, 0.25, 0.12, 'triangle', i * 0.09)); this.burst(0.6, 0.08, 4000, 'highpass'); }
}
export const sound = new Sound();
