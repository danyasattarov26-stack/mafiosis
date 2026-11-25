# Architecture

The author's later instructions replace the original server plan: **5 players maximum, no voice chat, and no Supabase, LiveKit, Fly.io or Google login**. So there is no game server and no database. Everything runs in the players' browsers.

```
                         make-your-earth.vercel.app  (static files only)
                                     │  HTML, JS, models, sounds
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
        Host's browser          Guest browser          Guest browser   (up to 5 in total)
   ┌───────────────────┐   WebRTC data channels (direct, peer to peer)
   │ real world save   │◄────────────────────────────────────────────►
   │ animals (AI)      │   seed + block edits, positions, chat, animals
   │ localStorage      │
   └───────────────────┘
              ▲  first contact only
              │
     public Nostr relays (Trystero signalling: "who is in room ABC123?")
```

## Page side (`src/`)

| Folder | What it does |
|---|---|
| `shared/` | Data registries: blocks, items, recipes, biomes, animals. Add content here. |
| `world/` | Terrain generation (`gen.ts`), greedy mesher with baked light (`mesher.ts`), the Web Worker that runs both (`worker.ts`), and chunk streaming, ray casts and edits (`world.ts`). |
| `game/` | Player physics and survival (`player.ts`), inventory and crafting (`inventory.ts`), animals (`animals.ts`), input (`input.ts`), settings and presets (`settings.ts`), and the running world (`game.ts`). |
| `render/` | Procedural block textures and item icons (`textures.ts`) and the menu globe (`globe.ts`). |
| `ui/` | Menu (Play / Friends / Settings / Credits) and in-game HUD, inventory, crafting and map. |
| `net/` | Co-op rooms, friend codes, inbox invites and the chat filter (`coop.ts`); the session protocol (`session.ts`). |
| `audio/` | Effects and ambience from bundled Freesound files, with synthesised fallbacks. |
| `i18n/` | Every UI string in `en` and `pt-PT`. |
| `monetization/` | Feature flag only (hidden "Support the game" button). |

## Co-op protocol (all JSON over Trystero)

- **Joining:**
  1. The guest sends `hello`.
  2. The host answers with `welcome`, which carries the seed, every block edit, the time and graves, and a spawn point beside the host.
  3. If 5 players are already in, the host answers `full` instead.
- **Messages:**

  | Message | Sent by | When / content |
  |---|---|---|
  | `state` | Everyone | 10 Hz: position, look, animation, downed |
  | `block` | Anyone | On every edit |
  | `animals` | Host | 5 Hz snapshot |
  | `attack` → `give` | Guest → host | A guest hits an animal; the host applies it and sends back the drops |
  | `grave` | Anyone | Graves created or removed |
  | `time` | Host | Every 5 s: time of day and weather |
  | `revive` | The reviver | To the downed friend |
  | `chat` | Anyone | Text, filtered on both ends |
- **Friends:** each game has a 6-letter friend code and listens on an `inbox-<code>` room. Friends can ping you to see whether you're online, or send an invite to "spawn together".
- **Saves:** the host's world lives in its `localStorage` (`mye-world-<id>`). A guest keeps their own character for that world under `mye-guest-<id>`.
