/*
  The story of the world, so there's something to do besides wander:
    1. Craft a Star Compass. It points to the nearest place a Starstone is kept.
    2. Find the four Starstones in the ancient vaults: ember (volcanic altars), frost (igloos),
       verdant (jungle temples) and tide (shipwrecks).
    3. Build the Skyward Beacon from them and light it: a column of light rises. Step in to be lifted
       above the clouds to the Sky Isles.
    4. Ring the four Sky Bells on the outer islands.
    5. The Sky Colossus wakes in the arena. Defeat it for the World Seed.
    6. Bring the seed home and plant it in your Beacon: the ending.
*/
import { VAULTS, CELL } from '../world/structures';
import type { TerrainGen } from '../world/gen';

export const STARSTONES = ['starstone_ember', 'starstone_frost', 'starstone_verdant', 'starstone_tide'];
export interface QuestData { beacon: [number, number, number] | null; visited: boolean; bells: number[]; colossus: boolean; ended: boolean; kills: number; deaths: number }
export const newQuest = (): QuestData => ({ beacon: null, visited: false, bells: [], colossus: false, ended: false, kills: 0, deaths: 0 });

export type Step = 'compass' | 'stones' | 'beacon' | 'sky' | 'bells' | 'colossus' | 'plant' | 'done';
export interface Progress { step: Step; stones: string[]; done: Record<Step, boolean> }

/** where the story is, from the world's record and what you carry */
export function progress(q: QuestData, has: (k: string) => boolean): Progress {
  const stones = STARSTONES.filter(s => has(s) || !!q.beacon);
  const done: Record<Step, boolean> = {
    compass: has('star_compass') || stones.length > 0 || !!q.beacon,
    stones: stones.length === 4,
    beacon: !!q.beacon || q.visited,
    sky: q.visited,
    bells: q.bells.length >= 4,
    colossus: q.colossus,
    plant: q.ended,
    done: q.ended,
  };
  const order: Step[] = ['compass', 'stones', 'beacon', 'sky', 'bells', 'colossus', 'plant'];
  const step = order.find(s => !done[s]) ?? 'done';
  return { step, stones, done };
}

/** the nearest structure whose vault holds a Starstone you still need */
export function nearestVault(gen: TerrainGen, px: number, pz: number, need: Set<string>, radius = 24) {
  let best: { x: number; z: number; item: string; d: number } | null = null;
  const gx0 = Math.floor(px / CELL), gz0 = Math.floor(pz / CELL);
  for (let r = 0; r <= radius; r++) {
    for (let gz = gz0 - r; gz <= gz0 + r; gz++) for (let gx = gx0 - r; gx <= gx0 + r; gx++) {
      if (Math.max(Math.abs(gx - gx0), Math.abs(gz - gz0)) !== r) continue;
      const site = gen.site(gx, gz); if (!site) continue;
      for (const p of site.parts) {
        const item = VAULTS[p.kind]; if (!item || !need.has(item)) continue;
        const d = Math.hypot(p.x - px, p.z - pz);
        if (!best || d < best.d) best = { x: p.x, z: p.z, item, d };
      }
    }
    if (best && best.d < (r - 1) * CELL) break;     // nothing closer can be further out
  }
  return best;
}
