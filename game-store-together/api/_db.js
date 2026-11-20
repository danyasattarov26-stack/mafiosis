/*
  Data layer for Game Store Together.
  - With a Vercel Blob store (BLOB_READ_WRITE_TOKEN) and no Postgres, it keeps accounts, friends and saves as
    small private JSON files. Presence and invites then travel peer-to-peer, so the store is only touched for
    sign-in, profile changes, friends and saves.
  - With a Postgres URL (Supabase via the Vercel integration sets POSTGRES_URL / POSTGRES_URL_NON_POOLING)
    it uses the gst_* tables, created and upgraded by the migrations below.
  - Without one, local dev uses an in-memory store so everything still works on your machine.
  Tables have row-level security switched on with no policies, so the public (anon) Supabase key
  the browser holds for realtime cannot read or write them; only these server functions can.
*/
import crypto from 'node:crypto';

export const MIGRATIONS = [
  // 1: accounts, saves, friends, invites
  `create table if not exists gst_meta (key text primary key, value text not null);
   create table if not exists gst_profiles (
     id uuid primary key default gen_random_uuid(),
     token_hash text unique not null,
     username text not null,
     friend_code text unique not null,
     appearance jsonb not null default '{}'::jsonb,
     shop_name text not null default '',
     created_at timestamptz not null default now(),
     online_at timestamptz,
     room text
   );
   create table if not exists gst_saves (
     profile_id uuid primary key references gst_profiles(id) on delete cascade,
     version int not null,
     data jsonb not null,
     updated_at timestamptz not null default now()
   );
   create table if not exists gst_friends (
     a uuid not null references gst_profiles(id) on delete cascade,
     b uuid not null references gst_profiles(id) on delete cascade,
     created_at timestamptz not null default now(),
     primary key (a, b)
   );
   create table if not exists gst_invites (
     id bigserial primary key,
     from_id uuid not null references gst_profiles(id) on delete cascade,
     to_id uuid not null references gst_profiles(id) on delete cascade,
     room text not null,
     created_at timestamptz not null default now()
   );
   create index if not exists gst_invites_to on gst_invites(to_id);
   alter table gst_meta enable row level security;
   alter table gst_profiles enable row level security;
   alter table gst_saves enable row level security;
   alter table gst_friends enable row level security;
   alter table gst_invites enable row level security;`,
  // 2: shop level shown on friends' lots
  `alter table gst_profiles add column if not exists shop_level int not null default 1;`,
];

export const dbUrl = (preferDirect = false) => {
  const e = process.env;
  const pooled = e.POSTGRES_URL || e.DATABASE_URL || e.SUPABASE_DB_URL;
  const direct = e.POSTGRES_URL_NON_POOLING;
  return (preferDirect ? direct || pooled : pooled || direct) || null;
};

export function pgConfig(url) {
  const u = new URL(url);
  for (const k of ['sslmode', 'supa', 'pgbouncer', 'sslrootcert']) u.searchParams.delete(k);
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  return { connectionString: u.toString(), ssl: local ? false : { rejectUnauthorized: false }, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 };
}

export async function migrate(client, log = () => {}) {
  await client.query(`create table if not exists gst_meta (key text primary key, value text not null)`);
  const r = await client.query(`select value from gst_meta where key = 'schema_version'`);
  let v = r.rows.length ? Number(r.rows[0].value) : 0;
  for (; v < MIGRATIONS.length; v++) {
    await client.query('begin');
    try {
      await client.query(MIGRATIONS[v]);
      await client.query(`insert into gst_meta (key, value) values ('schema_version', $1) on conflict (key) do update set value = excluded.value`, [String(v + 1)]);
      await client.query('commit');
      log(`migration ${v + 1} applied`);
    } catch (e) { await client.query('rollback'); throw e; }
  }
  return v;
}

// ---------- helpers ----------
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newFriendCode = () => Array.from(crypto.randomBytes(6), b => CODE_ABC[b % CODE_ABC.length]).join('');
export const newToken = () => 'gst_' + crypto.randomBytes(24).toString('base64url');
export const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
export const cleanName = n => String(n ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';
export const cleanShop = n => String(n ?? '').replace(/[^\p{L}\p{N} '&!._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
export const normCode = c => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const ONLINE_MS = 75_000;

function cleanAppearance(a) {
  const o = a && typeof a === 'object' ? a : {};
  const hex = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  return { body: o.body === 'female' ? 'female' : 'male', shirt: hex(o.shirt) || '#ff7a59', pants: hex(o.pants) || '#3d5a80', skin: Math.max(0, Math.min(5, Number(o.skin) | 0)), hat: typeof o.hat === 'string' ? o.hat.slice(0, 16) : 'none', hatColor: hex(o.hatColor) || '#2b2d42' };
}
const pub = p => p && ({ id: p.id, username: p.username, friendCode: p.friend_code, appearance: p.appearance, shopName: p.shop_name, shopLevel: p.shop_level || 1 });
const presence = p => {
  const online = !!p.online_at && Date.now() - new Date(p.online_at).getTime() < ONLINE_MS;
  return { online, room: online ? p.room || null : null };
};

// ---------- Postgres repo ----------
let pool = null, migrated = null;
async function pg() {
  if (!pool) {
    const { default: Pg } = await import('pg');
    pool = new Pg.Pool(pgConfig(dbUrl()));
    pool.on('error', () => {});
  }
  if (!migrated) migrated = (async () => { const c = await pool.connect(); try { await migrate(c); } finally { c.release(); } })().catch(e => { migrated = null; throw e; });
  await migrated;
  return pool;
}
const q = async (sql, params = []) => (await (await pg()).query(sql, params)).rows;

const PgRepo = {
  async createProfile(username, appearance, shopName) {
    for (let i = 0; i < 6; i++) {
      const token = newToken();
      try {
        const [p] = await q(`insert into gst_profiles (token_hash, username, friend_code, appearance, shop_name, online_at) values ($1,$2,$3,$4,$5, now()) returning *`,
          [hashToken(token), username, newFriendCode(), JSON.stringify(appearance), shopName]);
        return { token, profile: p };
      } catch (e) { if (!/unique|duplicate/i.test(e.message)) throw e; }
    }
    throw new Error('could not allocate a friend code');
  },
  async byToken(token) { const [p] = await q(`select * from gst_profiles where token_hash = $1`, [hashToken(token)]); return p || null; },
  async byCode(code) { const [p] = await q(`select * from gst_profiles where friend_code = $1`, [code]); return p || null; },
  async update(id, f) {
    const [p] = await q(`update gst_profiles set username = coalesce($2, username), appearance = coalesce($3::jsonb, appearance), shop_name = coalesce($4, shop_name), shop_level = coalesce($5, shop_level) where id = $1 returning *`,
      [id, f.username ?? null, f.appearance ? JSON.stringify(f.appearance) : null, f.shopName ?? null, f.shopLevel ?? null]);
    return p;
  },
  async getSave(id) { const [s] = await q(`select version, data, updated_at from gst_saves where profile_id = $1`, [id]); return s ? { version: s.version, data: s.data, updatedAt: new Date(s.updated_at).getTime() } : null; },
  async putSave(id, version, data) {
    const [s] = await q(`insert into gst_saves (profile_id, version, data, updated_at) values ($1,$2,$3, now())
      on conflict (profile_id) do update set version = excluded.version, data = excluded.data, updated_at = now() returning updated_at`, [id, version, JSON.stringify(data)]);
    return new Date(s.updated_at).getTime();
  },
  async friends(id) {
    return q(`select p.* from gst_friends f join gst_profiles p on p.id = f.b where f.a = $1 order by p.username`, [id]);
  },
  async areFriends(a, b) { const r = await q(`select 1 from gst_friends where a = $1 and b = $2`, [a, b]); return r.length > 0; },
  async addFriend(a, b) {
    await q(`insert into gst_friends (a, b) values ($1,$2), ($2,$1) on conflict do nothing`, [a, b]);
  },
  async removeFriend(a, b) { await q(`delete from gst_friends where (a = $1 and b = $2) or (a = $2 and b = $1)`, [a, b]); },
  async invite(from, to, room) {
    await q(`delete from gst_invites where from_id = $1 and to_id = $2`, [from, to]);
    await q(`insert into gst_invites (from_id, to_id, room) values ($1,$2,$3)`, [from, to, room]);
  },
  async invites(id) {
    await q(`delete from gst_invites where created_at < now() - interval '15 minutes'`);
    return q(`select i.id, i.room, i.created_at, p.username, p.friend_code from gst_invites i join gst_profiles p on p.id = i.from_id where i.to_id = $1 order by i.created_at desc limit 10`, [id]);
  },
  async dismiss(id, inviteId) { await q(`delete from gst_invites where id = $1 and to_id = $2`, [inviteId, id]); },
  async heartbeat(id, room) { await q(`update gst_profiles set online_at = now(), room = $2 where id = $1`, [id, room]); },
};

// ---------- in-memory repo (local dev without a database) ----------
const mem = { profiles: new Map(), saves: new Map(), friends: new Set(), invites: [], seq: 1 };
const MemRepo = {
  async createProfile(username, appearance, shopName) {
    const token = newToken();
    const p = { id: crypto.randomUUID(), token_hash: hashToken(token), username, friend_code: newFriendCode(), appearance, shop_name: shopName, shop_level: 1, online_at: new Date(), room: null };
    mem.profiles.set(p.id, p); return { token, profile: p };
  },
  async byToken(t) { const h = hashToken(t); for (const p of mem.profiles.values()) if (p.token_hash === h) return p; return null; },
  async byCode(c) { for (const p of mem.profiles.values()) if (p.friend_code === c) return p; return null; },
  async update(id, f) { const p = mem.profiles.get(id); if (f.username != null) p.username = f.username; if (f.appearance) p.appearance = f.appearance; if (f.shopName != null) p.shop_name = f.shopName; if (f.shopLevel != null) p.shop_level = f.shopLevel; return p; },
  async getSave(id) { return mem.saves.get(id) || null; },
  async putSave(id, version, data) { const at = Date.now(); mem.saves.set(id, { version, data: structuredClone(data), updatedAt: at }); return at; },
  async friends(id) { return [...mem.friends].filter(k => k.startsWith(id + '|')).map(k => mem.profiles.get(k.split('|')[1])).filter(Boolean); },
  async areFriends(a, b) { return mem.friends.has(a + '|' + b); },
  async addFriend(a, b) { mem.friends.add(a + '|' + b); mem.friends.add(b + '|' + a); },
  async removeFriend(a, b) { mem.friends.delete(a + '|' + b); mem.friends.delete(b + '|' + a); },
  async invite(from, to, room) { mem.invites = mem.invites.filter(i => !(i.from_id === from && i.to_id === to)); mem.invites.push({ id: mem.seq++, from_id: from, to_id: to, room, created_at: new Date() }); },
  async invites(id) { const cut = Date.now() - 15 * 60_000; mem.invites = mem.invites.filter(i => i.created_at.getTime() > cut); return mem.invites.filter(i => i.to_id === id).map(i => { const p = mem.profiles.get(i.from_id); return { id: i.id, room: i.room, created_at: i.created_at, username: p.username, friend_code: p.friend_code }; }); },
  async dismiss(id, inviteId) { mem.invites = mem.invites.filter(i => !(i.id === Number(inviteId) && i.to_id === id)); },
  async heartbeat(id, room) { const p = mem.profiles.get(id); if (p) { p.online_at = new Date(); p.room = room; } },
};

// ---------- Vercel Blob repo ----------
const B = { profiles: id => `gst/profiles/${id}.json`, tokens: h => `gst/tokens/${h}.json`, codes: c => `gst/codes/${c}.json`, saves: id => `gst/saves/${id}.json` };
const cache = new Map(); // path → { data, etag, at }
const CACHE_MS = 20_000;
async function bget(path, fresh = false) {
  const c = cache.get(path);
  if (!fresh && c && Date.now() - c.at < CACHE_MS) return c;
  const { get } = await import('@vercel/blob');
  let r = null;
  try { r = await get(path, { access: 'private', useCache: false }); } catch (e) { if (/not.?found/i.test(e?.message || e?.name || '')) r = null; else throw e; }
  if (!r || r.statusCode !== 200) { cache.delete(path); return null; }
  const v = { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag, at: Date.now() };
  cache.set(path, v);
  return v;
}
/** mode: 'create' (fail if exists) | 'replace' (unconditional) | an etag (fail if changed) */
async function bput(path, data, mode) {
  const { put } = await import('@vercel/blob');
  const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: mode !== 'create', cacheControlMaxAge: 60 };
  if (mode !== 'create' && mode !== 'replace' && mode) opts.ifMatch = mode;
  const r = await put(path, JSON.stringify(data), opts);
  cache.set(path, { data, etag: r.etag, at: Date.now() });
  return r;
}
const conflict = e => /precondition|already exists|etag/i.test(e?.message || '') || e?.name === 'BlobPreconditionFailedError';
async function bupdate(path, fn) {
  for (let i = 0; i < 5; i++) {
    const cur = await bget(path, i > 0);
    if (!cur) return null;
    const next = fn(structuredClone(cur.data));
    if (!next) return cur.data;
    try { await bput(path, next, cur.etag); return next; } catch (e) { if (!conflict(e)) throw e; cache.delete(path); }
  }
  throw new Error('busy, try again');
}
const BlobRepo = {
  async createProfile(username, appearance, shopName) {
    const id = crypto.randomUUID(), token = newToken();
    let code = '';
    for (let i = 0; i < 8; i++) {
      code = newFriendCode();
      try { await bput(B.codes(code), { id }, 'create'); break; } catch (e) { if (!conflict(e)) throw e; code = ''; }
    }
    if (!code) throw new Error('could not allocate a friend code');
    const p = { id, token_hash: hashToken(token), username, friend_code: code, appearance, shop_name: shopName, shop_level: 1, created_at: new Date().toISOString(), friends: [], online_at: null, room: null };
    await bput(B.profiles(id), p, 'create');
    await bput(B.tokens(p.token_hash), { id }, 'create');
    return { token, profile: p };
  },
  async byToken(t) { const r = await bget(B.tokens(hashToken(t))); if (!r) return null; const p = await bget(B.profiles(r.data.id)); return p ? p.data : null; },
  async byCode(c) { const r = await bget(B.codes(c)); if (!r) return null; const p = await bget(B.profiles(r.data.id)); return p ? p.data : null; },
  async update(id, f) {
    return bupdate(B.profiles(id), p => {
      const n = { ...p };
      if (f.username != null) n.username = f.username;
      if (f.appearance) n.appearance = f.appearance;
      if (f.shopName != null) n.shop_name = f.shopName;
      if (f.shopLevel != null) n.shop_level = f.shopLevel;
      return JSON.stringify(n) === JSON.stringify(p) ? null : n;
    });
  },
  async getSave(id) { const r = await bget(B.saves(id), true); return r ? { version: r.data.version, data: r.data.data, updatedAt: r.data.updatedAt } : null; },
  async putSave(id, version, data) { const at = Date.now(); await bput(B.saves(id), { version, data, updatedAt: at }, 'replace'); cache.delete(B.saves(id)); return at; },
  async friends(id) {
    const me = await bget(B.profiles(id), true); if (!me) return [];
    const list = await Promise.all((me.data.friends || []).map(f => bget(B.profiles(f)).then(r => r?.data).catch(() => null)));
    return list.filter(Boolean).sort((a, b) => a.username.localeCompare(b.username));
  },
  async areFriends(a, b) { const p = await bget(B.profiles(a)); return !!p?.data.friends?.includes(b); },
  async addFriend(a, b) {
    await bupdate(B.profiles(a), p => (p.friends || []).includes(b) ? null : { ...p, friends: [...(p.friends || []), b] });
    await bupdate(B.profiles(b), p => (p.friends || []).includes(a) ? null : { ...p, friends: [...(p.friends || []), a] });
  },
  async removeFriend(a, b) {
    await bupdate(B.profiles(a), p => ({ ...p, friends: (p.friends || []).filter(x => x !== b) }));
    await bupdate(B.profiles(b), p => ({ ...p, friends: (p.friends || []).filter(x => x !== a) }));
  },
  // presence and invites go peer-to-peer in this mode: nothing to store
  async invite() {},
  async invites() { return []; },
  async dismiss() {},
  async heartbeat() {},
  p2pPresence: true,
};

export function repo() {
  if (dbUrl()) return PgRepo;
  if (process.env.BLOB_READ_WRITE_TOKEN) return BlobRepo;
  if (process.env.VERCEL) return null; // deployed without a database: the game falls back to local saves
  return MemRepo;
}

export { cleanAppearance, pub, presence };
