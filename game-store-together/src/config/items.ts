/*
  Every buyable thing in the game lives here. Add an entry and it shows up in the laptop shop,
  the inventory, placement and the simulation — no other code needed for most kinds.
  Sizes are in grid cells (0.5 m). Local "front" of an object is +Z (where customers stand).
*/
export type CategoryId = 'pcs' | 'consoles' | 'monitors' | 'chairs' | 'desks' | 'decor' | 'snacks' | 'merch' | 'upgrades';

export const CATEGORIES: { id: CategoryId; name: string; icon: string; blurb: string }[] = [
  { id: 'pcs', name: 'Gaming PCs', icon: '🖥️', blurb: 'Stations customers rent by the session.' },
  { id: 'consoles', name: 'Consoles & Arcade', icon: '🎮', blurb: 'Couch consoles and arcade cabinets.' },
  { id: 'monitors', name: 'Monitors', icon: '🖵', blurb: 'Install on a PC station: higher session price.' },
  { id: 'chairs', name: 'Gaming Chairs', icon: '💺', blurb: 'Install on a station: comfier customers.' },
  { id: 'desks', name: 'Desks', icon: '🪵', blurb: 'Install on a station: more appeal.' },
  { id: 'decor', name: 'Decorations', icon: '🪴', blurb: 'Make the shop cozy. Raises appeal.' },
  { id: 'snacks', name: 'Snacks & Drinks', icon: '🥤', blurb: 'Stock boxes for shelves and fridges.' },
  { id: 'merch', name: 'Merchandise', icon: '🎧', blurb: 'Gamer gear to sell at the counter.' },
  { id: 'upgrades', name: 'Store Upgrades', icon: '⭐', blurb: 'Shelves, counters and shop services.' },
];

export type Kind = 'station' | 'arcade' | 'shelf' | 'fridge' | 'counter' | 'bin' | 'decor' | 'wall' | 'product' | 'component' | 'service' | 'vending' | 'foodbar';
export type Slot = 'mon' | 'chair' | 'desk';

export interface ItemDef {
  id: string;
  name: string;
  cat: CategoryId;
  kind: Kind;
  price: number;
  level: number;
  license?: string;
  desc: string;
  build?: string;          // visual builder key (world/objects.ts)
  model?: string;          // glb name for simple models
  scale?: number;
  size?: [number, number]; // footprint cells [w, d]
  walkable?: boolean;      // rugs: no collision, can sit under things
  tint?: string;
  // stations
  seats?: number;
  stand?: boolean;         // played standing (VR)
  kitted?: boolean;        // ships fully equipped: no component upgrades
  tier?: number;           // pc tier 0..3 (laptop = 0)
  priceMul?: number;       // session price multiplier
  playMul?: number;        // play-time multiplier (lower = faster turnover)
  power?: number;          // electricity $/day
  breakChance?: number;    // per session
  appeal?: number;
  comfort?: number;
  // arcade
  arcadePrice?: number;
  // shelves
  capacity?: number;
  accepts?: 'shelf' | 'fridge' | 'foodbar';
  // components
  slot?: Slot;
  slotTier?: number;
  // products
  product?: { market: number; cost: number; perBox: number; place: 'shelf' | 'fridge' | 'foodbar'; mesh: string; color?: string };
  // services
  service?: string;
}

export const ITEMS: ItemDef[] = [
  // ---------- Gaming PCs (stations) ----------
  { id: 'st_laptop', name: 'Starter Gaming Laptop', cat: 'pcs', kind: 'station', price: 60, level: 1, build: 'station', tier: 0, priceMul: 1, playMul: 1.1, power: 2, breakChance: 0.05, appeal: 1, seats: 1, size: [3, 4],
    desc: 'A trusty laptop on a desk. Where every gaming empire starts.' },
  { id: 'st_retro', name: 'Retro PC', cat: 'pcs', kind: 'station', price: 90, level: 1, build: 'retro', tier: 0, priceMul: 0.75, playMul: 0.9, power: 1, breakChance: 0.06, appeal: 2, seats: 1, size: [3, 4], kitted: true,
    desc: 'A beige box and a chunky CRT. Cheap and cheerful: kids and nostalgic gamers love it.' },
  { id: 'st_pc1', name: 'Gaming PC — Bronze', cat: 'pcs', kind: 'station', price: 180, level: 1, build: 'station', tier: 1, priceMul: 1.25, playMul: 1, power: 4, breakChance: 0.035, appeal: 3, seats: 1, size: [3, 4],
    desc: 'Solid tower with a 24" monitor. Customers pay a bit more.' },
  { id: 'st_pc2', name: 'Gaming PC — Silver', cat: 'pcs', kind: 'station', price: 450, level: 3, build: 'station', tier: 2, priceMul: 1.6, playMul: 0.95, power: 6, breakChance: 0.025, appeal: 6, seats: 1, size: [3, 4],
    desc: 'Glass-side tower with RGB fans. Pros love it.' },
  { id: 'st_pc3', name: 'RGB Beast PC', cat: 'pcs', kind: 'station', price: 1200, level: 5, license: 'premium', build: 'station', tier: 3, priceMul: 2.2, playMul: 0.9, power: 9, breakChance: 0.015, appeal: 12, seats: 1, size: [3, 4],
    desc: 'Water-cooled monster with dual monitors. The flagship.' },
  { id: 'st_stream', name: 'Streamer Pod', cat: 'pcs', kind: 'station', price: 900, level: 3, build: 'pod', tier: 2, priceMul: 2.0, playMul: 1.7, power: 7, breakChance: 0.02, appeal: 10, seats: 1, size: [4, 5], kitted: true,
    desc: 'A soundproof booth with mic, ring light and webcam. Streamers go live, shout at chat and bring their followers.' },
  { id: 'st_racing', name: 'Sim Racing Rig', cat: 'pcs', kind: 'station', price: 1400, level: 4, build: 'racing', tier: 3, priceMul: 2.4, playMul: 1.2, power: 8, breakChance: 0.025, appeal: 12, seats: 1, size: [4, 5], kitted: true,
    desc: 'Bucket seat, steering wheel, pedals and three curved screens. Racing fans pay top dollar.' },
  { id: 'st_vr', name: 'VR Station', cat: 'pcs', kind: 'station', price: 1100, level: 5, build: 'vr', tier: 3, priceMul: 2.0, playMul: 1.0, power: 6, breakChance: 0.03, appeal: 12, seats: 1, size: [5, 5], stand: true, kitted: true,
    desc: 'Headset, play mat and tracking towers. Players flail around hilariously.' },

  // ---------- Consoles & arcade ----------
  { id: 'st_console', name: 'Console Couch', cat: 'consoles', kind: 'station', price: 350, level: 2, license: 'consoles', build: 'console', tier: 1, priceMul: 1.2, playMul: 1.1, power: 3, breakChance: 0.03, appeal: 6, seats: 2, size: [5, 5],
    desc: 'Big TV, a console and a sofa for two. Kids and friends love it.' },
  { id: 'st_console2', name: 'Next-Gen Console Lounge', cat: 'consoles', kind: 'station', price: 800, level: 4, license: 'consoles', build: 'console', tier: 2, priceMul: 1.7, playMul: 1, power: 5, breakChance: 0.02, appeal: 12, seats: 2, size: [5, 5],
    desc: 'Huge 4K screen, newest console, comfy lounge sofa.' },
  { id: 'ar_cabinet', name: 'Retro Arcade Cabinet', cat: 'consoles', kind: 'arcade', price: 250, level: 2, license: 'arcade', build: 'model', model: 'arcade-machine', arcadePrice: 5, power: 2, appeal: 8, size: [2, 3], breakChance: 0.02,
    desc: 'Insert coin. $5 a play, kids can’t resist.' },
  { id: 'ar_pinball', name: 'Pinball Table', cat: 'consoles', kind: 'arcade', price: 320, level: 3, license: 'arcade', build: 'model', model: 'pinball', arcadePrice: 6, power: 2, appeal: 9, size: [3, 4], breakChance: 0.02,
    desc: 'Flippers, bumpers, high scores. $6 a play.' },
  { id: 'ar_claw', name: 'Claw Machine', cat: 'consoles', kind: 'arcade', price: 400, level: 3, license: 'arcade', build: 'model', model: 'claw-machine', arcadePrice: 4, power: 2, appeal: 10, size: [4, 4], breakChance: 0.01,
    desc: 'Will they win the plushie? $4 a try.' },
  { id: 'ar_dance', name: 'Dance Machine', cat: 'consoles', kind: 'arcade', price: 650, level: 4, license: 'arcade', build: 'model', model: 'dance-machine', arcadePrice: 8, power: 4, appeal: 14, size: [4, 5], breakChance: 0.02,
    desc: 'Lights, music, footwork. $8 a song.' },

  // ---------- Station components ----------
  { id: 'mon_2', name: '27" 144 Hz Monitor', cat: 'monitors', kind: 'component', slot: 'mon', slotTier: 1, price: 90, level: 2, appeal: 2, desc: 'Install on a PC station: +10% session price.' },
  { id: 'mon_3', name: 'Dual Monitor Arm', cat: 'monitors', kind: 'component', slot: 'mon', slotTier: 2, price: 220, level: 3, appeal: 4, desc: 'Two screens on an arm: +20% session price.' },
  { id: 'mon_4', name: 'Ultrawide 240 Hz', cat: 'monitors', kind: 'component', slot: 'mon', slotTier: 3, price: 420, level: 5, appeal: 7, desc: 'Curved and ridiculous: +30% session price.' },
  { id: 'ch_2', name: 'Gamer Chair', cat: 'chairs', kind: 'component', slot: 'chair', slotTier: 1, price: 70, level: 1, comfort: 5, desc: 'Padded with red trim. Happier customers.' },
  { id: 'ch_3', name: 'Racing Chair', cat: 'chairs', kind: 'component', slot: 'chair', slotTier: 2, price: 160, level: 3, comfort: 10, desc: 'Bucket seat, neck pillow, big smiles.' },
  { id: 'ch_4', name: 'Throne Chair', cat: 'chairs', kind: 'component', slot: 'chair', slotTier: 3, price: 350, level: 5, comfort: 16, desc: 'Gold trim. Customers tip like royalty.' },
  { id: 'dk_2', name: 'White Desk + LED', cat: 'desks', kind: 'component', slot: 'desk', slotTier: 1, price: 80, level: 2, appeal: 3, desc: 'Clean white top with an LED strip.' },
  { id: 'dk_3', name: 'Carbon RGB Desk', cat: 'desks', kind: 'component', slot: 'desk', slotTier: 2, price: 200, level: 4, appeal: 6, desc: 'Carbon top, rainbow underglow.' },

  // ---------- Decorations ----------
  { id: 'dec_plant', name: 'Potted Plant', cat: 'decor', kind: 'decor', price: 25, level: 1, build: 'plant', appeal: 3, size: [2, 2], desc: 'A little green makes everything cozier.' },
  { id: 'dec_rug', name: 'Striped Rug', cat: 'decor', kind: 'decor', price: 40, level: 1, build: 'model', model: 'rug_rectangle_stripes_A', walkable: true, appeal: 3, size: [4, 3], desc: 'Soft under the feet. Goes under stations too.' },
  { id: 'dec_rug2', name: 'Oval Rug', cat: 'decor', kind: 'decor', price: 40, level: 1, build: 'model', model: 'rug_oval_A', walkable: true, appeal: 3, size: [4, 3], desc: 'Round and friendly.' },
  { id: 'dec_lamp', name: 'Floor Lamp', cat: 'decor', kind: 'decor', price: 35, level: 1, build: 'lamp', appeal: 3, size: [1, 1], desc: 'Warm glow, especially at night.' },
  { id: 'dec_poster1', name: 'Poster: Space Raiders', cat: 'decor', kind: 'wall', price: 15, level: 1, build: 'poster', tint: '#5b5bd6', appeal: 2, desc: 'Hangs on a wall.' },
  { id: 'dec_poster2', name: 'Poster: Kart Rally', cat: 'decor', kind: 'wall', price: 15, level: 1, build: 'poster', tint: '#ef476f', appeal: 2, desc: 'Hangs on a wall.' },
  { id: 'dec_poster3', name: 'Poster: Dragon Quest-ish', cat: 'decor', kind: 'wall', price: 15, level: 2, build: 'poster', tint: '#06d6a0', appeal: 2, desc: 'Hangs on a wall.' },
  { id: 'dec_neon_gg', name: 'Neon Sign “GG”', cat: 'decor', kind: 'wall', price: 60, level: 2, build: 'neon', tint: '#ff4fd8', appeal: 6, desc: 'Glows pink. Shines at night.' },
  { id: 'dec_neon_play', name: 'Neon Sign “PLAY”', cat: 'decor', kind: 'wall', price: 70, level: 3, build: 'neon', tint: '#3ee6ff', appeal: 7, desc: 'Glows cyan. Shines at night.' },
  { id: 'dec_prizes', name: 'Prize Shelf', cat: 'decor', kind: 'decor', price: 150, level: 3, build: 'model', model: 'prizes', appeal: 9, size: [4, 2], desc: 'Shiny trophies and plushies on display.' },

  // ---------- Products ----------
  { id: 'pr_soda', name: 'Fizzy Soda', cat: 'snacks', kind: 'product', price: 12, level: 1, license: 'retail', product: { market: 3, cost: 1, perBox: 12, place: 'fridge', mesh: 'soda-can', color: '#e63946' }, desc: 'Box of 12 cans. Sells for ~$3 each.' },
  { id: 'pr_energy', name: 'Energy Drink', cat: 'snacks', kind: 'product', price: 24, level: 1, license: 'retail', product: { market: 5, cost: 2, perBox: 12, place: 'fridge', mesh: 'soda-bottle', color: '#80ed99' }, desc: 'Box of 12. Sells for ~$5 each.' },
  { id: 'pr_chips', name: 'Chips', cat: 'snacks', kind: 'product', price: 12, level: 1, license: 'retail', product: { market: 3, cost: 1, perBox: 12, place: 'shelf', mesh: 'bag', color: '#ffb703' }, desc: 'Box of 12 bags. Sells for ~$3 each.' },
  { id: 'pr_candy', name: 'Candy Bars', cat: 'snacks', kind: 'product', price: 10, level: 1, license: 'retail', product: { market: 2, cost: 0.8, perBox: 16, place: 'shelf', mesh: 'candy', color: '#9d4edd' }, desc: 'Box of 16. Sells for ~$2 each.' },
  { id: 'pr_food', name: 'Food Supplies', cat: 'snacks', kind: 'product', price: 40, level: 2, license: 'retail', product: { market: 7, cost: 2, perBox: 20, place: 'foodbar', mesh: 'pizza-box', color: '#e9c46a' }, desc: 'Box of 20 meals (pizza, noodles, slushies) for the Snack Bar.' },
  { id: 'pr_game', name: 'Game Boxes', cat: 'merch', kind: 'product', price: 176, level: 2, license: 'merch', product: { market: 40, cost: 22, perBox: 8, place: 'shelf', mesh: 'gamebox', color: '#4361ee' }, desc: 'Box of 8 games. Sells for ~$40 each.' },
  { id: 'pr_plush', name: 'Plush Toys', cat: 'merch', kind: 'product', price: 72, level: 2, license: 'merch', product: { market: 20, cost: 9, perBox: 8, place: 'shelf', mesh: 'plush', color: '#ff8fab' }, desc: 'Box of 8. Sells for ~$20 each.' },
  { id: 'pr_controller', name: 'Controllers', cat: 'merch', kind: 'product', price: 150, level: 3, license: 'merch', product: { market: 45, cost: 25, perBox: 6, place: 'shelf', mesh: 'controller', color: '#2b2d42' }, desc: 'Box of 6. Sells for ~$45 each.' },
  { id: 'pr_mouse', name: 'Gaming Mice', cat: 'merch', kind: 'product', price: 90, level: 3, license: 'merch', product: { market: 30, cost: 15, perBox: 6, place: 'shelf', mesh: 'mouse', color: '#ef233c' }, desc: 'Box of 6. Sells for ~$30 each.' },
  { id: 'pr_headset', name: 'Gaming Headsets', cat: 'merch', kind: 'product', price: 240, level: 4, license: 'merch', product: { market: 70, cost: 40, perBox: 6, place: 'shelf', mesh: 'headset', color: '#3a86ff' }, desc: 'Box of 6. Sells for ~$70 each.' },
  { id: 'pr_shirt', name: 'Store T-Shirts', cat: 'merch', kind: 'product', price: 80, level: 4, license: 'merch', product: { market: 25, cost: 10, perBox: 8, place: 'shelf', mesh: 'shirt', color: '#ffd166' }, desc: 'Box of 8 with your logo. ~$25 each.' },

  // ---------- Store upgrades: furniture ----------
  { id: 'fu_counter', name: 'Checkout Counter', cat: 'upgrades', kind: 'counter', price: 150, level: 1, license: 'retail', build: 'counter', model: 'cash-register', size: [5, 3], power: 1, desc: 'Scan items and take payments. Needed to sell products.' },
  { id: 'fu_shelf', name: 'Wall Shelf', cat: 'upgrades', kind: 'shelf', price: 80, level: 1, license: 'retail', build: 'shelf', model: 'shelf-end', size: [4, 2], capacity: 18, accepts: 'shelf', appeal: 1, desc: 'Holds 18 of one shelf product. Front side only.' },
  { id: 'fu_shelf2', name: 'Island Shelf', cat: 'upgrades', kind: 'shelf', price: 160, level: 2, license: 'retail', build: 'shelf', model: 'shelf-boxes', size: [4, 4], capacity: 36, accepts: 'shelf', appeal: 2, desc: 'Double-sided, holds 36 of one shelf product.' },
  { id: 'fu_fridge', name: 'Drinks Fridge', cat: 'upgrades', kind: 'fridge', price: 220, level: 1, license: 'retail', build: 'fridge', model: 'freezers-standing', size: [5, 3], capacity: 30, accepts: 'fridge', power: 3, appeal: 2, desc: 'Holds 30 drinks of one kind. Ice cold.' },
  { id: 'fu_foodbar', name: 'Snack Bar', cat: 'upgrades', kind: 'foodbar', price: 350, level: 2, license: 'retail', build: 'foodbar', size: [5, 3], capacity: 40, accepts: 'foodbar', power: 3, appeal: 5,
    desc: 'Make microwave pizza, noodles and slushies to order. Hungry gamers pay $5–8. Stock it with Food Supplies.' },
  { id: 'fu_bin', name: 'Trash Bin', cat: 'upgrades', kind: 'bin', price: 30, level: 1, build: 'model', model: 'trash', scale: 0.7, size: [2, 2], desc: 'Throw empty boxes here. Customers litter less nearby.' },
  { id: 'fu_vending', name: 'Vending Machine', cat: 'upgrades', kind: 'vending', price: 500, level: 3, build: 'model', model: 'vending-machine', size: [3, 3], power: 3, appeal: 4, desc: 'Sells drinks by itself: ~$25 a day per machine.' },

  // ---------- Store upgrades: services ----------
  { id: 'sv_express', name: 'Express Delivery', cat: 'upgrades', kind: 'service', service: 'express', price: 250, level: 2, desc: 'Boxes arrive instantly instead of after 15 s.' },
  { id: 'sv_wifi', name: 'Fiber Internet', cat: 'upgrades', kind: 'service', service: 'wifi', price: 400, level: 2, desc: 'Faster downloads: sessions 15% shorter, +satisfaction.' },
  { id: 'sv_ac', name: 'Air Conditioning', cat: 'upgrades', kind: 'service', service: 'ac', price: 500, level: 3, desc: 'Cool and comfy: +8 satisfaction for everyone.' },
  { id: 'sv_cctv', name: 'Security Cameras', cat: 'upgrades', kind: 'service', service: 'cctv', price: 350, level: 3, desc: 'Troublemakers behave: −60% theft and vandalism.' },
  { id: 'sv_ads', name: 'Billboard Ads', cat: 'upgrades', kind: 'service', service: 'ads', price: 600, level: 4, desc: '+25% more customers walk in.' },
];

/** what the snack bar makes */
export const MEALS = [
  { id: 'pizza', name: 'Pizza slice', emoji: '🍕', price: 8, secs: 3, model: 'pizza' },
  { id: 'noodles', name: 'Noodle bowl', emoji: '🍜', price: 7, secs: 3, model: 'bowl-broth' },
  { id: 'slushie', name: 'Slushie', emoji: '🥤', price: 5, secs: 2, model: 'cup-coffee' },
];
export const MEAL = Object.fromEntries(MEALS.map(m => [m.id, m]));

export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map(i => [i.id, i]));
export const PRODUCTS = ITEMS.filter(i => i.kind === 'product');
export const isPlaceable = (d: ItemDef) => !!d.size || d.kind === 'wall';

// Starting layout items (not sold): the office desk with the management laptop.
export const FIXED = {
  office: { id: 'office', name: 'Office Desk', size: [3, 2] as [number, number] },
};

// Station component visuals per tier (default tier 0 = what the station ships with).
export const SLOT_NAMES: Record<string, string[]> = {
  mon: ['24" Monitor', '27" 144 Hz', 'Dual Monitor Arm', 'Ultrawide 240 Hz'],
  chair: ['Office Chair', 'Gamer Chair', 'Racing Chair', 'Throne Chair'],
  desk: ['Wooden Desk', 'White Desk + LED', 'Carbon RGB Desk'],
};
