// Gem Blocks: shiny decorative blocks made from gems and crystal shards.
export default function (api) {
  api.addBlock({ key: 'ruby_block', en: 'Ruby Block', pt: 'Bloco de Rubi', top: { p: 'crystal', c: ['#b81a3a', '#ff6a8a'] }, recipe: { red_dye: 2, crystal_shard: 4 } });
  api.addBlock({ key: 'sapphire_block', en: 'Sapphire Block', pt: 'Bloco de Safira', top: { p: 'crystal', c: ['#1a3ab8', '#6a9aff'] }, recipe: { blue_dye: 2, crystal_shard: 4 } });
  api.addBlock({ key: 'amethyst_block', en: 'Amethyst Block', pt: 'Bloco de Ametista', top: { p: 'crystal', c: ['#6a2ab8', '#c08aff'] }, recipe: { crystal_shard: 6 } });
  api.addBlock({ key: 'crystal_bricks', en: 'Crystal Bricks', pt: 'Tijolos de Cristal', top: { p: 'brick', c: ['#b07af0', '#5a3a8a'] }, recipe: { crystal_shard: 2, stone_bricks: 2 }, n: 4 });
  api.addBlock({ key: 'gem_lamp', en: 'Gem Lamp', pt: 'Candeeiro de Gemas', top: { p: 'tiles', c: ['#f2e8ff', '#b07af0'] }, fn: 'light', recipe: { crystal_shard: 3, glass: 1, iron_nugget: 2 } });
}
