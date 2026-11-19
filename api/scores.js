/*
  Leaderboards for STANDSTILL.
    GET  /api/scores?board=room1            → { board, top: [{ name, value }], count }
    POST /api/scores { board, name, value } → { board, top, count, rank, best }
  Rooms rank by fastest game-time seconds; the gauntlet ranks by most kills. Each name keeps only its best.
  Scores live in one private Vercel Blob file per board, updated with ETag-checked writes so two players
  posting at once can't overwrite each other. Without a BLOB_READ_WRITE_TOKEN (local dev) it keeps them in memory.
*/
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

export const BOARDS = {
  room1: 'asc', room2: 'asc', room3: 'asc', room4: 'asc', room5: 'asc', room6: 'asc', room7: 'asc', room8: 'asc', gauntlet: 'desc',
};
const KEEP = 100, SHOW = 10;

export const cleanName = n => String(n ?? '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12) || 'ANON';

export function validValue(board, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return BOARDS[board] === 'asc' ? v >= 0.5 && v <= 3600 : Number.isInteger(v) && v >= 0 && v <= 100000;
}

/** Insert or improve a name's entry; returns the new sorted list. */
export function insert(list, board, name, value) {
  const asc = BOARDS[board] === 'asc', better = (a, b) => (asc ? a < b : a > b);
  const old = list.find(e => e.name === name);
  if (old) { if (better(value, old.value)) { old.value = value; old.at = Date.now(); } }
  else list.push({ name, value, at: Date.now() });
  list.sort((a, b) => (asc ? a.value - b.value : b.value - a.value) || a.at - b.at);
  return list.slice(0, KEEP);
}

// ---------- storage ----------
const memory = new Map();
const store = process.env.BLOB_READ_WRITE_TOKEN ? {
  async read(board) {
    const r = await get(`scores/${board}.json`, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return { list: [], etag: null };
    return { list: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
  },
  async write(board, list, etag) {
    await put(`scores/${board}.json`, JSON.stringify(list), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false,
      allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}),
    });
  },
} : {
  async read(board) { return { list: structuredClone(memory.get(board) || []), etag: 'mem' }; },
  async write(board, list) { memory.set(board, list); },
};

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const view = (board, list) => ({ board, top: list.slice(0, SHOW).map(({ name, value }) => ({ name, value })), count: list.length });

export async function GET(request) {
  const board = new URL(request.url).searchParams.get('board');
  if (!BOARDS[board]) return json({ error: 'unknown board' }, 400);
  try { const { list } = await store.read(board); return json(view(board, list)); }
  catch (e) { return json({ error: 'storage unavailable' }, 503); }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const board = body && body.board, name = cleanName(body && body.name), value = body && body.value;
  if (!BOARDS[board]) return json({ error: 'unknown board' }, 400);
  if (!validValue(board, value)) return json({ error: 'bad value' }, 400);
  const v = BOARDS[board] === 'asc' ? Math.round(value * 100) / 100 : value;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { list, etag } = await store.read(board);
      const next = insert(list, board, name, v);
      await store.write(board, next, etag);
      const i = next.findIndex(e => e.name === name);
      return json({ ...view(board, next), rank: i >= 0 ? i + 1 : null, best: i >= 0 ? next[i].value : v });
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError || /precondition|already exists/i.test(e && e.message)) continue; // someone wrote first: retry
      return json({ error: 'storage unavailable' }, 503);
    }
  }
  return json({ error: 'busy, try again' }, 503);
}
