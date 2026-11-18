# STANDSTILL

A first-person browser action game where **time moves only when you move**. White rooms, red crystal
gunmen who shatter, slow bullets you can see and step around, and one hit kills — you or them.

**Controls:** WASD move · mouse look · left click shoot (punch when empty-handed) · right click / E throw
your gun · F punch · walk over a dropped pistol to take it · R restart. Phones: left stick, drag to look,
FIRE / THROW / PUNCH. VR headsets get an "Enter VR" button (trigger fires, grip grabs, swing to punch).

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
