# Performance

Measured in headless Chromium on a software GPU (SwiftShader) in a cloud container, so the fps numbers here are far below real hardware. Draw calls and triangles don't depend on the GPU.

| Measure | Result | Budget |
|---|---|---|
| Draw calls, Medium preset, standing in a forest | 25 | < 300 |
| Triangles on screen | ~97k | — |
| Initial download (JS + CSS, gzip) | ~330 KB | < 15 MB |
| Models (lazy, per species) | 100–220 KB each; characters ~1.5 MB (co-op only) | — |
| Chunk generation (worker) | ~5 ms per chunk | — |
| Chunk meshing incl. light (worker, warm) | ~16 ms per chunk | off the main thread |
| Network per player | ~1.5 KB/s position + ≤ 9 KB/s animal snapshots (host → guest) | < 15 KB/s |
| fps on real mid-range laptop / 3-year-old phone | **Not measured yet.** Needs a real device. | 60 / 30 |

**Load test:** with no game server (5-player browser-to-browser co-op, see DECISIONS.md #1), there is nothing to load-test with 1000 bots. A two-browser co-op test (host + guest) passed:
- both saw each other;
- a placed block and a chat message reached the guest;
- animals were mirrored to the guest.

**Device presets:** picked automatically on first launch.
- Desktops get Medium (High with 8+ cores).
- Phones get Low.
- Devices with 2 GB of memory or less get Potato with render distance 4.
