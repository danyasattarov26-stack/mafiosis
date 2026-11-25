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
