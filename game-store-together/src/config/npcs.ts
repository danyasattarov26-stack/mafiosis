/* Customer types. Models are Polyfork people that share one rig (and one walk cycle). */
export type CustomerType = 'casual' | 'pro' | 'kid' | 'spender' | 'trouble';

export interface CustomerDef {
  id: CustomerType;
  name: string;
  level: number;          // shop level when they start showing up
  weight: number;         // spawn weight once unlocked
  models: string[];
  speed: number;          // m/s walking
  wants: { play: number; arcade: number; shop: number };
  minTier: number;        // lowest PC tier they're happy with (below = grumpy)
  payMul: number;         // tips / willingness to pay
  priceTolerance: number; // how far above market price they still buy
  items: [number, number];// how many products when shopping
  likes: string[];        // product ids they prefer
  trouble?: { litter: number; spill: number; vandal: number; steal: number };
  blurb: string;
}

export const CUSTOMERS: Record<CustomerType, CustomerDef> = {
  casual: {
    id: 'casual', name: 'Casual', level: 1, weight: 6, models: ['cafe-customer', 'backpacker', 'graduate-student', 'seated-office-worker', 'family-road-tripper'],
    speed: 1.25, wants: { play: 0.7, arcade: 0.1, shop: 0.2 }, minTier: 0, payMul: 1, priceTolerance: 1.25, items: [1, 2], likes: ['pr_soda', 'pr_chips', 'pr_candy', 'pr_game'],
    trouble: { litter: 0.08, spill: 0.03, vandal: 0, steal: 0 }, blurb: 'Here for a quick game and a snack.',
  },
  kid: {
    id: 'kid', name: 'Kids', level: 2, weight: 3, models: ['beginner-kid-skater', 'neighborhood-child', 'school-student'],
    speed: 1.4, wants: { play: 0.45, arcade: 0.35, shop: 0.2 }, minTier: 0, payMul: 0.9, priceTolerance: 1.1, items: [1, 2], likes: ['pr_candy', 'pr_soda', 'pr_plush', 'pr_chips'],
    trouble: { litter: 0.15, spill: 0.08, vandal: 0, steal: 0 }, blurb: 'Love consoles, arcades and candy.',
  },
  pro: {
    id: 'pro', name: 'Pro gamers', level: 3, weight: 3, models: ['teen-player', 'student-in-a-hoodie', 'bmx-rider'],
    speed: 1.35, wants: { play: 0.85, arcade: 0, shop: 0.15 }, minTier: 1, payMul: 1.3, priceTolerance: 1.35, items: [1, 2], likes: ['pr_energy', 'pr_mouse', 'pr_headset', 'pr_controller'],
    trouble: { litter: 0.05, spill: 0.02, vandal: 0, steal: 0 }, blurb: 'Want good PCs. Pay more, judge harder.',
  },
  spender: {
    id: 'spender', name: 'Big spenders', level: 4, weight: 1.6, models: ['arriving-hotel-guest', 'slot-tourist'],
    speed: 1.1, wants: { play: 0.3, arcade: 0.1, shop: 0.6 }, minTier: 0, payMul: 1.6, priceTolerance: 1.6, items: [2, 5], likes: ['pr_headset', 'pr_controller', 'pr_game', 'pr_shirt', 'pr_plush'],
    blurb: 'Buy lots of merch and tip well.',
  },
  trouble: {
    id: 'trouble', name: 'Troublemakers', level: 3, weight: 1.2, models: ['street-skater', 'kid-in-a-black'],
    speed: 1.5, wants: { play: 0.55, arcade: 0.15, shop: 0.3 }, minTier: 0, payMul: 0.8, priceTolerance: 1.0, items: [1, 2], likes: ['pr_energy', 'pr_chips', 'pr_game'],
    trouble: { litter: 0.6, spill: 0.3, vandal: 0.18, steal: 0.22 }, blurb: 'Litter, spill, break things… and steal.',
  },
};

export const STAFF_MODELS = { male: 'humanMaleA', female: 'humanFemaleA' };

export const REVIEW_LINES: Record<string, string[]> = {
  great: ['Best gaming spot in town!', 'Cozy vibes and fast PCs. 10/10', 'Staff were awesome, will be back!', 'Love the neon at night ✨', 'Smooth sessions, zero lag.'],
  good: ['Pretty good, would visit again.', 'Nice place, decent setups.', 'Fun afternoon with friends.', 'Solid little shop.'],
  wait: ['Waited forever for a free PC.', 'Too busy, gave up waiting.', 'Queue at the checkout was slow.'],
  dirty: ['Floor was sticky… gross.', 'Trash everywhere, clean up!', 'Someone spilled soda and nobody cleaned it.'],
  price: ['Way too expensive.', 'Prices are a rip-off.', 'Paid too much for a soda.'],
  stock: ['They were out of what I wanted.', 'Empty shelves everywhere.'],
  broken: ['My PC crashed mid-match!', 'Half the machines were broken.'],
  old: ['PCs are a bit outdated.', 'Need better hardware for real gamers.'],
  change: ['Cashier got my change wrong.'],
};
