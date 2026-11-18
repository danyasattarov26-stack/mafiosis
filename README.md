# STANDSTILL

A first-person browser action game where **time moves only when you move**. White rooms, red crystal
gunmen who shatter, slow bullets you can see and step around, and one hit kills — you or them.

**Controls:** WASD move · mouse look · left click shoot (punch when empty-handed) · right click / E throw
your gun · F punch · walk over a dropped pistol to take it · R restart. Phones: left stick, drag to look,
FIRE / THROW / PUNCH.

**Meta Quest 3 / 3S:** open the site in the Quest Browser and press **Enter VR**. Trigger fires the gun in
that hand · grip near a pistol grabs it, let go with a swing to throw, gently to drop · swing a fist fast
into an enemy to punch · left stick walks, right stick snap-turns · A / X (or trigger) restarts after a
death and skips replays. Time follows your head, hands and stick, so stand still and the room freezes.

Five rooms: Corridor, Bar, Elevator lobby, Rooftop, Hall. Each one cleared plays back as a real-time replay
(Space to skip). Add `?debug=1` for fps, time scale and draw calls.

## Run

```
npm install
npm run dev      # or: npm run build && npm run preview
```

Vite + vanilla JS + three.js. No physics engine, no texture or audio files: sound is synthesised with WebAudio.

## Models

Both from [Patch](https://patch.gg)'s free asset library, CC0 (credits in `public/models/CREDITS.md`):

- `public/models/enemy.glb` — "African man in a denim shirt and jeans" (MPFB human, rigged), textures removed and meshopt-compressed; recoloured red in game.
- `public/models/pistol.glb` — "Service Pistol" by Poly Haven, one of its two variants, textures removed and meshopt-compressed; recoloured black in game.
