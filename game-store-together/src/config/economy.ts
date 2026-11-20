/* Money, time, progression, staff, expansion and style tables. Tweak numbers here. */
export const ECON = {
  startMoney: 100,
  sessionBase: 20,        // $ per session on the starter laptop
  playSeconds: 10,        // real seconds a session lasts
  queuePatience: 15,      // real seconds a customer waits for a free station
  checkoutPatience: 40,   // seconds waiting in the checkout line before leaving
  dayStart: 8 * 60,       // 08:00, the clock waits here until you open
  lastEntry: 21 * 60 + 30,
  dayEnd: 22 * 60,
  secPerGameMinute: 0.5,  // 14 h of opening hours ≈ 7 real minutes
  deliverySeconds: 15,
  sellBack: 0.5,          // sell placed items back for 50%
  baseRent: 25,
  spawnEvery: 7,          // seconds between walk-ins at a 3★ rating, before modifiers
  arcadeSeconds: 6,
};

export const xpForLevel = (level: number) => Math.round(80 * Math.pow(level, 1.45));

export const XP = { meal: 3, goal: 25, session: 6, arcade: 3, sale: 2, clean: 2, repair: 5, review5: 6, review4: 3, restock: 0.25, catchThief: 10 };

export interface Perk { id: string; name: string; desc: string; icon: string }
export const PERKS: Perk[] = [
  { id: 'patience', name: 'Comfy Queue', icon: '🛋️', desc: 'Customers wait 6 s longer for a free station.' },
  { id: 'turbo', name: 'Turbo Sessions', icon: '⚡', desc: 'Sessions 15% shorter: more customers per hour.' },
  { id: 'charisma', name: 'Charisma', icon: '😎', desc: '+10% on every session price.' },
  { id: 'thrifty', name: 'Bulk Buyer', icon: '📦', desc: 'Stock boxes cost 15% less.' },
  { id: 'tidy', name: 'Tidy Crowd', icon: '🧹', desc: 'Customers make 35% less mess.' },
  { id: 'techie', name: 'Sturdy Hardware', icon: '🔧', desc: 'Stations break 40% less often.' },
  { id: 'popular', name: 'Word of Mouth', icon: '📣', desc: '+15% more customers walk in.' },
  { id: 'landlord', name: 'Friendly Landlord', icon: '🏠', desc: 'Rent is 25% cheaper.' },
  { id: 'tips', name: 'Tip Jar', icon: '🫙', desc: 'Happy customers tip up to $5.' },
  { id: 'sprinter', name: 'Sprinter', icon: '👟', desc: 'You and your staff move 12% faster.' },
  { id: 'mechanic', name: 'Quick Fix', icon: '🪛', desc: 'Repairs and cleaning take half the time.' },
  { id: 'cashier', name: 'Fast Fingers', icon: '🧾', desc: 'Checkout scanning is twice as fast for staff.' },
];

export interface License { id: string; name: string; price: number; level: number; desc: string }
export const LICENSES: License[] = [
  { id: 'retail', name: 'Retail License', price: 100, level: 2, desc: 'Sell snacks and drinks: counter, shelves and fridges.' },
  { id: 'consoles', name: 'Console License', price: 200, level: 2, desc: 'Console couches for groups and kids.' },
  { id: 'arcade', name: 'Arcade License', price: 150, level: 2, desc: 'Arcade cabinets, pinball, claw and dance machines.' },
  { id: 'merch', name: 'Merch License', price: 300, level: 3, desc: 'Sell games, plushies, controllers and more.' },
  { id: 'premium', name: 'Premium Partner', price: 900, level: 5, desc: 'Unlocks the RGB Beast PC.' },
];

export type Role = 'cashier' | 'restocker' | 'cleaner' | 'technician' | 'cook';
export interface StaffRole { id: Role; name: string; wage: number; level: number; icon: string; desc: string; shirt: string }
export const STAFF: StaffRole[] = [
  { id: 'cleaner', name: 'Cleaner', wage: 30, level: 2, icon: '🧽', desc: 'Picks up trash and mops spills.', shirt: '#4cc9f0' },
  { id: 'cashier', name: 'Cashier', wage: 45, level: 3, icon: '🧾', desc: 'Runs a checkout counter for you.', shirt: '#f72585' },
  { id: 'restocker', name: 'Restocker', wage: 40, level: 3, icon: '📦', desc: 'Carries stock boxes to empty shelves.', shirt: '#ffb703' },
  { id: 'cook', name: 'Cook', wage: 40, level: 3, icon: '🧑‍🍳', desc: 'Makes Snack Bar orders.', shirt: '#ef476f' },
  { id: 'technician', name: 'Technician', wage: 55, level: 4, icon: '🔧', desc: 'Repairs broken stations.', shirt: '#80ed99' },
];
export const MAX_STAFF_PER_ROLE = 3;
/** staff get better with work (or training): faster on their feet and at the job, and paid a bit more */
export const STAFF_SKILL = { max: 5, xpFor: (lvl: number) => 25 + lvl * 20, wage: 8, speed: 0.08, work: 0.12, train: (lvl: number) => 90 * lvl };
export const staffWage = (role: string, lvl = 1) => (STAFF.find(r => r.id === role)?.wage || 0) + (Math.max(1, lvl) - 1) * STAFF_SKILL.wage;
export const STAFF_NAMES = ['Alex', 'Sam', 'Robin', 'Jo', 'Kai', 'Mika', 'Noor', 'Theo', 'Lena', 'Rafa', 'Ivy', 'Ezra', 'Juno', 'Milo', 'Zoe', 'Ari'];

export interface Expansion { w: number; d: number; price: number; level: number; rent: number }
export const EXPANSIONS: Expansion[] = [
  { w: 10, d: 8, price: 0, level: 1, rent: 25 },
  { w: 13, d: 10, price: 600, level: 2, rent: 40 },
  { w: 16, d: 12, price: 1500, level: 3, rent: 60 },
  { w: 19, d: 14, price: 3200, level: 5, rent: 85 },
  { w: 22, d: 16, price: 6000, level: 7, rent: 115 },
];

export interface Style { id: string; name: string; price: number; level: number; a: string; b: string; kind?: string }
export const FLOORS: Style[] = [
  { id: 'wood', name: 'Warm Wood', price: 0, level: 1, a: '#c8915f', b: '#b47c4d', kind: 'planks' },
  { id: 'checker', name: 'Arcade Checker', price: 120, level: 1, a: '#f4f1de', b: '#2b2d42', kind: 'checker' },
  { id: 'carpet', name: 'Cozy Carpet', price: 160, level: 2, a: '#5e60ce', b: '#5390d9', kind: 'carpet' },
  { id: 'concrete', name: 'Polished Concrete', price: 200, level: 2, a: '#a8a8a8', b: '#9a9a9a', kind: 'concrete' },
  { id: 'neon', name: 'Neon Grid', price: 450, level: 4, a: '#1a1033', b: '#ff4fd8', kind: 'grid' },
];
export const WALLS: Style[] = [
  { id: 'cream', name: 'Cream Paint', price: 0, level: 1, a: '#f3e9d2', b: '#e6d5b8', kind: 'paint' },
  { id: 'mint', name: 'Mint Paint', price: 80, level: 1, a: '#b8e0d2', b: '#95d5b2', kind: 'paint' },
  { id: 'brick', name: 'Red Brick', price: 180, level: 2, a: '#b5523b', b: '#d9d0c1', kind: 'brick' },
  { id: 'panel', name: 'Wood Panels', price: 220, level: 3, a: '#8d6346', b: '#6f4e37', kind: 'panel' },
  { id: 'navy', name: 'Midnight Navy', price: 260, level: 3, a: '#22223b', b: '#4a4e69', kind: 'paint' },
];
export const LIGHTS: Style[] = [
  { id: 'warm', name: 'Warm White', price: 0, level: 1, a: '#ffd8a8', b: '#ff9e64' },
  { id: 'cool', name: 'Daylight', price: 60, level: 1, a: '#e7f5ff', b: '#a5d8ff' },
  { id: 'rgb', name: 'RGB Party', price: 300, level: 3, a: '#ff4fd8', b: '#3ee6ff' },
  { id: 'sunset', name: 'Sunset Glow', price: 220, level: 2, a: '#ffb4a2', b: '#e5989b' },
];

/** extra storeys: 4 floors max, 7 after a rebirth */
export interface Storey { n: number; price: number; level: number; rent: number; rebirth?: boolean }
export const STOREYS: Storey[] = [
  { n: 2, price: 4000, level: 6, rent: 30 },
  { n: 3, price: 9000, level: 8, rent: 45 },
  { n: 4, price: 16000, level: 10, rent: 60 },
  { n: 5, price: 26000, level: 12, rent: 80, rebirth: true },
  { n: 6, price: 38000, level: 14, rent: 100, rebirth: true },
  { n: 7, price: 55000, level: 16, rent: 125, rebirth: true },
];
export const ELEVATOR = { price: 5000, level: 8, power: 6 };
/** each rebirth: +25% income, +15% XP and a bigger starting budget, forever */
export const REBIRTH = { income: 0.25, xp: 0.15, startMoney: 500 };

export const DELIVERY_ZONE = { w: 2.2, d: 2.2 }; // inside, front-left corner
