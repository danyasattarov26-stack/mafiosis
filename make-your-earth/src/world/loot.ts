/* What's inside an old chest. Decided by the chest's position and biome, so it's the same for every player. */
import { mulberry32, hash3 } from './noise';
import { BIOME_ID } from '../shared/biomes';

type Entry = [string, number, number, number];   // item, min, max, weight
const COMMON: Entry[] = [
  ['bread', 1, 3, 6], ['apple', 2, 5, 6], ['jerky', 2, 6, 5], ['clean_water', 1, 2, 5], ['coal', 3, 9, 6], ['stick', 4, 10, 4], ['string', 2, 6, 4],
  ['leather', 1, 4, 4], ['paper', 2, 6, 3], ['ink', 1, 1, 2], ['blueprint_paper', 1, 3, 3], ['torch', 4, 12, 5], ['bandage', 1, 3, 3], ['herbs', 2, 5, 4],
  ['copper_ingot', 2, 6, 4], ['tin_ingot', 1, 3, 3], ['iron_ingot', 1, 4, 3], ['iron_nugget', 3, 9, 3], ['flint', 2, 5, 4], ['seeds', 3, 8, 3],
  ['stone_pickaxe', 1, 1, 3], ['bronze_axe', 1, 1, 2], ['bronze_pickaxe', 1, 1, 2], ['iron_sword', 1, 1, 1], ['iron_pickaxe', 1, 1, 1], ['leather_chest', 1, 1, 2],
  ['empty_bottle', 1, 3, 3], ['salt', 2, 6, 2], ['rope', 1, 3, 3], ['compass', 1, 1, 1], ['map_item', 1, 1, 1], ['saddle', 1, 1, 1],
];
const RARE: Entry[] = [['gold_ingot', 1, 3, 4], ['diamond', 1, 2, 2], ['medicine', 1, 2, 3], ['steel_ingot', 1, 2, 2], ['iron_chest', 1, 1, 1], ['antidote', 1, 2, 2], ['gunpowder', 1, 4, 2]];
const BY_BIOME: Record<number, Entry[]> = {
  [BIOME_ID.tundra]: [['fur', 2, 5, 6], ['raw_mammoth', 1, 3, 4], ['fur_chest', 1, 1, 3], ['fur_head', 1, 1, 2], ['tusk', 1, 2, 3]],
  [BIOME_ID.desert]: [['gold_nugget', 3, 9, 6], ['cactus_fruit', 2, 6, 5], ['chiseled_sandstone', 4, 12, 3], ['clean_water', 2, 3, 4]],
  [BIOME_ID.jungle]: [['gold_ingot', 1, 4, 4], ['honey', 1, 3, 4], ['coconut', 2, 4, 3], ['medicine', 1, 1, 2]],
  [BIOME_ID.beach]: [['raw_fish', 2, 5, 5], ['coconut', 2, 5, 5], ['rope', 2, 4, 4], ['gold_nugget', 2, 6, 3]],
  [BIOME_ID.mountains]: [['iron_ingot', 2, 5, 5], ['bronze_ingot', 2, 4, 4], ['iron_head', 1, 1, 2]],
};
function pick(list: Entry[], r: () => number) {
  const tot = list.reduce((a, e) => a + e[3], 0); let x = r() * tot;
  for (const e of list) { if (x < e[3]) return e; x -= e[3]; }
  return list[0];
}
export function lootFor(x: number, y: number, z: number, biome: number, seed: number): [string, number][] {
  const r = mulberry32(Math.floor(hash3(x, y, z, seed + 4242) * 2 ** 31));
  const n = 3 + Math.floor(r() * 4), out = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const list = r() < 0.12 ? RARE : (BY_BIOME[biome] && r() < 0.4) ? BY_BIOME[biome] : COMMON;
    const [k, lo, hi] = pick(list, r);
    out.set(k, (out.get(k) ?? 0) + lo + Math.floor(r() * (hi - lo + 1)));
  }
  return [...out];
}
