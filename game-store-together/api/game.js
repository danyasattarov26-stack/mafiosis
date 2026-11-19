/*
  One endpoint for accounts, cloud saves, friends, invites and visits:  /api/game?op=<name>
  Auth: "Authorization: Bearer <token>" — the token is created on first launch and kept on the device
  (it doubles as the recovery code for logging in on another device).
*/
import { repo, cleanName, cleanShop, cleanAppearance, normCode, pub, presence } from './_db.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const MAX_SAVE = 600_000;

function realtimeConfig() {
  const e = process.env;
  const url = e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || null;
  const key = e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.SUPABASE_PUBLISHABLE_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || null;
  return url && key ? { url, key } : null;
}

async function auth(R, request) {
  const h = request.headers.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!t) return null;
  return R.byToken(t);
}

const friendView = p => ({ ...pub(p), ...presence(p) });

async function handle(request) {
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  const R = repo();
  if (op === 'config') return json({ db: !!R, realtime: realtimeConfig() });
  if (!R) return json({ error: 'offline', detail: 'no database connected' }, 503);

  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); } }

  if (op === 'register') {
    const { token, profile } = await R.createProfile(cleanName(body.username), cleanAppearance(body.appearance), cleanShop(body.shopName) || '');
    return json({ token, profile: pub(profile) });
  }

  const me = await auth(R, request);
  if (!me) return json({ error: 'not signed in' }, 401);

  switch (op) {
    case 'me': return json({ profile: pub(me) });
    case 'profile': {
      const p = await R.update(me.id, {
        username: body.username != null ? cleanName(body.username) : null,
        appearance: body.appearance ? cleanAppearance(body.appearance) : null,
        shopName: body.shopName != null ? cleanShop(body.shopName) : null,
        shopLevel: Number.isFinite(body.shopLevel) ? Math.max(1, Math.min(99, body.shopLevel | 0)) : null,
      });
      return json({ profile: pub(p) });
    }
    case 'save': {
      if (request.method === 'GET') return json({ save: await R.getSave(me.id) });
      const data = body.data, version = Number(body.version) | 0;
      if (!data || typeof data !== 'object') return json({ error: 'no data' }, 400);
      if (JSON.stringify(data).length > MAX_SAVE) return json({ error: 'save too big' }, 413);
      const updatedAt = await R.putSave(me.id, version, data);
      if (data.shopName || data.level) await R.update(me.id, { shopName: data.shopName ? cleanShop(data.shopName) : null, shopLevel: data.level | 0 || null });
      return json({ ok: true, updatedAt });
    }
    case 'friends': {
      const [list, invites] = await Promise.all([R.friends(me.id), R.invites(me.id)]);
      return json({ friends: list.map(friendView), invites: invites.map(i => ({ id: i.id, room: i.room, from: i.username, fromCode: i.friend_code, at: new Date(i.created_at).getTime() })) });
    }
    case 'addFriend': {
      const code = normCode(body.code);
      if (code.length !== 6) return json({ error: 'Friend codes have 6 letters and numbers.' }, 400);
      if (code === me.friend_code) return json({ error: "That's your own code." }, 400);
      const other = await R.byCode(code);
      if (!other) return json({ error: 'No player has that code.' }, 404);
      await R.addFriend(me.id, other.id);
      return json({ friend: friendView(other) });
    }
    case 'removeFriend': {
      await R.removeFriend(me.id, String(body.id || ''));
      return json({ ok: true });
    }
    case 'invite': {
      const to = String(body.to || '');
      if (!(await R.areFriends(me.id, to))) return json({ error: 'You can only invite friends.' }, 403);
      await R.invite(me.id, to, String(body.room || me.friend_code).slice(0, 40));
      return json({ ok: true });
    }
    case 'dismiss': { await R.dismiss(me.id, body.id); return json({ ok: true }); }
    case 'heartbeat': {
      await R.heartbeat(me.id, body.room ? String(body.room).slice(0, 40) : null);
      const invites = await R.invites(me.id);
      return json({ invites: invites.map(i => ({ id: i.id, room: i.room, from: i.username, fromCode: i.friend_code, at: new Date(i.created_at).getTime() })) });
    }
    case 'visit': {
      const code = normCode(url.searchParams.get('code'));
      const other = await R.byCode(code);
      if (!other) return json({ error: 'No player has that code.' }, 404);
      if (other.id !== me.id && !(await R.areFriends(me.id, other.id))) return json({ error: 'Add them as a friend first.' }, 403);
      const save = await R.getSave(other.id);
      return json({ profile: friendView(other), save });
    }
    default: return json({ error: 'unknown op' }, 404);
  }
}

async function safe(request) {
  try { return await handle(request); }
  catch (e) { console.error('[api/game]', e && e.message); return json({ error: 'server error', detail: String(e && e.message || e).slice(0, 200) }, 500); }
}

export const GET = safe;
export const POST = safe;
