/* Biomes and animals, as data. A biome says what the ground is made of, which trees and plants grow,
   how warm it is, what weather it gets and which animals live there. */
export interface Biome {
  key: string; en: string; pt: string; color: string;          // map colour
  top: string; under: string; deep?: string;                    // surface blocks
  trees: { kind: string; chance: number }[]; plants: { block: string; chance: number }[];
  temp: number;          // °C at midday
  weather: 'rain' | 'snow' | 'dry';
  animals: string[];
}

export const BIOMES: Biome[] = [
  { key: 'ocean', en: 'Ocean', pt: 'Oceano', color: '#2a5f9e', top: 'sand', under: 'sand', deep: 'gravel', trees: [], plants: [], temp: 18, weather: 'rain',
    animals: ['shark', 'dolphin', 'turtle', 'fish', 'koi'] },
  { key: 'beach', en: 'Island Beach', pt: 'Praia de Ilha', color: '#e3d29a', top: 'sand', under: 'sand', deep: 'sandstone', trees: [{ kind: 'palm', chance: 0.012 }], plants: [{ block: 'tall_grass', chance: 0.02 }], temp: 27, weather: 'rain',
    animals: ['crab', 'turtle', 'parrot', 'chicken', 'boar'] },
  { key: 'forest', en: 'Temperate Forest', pt: 'Floresta Temperada', color: '#4f8a32', top: 'grass', under: 'dirt', trees: [{ kind: 'oak', chance: 0.022 }, { kind: 'birch', chance: 0.01 }], plants: [{ block: 'tall_grass', chance: 0.16 }, { block: 'flower_red', chance: 0.01 }, { block: 'flower_yellow', chance: 0.01 }, { block: 'berry_bush', chance: 0.006 }, { block: 'wheat', chance: 0.004 }], temp: 16, weather: 'rain',
    animals: ['deer', 'boar', 'rabbit', 'wolf', 'bear', 'fox', 'horse', 'owl', 'cow', 'sheep'] },
  { key: 'jungle', en: 'Jungle', pt: 'Selva', color: '#2f8226', top: 'jungle_grass', under: 'dirt', deep: 'mud', trees: [{ kind: 'jungle', chance: 0.05 }], plants: [{ block: 'fern', chance: 0.22 }, { block: 'berry_bush', chance: 0.01 }, { block: 'flower_red', chance: 0.006 }], temp: 30, weather: 'rain',
    animals: ['parrot', 'frog', 'crocodile', 'boar', 'deer'] },
  { key: 'desert', en: 'Desert', pt: 'Deserto', color: '#dcc98f', top: 'sand', under: 'sand', deep: 'sandstone', trees: [{ kind: 'cactus', chance: 0.006 }], plants: [{ block: 'dead_bush', chance: 0.008 }], temp: 38, weather: 'dry',
    animals: ['camel', 'rabbit', 'fox', 'goat', 'lion'] },
  { key: 'savanna', en: 'Savanna', pt: 'Savana', color: '#b6a64e', top: 'dry_grass', under: 'dirt', deep: 'red_sand', trees: [{ kind: 'acacia', chance: 0.004 }], plants: [{ block: 'tall_grass', chance: 0.2 }, { block: 'dead_bush', chance: 0.004 }], temp: 31, weather: 'dry',
    animals: ['lion', 'zebra', 'giraffe', 'elephant', 'boar'] },
  { key: 'tundra', en: 'Tundra (Ice Age)', pt: 'Tundra (Era Glaciar)', color: '#e9f0f5', top: 'snow', under: 'permafrost', trees: [{ kind: 'pine', chance: 0.006 }], plants: [{ block: 'dead_bush', chance: 0.004 }], temp: -14, weather: 'snow',
    animals: ['mammoth', 'penguin', 'wolf', 'polar_bear', 'arctic_fox', 'owl'] },
  { key: 'mountains', en: 'Mountains', pt: 'Montanhas', color: '#8a8b8f', top: 'stone', under: 'stone', trees: [{ kind: 'pine', chance: 0.012 }], plants: [{ block: 'tall_grass', chance: 0.03 }], temp: 4, weather: 'snow',
    animals: ['goat', 'sheep', 'bear', 'wolf', 'owl', 'horse'] },
];
export const BIOME_ID: Record<string, number> = Object.fromEntries(BIOMES.map((b, i) => [b.key, i]));

export interface Animal {
  key: string; en: string; pt: string;
  model: string; scale: number; tint?: string;        // glTF in /models, uniform scale, optional colour tint
  hp: number; speed: number; run: number;              // m/s walking and fleeing/charging
  mood: 'passive' | 'skittish' | 'neutral' | 'hostile';
  damage?: number; reach?: number;
  water?: boolean; fly?: boolean;
  drops: [string, number, number][];                   // item, min, max
  sound?: string; herd?: number;
  rideable?: boolean; harness?: boolean;
}
export const ANIMALS: Animal[] = [
  { key: 'deer', en: 'Deer', pt: 'Veado', model: 'deer-base', scale: 0.85, hp: 14, speed: 1.6, run: 7.5, mood: 'skittish', drops: [['raw_venison', 2, 3], ['hide', 1, 2], ['bone', 0, 1]], sound: 'deer', herd: 3 },
  { key: 'boar', en: 'Wild Boar', pt: 'Javali', model: 'pig-base', scale: 0.9, tint: '#5a3e2e', hp: 18, speed: 1.4, run: 5.5, mood: 'neutral', damage: 4, reach: 1.4, drops: [['raw_pork', 2, 3], ['hide', 1, 1], ['tusk', 0, 1]], sound: 'boar', herd: 2 },
  { key: 'rabbit', en: 'Rabbit', pt: 'Coelho', model: 'rabbit-base', scale: 1.1, hp: 4, speed: 1.4, run: 6.5, mood: 'skittish', drops: [['raw_rabbit', 1, 1], ['fur', 0, 1]], herd: 2 },
  { key: 'wolf', en: 'Wolf', pt: 'Lobo', model: 'wolf-base', scale: 1, hp: 20, speed: 1.8, run: 7, mood: 'hostile', damage: 5, reach: 1.6, drops: [['raw_wild_meat', 1, 2], ['fur', 1, 2], ['bone', 1, 2]], sound: 'wolf', herd: 3 },
  { key: 'bear', en: 'Brown Bear', pt: 'Urso Pardo', model: 'bear-base', scale: 1.15, hp: 45, speed: 1.4, run: 6, mood: 'neutral', damage: 10, reach: 2, drops: [['raw_bear', 3, 5], ['fur', 2, 3], ['bone', 1, 3]], sound: 'bear' },
  { key: 'polar_bear', en: 'Polar Bear', pt: 'Urso Polar', model: 'bear-base', scale: 1.3, tint: '#f2f4f2', hp: 55, speed: 1.4, run: 6, mood: 'hostile', damage: 12, reach: 2.2, drops: [['raw_bear', 3, 6], ['fur', 3, 4], ['bone', 1, 3]], sound: 'bear' },
  { key: 'fox', en: 'Fox', pt: 'Raposa', model: 'fox-base', scale: 1, hp: 10, speed: 1.6, run: 7, mood: 'skittish', drops: [['raw_wild_meat', 1, 1], ['fur', 1, 1]] },
  { key: 'arctic_fox', en: 'Arctic Fox', pt: 'Raposa-do-ártico', model: 'fox-base', scale: 0.9, tint: '#f4f6f8', hp: 10, speed: 1.6, run: 7, mood: 'skittish', drops: [['raw_wild_meat', 1, 1], ['fur', 1, 2]] },
  { key: 'owl', en: 'Owl', pt: 'Mocho', model: 'owl-base', scale: 1.4, hp: 4, speed: 1, run: 5, mood: 'skittish', drops: [['feather', 1, 3], ['raw_chicken', 0, 1]], sound: 'owl' },
  { key: 'horse', en: 'Horse', pt: 'Cavalo', model: 'horse-base', scale: 1, hp: 30, speed: 1.6, run: 9, mood: 'skittish', drops: [['raw_wild_meat', 2, 3], ['hide', 2, 2]], sound: 'horse', herd: 3, rideable: true, harness: true },
  { key: 'cow', en: 'Cow', pt: 'Vaca', model: 'cow-base', scale: 1, hp: 22, speed: 1.1, run: 4.5, mood: 'passive', drops: [['raw_beef', 2, 3], ['hide', 1, 2]], sound: 'cow', herd: 3 },
  { key: 'sheep', en: 'Sheep', pt: 'Ovelha', model: 'sheep-base', scale: 1, hp: 14, speed: 1.1, run: 4.5, mood: 'passive', drops: [['raw_mutton', 1, 2], ['wool', 1, 2]], sound: 'sheep', herd: 4 },
  { key: 'chicken', en: 'Chicken', pt: 'Galinha', model: 'chicken-base', scale: 1, hp: 4, speed: 1, run: 4, mood: 'skittish', drops: [['raw_chicken', 1, 1], ['feather', 1, 2]], sound: 'chicken', herd: 3 },
  { key: 'goat', en: 'Mountain Goat', pt: 'Cabra-montesa', model: 'goat-base', scale: 1, hp: 14, speed: 1.3, run: 6, mood: 'skittish', drops: [['raw_goat', 1, 2], ['hide', 1, 1]], herd: 3 },
  { key: 'camel', en: 'Camel', pt: 'Camelo', model: 'camel-base', scale: 1, hp: 35, speed: 1.2, run: 5.5, mood: 'passive', drops: [['raw_camel', 3, 4], ['hide', 2, 3]], herd: 2, rideable: true, harness: true },
  { key: 'lion', en: 'Lion', pt: 'Leão', model: 'lion-base', scale: 1, hp: 40, speed: 1.5, run: 8, mood: 'hostile', damage: 11, reach: 2, drops: [['raw_wild_meat', 2, 4], ['fur', 1, 2], ['bone', 1, 2]], sound: 'lion' },
  { key: 'zebra', en: 'Zebra', pt: 'Zebra', model: 'zebra-base', scale: 1, hp: 24, speed: 1.6, run: 8.5, mood: 'skittish', drops: [['raw_wild_meat', 2, 3], ['hide', 1, 2]], herd: 4, rideable: true },
  { key: 'giraffe', en: 'Giraffe', pt: 'Girafa', model: 'giraffe-base', scale: 1, hp: 40, speed: 1.2, run: 6, mood: 'passive', drops: [['raw_wild_meat', 3, 5], ['hide', 2, 3]], herd: 2 },
  { key: 'elephant', en: 'Elephant', pt: 'Elefante', model: 'elephant-base', scale: 1, hp: 90, speed: 1.1, run: 4.5, mood: 'neutral', damage: 16, reach: 3, drops: [['raw_wild_meat', 4, 6], ['hide', 3, 4], ['tusk', 0, 2]], sound: 'elephant' },
  { key: 'mammoth', en: 'Woolly Mammoth', pt: 'Mamute-lanoso', model: 'elephant-base', scale: 1.35, tint: '#6e4a30', hp: 120, speed: 1.1, run: 4.5, mood: 'neutral', damage: 20, reach: 3.5, drops: [['raw_mammoth', 6, 9], ['fur', 4, 6], ['tusk', 1, 2], ['bone', 2, 4]], sound: 'elephant', herd: 2 },
  { key: 'penguin', en: 'Penguin', pt: 'Pinguim', model: 'penguin-base', scale: 1.1, hp: 8, speed: 0.8, run: 3, mood: 'skittish', drops: [['raw_chicken', 1, 1], ['feather', 1, 2]], herd: 5 },
  { key: 'parrot', en: 'Parrot', pt: 'Papagaio', model: 'parrot-base', scale: 0.35, hp: 4, speed: 1, run: 5, mood: 'skittish', drops: [['feather', 1, 3]], sound: 'parrot' },
  { key: 'frog', en: 'Frog', pt: 'Rã', model: 'frog-base', scale: 2.2, hp: 3, speed: 0.8, run: 3, mood: 'skittish', drops: [['raw_wild_meat', 0, 1]], sound: 'frog' },
  { key: 'crocodile', en: 'Crocodile', pt: 'Crocodilo', model: 'crocodile-base', scale: 1, hp: 40, speed: 0.9, run: 5, mood: 'hostile', damage: 12, reach: 2.2, drops: [['raw_wild_meat', 2, 4], ['hide', 2, 3]] },
  { key: 'crab', en: 'Crab', pt: 'Caranguejo', model: 'hermit-crab-base', scale: 0.35, hp: 4, speed: 0.6, run: 2, mood: 'skittish', drops: [['raw_fish', 1, 1]] },
  { key: 'shark', en: 'Shark', pt: 'Tubarão', model: 'reef-shark-base', scale: 1.8, hp: 40, speed: 2, run: 6, mood: 'hostile', damage: 14, reach: 2, water: true, drops: [['raw_shark', 3, 5], ['bone', 1, 2]] },
  { key: 'dolphin', en: 'Dolphin', pt: 'Golfinho', model: 'dolphin-base', scale: 1, hp: 30, speed: 2.5, run: 7, mood: 'passive', water: true, drops: [['raw_fish', 2, 3]], herd: 3 },
  { key: 'turtle', en: 'Sea Turtle', pt: 'Tartaruga Marinha', model: 'sea-turtle-base', scale: 0.8, hp: 20, speed: 0.9, run: 2, mood: 'passive', water: true, drops: [['raw_fish', 1, 2], ['bone', 0, 1]] },
  { key: 'fish', en: 'Clownfish', pt: 'Peixe-palhaço', model: 'clownfish-base', scale: 1.6, hp: 2, speed: 1.2, run: 4, mood: 'skittish', water: true, drops: [['raw_fish', 1, 1]], herd: 5 },
  { key: 'koi', en: 'Carp', pt: 'Carpa', model: 'koi-base', scale: 1, hp: 3, speed: 1.2, run: 4, mood: 'skittish', water: true, drops: [['raw_fish', 1, 2]], herd: 3 },
];
export const ANIMAL: Record<string, Animal> = Object.fromEntries(ANIMALS.map(a => [a.key, a]));
