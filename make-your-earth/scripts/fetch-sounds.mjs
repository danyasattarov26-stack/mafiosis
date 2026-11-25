/*
  Downloads the game's sound effects from Freesound once, at build/dev time (never at runtime).
  Only CC0 (public domain) sounds are used, so there are no attribution or non-commercial strings attached;
  each one is still credited in public/sounds/credits.json and CREDITS.md.
  Usage: FREESOUND_API_KEY=... node scripts/fetch-sounds.mjs [--force]
*/
import fs from 'fs';
import path from 'path';

const KEY = process.env.FREESOUND_API_KEY;
if (!KEY) { console.error('Set FREESOUND_API_KEY (see .env.example). The game falls back to synthesised sounds without these files.'); process.exit(1); }
const OUT = path.resolve('public/sounds');
fs.mkdirSync(OUT, { recursive: true });
const force = process.argv.includes('--force');

// name → [search words, min seconds, max seconds]
const WANT = {
  chop: ['axe chopping wood', 0.2, 2.5], mine: ['pickaxe stone hit', 0.1, 2], dig: ['shovel dirt dig', 0.2, 2],
  place: ['wood knock', 0.05, 1.2], break: ['rock crumble break', 0.2, 2.5], wood_break: ['wood crack break', 0.2, 2.5],
  step_grass: ['footstep grass', 0.1, 1], step_stone: ['footstep stone', 0.1, 1], step_sand: ['footstep sand', 0.1, 1.2], step_snow: ['footstep snow', 0.1, 1.2],
  splash: ['water splash', 0.2, 2.5], eat: ['eating crunch apple', 0.2, 2.5], drink: ['drinking gulp', 0.2, 2.5],
  hurt: ['man grunt pain', 0.1, 1.5], death: ['body fall thud', 0.2, 2.5], pickup: ['pop pickup', 0.05, 0.8],
  click: ['ui click button', 0.02, 0.5], craft: ['hammer anvil', 0.1, 2], swing: ['whoosh swing', 0.1, 1],
  fire: ['campfire crackle', 4, 20], rain: ['rain falling ambience', 6, 25], wind: ['wind ambience loop', 6, 25], birds: ['forest birds ambience', 6, 25],
  night: ['crickets', 6, 25], ocean: ['ocean waves beach', 6, 25], thunder: ['thunder', 2, 10], discover: ['magic chime success', 0.3, 3],
  wolf: ['wolf howl', 1, 6], bear: ['bear roar', 0.5, 5], boar: ['pig grunt', 0.3, 3], cow: ['cow moo', 0.5, 4], sheep: ['sheep bleat', 0.3, 3],
  chicken: ['chicken cluck', 0.3, 3], lion: ['lion roar', 0.5, 5], horse: ['horse neigh', 0.5, 4], frog: ['frog croak', 0.2, 3], parrot: ['parrot squawk', 0.2, 3],
  elephant: ['elephant trumpet', 0.5, 5], deer: ['deer call', 0.3, 4], owl: ['owl hoot', 0.3, 4], seagull: ['seagull', 0.3, 4],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Freesound refuses bursts of requests: go slowly and retry a few times
const api = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { Authorization: `Token ${KEY}` } });
    if (r.ok) return r.json();
    if (r.status !== 403 && r.status !== 429) throw new Error(`${r.status}`);
    await sleep(4000 * (i + 1));
  }
  throw new Error('rate limited');
};
const redo = new Set(process.argv.slice(2).filter(a => !a.startsWith('--')));
const credits = fs.existsSync(path.join(OUT, 'credits.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'credits.json'), 'utf8')) : {};
for (const [name, [q, lo, hi]] of Object.entries(WANT)) {
  const file = path.join(OUT, `${name}.mp3`);
  if (!force && !redo.has(name) && fs.existsSync(file) && credits[name]) continue;
  await sleep(1500);
  const filter = encodeURIComponent(`license:"Creative Commons 0" duration:[${lo} TO ${hi}]`);
  const url = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&filter=${filter}&sort=score&page_size=5&fields=id,name,username,license,duration,previews,url`;
  try {
    const res = await api(url);
    const hit = res.results?.[0];
    if (!hit) { console.warn(`no CC0 result for ${name} (“${q}”)`); continue; }
    const audio = await fetch(hit.previews['preview-hq-mp3']);
    if (!audio.ok) throw new Error(`download ${audio.status}`);
    fs.writeFileSync(file, Buffer.from(await audio.arrayBuffer()));
    credits[name] = { id: hit.id, title: hit.name, author: hit.username, license: 'CC0 1.0', url: hit.url, seconds: +hit.duration.toFixed(1) };
    console.log(`${name.padEnd(12)} ← #${hit.id} “${hit.name}” by ${hit.username} (${hit.duration.toFixed(1)} s)`);
  } catch (e) { console.warn(`failed ${name}: ${e.message}`); }
}
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1));
