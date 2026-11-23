# Crumple Zone

A soft-body driving and crash sandbox that runs in the browser, on computers and phones.

Every vehicle is a frame of point masses joined by beams that bend, stay bent and snap. Panels dent, glass shatters, lights break, bumpers tear off, wheels come off, tyres go flat and engines die. The body you see is stretched over that frame, so every dent is the real damage.

## Play

- **Hillside Valley**: free roam with hills, a town, a ring road, a dirt loop, a ramp park and AI traffic.
- **Crash Lab**: pick a target (wall, pole, barriers, tyre wall, ramps, offset wall, kerb, a parked bus, or a head-on with another car), pick a speed, and launch. There's slow motion and a 15 m drop test.
- **Ridge Raceway**: a circuit with 12 gates, a countdown, AI rivals and a saved best lap for each vehicle.

Vehicles: Vesper GT (light rear-drive coupe), Brutus 70 (V8 muscle car), City Bus (11 tonnes), Box Hauler (a top-heavy delivery truck) and Zephyr X (a white wedge supercar that flies).

## Flying (Zephyr X)

Press F (gamepad LB, or FLY on a phone) to switch the lift jets on. The car hovers and keeps itself level.

| Keyboard | Gamepad | Phone | Action |
|---|---|---|---|
| E / Q | D-pad up / down | ▲ / ▼ | Climb / descend |
| W / S | Triggers | GAS / BRAKE | Thrust forward / back |
| A / D | Left stick | ◀ ▶ | Turn |
| Shift | RB | 🚀 | Rocket boost (works on the ground too) |

Press F again to cut the jets and drop back to the ground.

## VR

On a headset with a WebXR browser (for example Meta Quest Browser, or a PC headset with Chrome or Edge), a 🥽 button appears. You sit in the driver's seat and see your own gloved hands.

- **Steering wheel:** squeeze the grip button near the rim to hold it, then turn it with one or both hands. Let go and it centres itself.
- **Pedals:** right trigger is the throttle, left trigger the brake.
- **Gear lever:** grab it and move it through the H-pattern: 1–2 on the left, then 3–4, then 5–6–7, and reverse is far right and forward.
- **Handbrake:** grab the lever beside the seat and pull it up. It springs back when you let go.
- **Left controller:** X recovers the car, Y switches between automatic and manual gearbox, and pressing the stick recentres your seat. The stick also steers if you'd rather not hold the wheel.
- **Right controller:** A turns the thrusters on (Zephyr X) or launches (Crash Lab), B is rocket boost, the stick climbs and descends, and pressing the stick takes you back to the start.

A small screen on the dashboard shows speed, gear, revs, engine health and messages.

The menu lets you change vehicle and colour, engine power, tyre grip and body toughness. You can also turn traction control and ABS on or off, set traffic and rivals, switch gravity between Earth, Mars and the Moon, park a car in front of you or drop yourself from 20 m.

## Controls

| Keyboard | Gamepad | Action |
|---|---|---|
| W / ↑ | RT | Throttle |
| S / ↓ | LT | Brake (hold at a stop to reverse) |
| A D / ← → | Left stick | Steer |
| Space | A | Handbrake |
| R | B | Recover: repair and set upright where you are |
| T | X | Back to the start (or the last race gate) |
| C | Y | Camera: chase, hood, cockpit, orbit |
| M | Back | Slow motion |
| L / Enter | RB | Launch (Crash Lab) |
| F | LB | Thrusters on/off (Zephyr X) |
| Esc | Start | Menu |

On phones, hold the phone sideways. Gas, brake and handbrake are on the right, steering on the left, and you can turn on tilt steering in Settings. Drag on the screen to look around.

## How it works

- `src/cars/specs.ts`: each vehicle is a row of cross-sections plus its axles, engine, gearbox and colours.
- `src/cars/build.ts`: turns a blueprint into nodes and beams, with:
  - wheels on swinging arms with springs tuned per axle;
  - bolt-on bumpers;
  - the beam groups behind glass, lights and engine damage.
- `src/sim/physics.ts`: the simulation, run 1200 times a second in a Web Worker (`src/sim/worker.ts`). It covers:
  - beams that dent and snap;
  - tyres with slip and a friction circle;
  - engine, gearbox, traction control and ABS;
  - ground and box contacts with sparks;
  - car-against-car collisions;
  - AI drivers.
- `src/sim/maps.ts`: the three maps, generated the same way for physics and drawing.
- `src/render/`: the skinned car bodies, effects (sparks, shards, smoke, skid marks) and the world.
- `src/main.ts`: menus, input, cameras, HUD, modes and sound (`src/game/`). All sound is synthesised.
- `src/game/vr.ts`: the VR seat, gloves, grabbing, gear lever, handbrake and dashboard screen.

## Develop

```
npm install
npm run dev
npm run build
```

Credits for the tree models are in [CREDITS.md](CREDITS.md). A picture of every model is in [docs/models.png](docs/models.png).
