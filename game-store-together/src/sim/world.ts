/* Shared world state. The host simulates it; co-op guests mirror it from network snapshots. */
import type { SaveData, Review } from '../core/save';
import type { CustomerType } from '../config/npcs';
import { Emitter } from '../core/util';
import { Nav } from './nav';
import { stairs, elevator, floorY } from './building';
import type { V2 } from './layout';

/** a waypoint: on a floor, at a height; `wait` pauses there (elevator ride), `tp` jumps there (elevator arrival) */
export interface PathPt { x: number; z: number; y?: number; fl?: number; wait?: number; tp?: boolean }
export type Where = V2 & { fl?: number };

export type Anim = 'walk' | 'run' | 'idle' | 'sit' | 'play' | 'work' | 'carry' | 'drive' | 'vr' | 'eat';
export const PLAYING: ReadonlySet<string> = new Set(['play', 'drive', 'vr']);
export interface CartItem { p: string; price: number }

export interface Customer {
  id: string; type: CustomerType; model: string; tint: number;
  x: number; z: number; y: number; ry: number; anim: Anim; fl: number;
  state: string; t: number; tMax: number; patience: number;
  path: PathPt[]; speed: number;
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
  x: number; z: number; y: number; fl: number; ry: number; anim: Anim;
  state: string; t: number; path: PathPt[];
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
  cash: { x: number; z: number; y?: number; amount: number; label?: string };
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
  navs: Nav[] = [];
  isHost = true;

  constructor(save: SaveData) { this.save = save; this.rebuildNav(); }
  private rebuildNav() {
    const n = this.save.floors || 1;
    this.navs.length = n;
    for (let f = 0; f < n; f++) (this.navs[f] ||= new Nav()).rebuild(this.save, f);
  }
  get nav() { return this.navs[0]; }

  /** call after any structural change (objects, boxes, inventory, styles…) */
  bump() { this.rev++; this.rebuildNav(); this.ev.emit('changed', undefined); }

  /** a walking route between two spots, taking the stairs (or the elevator) between floors */
  route(from: Where, to: Where): PathPt[] {
    const n = this.save.floors || 1;
    const fa = Math.min(n - 1, from.fl || 0), fb = Math.min(n - 1, to.fl || 0);
    const on = (f: number, pts: V2[]) => pts.map(p => ({ x: p.x, z: p.z, fl: f, y: floorY(f) }));
    if (fa === fb) return on(fa, this.navs[fa].route(from, to));
    const out: PathPt[] = [];
    let cur: V2 = { x: from.x, z: from.z }, f = fa;
    const el = elevator(this.save), st = stairs(this.save)!;
    if (el && (Math.abs(fb - fa) >= 2 || Math.random() < 0.5)) {
      out.push(...on(f, this.navs[f].route(cur, el.entry)));
      out.push({ ...el.inside, fl: f, y: floorY(f) }, { ...el.inside, fl: f, y: floorY(f), wait: 1.2 + 0.6 * Math.abs(fb - fa) });
      out.push({ ...el.inside, fl: fb, y: floorY(fb), tp: true }, { ...el.entry, fl: fb, y: floorY(fb) });
      cur = el.entry; f = fb;
    }
    while (f !== fb) {
      if (fb > f) {
        out.push(...on(f, this.navs[f].route(cur, st.bottom(f))));
        out.push({ ...st.start(f), fl: f, y: floorY(f) }, { ...st.end(f), fl: f + 1, y: floorY(f + 1) }, { ...st.top(f), fl: f + 1, y: floorY(f + 1) });
        cur = st.top(f); f++;
      } else {
        out.push(...on(f, this.navs[f].route(cur, st.top(f - 1))));
        out.push({ ...st.end(f - 1), fl: f, y: floorY(f) }, { ...st.start(f - 1), fl: f - 1, y: floorY(f - 1) }, { ...st.bottom(f - 1), fl: f - 1, y: floorY(f - 1) });
        cur = st.bottom(f - 1); f--;
      }
    }
    out.push(...on(fb, this.navs[fb].route(cur, to)));
    return out;
  }

  today() { return this.save.today; }
  obj(id: string) { return this.save.objects.find(o => o.id === id) || null; }
  box(id: string) { return this.save.boxes.find(b => b.id === id) || null; }
  cust(id: string) { return this.customers.find(c => c.id === id) || null; }
}
