/*
  Smoke test: menu → new world → spawned and playing, with no page errors.
  Usage: npm run build && npx vite preview --port 4173 &  then  node tests/smoke.mjs [url]
  Needs Playwright with Chromium available (require('playwright')).
*/
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:4173/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/WebSocket|relay|nostr/i.test(m.text())) errors.push(m.text()); });
await p.goto(URL);
await p.waitForSelector('#menu nav button', { timeout: 30000 });
await p.click('[data-tab=friends]'); await p.click('[data-tab=play]');
await p.fill('.wseed', '1'); await p.click('[data-new=single]');
let ready = false;
for (let i = 0; i < 60 && !ready; i++) { await p.waitForTimeout(1000); ready = await p.evaluate(() => !!window.__mye.game?.ready); }
await p.waitForTimeout(3000);
const info = await p.evaluate(() => { const m = window.__mye; return { calls: m.renderer.info.render.calls, triangles: m.renderer.info.render.triangles, chunks: m.game.world.chunks.size, preset: m.settings.preset }; });
await b.close();
console.log(JSON.stringify({ ready, ...info, errors }));
if (!ready || errors.length) process.exit(1);
