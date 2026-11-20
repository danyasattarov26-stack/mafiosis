/* Shared world state. The host simulates it; co-op guests mirror it from network snapshots. */
import type { SaveData, Review } from '../core/save';
import type { CustomerType } from '../config/npcs';
import { Emitter } from '../core/util';
import { Nav } from './nav';

export type Anim = 'walk' | 'run' | 'idle' | 'sit' | 'play' | 'work' | 'carry' | 'drive' | 'vr' | 'eat';
export const PLAYING: ReadonlySet<string> = new Set(['play', 'drive', 'vr']);
export interface CartItem { p: string; price: number }

export interface Customer {
  id: string; type: CustomerType; model: string; tint: number;
  x: number; z: number; y: number; ry: number; anim: Anim;
  state: string; t: number; tMax: number; patience: number;
  path: { x: number; z: number }[]; speed: number;
  target: string | null; seat: number;
  plan: string[];                  // product ids still to pick
  cart: CartItem[]; scanned: number; pay: 'cash' | 'card'; given: number;
  sat: number; reasons: string[];
  progress: number;                // 0..1 for the ring above the head
  bubble: string;
  queueAt: string | null;
  after: string | null;            // what to do once the current walk ends
  order: string | null;            // snack bar meal they're waiting for
  regular: string | null;          // named regular id
  live?: boolean;                  // streaming right now
}

export interface StaffNpc {
  id: string; role: string; name: string; body: 'male' | 'female';
  x: number; z: number; ry: number; anim: Anim;
  state: string; t: number; path: { x: number; z: number }[];
  task: string | null; carry: string | null; counter: string | null;
}

export interface PlayerPos {
  id: string; name: string; look: any;
  x: number; y: number; z: number; ry: number; pitch: number;
  carry: string | null; anim: Anim; at: number; host?: boolean;
}

export interface DaySummary {
  day: number; income: Record<string, number>; costs: Record<string, number>; net: number;
  served: number; lost: number; sat: number; reviews: Review[]; xp: number; rating: number; thefts: number;
}

export interface WorldEvents {
  changed: void;
  cash: { x: number; z: number; amount: number; label?: string };
  sfx: { name: string; x: number; z: number };
  toast: { msg: string; to?: string; kind?: 'good' | 'bad' | 'info' };
  review: Review;
  levelup: { level: number; unlocks: string[] };
  goal: { icon: string; text: string; money: number; xp: number; kind: 'goal' | 'achievement' };
  dayover: DaySummary;
}

export class World {
  save: SaveData;
  customers: Customer[] = [];
  staff: StaffNpc[] = [];
  players = new Map<string, PlayerPos>();
  rev = 0;
  seatUse = new Map<string, (string | null)[]>();
  queues = new Map<string, string[]>();
  registerUser = new Map<string, string>();   // counter id → player id operating it
  summary: DaySummary | null = null;
  ev = new Emitter<WorldEvents>();
  nav = new Nav();
  isHost = true;

  constructor(save: SaveData) { this.save = save; this.nav.rebuild(save); }

  /** call after any structural change (objects, boxes, inventory, styles…) */
  bump() { this.rev++; this.nav.rebuild(this.save); this.ev.emit('changed', undefined); }

  today() { return this.save.today; }
  obj(id: string) { return this.save.objects.find(o => o.id === id) || null; }
  box(id: string) { return this.save.boxes.find(b => b.id === id) || null; }
  cust(id: string) { return this.customers.find(c => c.id === id) || null; }
}
