# Train Track Builder 3D

Build crazy train tracks in four worlds, then ride them from behind the train or from the front.

**Play:** https://train-track-builder-3d.vercel.app

## How to play

1. Pick a train (Steam Express, Freight Hauler or Speedy Tram) and a place to build:
   **Green Valley**, **Sunny Desert**, **Snowy Peaks** or the **Moon Base** (low gravity!).
2. Tap pieces to snap them onto the end of the track: straight, left, right, up, down, **loop**, **flip** (a full roll),
   **boost**, **spiral** up and spiral down. The yellow arrow shows where the next piece goes.
3. Bring the track back into the station to make a full circuit, or press **⭕ Finish loop** and the game builds the way home for you.
4. Press **▶ Drive!** Hold **GO** to speed up and **BRAKE** to stop or go backwards. Loops need speed: too slow and the train rolls back!
   Switch between the behind view and the front view with **🎥**.

Each world keeps its own track on your device.

| Computer | Phone / tablet |
|---|---|
| Build: keys **1–0** add pieces, **Backspace** undo, **F** finish loop, **Enter** drive, drag/scroll the camera | tap pieces, drag to look, pinch to zoom |
| Drive: **W / ↑** go, **S / ↓** brake & reverse, **C** camera, **Space** horn, **R** back to the station, **B** build | hold **GO** / **BRAKE**, buttons on top |

## Tech

Three.js + TypeScript + Vite, deployed on Vercel. Track pieces are little parametric curves (with banking, loops and rolls)
sampled every 25 cm; the train rides those samples with simple physics (engine, gravity along the slope, drag, brakes,
boosters). Everything snaps to a 4 m grid, so "Finish loop" is an A* search over grid positions, levels and headings.

- `src/track.ts` piece shapes, chaining, crash/underground checks
- `src/trackMesh.ts` rails, sleepers, pillars, station, buffer stops
- `src/autoroute.ts` the way back to the station
- `src/train.ts` train cars and physics
- `src/world.ts` regions, scenery, sky
- `src/main.ts` menus, build mode, driving, cameras

```bash
npm install
npm run dev
```

Models: Kenney (CC0) from Patch's asset library; see [CREDITS.md](CREDITS.md).
