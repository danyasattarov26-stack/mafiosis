/* Daily goals (3 fresh ones each morning) and permanent achievements. */
import type { SaveData, DayStats } from '../core/save';
import { ITEM } from './items';

export interface GoalDef {
  id: string;
  icon: string;
  text: (n: number) => string;
  stat: (t: DayStats) => number;
  base: (level: number, stations: number) => number;   // target for this shop level and size
  needs?: (s: SaveData) => boolean;  // only offered when the shop can do it
}

const owns = (s: SaveData, f: (kind: string, build?: string) => boolean) => s.objects.some(o => { const d = ITEM[o.item]; return !!d && f(d.kind, d.build); });

export const GOALS: GoalDef[] = [
  { id: 'serve', icon: '🙂', text: n => `Serve ${n} happy customers`, stat: t => t.served, base: (l, st) => 4 + l * 2 + st * 5 },
  { id: 'sessions', icon: '🎮', text: n => `Run ${n} gaming sessions`, stat: t => t.sessions, base: (l, st) => 3 + l + st * 5 },
  { id: 'earn', icon: '💰', text: n => `Earn $${n} today`, stat: t => t.sessionRev + t.salesRev + t.arcadeRev + t.tips + (t.foodRev || 0), base: (l, st) => Math.round((80 + l * 50 + st * 80) / 10) * 10 },
  { id: 'sales', icon: '🛒', text: n => `Sell ${n} products`, stat: t => t.sales, base: l => 4 + l * 3, needs: s => owns(s, k => k === 'counter') },
  { id: 'meals', icon: '🍕', text: n => `Serve ${n} snacks at the Snack Bar`, stat: t => t.meals || 0, base: l => 3 + l * 2, needs: s => owns(s, k => k === 'foodbar') },
  { id: 'streams', icon: '📢', text: n => `Host ${n} live streams`, stat: t => t.streams || 0, base: l => 2 + Math.floor(l / 3), needs: s => owns(s, (_k, b) => b === 'pod') },
  { id: 'clean', icon: '🧽', text: n => `Clean up ${n} messes`, stat: t => t.cleaned || 0, base: l => 3 + Math.floor(l / 2) },
  { id: 'fivestar', icon: '⭐', text: n => `Get ${n} five-star review${n > 1 ? 's' : ''}`, stat: t => t.fiveStar || 0, base: l => 1 + Math.floor(l / 2) },
  { id: 'arcade', icon: '🕹️', text: n => `Earn $${n} from arcade machines`, stat: t => t.arcadeRev, base: l => 20 + l * 10, needs: s => owns(s, k => k === 'arcade') },
  { id: 'regulars', icon: '💛', text: n => `Welcome ${n} regular${n > 1 ? 's' : ''}`, stat: t => t.regulars || 0, base: l => 1 + Math.floor(l / 4), needs: s => s.level >= 2 },
  { id: 'nolost', icon: '⌛', text: n => `Serve ${n} customers in a row without losing one`, stat: t => t.streak || 0, base: l => 6 + l * 3 },
];
export const GOAL = Object.fromEntries(GOALS.map(g => [g.id, g]));

export interface DailyGoal { id: string; target: number; money: number; xp: number; done: boolean }

/** three goals for the day, the same for everyone in a co-op shop (seeded by the day) */
export function rollGoals(s: SaveData): DailyGoal[] {
  let seed = (s.day * 9301 + s.id.length * 49297 + 7) % 233280;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const pool = GOALS.filter(g => !g.needs || g.needs(s));
  const stations = s.objects.filter(o => ITEM[o.item]?.kind === 'station').length;
  const out: DailyGoal[] = [];
  while (out.length < 3 && pool.length) {
    const g = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const target = Math.max(1, Math.round(g.base(s.level, stations) * (0.85 + rnd() * 0.3)));
    out.push({ id: g.id, target, money: 25 + s.level * 15, xp: 15 + s.level * 4, done: false });
  }
  return out;
}

export interface Achievement { id: string; icon: string; name: string; desc: string; check: (s: SaveData) => boolean; xp: number }
const L = (s: SaveData) => s.lifetime;
const hearts = (love: number) => Math.floor((love || 0) / 20);
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'open', icon: '🔑', name: 'Grand Opening', desc: 'Open your shop for the first time.', check: s => s.tutorial >= 2 || L(s).days > 0, xp: 10 },
  { id: 's10', icon: '🎮', name: 'Warming Up', desc: 'Run 10 gaming sessions.', check: s => (L(s).sessions || 0) >= 10, xp: 15 },
  { id: 's250', icon: '🕹️', name: 'LAN Legend', desc: 'Run 250 gaming sessions.', check: s => (L(s).sessions || 0) >= 250, xp: 60 },
  { id: 's1000', icon: '👾', name: 'Esports Arena', desc: 'Run 1,000 gaming sessions.', check: s => (L(s).sessions || 0) >= 1000, xp: 150 },
  { id: 'rich', icon: '💰', name: 'Money Maker', desc: 'Earn $5,000 in total.', check: s => L(s).revenue >= 5000, xp: 40 },
  { id: 'tycoon', icon: '🤑', name: 'Tycoon', desc: 'Earn $50,000 in total.', check: s => L(s).revenue >= 50000, xp: 150 },
  { id: 'week', icon: '📅', name: 'One Week In', desc: 'Finish 7 days.', check: s => L(s).days >= 7, xp: 40 },
  { id: 'lv5', icon: '⭐', name: 'Rising Star', desc: 'Reach level 5.', check: s => s.level >= 5, xp: 30 },
  { id: 'lv10', icon: '🌟', name: 'Superstar', desc: 'Reach level 10.', check: s => s.level >= 10, xp: 100 },
  { id: 'expand', icon: '🏗️', name: 'Moving On Up', desc: 'Expand the shop.', check: s => s.expansion >= 1, xp: 25 },
  { id: 'maxlot', icon: '🏙️', name: 'Mega Store', desc: 'Expand to the biggest lot.', check: s => s.expansion >= 4, xp: 120 },
  { id: 'staff', icon: '👥', name: 'Team Player', desc: 'Hire your first employee.', check: s => s.staff.length >= 1, xp: 15 },
  { id: 'pro', icon: '🎓', name: 'Mentor', desc: 'Get an employee to skill level 5.', check: s => s.staff.some(m => (m.lvl || 1) >= 5), xp: 60 },
  { id: 'staff6', icon: '🏢', name: 'Big Boss', desc: 'Have 6 employees at once.', check: s => s.staff.length >= 6, xp: 60 },
  { id: 'stream', icon: '📢', name: 'We’re Live!', desc: 'Host your first live stream.', check: s => (L(s).streams || 0) >= 1, xp: 25 },
  { id: 'stream50', icon: '📡', name: 'Streaming Capital', desc: 'Host 50 live streams.', check: s => (L(s).streams || 0) >= 50, xp: 80 },
  { id: 'meal1', icon: '🍕', name: 'Order Up!', desc: 'Serve your first snack.', check: s => (L(s).meals || 0) >= 1, xp: 15 },
  { id: 'meal100', icon: '👨‍🍳', name: 'Head Chef', desc: 'Serve 100 snacks.', check: s => (L(s).meals || 0) >= 100, xp: 70 },
  { id: 'friend', icon: '💛', name: 'Best Friends', desc: 'Reach 5 hearts with a regular.', check: s => Object.values(s.regulars || {}).some(r => hearts(r.love) >= 5), xp: 60 },
  { id: 'vip3', icon: '💳', name: 'VIP Club', desc: 'Have 3 VIP members.', check: s => Object.values(s.regulars || {}).filter(r => r.vip).length >= 3, xp: 60 },
  { id: 'clean', icon: '🧹', name: 'Spotless', desc: 'Clean up 100 messes.', check: s => (L(s).cleaned || 0) >= 100, xp: 50 },
  { id: 'thief', icon: '🚨', name: 'Neighbourhood Watch', desc: 'Catch 5 thieves.', check: s => (L(s).caught || 0) >= 5, xp: 40 },
  { id: 'five', icon: '🏅', name: 'Crowd Favourite', desc: 'Get 25 five-star reviews.', check: s => (L(s).fiveStar || 0) >= 25, xp: 60 },
  { id: 'floor2', icon: '🪜', name: 'Going Up', desc: 'Build a second floor.', check: s => (s.floors || 1) >= 2, xp: 40 },
  { id: 'floor4', icon: '🏢', name: 'Skyscraper', desc: 'Build 4 floors.', check: s => (s.floors || 1) >= 4, xp: 100 },
  { id: 'lift', icon: '🛗', name: 'Express Service', desc: 'Install an elevator.', check: s => !!s.elevator, xp: 40 },
  { id: 'rebirth', icon: '💎', name: 'Born Again', desc: 'Rebirth your shop.', check: s => (s.rebirths || 0) >= 1, xp: 100 },
  { id: 'floor7', icon: '🏙️', name: 'Tower Tycoon', desc: 'Build all 7 floors.', check: s => (s.floors || 1) >= 7, xp: 250 },
  { id: 'allpc', icon: '🖥️', name: 'Collector', desc: 'Own a Retro PC, Streamer Pod, Sim Racing Rig and VR Station.', check: s => ['st_retro', 'st_stream', 'st_racing', 'st_vr'].every(id => s.objects.some(o => o.item === id)), xp: 100 },
];
export const ACHIEVEMENT = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
