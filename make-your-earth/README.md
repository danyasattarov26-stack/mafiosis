# Make Your Earth

A blocky planet you can shape however you like, in the browser. Wake up somewhere on an endless procedural Earth holding only an axe, then survive: chop, mine, craft, build, hunt, eat, drink and stay warm. Play alone or with up to four friends (5 players).

Live: https://make-your-earth.vercel.app

- **World:** 16×16×256 voxel chunks streamed around you; eight biomes (ocean, island beach, temperate forest, jungle, desert, savanna, tundra/ice age, mountains), rivers, caves, lava and ores.
- **Survival:** health, hunger, thirst, stamina, body temperature and sickness (raw meat, dirty water, cold). When you drop to 0 you're downed for 60 s and a friend can revive you. If nobody does, your things go into a grave only you can open, and you wake up as a new person somewhere else.
- **Content:** 92 built-in blocks, 257 items, 180 recipes, 30 animal species. All of it is data in `src/shared`.
- **Building:**
  - **Blueprints:** use a sheet of blueprint paper at the blueprint table. The ready-made plans are a hut, log cabin, house, watchtower and nuclear bunker, or save your own build by marking two corners. A see-through ghost shows where it goes; it then builds itself from your inventory.
  - **Block Maker (B):** paint all six faces of a new block, choose what it does, and give it a recipe.
- **Structures in the world:** villages (houses, smithy, well, farm), cabins, watchtowers, desert pyramids and wells, jungle temples, igloos and mammoth-hunter camps, beach huts, shipwrecks and old ruins. Old chests inside hold loot the first time someone opens them.
- **Admin panel (F2, world owner):**
  - kick, ban or mute players, go to them or bring them to you, see their inventory;
  - give anyone items;
  - set the time and weather, message everyone, heal yourself, god mode.
- **Devices:** keyboard and mouse, touch (joystick + buttons) and gamepad; English and European Portuguese.

## Controls

| Keyboard / mouse | Gamepad | Action |
|---|---|---|
| WASD | Left stick | Move |
| Mouse | Right stick | Look |
| Left click (hold) | RT | Hit / break |
| Right click | LT | Use, place, eat, drink, open a station or chest, shoot a bow, open a door, sleep, tame, saddle or ride |
| Space | A | Jump / swim up |
| Left Shift | Left stick press | Sprint |
| C | B | Crouch (raises your shield; gets you off a horse) |
| E | Y | Inventory and crafting |
| M | Back | Map (click to add waypoints) |
| F | X | Eat / drink what you hold |
| Q | D-pad down | Drop one item |
| T | D-pad up | Chat (co-op) |
| 1–9, wheel | LB / RB | Hotbar |
| B | — | Block Maker (stand next to a Designer's Bench) |
| R | — | Rotate a blueprint while placing it |
| Esc | Start | Pause / cancel a blueprint |

Keys can be rebound in Settings.

## Crafting

Open your bags (E). Put items in the crafting grid (2×2 by hand, 3×3 next to a workbench or another station)
and the result appears on the right: tap it to craft, Shift-click to craft as many as fit. When the same items
fit more than one recipe (four planks: sticks or a workbench), ⟳ switches between them. The recipe book below
the grid fills the grid for you from your bags.

The **Block Maker** needs a **Designer's Bench** (made at a workbench from a workbench, red, blue and yellow dye
and paper). Use the bench, or press B next to it.

## Admin panel (world owner only)

There's no button for it. Press **F2 three times quickly**, or on a phone **tap the coordinates in the top-left
corner five times**. The first time you choose a PIN (4–12 digits); after that the PIN is needed every time.
It's stored on that device only. Friends who join your world can't open it.

The panel has an item picker (search, categories, icons), time and weather, players (kick, ban, mute, teleport,
give, look at inventory), god mode, and **Mods on this device** for trying a mod before you publish it.

## Mods

Players switch official mods on and off in the **Mods** tab of the main menu. Five come with the game:
Fireflies, Tasty Foods, Gem Blocks, Starter Kit and Lucky Miner. Only the owner publishes new mods, by adding
them to `public/mods/` and redeploying. See [MODS.md](MODS.md) for how to write one (or ask Claude to).

## Survival tips

- **Monsters** come out at night and in dark caves: zombies, skeleton archers, skeleton warriors, giant spiders, cave spiders and cave beasts. Torches and lanterns stop them spawning nearby; zombies and skeletons burn at sunrise. Bandits roam by day and carry coins.
- **Shields** go in the off-hand slot (next to your armour). They stop part of a hit from the front; crouch to block it all.
- **Bow:** hold it and right-click; you need arrows.
- **Farming:** a hoe turns dirt or grass into farmland; plant seeds, carrots or potatoes on it. Crops grow in three stages; white dye (bone meal) speeds them up.
- **Pets and riding:** give a wolf a bone (it may take a few) and it becomes your dog; wild cats like raw fish. Put a saddle on a horse, camel or zebra, then right-click to ride.
- **Beds** set where your next life starts and skip the night (if no monsters are close).
- **Chests** store 27 stacks. **Furnaces** smelt with fuel: put ore, sand, logs or raw food on top and coal, charcoal, wood or sticks underneath.

## Develop

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build && npx vite preview --port 4173 & node tests/smoke.mjs
FREESOUND_API_KEY=... npm run sounds   # re-download sounds (optional)
```

See ARCHITECTURE.md, DECISIONS.md, PROGRESS.md, QUESTIONS.md, MISSING_MODELS.md, PERFORMANCE.md and CREDITS.md.
