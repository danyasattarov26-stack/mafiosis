# Decisions and simplifications

1. **No game servers, accounts, voice or database.** The author said: "5 players max, no voice chat, no supabase, no live kit, no fly.io and no Google. Just a simple game for me and my friends."
   - Co-op is browser to browser (WebRTC via Trystero/Nostr). One player hosts; the host's browser is the authority for the world and animals.
   - **Dropped as a result:** login, 5 server shards, the 1000-player load test, the server list with ping, voice chat, and the `/admin` web panel (it would have nothing to administer without a server).
   - **Safety:** the chat filter and name filter are on by default. Muting and blocking work inside the co-op session code, but there are **no buttons for them yet**, and reporting isn't built (there's no server to send reports to).
2. **Single Vite app, not a pnpm monorepo.** With no server there is no `apps/server`. Shared types and registries live in `src/shared`, so splitting them out later is straightforward.
3. **Player physics are custom, not Rapier.** A voxel world only needs box-vs-grid collisions, which are cheaper and more predictable written by hand. Rapier is still the plan for vehicles (M6).
4. **Block textures are drawn in code.** Every texture is painted from a small pattern recipe and the block's colours:
   - no copyrighted art;
   - one 512-tile atlas;
   - the Block Maker (M5) can append tiles to it at runtime.
5. **Block ids are bytes.** There are 85 built-in blocks, leaving about 170 ids for player-made blocks before chunks need 16-bit storage.
6. **Animals have no death animations.** The Polyfork models ship Idle, Walk and Run (Swim for sea animals). On death they tip over in code.
7. **Stand-ins for missing animals:** mammoth = elephant, tinted brown and scaled up; boar = pig, tinted dark; polar bear and arctic fox = bear and fox, tinted white. See MISSING_MODELS.md.
8. **Sounds are CC0 only.** This avoids attribution chains and any non-commercial licences, though every sound is still credited. Any missing file falls back to a short synthesised sound.
9. **Felled trees come down whole.** Chopping a trunk brings the logs above it down too, which is a bit more realistic than floating trees.
10. **The tundra is called "Tundra (Ice Age)"**, so mammoths there make sense.
11. **The admin panel is in the game, not at `/admin`.** With no server, the world owner is in charge:
    - It opens with F2 or from the pause menu, for single player or the co-op host.
    - Bans are by player name and saved with the world.
    - Guests can't open it.
12. **What Block Maker functions do:**
    - **Door:** a block you can walk through.
    - **Ladder:** climbable, drawn like a ladder.
    - **Conveyor:** always carries you east.
    - **Storage:** opens the crafting panel. Chests don't hold items yet.
    - **Explosive:** lit with a fire starter or torch; goes off after 2.5 s, radius 3.
13. **Custom blocks belong to each world.** A world saves its own list, because block numbers are stored in the terrain. Your library is added to worlds you own. In co-op the host assigns numbers and shares the list; guests' new blocks go through the host. Up to about 100 custom blocks fit per world. There's no "promote to global" without a server.
14. **Structures sit on a 144-block grid and depend only on the seed.** About 55% of grid cells with a suitable biome get one. Old chests become normal chests once looted, so loot is taken only once, also in co-op.
15. **New built-in blocks push custom block numbers up.** Worlds remember how many built-in blocks existed when they were saved and move player-made block numbers up when more built-ins arrive, so old worlds keep their custom blocks. About 100 custom blocks still fit per world.
16. **Monsters follow light, not just time.** They spawn on the surface at night and in caves at any time, but never within about 7 blocks of a torch, lantern, fire, lava or glowing crystal. Zombies and skeletons burn under open sky in the day; spiders turn calm in sunlight unless you hit them.
17. **Shields work without an extra button.** A shield in the off hand stops part of any hit from the front (55% wood, 80% iron); crouching stops all of it. This keeps phone controls simple.
18. **The furnace takes over smelting.** Things that used to smelt instantly at a nearby furnace now go into the furnace and take a few seconds each, with fuel. Cement and floor tiles moved to the workbench because they mix several ingredients.
19. **Crops grow on game time**, about 100 game seconds per stage (three stages), and only while their chunk is loaded on the host. Bone meal (white dye) skips a stage.
20. **The host owns pets and saddled animals.** They're saved with the host's world. A friend's tamed pet follows that friend for the session; a friend riding a horse steers it, and the host moves it for everyone.
21. **Giant spiders are made in code.** Patch's library had no light, animated spider; the procedural one has eight jointed legs that scuttle.
22. **Monster voices are synthesised** (groans, rattles, hisses), because the library had no CC0 creature sounds; hits, doors, chests, shields and the bow use Kenney's CC0 sounds.
23. **Crafting is a grid, but recipes have no shapes.** What matters is which items are in the grid and how many (or a whole multiple). It feels like laying out ingredients without memorising patterns, and every existing recipe still works. When several recipes fit, the one that uses everything in the grid in one go comes first, and ⟳ cycles the rest.
24. **The admin panel has no visible way in.** F2 three times (or five taps on the coordinates on a phone), then a PIN chosen the first time. The PIN is a salted SHA-256 hash in that device's storage. There's no PIN reset: clearing the site's data on that device sets a new one. Guests can never open it.
25. **Mods are files on the game's own website.** Without a server, "only the owner can publish" means only someone who can deploy the site can add a file to `public/mods/`. Players only switch mods on or off. The owner can test a mod file on their own device from the admin panel first.
26. **Mod blocks become the world's custom blocks**, so their numbers are saved with the world and shared in co-op the same way as Block Maker blocks. Mod items and recipes are added at page load; items from a mod that's switched off are set aside in the inventory, not deleted.
27. **Painted blocks with any see-through pixel count as transparent**, so the blocks next to them are still drawn.
28. **New biomes come from a "rare" noise inside the common ones**: canyons inside deserts and savannas, volcanic fields in some mountains, swamps in low wet ground, taiga in the cold edge of forests, autumn forests in patches of forest. New characters never start in volcanic fields.
