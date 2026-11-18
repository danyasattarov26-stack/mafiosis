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

**Weapons:** pistol (6 shots) · rifle (3 shots that go through every enemy in a line) · katana (left click
swings and cuts bullets out of the air; in VR the blade cuts any bullet it touches and anyone you swing it
through) · bottles, glasses and fire extinguishers to throw (a bottle or glass stuns and shatters, an
extinguisher stuns for longer). Anything you hold can be thrown; a thrown katana kills. Some enemies carry rifles.

**Modes:** *Play the rooms* — five rooms, each ranked S / A / B / C on game time and missed shots, with an
online best-time leaderboard per room. *Gauntlet* — an endless arena where every wave is bigger, faster and
better armed; your kill count goes on its own leaderboard. Set your name on the start screen.

Five rooms: Corridor, Bar, Elevator lobby, Rooftop, Hall. Each one cleared plays back as a real-time replay
(Space to skip). Add `?debug=1` for fps, time scale and draw calls.

## Run

```
npm install
npm run dev      # or: npm run build && npm run preview
```

Vite + vanilla JS + three.js. No physics engine, no texture or audio files: sound is synthesised with WebAudio.

Leaderboards are a Vercel Function (`api/scores.js`) storing one JSON file per board in a private Vercel Blob
store (`BLOB_READ_WRITE_TOKEN`). Writes are ETag-checked so simultaneous posts can't overwrite each other.
Locally, `npm run dev` / `preview` serve the same handler with an in-memory store.

## Models

From [Patch](https://patch.gg)'s free asset library (credits in `public/models/CREDITS.md`):

- `public/models/enemy.glb` — "African man in a denim shirt and jeans" (MPFB human, rigged), textures removed and meshopt-compressed; recoloured red in game.
- `public/models/pistol.glb` — "Service Pistol" by Poly Haven, one of its two variants, textures removed and meshopt-compressed; recoloured black in game.
- `public/models/katana.glb` — "Antique Katana 01" by Tal Swicegood (Poly Haven), CC0.
- `public/models/rifle.glb` — "Bolt Action Rifle 7.62" by Mateusz Sadek (Poly Haven), CC0.
- `public/models/bottle.glb`, `glass.glb` — "Glass bottle" and "Drinking glass" by NVIDIA (SimReady), CC BY 4.0.
- `public/models/extinguisher.glb` — "Fire Extinguisher" by Polyfork, CC BY 4.0.

All at full triangle count; textures removed (everything is recoloured in game) and meshopt-compressed.
