// Starter Kit: every new life starts with a few useful things.
export default function (api) {
  api.on('newLife', game => {
    for (const [k, n] of [['bread', 3], ['torch', 8], ['wooden_sword', 1], ['clean_water', 1], ['bandage', 2]]) game.give(k, n);
    game.toast(api.lang() === 'pt-PT' ? '🎒 Kit inicial recebido' : '🎒 Starter kit received', 'good');
  });
}
