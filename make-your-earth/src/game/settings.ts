/* Player settings: graphics presets (auto-picked per device), view/simulation distance, audio, controls. */
export type Preset = 'potato' | 'low' | 'medium' | 'high' | 'ultra';
export interface Settings {
  preset: Preset; render: number; sim: number; shadows: boolean; foliage: boolean; particles: boolean; scale: number;
  master: number; ambience: number; sfx: number; sensitivity: number; invertY: boolean; fov: number; profanity: boolean;
  keys: Record<string, string>; name: string; autoDetected: boolean; touchLayout: Record<string, [number, number]>;
}
export const PRESETS: Record<Preset, Pick<Settings, 'render' | 'sim' | 'shadows' | 'foliage' | 'particles' | 'scale'>> = {
  potato: { render: 4, sim: 3, shadows: false, foliage: false, particles: false, scale: 0.6 },
  low: { render: 5, sim: 3, shadows: false, foliage: true, particles: true, scale: 0.75 },
  medium: { render: 7, sim: 4, shadows: true, foliage: true, particles: true, scale: 1 },
  high: { render: 9, sim: 5, shadows: true, foliage: true, particles: true, scale: 1 },
  ultra: { render: 12, sim: 6, shadows: true, foliage: true, particles: true, scale: 1.25 },
};
export const DEFAULT_KEYS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'KeyC',
  inventory: 'KeyE', map: 'KeyM', journal: 'KeyJ', blockmaker: 'KeyB', rotate: 'KeyR', chat: 'KeyT', drop: 'KeyQ', eat: 'KeyF', menu: 'Escape',
};
export const isTouch = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && innerWidth < 1100;

export function detectPreset(): { preset: Preset; lowMemory: boolean } {
  const mem = (navigator as any).deviceMemory as number | undefined, cores = navigator.hardwareConcurrency || 4;
  const lowMemory = !!mem && mem <= 2;
  if (lowMemory) return { preset: 'potato', lowMemory };
  if (isTouch()) return { preset: (mem && mem >= 6 && cores >= 8) ? 'medium' : 'low', lowMemory };
  return { preset: cores >= 8 ? 'high' : 'medium', lowMemory };
}

const KEY = 'mye-settings';
function load(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  if (!s.preset) {
    const d = detectPreset();
    s = { ...PRESETS[d.preset], preset: d.preset, autoDetected: true, ...(d.lowMemory ? { render: 4 } : {}) };
  }
  return {
    preset: 'medium', ...PRESETS.medium, master: 0.8, ambience: 0.6, sfx: 0.9, sensitivity: 1, invertY: false, fov: 75, profanity: true,
    name: '', autoDetected: false, touchLayout: {}, ...s, keys: { ...DEFAULT_KEYS, ...(s.keys || {}) },
  } as Settings;
}
export const settings: Settings = load();
const subs = new Set<() => void>();
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } subs.forEach(f => f()); }
export const onSettings = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export function applyPreset(p: Preset) { Object.assign(settings, PRESETS[p], { preset: p, autoDetected: false }); saveSettings(); }
