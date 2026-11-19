import { store, storeSet, isPhone } from './util';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export interface Settings {
  quality: Quality;
  renderDistance: number;   // metres
  fov: number;
  sensitivity: number;
  invertY: boolean;
  master: number; music: number; sfx: number;
  showFps: boolean;
  touch: 'auto' | 'on' | 'off';
}

export const PRESETS: Record<Quality, { pixelRatio: number; shadows: boolean; shadowSize: number; antialias: boolean; maxCustomers: number; pedestrians: number; cars: number; lights: number }> = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 512, antialias: false, maxCustomers: 8, pedestrians: 4, cars: 4, lights: 1 },
  medium: { pixelRatio: 1, shadows: false, shadowSize: 1024, antialias: true, maxCustomers: 14, pedestrians: 8, cars: 8, lights: 2 },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, antialias: true, maxCustomers: 18, pedestrians: 12, cars: 12, lights: 4 },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, antialias: true, maxCustomers: 22, pedestrians: 16, cars: 16, lights: 6 },
};

const defaults: Settings = {
  quality: isPhone() ? 'low' : 'high',
  renderDistance: isPhone() ? 60 : 110,
  fov: 75, sensitivity: 1, invertY: false,
  master: 0.8, music: 0.45, sfx: 0.8,
  showFps: false, touch: 'auto',
};

export const settings: Settings = store('gst-settings', defaults);
export const saveSettings = () => storeSet('gst-settings', settings);
export const preset = () => PRESETS[settings.quality] || PRESETS.medium;
