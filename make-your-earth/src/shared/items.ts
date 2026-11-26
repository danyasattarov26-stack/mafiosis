/*
  Item and recipe registries. Every placeable block is also an item. Tools, armour, food, drinks,
  medicine and materials are listed here as data; recipes say what goes in, what comes out and
  where it can be made. Recipe inputs can name a tag ("#planks", "#log", "#raw_meat") that any
  matching item satisfies. To add content, add entries; no code changes are needed.
*/
import { BLOCKS } from './blocks';

export type Kind = 'block' | 'tool' | 'weapon' | 'food' | 'drink' | 'medicine' | 'material' | 'armor' | 'misc';
export type ToolType = 'axe' | 'pickaxe' | 'shovel' | 'sword' | 'hoe' | 'knife' | 'spear' | 'hammer';
export interface Shield { block: number; durability: number }
export interface ItemDef {
  key: string; en: string; pt: string; kind: Kind;
  color: string; color2?: string;      // icon colours (icons are drawn in code)
  icon?: string;                        // icon shape for non-block items
  stack: number;
  block?: number;                       // block id it places
  tool?: { type: ToolType; tier: number; durability: number; speed: number; damage: number };
  food?: { hunger?: number; thirst?: number; health?: number; sick?: number; cure?: number; warm?: number };
  armor?: { slot: 'head' | 'chest' | 'legs' | 'feet'; defense: number; warmth: number; durability: number };
  tags?: string[]; era?: number;
  shield?: Shield;                      // off-hand shields: share of a frontal hit they stop
  plant?: string;                       // seeds and crops: the first crop block it plants on farmland
  fuel?: number;                        // seconds it burns in a furnace
}
/**
  A recipe. Most are shapeless: put the ingredients anywhere in the grid. Tools and armour have a shape:
  rows of letters, where each letter stands for an ingredient in `key` and a space is an empty square
  (one item per square; the shape can sit anywhere in the grid and can be mirrored left-to-right).
*/
export interface Recipe { out: string; n: number; in: Record<string, number>; at: Station; time?: number; shape?: string[]; key?: Record<string, string> }
export type Station = 'hand' | 'workbench' | 'furnace' | 'campfire' | 'anvil' | 'lab' | 'blueprint';

export const ITEMS: ItemDef[] = [];
const add = (d: ItemDef) => { ITEMS.push(d); return d; };

// ---- every block that can be held ----
const NOT_ITEMS = new Set(['air', 'water', 'lava', 'fire', 'grave', 'bedrock', 'ancient_vault', 'sky_altar', 'sky_bell', 'sky_bell_rung', 'wooden_door_open', 'wheat_crop_0', 'wheat_crop_1', 'wheat_crop_2', 'carrot_crop_0', 'carrot_crop_1', 'carrot_crop_2', 'potato_crop_0', 'potato_crop_1', 'potato_crop_2']);
BLOCKS.forEach((b, id) => {
  if (NOT_ITEMS.has(b.key)) return;
  const tags: string[] = [];
  if (b.key.endsWith('_log')) tags.push('log');
  if (b.key.endsWith('_planks')) tags.push('planks');
  if (b.key.endsWith('_leaves')) tags.push('leaves');
  add({ key: b.key, en: b.en, pt: b.pt, kind: 'block', color: (b.side ?? b.top).c[0], color2: (b.side ?? b.top).c[1], stack: 64, block: id, tags, era: b.era });
});

// ---- tools: five materials × eight tool types ----
export const TOOL_MATS = [
  { key: 'wooden', en: 'Wooden', pt: 'de Madeira', tier: 0, dur: 60, speed: 1.6, dmg: 1, mat: '#planks', color: '#a8834f', era: 0 },
  { key: 'stone', en: 'Stone', pt: 'de Pedra', tier: 1, dur: 130, speed: 2.4, dmg: 2, mat: 'cobblestone', color: '#8a8b8f', era: 0 },
  { key: 'bronze', en: 'Bronze', pt: 'de Bronze', tier: 2, dur: 260, speed: 3.4, dmg: 3, mat: 'bronze_ingot', color: '#c98a3c', era: 1 },
  { key: 'iron', en: 'Iron', pt: 'de Ferro', tier: 3, dur: 420, speed: 4.6, dmg: 4, mat: 'iron_ingot', color: '#cfd3d8', era: 2 },
  { key: 'steel', en: 'Steel', pt: 'de Aço', tier: 4, dur: 900, speed: 6.5, dmg: 5, mat: 'steel_ingot', color: '#8fa3b8', era: 3 },
];
const TOOL_TYPES: { t: ToolType; en: string; pt: string; mat: number; sticks: number; dmg: number }[] = [
  { t: 'axe', en: 'Axe', pt: 'Machado', mat: 3, sticks: 2, dmg: 3 },
  { t: 'pickaxe', en: 'Pickaxe', pt: 'Picareta', mat: 3, sticks: 2, dmg: 2 },
  { t: 'shovel', en: 'Shovel', pt: 'Pá', mat: 1, sticks: 2, dmg: 1.5 },
  { t: 'sword', en: 'Sword', pt: 'Espada', mat: 2, sticks: 1, dmg: 5 },
  { t: 'hoe', en: 'Hoe', pt: 'Enxada', mat: 2, sticks: 2, dmg: 1 },
  { t: 'knife', en: 'Knife', pt: 'Faca', mat: 1, sticks: 1, dmg: 3 },
  { t: 'spear', en: 'Spear', pt: 'Lança', mat: 1, sticks: 2, dmg: 4.5 },
  { t: 'hammer', en: 'Hammer', pt: 'Martelo', mat: 5, sticks: 2, dmg: 3.5 },
];
for (const m of TOOL_MATS) for (const tt of TOOL_TYPES) {
  add({
    key: `${m.key}_${tt.t}`, en: `${m.en} ${tt.en}`, pt: `${tt.pt} ${m.pt}`, kind: tt.t === 'sword' || tt.t === 'spear' ? 'weapon' : 'tool',
    color: m.color, color2: '#6b4a2b', icon: tt.t, stack: 1, era: m.era,
    tool: { type: tt.t, tier: m.tier, durability: m.dur, speed: m.speed, damage: tt.dmg + m.dmg },
  });
}

// ---- armour: four materials × four slots ----
export const ARMOR_MATS = [
  { key: 'leather', en: 'Leather', pt: 'de Couro', def: 1, warm: 1, dur: 80, mat: 'leather', color: '#8a5a32', era: 0 },
  { key: 'fur', en: 'Fur', pt: 'de Pelo', def: 1, warm: 3, dur: 90, mat: 'fur', color: '#cfc2a8', era: 0 },
  { key: 'bronze', en: 'Bronze', pt: 'de Bronze', def: 2, warm: 0, dur: 200, mat: 'bronze_ingot', color: '#c98a3c', era: 1 },
  { key: 'iron', en: 'Iron', pt: 'de Ferro', def: 3, warm: 0, dur: 330, mat: 'iron_ingot', color: '#cfd3d8', era: 2 },
];
const SLOTS = [
  { s: 'head' as const, en: 'Helmet', pt: 'Capacete', n: 5, d: 1 }, { s: 'chest' as const, en: 'Chestplate', pt: 'Peitoral', n: 8, d: 3 },
  { s: 'legs' as const, en: 'Leggings', pt: 'Calças', n: 7, d: 2 }, { s: 'feet' as const, en: 'Boots', pt: 'Botas', n: 4, d: 1 },
];
for (const m of ARMOR_MATS) for (const s of SLOTS) {
  add({ key: `${m.key}_${s.s}`, en: `${m.en} ${s.en}`, pt: `${s.pt} ${m.pt}`, kind: 'armor', color: m.color, icon: s.s, stack: 1, era: m.era, armor: { slot: s.s, defense: m.def * s.d, warmth: m.warm * (s.d / 2), durability: m.dur } });
}

// ---- food: raw meat makes you sick, cooked meat is safe ----
export const MEATS = [
  { k: 'venison', en: 'Venison', pt: 'Carne de Veado', c: '#b0503f' }, { k: 'pork', en: 'Boar Meat', pt: 'Carne de Javali', c: '#d77a72' },
  { k: 'rabbit', en: 'Rabbit', pt: 'Coelho', c: '#d68f80' }, { k: 'bear', en: 'Bear Meat', pt: 'Carne de Urso', c: '#8a3a30' },
  { k: 'fish', en: 'Fish', pt: 'Peixe', c: '#a9c3d0' }, { k: 'shark', en: 'Shark Steak', pt: 'Bife de Tubarão', c: '#c9b5b0' },
  { k: 'camel', en: 'Camel Meat', pt: 'Carne de Camelo', c: '#b8644a' }, { k: 'mammoth', en: 'Mammoth Meat', pt: 'Carne de Mamute', c: '#9a3a2e' },
  { k: 'mutton', en: 'Mutton', pt: 'Carneiro', c: '#c8605a' }, { k: 'beef', en: 'Beef', pt: 'Carne de Vaca', c: '#b84a3e' },
  { k: 'chicken', en: 'Chicken', pt: 'Frango', c: '#f0c0a8' }, { k: 'goat', en: 'Goat Meat', pt: 'Carne de Cabra', c: '#b85a48' },
  { k: 'wild_meat', en: 'Wild Meat', pt: 'Carne Selvagem', c: '#a04838' },
];
for (const m of MEATS) {
  const big = m.k === 'mammoth' || m.k === 'bear' || m.k === 'shark';
  add({ key: `raw_${m.k}`, en: `Raw ${m.en}`, pt: `${m.pt} Crua`, kind: 'food', color: m.c, icon: m.k === 'fish' ? 'fish' : 'meat', stack: 32, tags: ['raw_meat'], food: { hunger: big ? 14 : 8, sick: 0.45 } });
  add({ key: `cooked_${m.k}`, en: `Cooked ${m.en}`, pt: `${m.pt} Cozinhada`, kind: 'food', color: '#7a4a2a', color2: m.c, icon: m.k === 'fish' ? 'fish' : 'meat', stack: 32, tags: ['cooked_meat'], food: { hunger: big ? 38 : 26, health: 4, warm: 2 } });
}
const FOODS: ItemDef[] = [
  { key: 'berries', en: 'Berries', pt: 'Bagas', kind: 'food', color: '#b0203a', icon: 'berries', stack: 64, food: { hunger: 5, thirst: 3 } },
  { key: 'apple', en: 'Apple', pt: 'Maçã', kind: 'food', color: '#d8382a', icon: 'fruit', stack: 64, food: { hunger: 10, thirst: 4 } },
  { key: 'coconut', en: 'Coconut', pt: 'Coco', kind: 'food', color: '#6b4a2b', icon: 'fruit', stack: 32, food: { hunger: 8, thirst: 14 } },
  { key: 'cactus_fruit', en: 'Cactus Fruit', pt: 'Figo-da-índia', kind: 'food', color: '#c8306a', icon: 'fruit', stack: 64, food: { hunger: 6, thirst: 10 } },
  { key: 'wheat_item', en: 'Wheat', pt: 'Trigo', kind: 'material', color: '#d8c05a', icon: 'wheat', stack: 64 },
  { key: 'seeds', en: 'Seeds', pt: 'Sementes', kind: 'material', color: '#9a8a4a', icon: 'seeds', stack: 64 },
  { key: 'bread', en: 'Bread', pt: 'Pão', kind: 'food', color: '#c8903e', icon: 'bread', stack: 32, food: { hunger: 22 } },
  { key: 'potato', en: 'Potato', pt: 'Batata', kind: 'food', color: '#c8a86a', icon: 'fruit', stack: 64, food: { hunger: 5, sick: 0.1 } },
  { key: 'baked_potato', en: 'Baked Potato', pt: 'Batata Assada', kind: 'food', color: '#a8783e', icon: 'fruit', stack: 64, food: { hunger: 18, warm: 1 } },
  { key: 'carrot', en: 'Carrot', pt: 'Cenoura', kind: 'food', color: '#f08a2a', icon: 'carrot', stack: 64, food: { hunger: 8, thirst: 2 } },
  { key: 'mushroom', en: 'Mushroom', pt: 'Cogumelo', kind: 'food', color: '#c8a088', icon: 'mushroom', stack: 64, food: { hunger: 4, sick: 0.2 } },
  { key: 'stew', en: 'Hearty Stew', pt: 'Guisado', kind: 'food', color: '#8a4a2a', icon: 'bowl', stack: 8, food: { hunger: 45, thirst: 15, health: 8, warm: 4 } },
  { key: 'fish_soup', en: 'Fish Soup', pt: 'Sopa de Peixe', kind: 'food', color: '#d8c8a8', icon: 'bowl', stack: 8, food: { hunger: 35, thirst: 20, health: 6, warm: 3 } },
  { key: 'jerky', en: 'Jerky', pt: 'Carne Seca', kind: 'food', color: '#6a3a24', icon: 'meat', stack: 64, food: { hunger: 16, thirst: -4 } },
  { key: 'honey', en: 'Honey', pt: 'Mel', kind: 'food', color: '#f0b030', icon: 'jar', stack: 16, food: { hunger: 10, health: 2, cure: 0.2 } },
  { key: 'salt', en: 'Salt', pt: 'Sal', kind: 'material', color: '#f2eef0', icon: 'powder', stack: 64 },
  { key: 'flour', en: 'Flour', pt: 'Farinha', kind: 'material', color: '#f0ead8', icon: 'powder', stack: 64 },
  { key: 'rotten_flesh', en: 'Rotten Flesh', pt: 'Carne Podre', kind: 'food', color: '#7a8a4a', color2: '#5a3a2a', icon: 'meat', stack: 64, food: { hunger: 6, sick: 0.7 } },
  { key: 'spider_eye', en: 'Spider Eye', pt: 'Olho de Aranha', kind: 'food', color: '#a8203a', icon: 'berries', stack: 64, food: { hunger: 2, sick: 0.8 } },
  { key: 'glow_cap', en: 'Glow Cap', pt: 'Cogumelo Luminoso', kind: 'food', color: '#3fd8e8', icon: 'mushroom', stack: 64, food: { hunger: 3, cure: 0.15 } },
  { key: 'mushroom_soup', en: 'Mushroom Soup', pt: 'Sopa de Cogumelos', kind: 'food', color: '#b89070', icon: 'bowl', stack: 8, food: { hunger: 28, thirst: 12, health: 4, warm: 3 } },
  { key: 'pumpkin_pie', en: 'Pumpkin Pie', pt: 'Tarte de Abóbora', kind: 'food', color: '#e8862a', color2: '#c8903e', icon: 'pie', stack: 16, food: { hunger: 30, health: 4 } },
  { key: 'apple_pie', en: 'Apple Pie', pt: 'Tarte de Maçã', kind: 'food', color: '#d8a050', color2: '#a8702e', icon: 'pie', stack: 16, food: { hunger: 32, health: 4 } },
  { key: 'golden_apple', en: 'Golden Apple', pt: 'Maçã Dourada', kind: 'food', color: '#f5d04a', icon: 'fruit', stack: 16, food: { hunger: 12, health: 45, cure: 1 } },
  { key: 'carrot_soup', en: 'Carrot Soup', pt: 'Sopa de Cenoura', kind: 'food', color: '#f08a2a', icon: 'bowl', stack: 8, food: { hunger: 26, thirst: 14, health: 3, warm: 3 } },
  { key: 'snowball', en: 'Snowball', pt: 'Bola de Neve', kind: 'misc', color: '#f4f8fb', icon: 'ball', stack: 16 },
];
FOODS.forEach(add);

// ---- drinks: dirty water makes you sick unless boiled ----
[
  { key: 'empty_bottle', en: 'Empty Bottle', pt: 'Garrafa Vazia', kind: 'misc', color: '#cfe8f5', icon: 'bottle', stack: 16 },
  { key: 'dirty_water', en: 'Dirty Water', pt: 'Água Suja', kind: 'drink', color: '#7a8a6a', icon: 'bottle', stack: 16, food: { thirst: 30, sick: 0.35 } },
  { key: 'clean_water', en: 'Boiled Water', pt: 'Água Fervida', kind: 'drink', color: '#4a9ad8', icon: 'bottle', stack: 16, food: { thirst: 40 } },
  { key: 'herbal_tea', en: 'Herbal Tea', pt: 'Chá de Ervas', kind: 'medicine', color: '#8aa83a', icon: 'bottle', stack: 16, food: { thirst: 25, cure: 0.6, warm: 3 } },
  { key: 'coconut_milk', en: 'Coconut Milk', pt: 'Leite de Coco', kind: 'drink', color: '#f2eee6', icon: 'bottle', stack: 16, food: { thirst: 30, hunger: 4 } },
  { key: 'berry_juice', en: 'Berry Juice', pt: 'Sumo de Bagas', kind: 'drink', color: '#a02040', icon: 'bottle', stack: 16, food: { thirst: 35, hunger: 4 } },
].forEach(d => add(d as ItemDef));

// ---- medicine ----
[
  { key: 'herbs', en: 'Herbs', pt: 'Ervas', kind: 'medicine', color: '#5a9a3a', icon: 'herb', stack: 64, food: { cure: 0.25 } },
  { key: 'bandage', en: 'Bandage', pt: 'Ligadura', kind: 'medicine', color: '#f2eee6', icon: 'bandage', stack: 16, food: { health: 20 } },
  { key: 'medicine', en: 'Medicine', pt: 'Medicamento', kind: 'medicine', color: '#e23b3b', color2: '#ffffff', icon: 'pill', stack: 16, food: { cure: 1, health: 10 }, era: 3 },
  { key: 'antidote', en: 'Antidote', pt: 'Antídoto', kind: 'medicine', color: '#46b3c9', icon: 'bottle', stack: 16, food: { cure: 1 }, era: 2 },
  { key: 'first_aid_kit', en: 'First Aid Kit', pt: 'Kit de Primeiros Socorros', kind: 'medicine', color: '#f2f2f2', color2: '#e23b3b', icon: 'box', stack: 8, food: { health: 60, cure: 0.5 }, era: 3 },
].forEach(d => add(d as ItemDef));

// ---- materials ----
[
  ['stick', 'Stick', 'Pau', '#8a6a3a', 'stick'], ['plant_fiber', 'Plant Fiber', 'Fibra Vegetal', '#8aa84a', 'fiber'], ['string', 'String', 'Fio', '#e8e2d0', 'fiber'],
  ['rope', 'Rope', 'Corda', '#c8a86a', 'rope'], ['flint', 'Flint', 'Sílex', '#4a4b50', 'rock'], ['coal', 'Coal', 'Carvão', '#242426', 'rock'],
  ['charcoal', 'Charcoal', 'Carvão Vegetal', '#3a3330', 'rock'], ['raw_copper', 'Raw Copper', 'Cobre Bruto', '#c8743c', 'rock'], ['raw_tin', 'Raw Tin', 'Estanho Bruto', '#d9dde2', 'rock'],
  ['raw_iron', 'Raw Iron', 'Ferro Bruto', '#c9a283', 'rock'], ['raw_gold', 'Raw Gold', 'Ouro Bruto', '#f2c530', 'rock'], ['raw_uranium', 'Raw Uranium', 'Urânio Bruto', '#7cff4a', 'rock'],
  ['copper_ingot', 'Copper Ingot', 'Lingote de Cobre', '#d9874a', 'ingot'], ['tin_ingot', 'Tin Ingot', 'Lingote de Estanho', '#d9dde2', 'ingot'], ['bronze_ingot', 'Bronze Ingot', 'Lingote de Bronze', '#c98a3c', 'ingot'],
  ['iron_ingot', 'Iron Ingot', 'Lingote de Ferro', '#cfd3d8', 'ingot'], ['steel_ingot', 'Steel Ingot', 'Lingote de Aço', '#8fa3b8', 'ingot'], ['gold_ingot', 'Gold Ingot', 'Lingote de Ouro', '#f5d04a', 'ingot'],
  ['iron_nugget', 'Iron Nugget', 'Pepita de Ferro', '#cfd3d8', 'nugget'], ['gold_nugget', 'Gold Nugget', 'Pepita de Ouro', '#f5d04a', 'nugget'], ['diamond', 'Diamond', 'Diamante', '#6ef0e8', 'gem'],
  ['sulfur', 'Sulfur', 'Enxofre', '#e2d84a', 'powder'], ['saltpeter', 'Saltpeter', 'Salitre', '#f2f2ee', 'powder'], ['gunpowder', 'Gunpowder', 'Pólvora', '#4a4b50', 'powder'],
  ['clay_ball', 'Clay Ball', 'Bola de Argila', '#9aa3ad', 'ball'], ['brick', 'Brick', 'Tijolo', '#a8533c', 'ingot'], ['leather', 'Leather', 'Couro', '#8a5a32', 'hide'],
  ['fur', 'Fur', 'Pelo', '#cfc2a8', 'hide'], ['hide', 'Raw Hide', 'Pele Crua', '#b08a62', 'hide'], ['bone', 'Bone', 'Osso', '#ece6d2', 'bone'],
  ['feather', 'Feather', 'Pena', '#f2f2f2', 'feather'], ['tusk', 'Ivory Tusk', 'Presa de Marfim', '#f2ead6', 'bone'], ['resin', 'Resin', 'Resina', '#d89a2a', 'jar'],
  ['cement', 'Cement', 'Cimento', '#a9aaab', 'powder'], ['rebar', 'Rebar', 'Varão de Aço', '#6f7a85', 'stick'], ['glass_pane', 'Glass Pane', 'Painel de Vidro', '#cfe8f5', 'pane'],
  ['gear', 'Gear', 'Engrenagem', '#9aa3ad', 'gear'], ['copper_wire', 'Copper Wire', 'Fio de Cobre', '#d9874a', 'rope'], ['circuit', 'Circuit Board', 'Placa de Circuito', '#2f8a4a', 'chip'],
  ['battery', 'Battery', 'Bateria', '#2f5d9a', 'box'], ['plastic', 'Plastic', 'Plástico', '#e8e8f0', 'ingot'], ['oil', 'Crude Oil', 'Petróleo', '#1a1a1c', 'jar'],
  ['fuel', 'Fuel Can', 'Bidão de Combustível', '#c8302a', 'box'], ['blueprint_paper', 'Blueprint Paper', 'Papel de Planta', '#2f6db3', 'paper'], ['paper', 'Paper', 'Papel', '#f2eee6', 'paper'],
  ['crystal_shard', 'Crystal Shard', 'Fragmento de Cristal', '#b07af0', 'gem'], ['blue_petals', 'Blue Petals', 'Pétalas Azuis', '#4a6ae8', 'herb'],
  ['ink', 'Ink', 'Tinta', '#1a1a2a', 'jar'], ['journal', 'Research Journal', 'Diário de Investigação', '#5e3f22', 'book'], ['coin', 'Coin', 'Moeda', '#f5d04a', 'coin'],
].forEach(([key, en, pt, color, icon]) => add({ key, en, pt, kind: 'material', color, icon, stack: 64 }));

// ---- dyes (from flowers and minerals) colour wool, glass, concrete and terracotta ----
export const DYES = [
  { k: 'red', en: 'Red', pt: 'Vermelho', c: '#c8302a' }, { k: 'orange', en: 'Orange', pt: 'Laranja', c: '#f08a2a' }, { k: 'yellow', en: 'Yellow', pt: 'Amarelo', c: '#f2d23a' },
  { k: 'green', en: 'Green', pt: 'Verde', c: '#5ab83a' }, { k: 'blue', en: 'Blue', pt: 'Azul', c: '#3a5ac8' }, { k: 'purple', en: 'Purple', pt: 'Roxo', c: '#8a3ac8' },
  { k: 'pink', en: 'Pink', pt: 'Cor-de-rosa', c: '#f09ab8' }, { k: 'black', en: 'Black', pt: 'Preto', c: '#2a2a2e' }, { k: 'white', en: 'White', pt: 'Branco', c: '#f2eee6' },
];
for (const d of DYES) add({ key: `${d.k}_dye`, en: `${d.en} Dye`, pt: `Corante ${d.pt}`, kind: 'material', color: d.c, icon: 'dye', stack: 64, tags: ['dye'] });

// ---- misc gear ----
[
  { key: 'bucket', en: 'Bucket', pt: 'Balde', kind: 'misc', color: '#cfd3d8', icon: 'bucket', stack: 16 },
  { key: 'water_bucket', en: 'Water Bucket', pt: 'Balde de Água', kind: 'misc', color: '#3b7fc2', icon: 'bucket', stack: 1 },
  { key: 'bow', en: 'Bow', pt: 'Arco', kind: 'weapon', color: '#8a6a3a', icon: 'bow', stack: 1, tool: { type: 'spear', tier: 0, durability: 200, speed: 1, damage: 6 } },
  { key: 'arrow', en: 'Arrow', pt: 'Flecha', kind: 'misc', color: '#c8b88a', icon: 'arrow', stack: 64 },
  { key: 'fishing_rod', en: 'Fishing Rod', pt: 'Cana de Pesca', kind: 'tool', color: '#8a6a3a', icon: 'rod', stack: 1 },
  { key: 'compass', en: 'Compass', pt: 'Bússola', kind: 'misc', color: '#cfd3d8', icon: 'compass', stack: 1 },
  { key: 'map_item', en: 'Map', pt: 'Mapa', kind: 'misc', color: '#e8dcb8', icon: 'paper', stack: 1 },
  { key: 'saddle', en: 'Saddle', pt: 'Sela', kind: 'misc', color: '#6b3a1e', icon: 'hide', stack: 1 },
  { key: 'harness', en: 'Harness', pt: 'Arreio', kind: 'misc', color: '#6b3a1e', icon: 'rope', stack: 1 },
  { key: 'flint_and_steel', en: 'Fire Starter', pt: 'Isqueiro de Sílex', kind: 'tool', color: '#4a4b50', icon: 'flint', stack: 1 },
  { key: 'oxygen_tank', en: 'Oxygen Tank', pt: 'Garrafa de Oxigénio', kind: 'misc', color: '#e8eef2', icon: 'box', stack: 1, era: 5 },
  { key: 'wooden_shield', en: 'Wooden Shield', pt: 'Escudo de Madeira', kind: 'misc', color: '#a8834f', color2: '#5e3f22', icon: 'shield', stack: 1, shield: { block: 0.55, durability: 120 } },
  { key: 'iron_shield', en: 'Iron Shield', pt: 'Escudo de Ferro', kind: 'misc', color: '#9aa3ad', color2: '#4a4d52', icon: 'shield', stack: 1, shield: { block: 0.8, durability: 400 }, era: 2 },
  { key: 'shears', en: 'Shears', pt: 'Tesoura de Tosquia', kind: 'tool', color: '#cfd3d8', color2: '#6b4a2b', icon: 'shears', stack: 1 },
  { key: 'boat', en: 'Rowing Boat', pt: 'Barco a Remos', kind: 'misc', color: '#9a6e3e', color2: '#5a3a1e', icon: 'boat', stack: 1 },
  { key: 'star_compass', en: 'Star Compass', pt: 'Bússola Estelar', kind: 'misc', color: '#f5d04a', color2: '#b07af0', icon: 'compass', stack: 1 },
  { key: 'starstone_ember', en: 'Ember Starstone', pt: 'Pedra Estelar de Brasa', kind: 'misc', color: '#ff6a1a', icon: 'gem', stack: 1, tags: ['starstone'] },
  { key: 'starstone_frost', en: 'Frost Starstone', pt: 'Pedra Estelar de Gelo', kind: 'misc', color: '#8ad8ff', icon: 'gem', stack: 1, tags: ['starstone'] },
  { key: 'starstone_verdant', en: 'Verdant Starstone', pt: 'Pedra Estelar Verdejante', kind: 'misc', color: '#4ad86a', icon: 'gem', stack: 1, tags: ['starstone'] },
  { key: 'starstone_tide', en: 'Tide Starstone', pt: 'Pedra Estelar das Marés', kind: 'misc', color: '#3a6ad8', icon: 'gem', stack: 1, tags: ['starstone'] },
  { key: 'world_seed', en: 'World Seed', pt: 'Semente do Mundo', kind: 'misc', color: '#f5d04a', color2: '#4ad86a', icon: 'fruit', stack: 1 },
  { key: 'mammoth_trophy', en: 'Mammoth Trophy', pt: 'Troféu de Mamute', kind: 'misc', color: '#f2ead6', icon: 'bone', stack: 1 },
].forEach(d => add(d as ItemDef));

export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map(i => [i.key, i]));
// what you plant on farmland, and what burns in a furnace
ITEM.seeds.plant = 'wheat_crop_0'; ITEM.carrot.plant = 'carrot_crop_0'; ITEM.potato.plant = 'potato_crop_0';
for (const it of ITEMS) {
  if (it.tags?.includes('log')) it.fuel = 15;
  else if (it.tags?.includes('planks')) it.fuel = 8;
}
Object.assign(ITEM.coal, { fuel: 80 }); Object.assign(ITEM.charcoal, { fuel: 80 }); Object.assign(ITEM.stick, { fuel: 3 }); Object.assign(ITEM.fuel, { fuel: 300 });
Object.assign(ITEM.plant_fiber, { fuel: 2 }); Object.assign(ITEM.thatch, { fuel: 4 }); Object.assign(ITEM.hay_bale, { fuel: 20 }); Object.assign(ITEM.oil, { fuel: 200 });
export const itemsWithTag = (tag: string) => ITEMS.filter(i => i.tags?.includes(tag));

// =================== recipes ===================
export const RECIPES: Recipe[] = [];
const R = (out: string, n: number, inp: Record<string, number>, at: Station = 'hand') => RECIPES.push({ out, n, in: inp, at });

// basics by hand
R('oak_planks', 4, { oak_log: 1 }); R('birch_planks', 4, { birch_log: 1 }); R('pine_planks', 4, { pine_log: 1 });
R('jungle_planks', 4, { jungle_log: 1 }); R('acacia_planks', 4, { acacia_log: 1 }); R('palm_planks', 4, { palm_log: 1 });
R('stick', 4, { '#planks': 2 }); R('string', 1, { plant_fiber: 3 }); R('rope', 1, { string: 3 });
R('workbench', 1, { '#planks': 4 }); R('torch', 4, { stick: 1, coal: 1 }); R('torch', 4, { stick: 1, charcoal: 1 });
R('campfire', 1, { stick: 3, '#log': 1, flint: 1 }); R('thatch', 2, { plant_fiber: 4 }); R('flint_and_steel', 1, { flint: 1, iron_nugget: 1 });
R('herbal_tea', 1, { herbs: 2, clean_water: 1 }); R('bandage', 2, { string: 2, plant_fiber: 2 }); R('berry_juice', 1, { berries: 4, empty_bottle: 1 });
R('coconut_milk', 1, { coconut: 1, empty_bottle: 1 }); R('seeds', 2, { wheat_item: 1 }); R('flour', 1, { wheat_item: 2 });
// wood-tier tools and early stations
// tools and armour are laid out in a shape: M = the material, S = a stick
export const TOOL_SHAPES: Record<string, string[]> = {
  pickaxe: ['MMM', ' S ', ' S '], axe: ['MM', 'MS', ' S'], shovel: ['M', 'S', 'S'], sword: ['M', 'M', 'S'],
  hoe: ['MM', ' S', ' S'], knife: ['M', 'S'], spear: ['  M', ' S ', 'S  '], hammer: ['MMM', 'MSM', ' S '],
};
export const ARMOR_SHAPES: Record<string, string[]> = { head: ['MMM', 'M M'], chest: ['M M', 'MMM', 'MMM'], legs: ['MMM', 'M M', 'M M'], feet: ['M M', 'M M'] };
const shaped = (out: string, shape: string[], key: Record<string, string>, at: Station) => {
  const ins: Record<string, number> = {};
  for (const row of shape) for (const ch of row) if (ch !== ' ') ins[key[ch]] = (ins[key[ch]] ?? 0) + 1;
  RECIPES.push({ out, n: 1, in: ins, at, shape, key });
};
for (const m of TOOL_MATS) for (const tt of TOOL_TYPES) shaped(`${m.key}_${tt.t}`, TOOL_SHAPES[tt.t], { M: m.mat, S: 'stick' }, m.tier <= 1 ? 'workbench' : 'anvil');
for (const m of ARMOR_MATS) for (const s of SLOTS) shaped(`${m.key}_${s.s}`, ARMOR_SHAPES[s.s], { M: m.mat }, m.key === 'leather' || m.key === 'fur' ? 'workbench' : 'anvil');
// workbench
R('furnace', 1, { cobblestone: 8 }, 'workbench'); R('chest', 1, { '#planks': 8 }, 'workbench'); R('ladder', 3, { stick: 7 }, 'workbench');
R('wooden_door', 1, { '#planks': 6 }, 'workbench'); R('stone_bricks', 4, { cobblestone: 4 }, 'workbench'); R('clay_bricks', 1, { brick: 4 }, 'workbench');
R('blueprint_table', 1, { '#planks': 4, paper: 3, ink: 1 }, 'workbench'); R('bucket', 1, { iron_ingot: 3 }, 'workbench'); R('bow', 1, { stick: 3, string: 3 }, 'workbench');
R('arrow', 8, { stick: 1, flint: 1, feather: 1 }, 'workbench'); R('fishing_rod', 1, { stick: 3, string: 2 }, 'workbench'); R('saddle', 1, { leather: 5, iron_nugget: 2 }, 'workbench');
R('harness', 1, { leather: 3, rope: 2 }, 'workbench'); R('paper', 3, { plant_fiber: 6 }, 'workbench'); R('ink', 1, { charcoal: 1, empty_bottle: 1 }, 'workbench');
R('journal', 1, { paper: 6, leather: 1 }, 'workbench'); R('wool', 1, { string: 4 }, 'workbench'); R('map_item', 1, { paper: 4, ink: 1 }, 'workbench');
R('leather', 1, { hide: 1, salt: 1 }, 'workbench'); R('anvil', 1, { iron_ingot: 6, cobblestone: 4 }, 'workbench'); R('compass', 1, { iron_ingot: 2, copper_wire: 1 }, 'workbench');
R('stew', 1, { '#cooked_meat': 1, potato: 1, carrot: 1, clean_water: 1 }, 'campfire'); R('fish_soup', 1, { cooked_fish: 2, clean_water: 1, salt: 1 }, 'campfire');
R('jerky', 3, { '#raw_meat': 2, salt: 1 }, 'workbench'); R('blueprint_paper', 2, { paper: 2, ink: 1 }, 'workbench'); R('snow_bricks', 1, { snowball: 4 }); R('mossy_bricks', 1, { stone_bricks: 1, plant_fiber: 2 }, 'workbench');
R('chiseled_sandstone', 2, { sandstone: 2 }, 'workbench'); R('hay_bale', 1, { wheat_item: 9 }); R('bookshelf', 1, { '#planks': 6, paper: 6 }, 'workbench'); R('cracked_bricks', 1, { stone_bricks: 1 }, 'furnace'); R('tiles', 4, { clay_ball: 2, glass_pane: 1 }, 'workbench');
// cooking: every raw meat can be cooked at a campfire or furnace
for (const m of MEATS) { R(`cooked_${m.k}`, 1, { [`raw_${m.k}`]: 1 }, 'campfire'); R(`cooked_${m.k}`, 1, { [`raw_${m.k}`]: 1 }, 'furnace'); }
R('clean_water', 1, { dirty_water: 1 }, 'campfire'); R('clean_water', 1, { dirty_water: 1 }, 'furnace'); R('baked_potato', 1, { potato: 1 }, 'campfire');
R('bread', 1, { flour: 2 }, 'furnace'); R('bread', 1, { flour: 2 }, 'campfire');
// furnace: smelting
R('charcoal', 1, { '#log': 1 }, 'furnace'); R('copper_ingot', 1, { raw_copper: 1 }, 'furnace'); R('tin_ingot', 1, { raw_tin: 1 }, 'furnace');
R('iron_ingot', 1, { raw_iron: 1 }, 'furnace'); R('gold_ingot', 1, { raw_gold: 1 }, 'furnace'); R('glass', 1, { sand: 1 }, 'furnace');
R('brick', 1, { clay_ball: 1 }, 'furnace'); R('stone', 1, { cobblestone: 1 }, 'furnace'); R('empty_bottle', 2, { glass: 1 }, 'furnace');
R('glass_pane', 4, { glass: 2 }, 'furnace'); R('salt', 2, { salt_rock: 1 }, 'furnace'); R('cement', 2, { cobblestone: 2, clay_ball: 1, sand: 1 }, 'workbench');
// anvil: metal work
R('bronze_ingot', 4, { copper_ingot: 3, tin_ingot: 1 }, 'anvil'); R('steel_ingot', 1, { iron_ingot: 2, coal: 2 }, 'anvil'); R('iron_nugget', 9, { iron_ingot: 1 }, 'anvil');
R('gold_nugget', 9, { gold_ingot: 1 }, 'anvil'); R('iron_block', 1, { iron_ingot: 9 }, 'anvil'); R('copper_block', 1, { copper_ingot: 9 }, 'anvil');
R('gold_block', 1, { gold_ingot: 9 }, 'anvil'); R('gear', 2, { iron_ingot: 2 }, 'anvil'); R('copper_wire', 4, { copper_ingot: 1 }, 'anvil');
R('rebar', 4, { steel_ingot: 1 }, 'anvil'); R('lab_bench', 1, { iron_ingot: 4, glass: 2, '#planks': 4 }, 'anvil'); R('coin', 16, { gold_nugget: 1 }, 'anvil');
// lab: science (the Research Journal records discoveries)
R('gunpowder', 2, { sulfur: 1, saltpeter: 1, charcoal: 1 }, 'lab'); R('medicine', 2, { herbs: 3, salt: 1, clean_water: 1 }, 'lab'); R('antidote', 1, { herbs: 2, honey: 1, clean_water: 1 }, 'lab');
R('first_aid_kit', 1, { bandage: 2, medicine: 1, leather: 1 }, 'lab'); R('circuit', 1, { copper_wire: 2, plastic: 1, gold_nugget: 1 }, 'lab'); R('battery', 1, { copper_ingot: 1, sulfur: 1, plastic: 1 }, 'lab');
R('plastic', 2, { oil: 1 }, 'lab'); R('fuel', 1, { oil: 2, empty_bottle: 1 }, 'lab'); R('tnt', 1, { gunpowder: 4, sand: 2 }, 'lab');
R('concrete', 4, { cement: 2, gravel: 1, clean_water: 1 }, 'lab'); R('reinforced_concrete', 4, { concrete: 4, rebar: 2 }, 'lab'); R('air_filter', 1, { iron_ingot: 4, circuit: 1, plant_fiber: 8 }, 'lab');
R('blast_door', 1, { steel_ingot: 8, reinforced_concrete: 2, gear: 2 }, 'lab'); R('oxygen_tank', 1, { steel_ingot: 4, circuit: 1 }, 'lab'); R('saltpeter', 1, { bone: 2, mud: 1 }, 'lab');

// ---- v3: dyes, colours, furniture, farming food, combat gear ----
R('red_dye', 2, { flower_red: 1 }); R('yellow_dye', 2, { flower_yellow: 1 }); R('blue_dye', 2, { blue_petals: 1 }); R('white_dye', 3, { bone: 1 });
R('black_dye', 2, { coal: 1 }); R('black_dye', 2, { ink: 1 }); R('orange_dye', 2, { red_dye: 1, yellow_dye: 1 }); R('purple_dye', 2, { red_dye: 1, blue_dye: 1 });
R('pink_dye', 2, { red_dye: 1, white_dye: 1 }); R('green_dye', 2, { yellow_dye: 1, blue_dye: 1 }); R('green_dye', 1, { cactus: 1 }, 'furnace');
R('purple_dye', 2, { crystal_shard: 1 });
for (const c of ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'black']) R(`wool_${c}`, 1, { wool: 1, [`${c}_dye`]: 1 });
for (const c of ['red', 'orange', 'yellow', 'green', 'blue', 'purple']) R(`glass_${c}`, 4, { glass: 4, [`${c}_dye`]: 1 }, 'workbench');
for (const c of ['white', 'red', 'yellow', 'green', 'blue', 'black']) R(`concrete_${c}`, 4, { concrete: 4, [`${c}_dye`]: 1 }, 'workbench');
for (const c of ['white', 'red', 'blue']) R(`terracotta_${c}`, 4, { terracotta: 4, [`${c}_dye`]: 1 }, 'workbench');
R('terracotta', 1, { clay: 1 }, 'furnace'); R('smooth_stone', 1, { stone: 1 }, 'furnace'); R('polished_granite', 4, { granite: 4 }, 'workbench'); R('polished_marble', 4, { marble: 4 }, 'workbench');
R('window', 4, { glass: 4, '#planks': 2 }, 'workbench'); R('iron_bars', 8, { iron_ingot: 3 }, 'anvil'); R('lantern', 1, { iron_nugget: 4, torch: 1 }, 'workbench');
R('lantern', 1, { iron_nugget: 4, crystal_shard: 1 }, 'workbench'); R('glow_crystal', 1, { crystal_shard: 4 }, 'workbench');
R('bed', 1, { wool: 3, '#planks': 3 }, 'workbench'); R('crate', 2, { '#planks': 4, stick: 4 }, 'workbench'); R('barrel', 1, { '#planks': 6, iron_nugget: 2 }, 'workbench');
R('moss_block', 1, { cobblestone: 1, plant_fiber: 4 }); R('mossy_cobble', 1, { cobblestone: 1, moss_block: 1 });
R('wooden_shield', 1, { '#planks': 5, iron_nugget: 1 }, 'workbench'); R('iron_shield', 1, { iron_ingot: 5, leather: 1 }, 'anvil'); R('shears', 1, { iron_ingot: 2 }, 'anvil');
R('arrow', 4, { stick: 1, flint: 1, string: 1 }, 'workbench'); R('arrow', 6, { stick: 2, iron_nugget: 1, feather: 2 }, 'workbench');
R('mushroom_soup', 1, { mushroom: 3, clean_water: 1 }, 'campfire'); R('carrot_soup', 1, { carrot: 3, clean_water: 1 }, 'campfire');
R('pumpkin_pie', 1, { pumpkin: 1, flour: 1 }, 'campfire'); R('apple_pie', 1, { apple: 3, flour: 1 }, 'campfire'); R('golden_apple', 1, { apple: 1, gold_nugget: 8 }, 'workbench');
R('seeds', 4, { pumpkin: 1 }); R('designer_table', 1, { workbench: 1, red_dye: 1, blue_dye: 1, yellow_dye: 1, paper: 2 }, 'workbench');
R('terracotta_orange', 4, { terracotta: 4, orange_dye: 1 }, 'workbench'); R('terracotta_yellow', 4, { terracotta: 4, yellow_dye: 1 }, 'workbench'); R('terracotta_brown', 4, { terracotta: 4, black_dye: 1, red_dye: 1 }, 'workbench'); R('string', 2, { cobweb: 1 }); R('leather', 1, { rotten_flesh: 4, salt: 1 }, 'workbench');

// ---- the quest ----
R('star_compass', 1, { compass: 1, crystal_shard: 2 }, 'workbench'); R('star_compass', 1, { iron_ingot: 2, crystal_shard: 3 }, 'workbench');
R('sky_beacon', 1, { starstone_ember: 1, starstone_frost: 1, starstone_verdant: 1, starstone_tide: 1, gold_block: 1, glow_crystal: 2 }, 'anvil');
R('skystone_bricks', 4, { skystone: 4 }, 'workbench'); R('oak_planks', 4, { skywood_log: 1 });
R('boat', 1, { '#planks': 6, stick: 2 }, 'workbench');
