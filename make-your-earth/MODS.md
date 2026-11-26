# Mods

Mods are small JavaScript files that add things to Make Your Earth: items, foods, blocks and recipes, or
little behaviours that react to the game (when you break a block, start a new life, every frame…).

## Who can do what

- **Players** open the **Mods** tab in the main menu and switch official mods on or off. The page reloads
  to apply the change. That's all they can do: they can't add mods.
- **The owner** (you) publishes mods by adding them to this repository and redeploying. Only someone who
  can push to the repository and deploy the site can do that.
- **Trying a mod first:** open the admin panel (see README) and use **Install a mod file (.js)**. It runs on
  that device only, so you can test it before anyone else sees it.

## Publishing a mod

1. Put the file in `public/mods/`, for example `public/mods/rainbow-wool.js`.
2. Add an entry to `public/mods/index.json`:
   ```json
   { "id": "rainbow-wool", "name": "Rainbow Wool", "pt": "Lã Arco-Íris",
     "description": "…", "descPt": "…", "version": "1.0.0", "author": "…", "file": "rainbow-wool.js" }
   ```
3. Commit, push and deploy. Players see it in the Mods tab within a few minutes.

To change a mod later, edit the file and raise its `version`.

## Making a mod with Claude

Ask Claude something like:

> Write a Make Your Earth mod (read MODS.md in the repo) that adds a "Honey Lamp" block that glows, made
> from honey and glass at the workbench, and gives the player 3 honey when they start a new life.

Then try the file with **Install a mod file** in the admin panel, and publish it as above when it works.

## How a mod looks

A mod is an ES module whose default export is a function. The game calls it once, when the page loads,
with an `api` object:

```js
export default function (api) {
  api.addItem({ key: 'pancake', en: 'Pancake', pt: 'Panqueca', kind: 'food', color: '#e8c070', icon: 'bread', food: { hunger: 20 } });
  api.addRecipe('pancake', 2, { flour: 1, honey: 1 }, 'campfire');
  api.on('newLife', game => game.give('pancake', 2));
}
```

## The API

| Call | What it does |
|---|---|
| `api.addItem(def)` | Adds an item. `key` (3–24 lowercase letters, digits or `_`), `en`, `pt`, `kind` (`food`, `drink`, `medicine`, `material`, `tool`, `weapon`, `misc`), `color`, `color2`, `icon`, `stack`, and for food `food: { hunger, thirst, health, sick, cure, warm }`. Tools: `tool: { type, tier, durability, speed, damage }`. |
| `api.addRecipe(out, n, ingredients, station)` | `ingredients` is `{ itemKey: count }`; use `"#planks"`, `"#log"`, `"#raw_meat"` or `"#cooked_meat"` for any of a kind. `station` is `hand`, `workbench`, `furnace`, `campfire`, `anvil` or `lab`. Furnace recipes need a single ingredient. |
| `api.addBlock(def)` | Adds a block, painted from a pattern: `key`, `en`, `pt`, `top: { p, c }`, optional `side`, `bottom`, `fn` (`solid`, `light`, `glass`, `door`, `ladder`, `conveyor`, `flammable`, `explosive`, `storage`), `recipe`, `at`, `n`. Returns the block's item key (`cb_…`). |
| `api.on(event, fn)` | `start` (a world opened), `tick` (every frame: `fn(game, dt)`), `blockBreak` (`{ x, y, z, key, tool }`), `newLife` (a new character), `kill` (an animal or monster died: `{ key, x, y, z }`). |
| `api.lang()` | `"en"` or `"pt-PT"`. |
| `api.THREE` | The three.js library, for effects. |

Block patterns (`p`): `noise`, `stone`, `cobble`, `brick`, `planks`, `log`, `logTop`, `leaves`, `glass`, `stained`,
`metal`, `concrete`, `polished`, `crystal`, `tiles`, `wool`, `clay`, `strata`, `crate`, `barrel`, `moss`, `pumpkin`.
`c` is a list of two colours, for example `["#b81a3a", "#ff6a8a"]`.

Item icons (`icon`): `meat`, `fish`, `fruit`, `berries`, `bread`, `pie`, `bowl`, `bottle`, `mushroom`, `carrot`,
`ingot`, `nugget`, `gem`, `rock`, `powder`, `coin`, `ball`, `jar`, `herb`, `bone`, `feather`, `stick`, `rope`,
`paper`, `book`, `box`, `dye`, `shield`, `bow`, `arrow`, and the tool shapes `axe`, `pickaxe`, `shovel`, `sword`,
`hoe`, `knife`, `spear`, `hammer`.

Useful things on `game` inside events:

- `game.give(key, n)` puts items in the player's bags.
- `game.toast(text, 'good' | 'bad')` shows a message.
- `game.player.pos` is the player's position, and `game.player.stats` holds `health`, `hunger`, `thirst`, `stamina`, `temp` and `sick`.
- `game.world.get(x, y, z)` and `game.world.set(x, y, z, id)` read and change blocks.
- `game.spray(pos, [r, g, b], count)` throws particles.
- `game.sunLevel` goes from 0 (night) to 1 (day), and `game.time` is the time of day.
- `game.scene` is the three.js scene, if you want to add your own objects to it.

## Rules

- Blocks from mods join each world as that world's own custom blocks. They stay in the world even if the
  mod is switched off later. Up to about 100 custom blocks fit in one world.
- Items from a mod that's been switched off are set aside in your inventory and come back when it's on again.
- A mod that throws an error is stopped and a message says so; the game keeps running.
- In co-op, everyone should switch on the same mods. Joining a host with mods you don't have shows a reminder.
- Mods run with full access to the page, which is why only the owner publishes them.
