# Train Track Builder 3D

Build crazy train tracks in four worlds, hook carriages onto your engine, then ride them: grab the stars,
pull off loops and flips, beat your lap time, and don't take the bends too fast or the whole train flies off the rails.

**Play:** https://train-track-builder-3d.vercel.app

## How to play

1. Pick an engine (Steam Express, Freight Hauler, Blue Comet, Big Diesel, Little Shunter, Bullet Train, City Metro,
   Speedy Tram, Roller Coaster or Moon Shuttle) and hook on up to **12 carriages** in the carriage yard: coal, logs,
   tankers, containers, coaches, coaster seats, moon pods… Tap a carriage on your train to unhook it, or press **🎲 Surprise me**.
   Every carriage adds one to the points multiplier, but heavy trains speed up slower.
2. Pick a place to build:
   **Green Valley**, **Sunny Desert**, **Snowy Peaks** or the **Moon Base** (low gravity!).
3. Tap pieces to snap them onto the end of the track: straight, left, right, up, down, **loop**, **flip** (a full roll),
   **boost**, **spiral** up and spiral down. The yellow arrow shows where the next piece goes.
4. Bring the track back into the station to make a full circuit, or press **⭕ Finish loop** and the game builds the way home for you.
5. Press **▶ Drive!** Hold **GO** to speed up and **BRAKE** to stop or go backwards. Loops need speed: too slow and the train rolls back!
   Switch between the behind, driver and drone views with **🎥**.
6. Collect the ⭐ stars along the track. Loops, flips, spirals, 100 and 150 km/h and every lap of a full circuit give bonus points.
   Take a bend too fast and the screen goes red and the wheels squeal: brake, or the train derails! (Turn crashes off in the menu;
   the Roller Coaster never derails.)

Each world keeps its own track on your device.

| Computer | Phone / tablet |
|---|---|
| Build: keys **1–0** add pieces, **Backspace** undo, **F** finish loop, **Enter** drive, drag/scroll the camera | tap pieces, drag to look, pinch to zoom |
| Drive: **W / ↑** go, **S / ↓** brake & reverse, **C** camera, **Space** horn, **R** back to the station, **B** build, **Esc** pause | hold **GO** / **BRAKE**, buttons on top |

Controller (not tried on a real pad yet): right trigger go, left trigger brake & reverse, top button camera, left button horn,
Start pause; in menus the d-pad moves and the bottom button picks.

## Tech

Three.js + TypeScript + Vite, deployed on Vercel. Track pieces are little parametric curves (with banking, loops and rolls)
sampled every 25 cm; the train rides those samples with simple physics (engine, gravity along the slope, drag, brakes,
boosters). Everything snaps to a 4 m grid, so "Finish loop" is an A* search over grid positions, levels and headings.

- `src/track.ts` piece shapes, chaining, crash/underground checks
- `src/trackMesh.ts` rails, sleepers, pillars, station, buffer stops
- `src/autoroute.ts` the way back to the station
- `src/train.ts` engines, carriages, physics and derailing
- `src/fun.ts` stars, trick bonuses, laps and steam puffs
- `src/world.ts` regions, scenery, sky
- `src/main.ts` menus, build mode, driving, cameras

```bash
npm install
npm run dev
```

Models: Kenney (CC0) from Patch's asset library (train kit, coaster kit, space kit, platformer kit); see [CREDITS.md](CREDITS.md).
