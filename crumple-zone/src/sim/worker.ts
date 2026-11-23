/* The physics thread: owns the simulation, steps it when the page asks, and sends back node positions. */
import { Sim, AIDriver, DT } from './physics';
import { getMap, type Box } from './maps';

let sim: Sim | null = null;
let timeScale = 1;

type Msg =
  | { t: 'map'; id: string }
  | { t: 'spawn'; key: string; spec: string; x: number; z: number; yaw: number; ai?: number | null; aiSpeed?: number }
  | { t: 'remove'; key: string }
  | { t: 'place'; key: string; x: number; z: number; yaw: number; repair: boolean; drop?: number }
  | { t: 'repair'; key: string }
  | { t: 'input'; key: string; throttle: number; brake: number; steer: number; hand: number; gear?: number | null; fly?: boolean; lift?: number; boost?: number }
  | { t: 'tune'; key: string; power?: number; grip?: number; strength?: number; aids?: boolean }
  | { t: 'launch'; key: string; speed: number }
  | { t: 'box'; box: Box }
  | { t: 'gravity'; g: number }
  | { t: 'step'; dt: number; scale: number };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.t === 'map') { sim = new Sim(getMap(m.id)); (self as any).postMessage({ t: 'ready' }); return; }
  if (!sim) return;
  switch (m.t) {
    case 'spawn': {
      const c = sim.spawn(m.key, m.spec, m.x, m.z, m.yaw);
      if (m.ai != null && sim.map.ai[m.ai]) { c.ai = new AIDriver(sim.map.ai[m.ai], c); c.ai.target = m.aiSpeed ?? 11 + Math.random() * 6; }
      break;
    }
    case 'remove': sim.remove(m.key); break;
    case 'place': { const c = sim.car(m.key); if (c) { c.place(m.x, m.z, m.yaw, m.repair, m.drop || 0); c.updateFrame(); } break; }
    case 'repair': sim.car(m.key)?.repairHere(); break;
    case 'input': { const c = sim.car(m.key); if (c && !c.ai) c.input = { throttle: m.throttle, brake: m.brake, steer: m.steer, hand: m.hand, gear: m.gear, fly: m.fly, lift: m.lift, boost: m.boost }; break; }
    case 'tune': {
      const c = sim.car(m.key); if (!c) break;
      if (m.power != null) c.powerMul = m.power;
      if (m.aids != null) c.aids = m.aids;
      if (m.grip != null) c.gripMul = m.grip;
      if (m.strength != null) { c.strengthMul = m.strength; for (let i = 0; i < c.nb; i++) c.bdef[i] = c.def.beams[i].def * m.strength; }
      break;
    }
    case 'launch': {
      const c = sim.car(m.key); if (!c) break;
      c.updateFrame();
      const f = c.fwd, fl = Math.hypot(f[0], f[2]) || 1;
      for (let i = 0; i < c.n; i++) { c.vel[i * 3] = (f[0] / fl) * m.speed; c.vel[i * 3 + 1] = 0; c.vel[i * 3 + 2] = (f[2] / fl) * m.speed; }
      c.w.forEach(w => { w.omega = m.speed / w.R; });
      break;
    }
    case 'box': sim.addBox(m.box); break;
    case 'gravity': sim.gravity = m.g; break;
    case 'step': {
      timeScale = m.scale;
      const t0 = performance.now();
      sim.run(Math.min(1 / 15, m.dt) * timeScale);
      const ms = performance.now() - t0;
      const cars = sim.cars.map(c => {
        const pos = new Float32Array(c.pos);
        const wheels = new Float32Array(c.w.length * 6);
        c.w.forEach((w, i) => { wheels.set([w.angle, w.steer, w.flat ? 1 : 0, w.lost ? 1 : 0, w.contact * w.slip, w.R], i * 6); });
        return {
          key: c.key, pos, wheels, speed: c.speed, rpm: c.rpm, gear: c.rev ? -1 : c.gear, health: c.health, dead: c.engineDead,
          fwd: c.fwd, up: c.up, com: c.com, windows: [...c.brokenWindows], lights: [...c.brokenLights], parts: [...c.lostParts], damage: c.damage,
          throttle: c.input.throttle, brake: c.input.brake, jets: c.jets, fly: !!c.input.fly, steer: c.input.steer,
        };
      });
      const events = sim.events; sim.events = [];
      (self as any).postMessage({ t: 'state', cars, events, ms, dt: DT }, cars.flatMap(c => [c.pos.buffer, c.wheels.buffer]));
      break;
    }
  }
};
