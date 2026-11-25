# Make Your Earth

A blocky planet you can shape however you like, in the browser. Wake up somewhere on an endless procedural Earth holding only an axe, then survive: chop, mine, craft, build, hunt, eat, drink and stay warm. Play alone or with up to four friends (5 players).

Live: https://make-your-earth.vercel.app

- **World:** 16×16×256 voxel chunks streamed around you; eight biomes (ocean, island beach, temperate forest, jungle, desert, savanna, tundra/ice age, mountains), rivers, caves, lava and ores.
- **Survival:** health, hunger, thirst, stamina, body temperature and sickness (raw meat, dirty water, cold). When you drop to 0 you're downed for 60 s and a friend can revive you. If nobody does, your things go into a grave only you can open, and you wake up as a new person somewhere else.
- **Content:** 85 blocks, 250 items, 173 recipes, 30 animal species. All of it is data in `src/shared`.
- **Devices:** keyboard and mouse, touch (joystick + buttons) and gamepad; English and European Portuguese.

## Controls

| Keyboard / mouse | Gamepad | Action |
|---|---|---|
| WASD | Left stick | Move |
| Mouse | Right stick | Look |
| Left click (hold) | RT | Hit / break |
| Right click | LT | Use, place, eat, drink, open a station |
| Space | A | Jump / swim up |
| Left Shift | Left stick press | Sprint |
| C | B | Crouch |
| E | Y | Inventory and crafting |
| M | Back | Map (click to add waypoints) |
| F | X | Eat / drink what you hold |
| Q | D-pad down | Drop one item |
| T | D-pad up | Chat (co-op) |
| 1–9, wheel | LB / RB | Hotbar |
| Esc | Start | Pause |

Keys can be rebound in Settings.

## Develop

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build && npx vite preview --port 4173 & node tests/smoke.mjs
FREESOUND_API_KEY=... npm run sounds   # re-download sounds (optional)
```

See ARCHITECTURE.md, DECISIONS.md, PROGRESS.md, QUESTIONS.md, MISSING_MODELS.md, PERFORMANCE.md and CREDITS.md.
