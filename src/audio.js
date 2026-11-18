/*
  WebAudio synth only. Every sound's pitch and length follow the time scale (never below 0.3),
  a master low-pass closes as time slows, and a low hum rises when time is nearly frozen.
*/
let ctx = null, master, lowpass, humGain, noise, rate = 1, muted = false;

function makeNoise() {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }

function noiseHit({ type = 'bandpass', freq = 1500, q = 1, peak = 0.4, dec = 0.2, sweep = 0 }) {
  const t = ctx.currentTime, r = rate, s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = r;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq * r, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep * r), t + dec / r);
  const g = ctx.createGain(); env(g, t, 0.004, peak, dec / r);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + 0.05 + dec / r);
}

function tone({ type = 'sine', f0 = 440, f1 = null, peak = 0.3, dec = 0.2, at = 0 }) {
  const t = ctx.currentTime + at / rate, r = rate, o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0 * r, t); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * r), t + dec / r);
  const g = ctx.createGain(); env(g, t, 0.005, peak, dec / r);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.05 + dec / r);
}

const SOUNDS = {
  shot() { noiseHit({ freq: 2200, q: 0.7, peak: 0.5, dec: 0.22, sweep: 500 }); tone({ type: 'triangle', f0: 150, f1: 40, peak: 0.6, dec: 0.25 }); },
  enemyShot() { noiseHit({ freq: 1300, q: 0.9, peak: 0.35, dec: 0.3, sweep: 300 }); tone({ type: 'triangle', f0: 110, f1: 35, peak: 0.45, dec: 0.3 }); },
  dry() { tone({ type: 'square', f0: 2400, f1: 1800, peak: 0.08, dec: 0.03 }); tone({ type: 'square', f0: 900, peak: 0.05, dec: 0.02, at: 0.04 }); },
  punch() { tone({ type: 'sine', f0: 120, f1: 45, peak: 0.7, dec: 0.18 }); noiseHit({ type: 'lowpass', freq: 900, peak: 0.4, dec: 0.12 }); },
  whoosh() { noiseHit({ freq: 600, q: 2, peak: 0.25, dec: 0.35, sweep: 2400 }); },
  thud() { tone({ type: 'sine', f0: 90, f1: 50, peak: 0.35, dec: 0.12 }); },
  ricochet() { noiseHit({ type: 'highpass', freq: 3000, peak: 0.12, dec: 0.08 }); tone({ type: 'sine', f0: 2600, f1: 1200, peak: 0.05, dec: 0.15 }); },
  shatter() {
    noiseHit({ type: 'highpass', freq: 2500, peak: 0.45, dec: 0.7 });
    for (let i = 0; i < 6; i++) tone({ type: 'sine', f0: 1800 + Math.random() * 2600, peak: 0.06, dec: 0.4 + Math.random() * 0.5, at: i * 0.03 });
    tone({ type: 'triangle', f0: 200, f1: 60, peak: 0.3, dec: 0.3 });
  },
  pickup() { tone({ type: 'square', f0: 700, peak: 0.07, dec: 0.05 }); tone({ type: 'square', f0: 1050, peak: 0.07, dec: 0.06, at: 0.06 }); },
  death() { tone({ type: 'sawtooth', f0: 220, f1: 35, peak: 0.4, dec: 1.2 }); noiseHit({ type: 'lowpass', freq: 600, peak: 0.5, dec: 1 }); },
  rifle() { noiseHit({ freq: 1500, q: 0.6, peak: 0.7, dec: 0.45, sweep: 250 }); tone({ type: 'triangle', f0: 95, f1: 30, peak: 0.8, dec: 0.45 }); },
  swish() { noiseHit({ freq: 900, q: 3, peak: 0.3, dec: 0.28, sweep: 3800 }); },
  clang() { tone({ type: 'square', f0: 3100, f1: 2400, peak: 0.07, dec: 0.25 }); tone({ type: 'sine', f0: 4700, peak: 0.05, dec: 0.4 }); noiseHit({ type: 'highpass', freq: 5000, peak: 0.15, dec: 0.06 }); },
  glass() { noiseHit({ type: 'highpass', freq: 3500, peak: 0.35, dec: 0.4 }); for (let i = 0; i < 4; i++) tone({ type: 'sine', f0: 2500 + Math.random() * 3000, peak: 0.05, dec: 0.25 + Math.random() * 0.3, at: i * 0.02 }); },
  clear() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, peak: 0.18, dec: 0.9, at: i * 0.07 })); },
};

export const Audio = {
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    noise = makeNoise();
    lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 18000;
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(lowpass).connect(ctx.destination);
    // near-frozen hum: two detuned low saws through a tight low-pass
    humGain = ctx.createGain(); humGain.gain.value = 0; const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 160;
    for (const f of [55, 55.7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(hf); o.start(); }
    hf.connect(humGain).connect(ctx.destination);
  },
  /** Follow the time scale: pitch for new sounds, master tone, and the hum. */
  setRate(scale) {
    rate = Math.max(0.3, Math.min(1, scale));
    if (!ctx) return;
    const t = ctx.currentTime;
    lowpass.frequency.setTargetAtTime(500 + 17500 * rate * rate, t, 0.05);
    const frozen = Math.max(0, 1 - scale / 0.12);
    humGain.gain.setTargetAtTime(muted ? 0 : 0.06 * frozen, t, 0.12);
  },
  play(name) { if (!ctx || muted || ctx.state !== 'running') return; const s = SOUNDS[name]; if (s) s(); },
  mute(on) { muted = on; if (master) master.gain.value = on ? 0 : 0.7; },
  get ready() { return !!ctx; },
};
