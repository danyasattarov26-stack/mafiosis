# Changelog

All notable changes to Game Store Together. Versions follow semver; the save format has its own `SAVE_VERSION`.

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
