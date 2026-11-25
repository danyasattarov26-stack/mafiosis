/*
  Block registry. Every block is data: how it looks (procedural 16×16 pixel textures, no image files),
  how hard it is to break, which tool is best, what it drops and how it behaves (solid, liquid, plant,
  light, flammable). Block ids are their index in this list and must never be reordered once worlds
  are saved; add new blocks at the end.
*/
export type Pattern =
  | 'noise' | 'grass' | 'grassSide' | 'log' | 'logTop' | 'planks' | 'leaves' | 'stone' | 'cobble' | 'ore'
  | 'sand' | 'brick' | 'glass' | 'water' | 'snow' | 'ice' | 'metal' | 'concrete' | 'crystal' | 'plant'
  | 'flower' | 'crop' | 'cactus' | 'cactusTop' | 'wool' | 'tiles' | 'torch' | 'door' | 'table' | 'furnace'
  | 'lava' | 'chest' | 'clay' | 'strata';
export interface Tex { p: Pattern; c: string[] }
export type Tool = 'hand' | 'axe' | 'pickaxe' | 'shovel';
export type Render = 'cube' | 'cross' | 'liquid' | 'none';
export interface BlockDef {
  key: string; en: string; pt: string;
  top: Tex; side?: Tex; bottom?: Tex;
  hard: number;            // seconds to break by hand with the right tool tier 0; <0 = unbreakable
  tool: Tool; tier?: number;   // minimum tool tier to get a drop (0 wood, 1 stone, 2 bronze, 3 iron, 4 steel)
  drop?: string | null;    // item key dropped (default: itself)
  render?: Render; solid?: boolean; transparent?: boolean;
  light?: number; flammable?: boolean; station?: string; era?: number;
}

const T = (p: Pattern, ...c: string[]): Tex => ({ p, c });

export const BLOCKS: BlockDef[] = [
  { key: 'air', en: 'Air', pt: 'Ar', top: T('noise', '#000'), hard: 0, tool: 'hand', render: 'none', solid: false, transparent: true },
  { key: 'bedrock', en: 'Bedrock', pt: 'Rocha-mãe', top: T('stone', '#3a3a3e', '#26262a'), hard: -1, tool: 'pickaxe' },
  { key: 'stone', en: 'Stone', pt: 'Pedra', top: T('stone', '#8a8b8f', '#77787c'), hard: 1.5, tool: 'pickaxe', drop: 'cobblestone' },
  { key: 'dirt', en: 'Dirt', pt: 'Terra', top: T('noise', '#7a5536', '#6a4a2e'), hard: 0.5, tool: 'shovel' },
  { key: 'grass', en: 'Grass', pt: 'Relva', top: T('grass', '#5f9e3c', '#4f8a32'), side: T('grassSide', '#7a5536', '#5f9e3c'), bottom: T('noise', '#7a5536', '#6a4a2e'), hard: 0.6, tool: 'shovel', drop: 'dirt' },
  { key: 'sand', en: 'Sand', pt: 'Areia', top: T('sand', '#dcc98f', '#cdb97c'), hard: 0.5, tool: 'shovel' },
  { key: 'gravel', en: 'Gravel', pt: 'Cascalho', top: T('cobble', '#8d8680', '#6e6862'), hard: 0.6, tool: 'shovel', drop: 'flint' },
  { key: 'clay', en: 'Clay', pt: 'Argila', top: T('clay', '#9aa3ad', '#8a93a0'), hard: 0.6, tool: 'shovel', drop: 'clay_ball' },
  { key: 'water', en: 'Water', pt: 'Água', top: T('water', '#2f6fb0', '#3b7fc2'), hard: -1, tool: 'hand', render: 'liquid', solid: false, transparent: true },
  { key: 'oak_log', en: 'Oak Log', pt: 'Tronco de Carvalho', top: T('logTop', '#a8834f', '#6b4a2b'), side: T('log', '#6b4a2b', '#4f361e'), hard: 2, tool: 'axe', flammable: true },
  { key: 'oak_leaves', en: 'Oak Leaves', pt: 'Folhas de Carvalho', top: T('leaves', '#3f7d2c', '#2e6421'), hard: 0.2, tool: 'hand', drop: 'stick', transparent: true, flammable: true },
  { key: 'birch_log', en: 'Birch Log', pt: 'Tronco de Bétula', top: T('logTop', '#d6c59b', '#a08c5f'), side: T('log', '#e6e2d6', '#2b2b2b'), hard: 2, tool: 'axe', flammable: true },
  { key: 'birch_leaves', en: 'Birch Leaves', pt: 'Folhas de Bétula', top: T('leaves', '#6a9e3f', '#557f31'), hard: 0.2, tool: 'hand', drop: 'stick', transparent: true, flammable: true },
  { key: 'pine_log', en: 'Pine Log', pt: 'Tronco de Pinheiro', top: T('logTop', '#9c7a4c', '#4a311a'), side: T('log', '#4a311a', '#362312'), hard: 2, tool: 'axe', flammable: true },
  { key: 'pine_leaves', en: 'Pine Needles', pt: 'Agulhas de Pinheiro', top: T('leaves', '#2f5a35', '#23472a'), hard: 0.2, tool: 'hand', drop: 'stick', transparent: true, flammable: true },
  { key: 'jungle_log', en: 'Jungle Log', pt: 'Tronco Tropical', top: T('logTop', '#a07a45', '#5b4122'), side: T('log', '#5e4a24', '#4a3a1a'), hard: 2.2, tool: 'axe', flammable: true },
  { key: 'jungle_leaves', en: 'Jungle Leaves', pt: 'Folhas Tropicais', top: T('leaves', '#2f8a2a', '#1f6e1d'), hard: 0.2, tool: 'hand', drop: 'stick', transparent: true, flammable: true },
  { key: 'acacia_log', en: 'Acacia Log', pt: 'Tronco de Acácia', top: T('logTop', '#c07a46', '#7a6a5a'), side: T('log', '#7a6a5a', '#5e5045'), hard: 2, tool: 'axe', flammable: true },
  { key: 'acacia_leaves', en: 'Acacia Leaves', pt: 'Folhas de Acácia', top: T('leaves', '#8aa23a', '#6d8a2c'), hard: 0.2, tool: 'hand', drop: 'stick', transparent: true, flammable: true },
  { key: 'palm_log', en: 'Palm Log', pt: 'Tronco de Palmeira', top: T('logTop', '#c4a46a', '#8a6d3d'), side: T('log', '#a8884f', '#8a6d3d'), hard: 1.8, tool: 'axe', flammable: true },
  { key: 'palm_leaves', en: 'Palm Fronds', pt: 'Folhas de Palmeira', top: T('leaves', '#4f9a35', '#3a7d27'), hard: 0.2, tool: 'hand', drop: 'coconut', transparent: true, flammable: true },
  { key: 'cactus', en: 'Cactus', pt: 'Cato', top: T('cactusTop', '#5a8f3a', '#3f6e28'), side: T('cactus', '#4f8a33', '#2f5e1f'), hard: 0.6, tool: 'hand', drop: 'cactus_fruit' },
  { key: 'snow', en: 'Snow', pt: 'Neve', top: T('snow', '#f4f8fb', '#e2eaf0'), side: T('grassSide', '#7a5536', '#f4f8fb'), bottom: T('noise', '#7a5536', '#6a4a2e'), hard: 0.5, tool: 'shovel', drop: 'snowball' },
  { key: 'ice', en: 'Ice', pt: 'Gelo', top: T('ice', '#a8d4f0', '#8cc0e6'), hard: 0.8, tool: 'pickaxe', drop: null, transparent: true },
  { key: 'permafrost', en: 'Permafrost', pt: 'Permafrost', top: T('noise', '#6d7c85', '#5c6a72'), hard: 1.2, tool: 'shovel', drop: 'dirt' },
  { key: 'sandstone', en: 'Sandstone', pt: 'Arenito', top: T('strata', '#d8c48a', '#c4ae74'), hard: 1.2, tool: 'pickaxe' },
  { key: 'red_sand', en: 'Red Sand', pt: 'Areia Vermelha', top: T('sand', '#c77a45', '#b0683a'), hard: 0.5, tool: 'shovel' },
  { key: 'dry_grass', en: 'Dry Grass', pt: 'Erva Seca', top: T('grass', '#b6a64e', '#9a8c3e'), side: T('grassSide', '#8a6640', '#b6a64e'), bottom: T('noise', '#8a6640', '#7a5836'), hard: 0.6, tool: 'shovel', drop: 'dirt' },
  { key: 'jungle_grass', en: 'Jungle Grass', pt: 'Relva Tropical', top: T('grass', '#3f9a32', '#2f8226'), side: T('grassSide', '#6a4a2e', '#3f9a32'), bottom: T('noise', '#6a4a2e', '#5a3e26'), hard: 0.6, tool: 'shovel', drop: 'dirt' },
  { key: 'mud', en: 'Mud', pt: 'Lama', top: T('noise', '#4e3a2a', '#3f2e22'), hard: 0.5, tool: 'shovel' },
  { key: 'coal_ore', en: 'Coal Ore', pt: 'Minério de Carvão', top: T('ore', '#8a8b8f', '#1d1d1f'), hard: 2, tool: 'pickaxe', drop: 'coal' },
  { key: 'copper_ore', en: 'Copper Ore', pt: 'Minério de Cobre', top: T('ore', '#8a8b8f', '#c8743c'), hard: 2.2, tool: 'pickaxe', tier: 1, drop: 'raw_copper' },
  { key: 'tin_ore', en: 'Tin Ore', pt: 'Minério de Estanho', top: T('ore', '#8a8b8f', '#d9dde2'), hard: 2.2, tool: 'pickaxe', tier: 1, drop: 'raw_tin' },
  { key: 'iron_ore', en: 'Iron Ore', pt: 'Minério de Ferro', top: T('ore', '#8a8b8f', '#c9a283'), hard: 2.6, tool: 'pickaxe', tier: 2, drop: 'raw_iron' },
  { key: 'gold_ore', en: 'Gold Ore', pt: 'Minério de Ouro', top: T('ore', '#8a8b8f', '#f2c530'), hard: 2.8, tool: 'pickaxe', tier: 3, drop: 'raw_gold' },
  { key: 'sulfur_ore', en: 'Sulfur Ore', pt: 'Minério de Enxofre', top: T('ore', '#8a8b8f', '#e2d84a'), hard: 2.2, tool: 'pickaxe', tier: 1, drop: 'sulfur' },
  { key: 'diamond_ore', en: 'Diamond Ore', pt: 'Minério de Diamante', top: T('ore', '#8a8b8f', '#6ef0e8'), hard: 3.5, tool: 'pickaxe', tier: 3, drop: 'diamond' },
  { key: 'uranium_ore', en: 'Uranium Ore', pt: 'Minério de Urânio', top: T('ore', '#6c6d70', '#7cff4a'), hard: 4, tool: 'pickaxe', tier: 4, drop: 'raw_uranium', light: 4 },
  { key: 'cobblestone', en: 'Cobblestone', pt: 'Pedra Rústica', top: T('cobble', '#8a8b8f', '#5f6064'), hard: 1.8, tool: 'pickaxe' },
  { key: 'oak_planks', en: 'Oak Planks', pt: 'Tábuas de Carvalho', top: T('planks', '#b48a52', '#94703f'), hard: 1.4, tool: 'axe', flammable: true },
  { key: 'birch_planks', en: 'Birch Planks', pt: 'Tábuas de Bétula', top: T('planks', '#d8c58d', '#bfa96f'), hard: 1.4, tool: 'axe', flammable: true },
  { key: 'pine_planks', en: 'Pine Planks', pt: 'Tábuas de Pinheiro', top: T('planks', '#7c5a35', '#644728'), hard: 1.4, tool: 'axe', flammable: true },
  { key: 'stone_bricks', en: 'Stone Bricks', pt: 'Tijolos de Pedra', top: T('brick', '#9a9b9f', '#6f7074'), hard: 2, tool: 'pickaxe' },
  { key: 'clay_bricks', en: 'Clay Bricks', pt: 'Tijolos de Barro', top: T('brick', '#a8533c', '#d8d0c4'), hard: 2, tool: 'pickaxe' },
  { key: 'glass', en: 'Glass', pt: 'Vidro', top: T('glass', '#cfe8f5', '#ffffff'), hard: 0.4, tool: 'hand', drop: null, transparent: true },
  { key: 'thatch', en: 'Thatch', pt: 'Colmo', top: T('crop', '#c9b35c', '#a8923f'), hard: 0.5, tool: 'hand', flammable: true },
  { key: 'wool', en: 'Wool', pt: 'Lã', top: T('wool', '#eeeae2', '#d8d2c6'), hard: 0.6, tool: 'hand', flammable: true },
  { key: 'concrete', en: 'Concrete', pt: 'Betão', top: T('concrete', '#a9aaab', '#9c9d9e'), hard: 3, tool: 'pickaxe', tier: 2, era: 3 },
  { key: 'reinforced_concrete', en: 'Reinforced Concrete', pt: 'Betão Armado', top: T('concrete', '#7d8187', '#5f6368'), hard: 8, tool: 'pickaxe', tier: 3, era: 4 },
  { key: 'iron_block', en: 'Iron Block', pt: 'Bloco de Ferro', top: T('metal', '#cfd3d8', '#a9aeb4'), hard: 4, tool: 'pickaxe', tier: 2 },
  { key: 'copper_block', en: 'Copper Block', pt: 'Bloco de Cobre', top: T('metal', '#d9874a', '#b86a35'), hard: 3.5, tool: 'pickaxe', tier: 1 },
  { key: 'gold_block', en: 'Gold Block', pt: 'Bloco de Ouro', top: T('metal', '#f5d04a', '#d8ad2a'), hard: 3.5, tool: 'pickaxe', tier: 2 },
  { key: 'tiles', en: 'Floor Tiles', pt: 'Azulejos', top: T('tiles', '#e9eef2', '#2f6db3'), hard: 1.8, tool: 'pickaxe' },
  { key: 'workbench', en: 'Workbench', pt: 'Bancada', top: T('table', '#b48a52', '#5e3f22'), side: T('planks', '#94703f', '#744f2c'), hard: 1.5, tool: 'axe', station: 'workbench', flammable: true },
  { key: 'furnace', en: 'Furnace', pt: 'Fornalha', top: T('cobble', '#7a7b7f', '#55565a'), side: T('furnace', '#7a7b7f', '#e8762f'), hard: 2.5, tool: 'pickaxe', station: 'furnace', light: 10 },
  { key: 'campfire', en: 'Campfire', pt: 'Fogueira', top: T('torch', '#6b4a2b', '#ff9a2e'), hard: 0.8, tool: 'hand', station: 'campfire', render: 'cross', solid: false, transparent: true, light: 14 },
  { key: 'anvil', en: 'Anvil', pt: 'Bigorna', top: T('metal', '#4a4d52', '#2e3034'), hard: 4, tool: 'pickaxe', tier: 1, station: 'anvil' },
  { key: 'lab_bench', en: 'Lab Bench', pt: 'Bancada de Laboratório', top: T('tiles', '#f2f4f6', '#46b3c9'), side: T('metal', '#d6dbe0', '#aab2ba'), hard: 2, tool: 'pickaxe', station: 'lab', era: 3 },
  { key: 'blueprint_table', en: 'Blueprint Table', pt: 'Mesa de Plantas', top: T('table', '#2f5d9a', '#e8edf2'), side: T('planks', '#7c5a35', '#644728'), hard: 1.5, tool: 'axe', station: 'blueprint' },
  { key: 'chest', en: 'Chest', pt: 'Baú', top: T('chest', '#9a6b38', '#5e3f22'), hard: 1.5, tool: 'axe', flammable: true },
  { key: 'torch', en: 'Torch', pt: 'Tocha', top: T('torch', '#6b4a2b', '#ffd24a'), hard: 0.1, tool: 'hand', render: 'cross', solid: false, transparent: true, light: 14, flammable: true },
  { key: 'tall_grass', en: 'Tall Grass', pt: 'Erva Alta', top: T('plant', '#5f9e3c', '#4a8030'), hard: 0.05, tool: 'hand', drop: 'plant_fiber', render: 'cross', solid: false, transparent: true, flammable: true },
  { key: 'flower_red', en: 'Poppy', pt: 'Papoila', top: T('flower', '#4a8030', '#e23b3b'), hard: 0.05, tool: 'hand', drop: 'herbs', render: 'cross', solid: false, transparent: true },
  { key: 'flower_yellow', en: 'Dandelion', pt: 'Dente-de-leão', top: T('flower', '#4a8030', '#f2d23a'), hard: 0.05, tool: 'hand', drop: 'herbs', render: 'cross', solid: false, transparent: true },
  { key: 'berry_bush', en: 'Berry Bush', pt: 'Arbusto de Bagas', top: T('flower', '#2f6a2a', '#b0203a'), hard: 0.3, tool: 'hand', drop: 'berries', render: 'cross', solid: false, transparent: true, flammable: true },
  { key: 'dead_bush', en: 'Dead Bush', pt: 'Arbusto Seco', top: T('plant', '#8a6a3a', '#6e5430'), hard: 0.05, tool: 'hand', drop: 'stick', render: 'cross', solid: false, transparent: true, flammable: true },
  { key: 'fern', en: 'Fern', pt: 'Feto', top: T('plant', '#2f8a2a', '#1f6e1d'), hard: 0.05, tool: 'hand', drop: 'plant_fiber', render: 'cross', solid: false, transparent: true, flammable: true },
  { key: 'wheat', en: 'Wild Wheat', pt: 'Trigo Selvagem', top: T('crop', '#d8c05a', '#a8923f'), hard: 0.05, tool: 'hand', drop: 'wheat_item', render: 'cross', solid: false, transparent: true, flammable: true },
  { key: 'lava', en: 'Lava', pt: 'Lava', top: T('lava', '#ff6a1a', '#ffb02e'), hard: -1, tool: 'hand', render: 'liquid', solid: false, transparent: true, light: 15 },
  { key: 'obsidian', en: 'Obsidian', pt: 'Obsidiana', top: T('crystal', '#1c1428', '#3a2a52'), hard: 10, tool: 'pickaxe', tier: 3 },
  { key: 'mossy_cobble', en: 'Mossy Cobblestone', pt: 'Pedra com Musgo', top: T('cobble', '#7a8a6a', '#4f6a3a'), hard: 1.8, tool: 'pickaxe' },
  { key: 'basalt', en: 'Basalt', pt: 'Basalto', top: T('strata', '#4a4b50', '#3a3b40'), hard: 2, tool: 'pickaxe' },
  { key: 'granite', en: 'Granite', pt: 'Granito', top: T('stone', '#a87a6a', '#8a5e50'), hard: 1.8, tool: 'pickaxe' },
  { key: 'marble', en: 'Marble', pt: 'Mármore', top: T('stone', '#eceae6', '#d2cfc8'), hard: 2, tool: 'pickaxe' },
  { key: 'packed_ice', en: 'Packed Ice', pt: 'Gelo Compacto', top: T('ice', '#8cb8e0', '#6f9fd0'), hard: 1.2, tool: 'pickaxe' },
  { key: 'blast_door', en: 'Blast Door', pt: 'Porta Blindada', top: T('door', '#5f6368', '#f2c230'), hard: 12, tool: 'pickaxe', tier: 4, era: 4 },
  { key: 'air_filter', en: 'Air Filter', pt: 'Filtro de Ar', top: T('metal', '#9aa3ad', '#46b3c9'), hard: 3, tool: 'pickaxe', tier: 3, era: 4 },
  { key: 'wooden_door', en: 'Wooden Door', pt: 'Porta de Madeira', top: T('door', '#94703f', '#5e3f22'), hard: 1.2, tool: 'axe', flammable: true },
  { key: 'ladder', en: 'Ladder', pt: 'Escada de Mão', top: T('planks', '#94703f', '#5e3f22'), hard: 0.5, tool: 'axe', render: 'cross', solid: false, transparent: true, flammable: true },
  { key: 'tnt', en: 'Explosive Charge', pt: 'Carga Explosiva', top: T('tiles', '#c8302a', '#f2f2f2'), hard: 0.3, tool: 'hand', flammable: true, era: 3 },
  { key: 'fire', en: 'Fire', pt: 'Fogo', top: T('torch', '#ff5a1a', '#ffd24a'), hard: 0, tool: 'hand', drop: null, render: 'cross', solid: false, transparent: true, light: 15 },
  { key: 'farmland', en: 'Farmland', pt: 'Terra Lavrada', top: T('strata', '#5a3e26', '#4a321e'), side: T('noise', '#7a5536', '#6a4a2e'), hard: 0.5, tool: 'shovel', drop: 'dirt' },
  { key: 'mammoth_bones', en: 'Ancient Bones', pt: 'Ossos Antigos', top: T('strata', '#e8e2d0', '#cfc6ae'), hard: 1.5, tool: 'pickaxe', drop: 'bone' },
  { key: 'salt_rock', en: 'Salt Rock', pt: 'Rocha de Sal', top: T('crystal', '#f0e6ea', '#d8c8d0'), hard: 1.5, tool: 'pickaxe', drop: 'salt' },
  { key: 'grave', en: 'Grave Chest', pt: 'Baú Sepulcral', top: T('chest', '#4a4b50', '#9aa3ad'), hard: -1, tool: 'hand', drop: null },
];

export const BLOCK_ID: Record<string, number> = Object.fromEntries(BLOCKS.map((b, i) => [b.key, i]));
export const B = BLOCK_ID;
/** which blocks have a solid full cube for collision */
export const isSolid = (id: number) => id !== 0 && BLOCKS[id] && BLOCKS[id].solid !== false;
export const isOpaque = (id: number) => id !== 0 && BLOCKS[id] && !BLOCKS[id].transparent && (BLOCKS[id].render ?? 'cube') === 'cube';
