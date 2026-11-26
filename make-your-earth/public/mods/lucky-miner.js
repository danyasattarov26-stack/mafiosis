// Lucky Miner: ore sometimes drops a bonus, with a little sparkle.
const BONUS = { coal_ore: 'coal', copper_ore: 'raw_copper', tin_ore: 'raw_tin', iron_ore: 'raw_iron', gold_ore: 'raw_gold', sulfur_ore: 'sulfur', diamond_ore: 'diamond', glow_crystal: 'crystal_shard' };
export default function (api) {
  api.on('blockBreak', (game, b) => {
    const drop = BONUS[b.key];
    if (!drop || Math.random() > 0.2) return;
    game.give(drop, 1);
    game.spray(new api.THREE.Vector3(b.x + 0.5, b.y + 0.5, b.z + 0.5), [1, 0.9, 0.3], 16);
    game.toast(api.lang() === 'pt-PT' ? '✨ Sorte! +1' : '✨ Lucky! +1', 'good');
  });
}
