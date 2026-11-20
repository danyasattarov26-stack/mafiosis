# Changelog

All notable changes to Game Store Together. Versions follow semver; the save format has its own `SAVE_VERSION`.

## [1.2.0] — 2026-11-20

### New stations
- **Retro PC** (level 1): a beige desktop case and a chunky CRT. Cheap; kids and casual players love it.
- **Streamer Pod** (level 3): a soundproof booth with acoustic foam, a ring light, mic, webcam and an **ON AIR** sign that
  lights up when someone goes live. New **Streamer** customers stream there, shout at chat and bring their viewers in.
- **Sim Racing Rig** (level 4): bucket seat, a wheel that turns while they drive, pedals and three screens.
- **VR Station** (level 5): a glowing play mat, tracking towers and a spectator screen. Players wear a headset and flail.

### Snack Bar
- New **Snack Bar** (level 2, Retail License) with a microwave, coffee and slushie machines and a pizza display.
- Customers line up and order pizza, noodles or slushies; hold **E** to make the order, or hire the new **Cook**.
- Stock it with **Food Supplies**; restockers keep it filled.

### Regulars & memberships
- Eight named regulars with their own looks, favourite items and wishes, shown with a name tag in the shop.
- Hearts grow with happy visits: 3 hearts buys a **VIP membership** (+$40; VIPs visit more and tip every session),
  5 hearts brings a gift. Friendly troublemakers stop causing trouble. New **Regulars** tab on the laptop.

### Daily goals & achievements
- Three daily goals every morning with cash and XP rewards, a bonus for finishing all three, and a tracker on the HUD.
- 23 achievements in the new **Goals** tab.

### Also
- Day summary lists Snack Bar, VIP memberships and goal rewards; stats show snacks and streams.
- Save format v4 (old saves upgrade automatically).

## [1.1.0] — 2026-11-20

### Online without Supabase
- Accounts, friends and cloud saves can now live in a **Vercel Blob** store (used on the live site).
- Co-op, friends' online status and invites go **peer-to-peer** (WebRTC via Trystero) when Supabase Realtime isn't set up.
- Joining keeps knocking until the host's connection opens; cloud saves every 5 minutes (plus end of day and on leaving).

## [1.0.0] — 2026-11-19

First playable release.

### Gameplay
- First-person shop with a starter gaming laptop, the manager laptop and $100.
- Gaming floor: laptop, Bronze/Silver/RGB Beast PCs, two console couches, arcade cabinet, pinball, claw and dance machines.
- Station upgrades: 3 monitors, 3 gaming chairs, 2 desks, installed straight onto stations.
- Store: checkout counter (scan, card, cash with change), wall and island shelves, drinks fridge, 10 products with pricing.
- Delivery boxes: carry, drop, stack, unbox, restock, bin empty boxes.
- Inventory with a rotating 3D preview; placement with a ghost, grid snapping, rotation, green/red validity, move, pick up and sell back for 50%.
- Five customer types with their own behaviour, including thieves you can catch.
- Satisfaction, reviews and a star rating that drives foot traffic.
- Staff: cleaner, cashier, restocker and technician, with salaries.
- Upkeep: trash, spills, breakdowns, rent, electricity.
- Levels, XP, unlocks, 5 licenses, 12 perks, 5 shop sizes, 5 floors, 5 walls, 4 lighting styles, a custom shop sign.
- Day/night cycle (08:00–22:00) with a door sign and an end-of-day summary.
- City with traffic and signals, pedestrians, street lights, and friends' shops on the neighbouring buildings.

### Online
- Accounts with username + friend code (no passwords) and a recovery code for other devices.
- Cloud saves (the newest of local and cloud wins), friends list, invites, live co-op visits for up to 4 players, read-only visits when a friend is offline.
- Host-authoritative co-op over Supabase Realtime (BroadcastChannel fallback between local tabs).

### Tech
- Three.js r187 + TypeScript + Vite on Vercel; Supabase Postgres + Realtime.
- Data-driven content (`src/config`), versioned saves with migrations (v3), automatic database migrations on deploy.
- Quality presets (Low → Ultra) with render distance; phones default to Low.
- Debug panel (`?debug=1` / F3).
