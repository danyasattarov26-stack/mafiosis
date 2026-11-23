/*
  Vehicle blueprints. Each car is a row of cross-sections ("stations") from the back (−z) to the front (+z).
  At every station: floor height (yb), beltline (yl) and top (yt), and half-widths at those three heights.
  The physics frame and the visible body are both generated from these numbers, so they always match.
  Units: metres, kg, kW. The car faces +z, +y is up.
*/
export type Glass = 'front' | 'rear' | null;
export interface Station { z: number; yb: number; yl: number; yt: number; wb: number; wl: number; wt: number; side?: boolean; top?: Glass }

export interface Spec {
  id: string; name: string; blurb: string; emoji: string;
  mass: number; engineMass: number; engineAt: 'front' | 'rear';
  stations: Station[];
  axles: { z: number; steer: boolean; drive: boolean; hand: boolean }[];
  track: number; wheelR: number; wheelW: number; tyreGrip: number;
  power: number; maxRpm: number; idleRpm: number; gears: number[]; final: number; reverse: number;
  springHz: number; damping: number; steerMax: number; strength: number;
  colors: string[]; driver: { x: number; y: number; z: number };
  style: 'coupe' | 'muscle' | 'bus' | 'truck';
}

const S = (z: number, yb: number, yl: number, yt: number, wb: number, wl: number, wt: number, side = false, top: Glass = null): Station => ({ z, yb, yl, yt, wb, wl, wt, side, top });

export const SPECS: Spec[] = [
  {
    id: 'vesper', name: 'Vesper GT', emoji: '🏎️', style: 'coupe', blurb: 'Low, light, rear-wheel-drive sports coupe. Fast and twitchy.',
    mass: 1250, engineMass: 220, engineAt: 'front', track: 1.6, wheelR: 0.33, wheelW: 0.26, tyreGrip: 1.15,
    power: 290, maxRpm: 7600, idleRpm: 900, gears: [3.3, 2.2, 1.6, 1.25, 1.0, 0.82], final: 3.6, reverse: 3.2,
    springHz: 1.8, damping: 0.42, steerMax: 0.6, strength: 1,
    colors: ['#d7263d', '#f5f5f5', '#1b98e0', '#ffb400', '#2e2e3a'], driver: { x: 0.37, y: 1.0, z: -0.25 },
    axles: [{ z: -1.32, steer: false, drive: true, hand: true }, { z: 1.33, steer: true, drive: false, hand: false }],
    stations: [
      S(-2.22, 0.30, 0.62, 0.78, 0.80, 0.86, 0.72),
      S(-1.95, 0.22, 0.66, 0.92, 0.88, 0.93, 0.80),
      S(-1.60, 0.18, 0.70, 0.96, 0.90, 0.95, 0.82),
      S(-1.32, 0.17, 0.72, 0.98, 0.91, 0.95, 0.82, false, 'rear'),
      S(-0.90, 0.16, 0.74, 1.22, 0.91, 0.95, 0.68, true),
      S(-0.40, 0.16, 0.75, 1.27, 0.91, 0.95, 0.67, true),
      S(0.08, 0.16, 0.75, 1.26, 0.91, 0.95, 0.68, true, 'front'),
      S(0.78, 0.16, 0.74, 0.87, 0.91, 0.95, 0.80),
      S(1.33, 0.17, 0.70, 0.82, 0.91, 0.95, 0.82),
      S(1.80, 0.20, 0.64, 0.74, 0.88, 0.92, 0.80),
      S(2.10, 0.24, 0.56, 0.66, 0.82, 0.86, 0.74),
      S(2.24, 0.30, 0.48, 0.58, 0.74, 0.78, 0.66),
    ],
  },
  {
    id: 'brutus', name: 'Brutus 70', emoji: '🚘', style: 'muscle', blurb: 'Big V8 muscle car. Heavy, loud and loves burnouts.',
    mass: 1600, engineMass: 300, engineAt: 'front', track: 1.62, wheelR: 0.34, wheelW: 0.28, tyreGrip: 1.0,
    power: 320, maxRpm: 6200, idleRpm: 750, gears: [2.8, 1.9, 1.4, 1.1, 0.9], final: 3.4, reverse: 2.9,
    springHz: 1.4, damping: 0.35, steerMax: 0.58, strength: 1.15,
    colors: ['#f4a259', '#1d3557', '#2a9d8f', '#e9c46a', '#111111'], driver: { x: 0.38, y: 1.05, z: -0.15 },
    axles: [{ z: -1.40, steer: false, drive: true, hand: true }, { z: 1.40, steer: true, drive: false, hand: false }],
    stations: [
      S(-2.42, 0.32, 0.66, 0.80, 0.84, 0.92, 0.86),
      S(-2.15, 0.25, 0.70, 0.90, 0.90, 0.97, 0.88),
      S(-1.75, 0.20, 0.72, 0.92, 0.93, 0.98, 0.90),
      S(-1.40, 0.19, 0.73, 0.93, 0.93, 0.98, 0.90, false, 'rear'),
      S(-0.95, 0.18, 0.76, 1.30, 0.93, 0.98, 0.72, true),
      S(-0.40, 0.18, 0.77, 1.36, 0.93, 0.98, 0.72, true),
      S(0.15, 0.18, 0.77, 1.35, 0.93, 0.98, 0.73, true, 'front'),
      S(0.78, 0.18, 0.76, 0.98, 0.93, 0.98, 0.88),
      S(1.40, 0.19, 0.75, 0.95, 0.93, 0.98, 0.88),
      S(1.95, 0.22, 0.72, 0.92, 0.92, 0.97, 0.86),
      S(2.30, 0.26, 0.66, 0.86, 0.88, 0.94, 0.82),
      S(2.43, 0.30, 0.52, 0.78, 0.84, 0.90, 0.78),
    ],
  },
  {
    id: 'bus', name: 'City Bus', emoji: '🚌', style: 'bus', blurb: 'Twelve tonnes of public transport. Slow, but it wins every argument.',
    mass: 11000, engineMass: 1200, engineAt: 'rear', track: 2.1, wheelR: 0.52, wheelW: 0.32, tyreGrip: 0.9,
    power: 220, maxRpm: 2600, idleRpm: 600, gears: [4.8, 2.9, 1.9, 1.35, 1.0], final: 5.4, reverse: 4.5,
    springHz: 1.3, damping: 0.4, steerMax: 0.62, strength: 1.7,
    colors: ['#ffd23f', '#3a86ff', '#ef476f', '#06d6a0', '#ffffff'], driver: { x: 0.7, y: 2.05, z: 4.3 },
    axles: [{ z: -2.6, steer: false, drive: true, hand: true }, { z: 3.25, steer: true, drive: false, hand: false }],
    stations: [
      S(-5.25, 0.55, 1.3, 2.95, 1.18, 1.24, 1.15),
      S(-4.60, 0.48, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(-3.60, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(-2.60, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(-1.60, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(-0.60, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(0.40, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(1.40, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(2.40, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(3.25, 0.45, 1.35, 3.0, 1.22, 1.25, 1.18, true),
      S(4.30, 0.45, 1.30, 3.0, 1.22, 1.25, 1.18, true, 'front'),
      S(5.10, 0.50, 1.05, 1.25, 1.20, 1.23, 1.18),
      S(5.30, 0.55, 0.95, 1.12, 1.14, 1.18, 1.12),
    ],
  },
  {
    id: 'hauler', name: 'Box Hauler', emoji: '🚚', style: 'truck', blurb: 'Delivery truck with a big box. Top-heavy: corners carefully.',
    mass: 6500, engineMass: 700, engineAt: 'front', track: 2.0, wheelR: 0.48, wheelW: 0.3, tyreGrip: 0.95,
    power: 200, maxRpm: 3200, idleRpm: 650, gears: [4.2, 2.6, 1.7, 1.25, 1.0], final: 4.6, reverse: 4.0,
    springHz: 1.4, damping: 0.4, steerMax: 0.6, strength: 1.5,
    colors: ['#ffffff', '#e63946', '#457b9d', '#2a9d8f', '#f4a261'], driver: { x: 0.55, y: 1.95, z: 2.55 },
    axles: [{ z: -1.9, steer: false, drive: true, hand: true }, { z: 2.4, steer: true, drive: false, hand: false }],
    stations: [
      S(-3.60, 0.62, 1.0, 3.25, 1.18, 1.22, 1.18),
      S(-2.70, 0.60, 1.0, 3.30, 1.20, 1.23, 1.20),
      S(-1.90, 0.60, 1.0, 3.30, 1.20, 1.23, 1.20),
      S(-0.90, 0.60, 1.0, 3.30, 1.20, 1.23, 1.20),
      S(0.10, 0.60, 1.0, 3.30, 1.20, 1.23, 1.20),
      S(1.15, 0.60, 1.0, 3.25, 1.20, 1.23, 1.20),
      S(1.40, 0.56, 1.25, 2.55, 1.10, 1.14, 1.06, true),
      S(2.40, 0.55, 1.25, 2.62, 1.10, 1.14, 1.06, true, 'front'),
      S(3.15, 0.55, 1.15, 1.55, 1.10, 1.14, 1.08),
      S(3.62, 0.58, 0.98, 1.38, 1.04, 1.08, 1.02),
    ],
  },
];
export const SPEC = Object.fromEntries(SPECS.map(s => [s.id, s]));
