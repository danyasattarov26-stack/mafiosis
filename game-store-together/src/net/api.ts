/* Client for /api/game: account (username + friend code), cloud saves, friends, invites and visits. */
import { store, storeSet, uid } from '../core/util';
import { inbox } from './p2p';

export interface Look { body: 'male' | 'female'; shirt: string; pants: string; skin: number; hat: string; hatColor: string }
export interface Profile { id: string; username: string; friendCode: string; appearance: Look; shopName: string; shopLevel?: number; local?: boolean }
export interface Friend extends Profile { online: boolean; room: string | null; checking?: boolean }
export interface Invite { id: number; room: string; from: string; fromCode: string; at: number }

export const DEFAULT_LOOK: Look = { body: 'male', shirt: '#ff7a59', pants: '#3d5a80', skin: 1, hat: 'cap', hatColor: '#2b2d42' };
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const localCode = () => Array.from({ length: 6 }, () => ABC[Math.floor(Math.random() * ABC.length)]).join('');
export const fmtCode = (c: string) => (c || '').length === 6 ? c.slice(0, 3) + '-' + c.slice(3) : c;

class Api {
  db = false;
  realtime: { url: string; key: string } | null = null;
  token: string | null = null;
  profile: Profile | null = null;
  status = 'offline';
  presence: 'p2p' | 'server' | 'none' = 'none';

  async init() {
    this.token = store<{ t: string | null }>('gst-token', { t: null }).t;
    const p = store<{ p: Profile | null }>('gst-profile', { p: null }).p;
    this.profile = p;
    try {
      const r = await fetch('/api/game?op=config', { cache: 'no-store' });
      const c = await r.json();
      this.db = !!c.db; this.realtime = c.realtime || null; this.presence = c.presence || (c.db ? 'server' : 'none');
    } catch { this.db = false; }
    if (this.db && this.token) {
      try { const r = await this.call('me'); if (r.profile) this.setProfile(r.profile); } catch (e: any) { if (e.status === 401) { this.token = null; storeSet('gst-token', { t: null }); } }
    }
    // offline profile: works on this device, upgraded to an online account as soon as a database is available
    if (this.db && this.profile?.local) {
      try { await this.register(this.profile.username, this.profile.appearance, this.profile.shopName); } catch { /* keep local */ }
    }
    this.status = this.db ? (this.token ? 'online' : 'no account') : 'offline';
  }

  private setProfile(p: Profile) { this.profile = p; storeSet('gst-profile', { p }); }

  async call(op: string, body?: any, method: 'GET' | 'POST' = body ? 'POST' : 'GET', q = '') {
    const r = await fetch(`/api/game?op=${op}${q}`, {
      method, headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e: any = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return j;
  }

  async register(username: string, appearance: Look, shopName: string) {
    if (!this.db) {
      this.setProfile({ id: uid('local'), username: username || 'Player', friendCode: this.profile?.friendCode || localCode(), appearance, shopName, local: true });
      return this.profile!;
    }
    const r = await this.call('register', { username, appearance, shopName });
    this.token = r.token; storeSet('gst-token', { t: r.token });
    this.setProfile(r.profile);
    this.status = 'online';
    return this.profile!;
  }
  /** log in on another device with the recovery code (the account token) */
  async recover(code: string) {
    const t = code.trim();
    const r = await fetch('/api/game?op=me', { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) throw new Error('That recovery code didn’t work.');
    const j = await r.json();
    this.token = t; storeSet('gst-token', { t });
    this.setProfile(j.profile); this.status = 'online';
    return j.profile as Profile;
  }
  async updateProfile(f: Partial<{ username: string; appearance: Look; shopName: string }>) {
    if (!this.profile) return;
    if (!this.db || !this.token) { this.setProfile({ ...this.profile, ...f } as Profile); return; }
    const r = await this.call('profile', f);
    this.setProfile(r.profile);
  }
  get online() { return this.db && !!this.token; }

  async loadCloud(): Promise<{ data: any; updatedAt: number } | null> {
    if (!this.online) return null;
    const r = await this.call('save');
    return r.save ? { data: r.save.data, updatedAt: r.save.updatedAt } : null;
  }
  async saveCloud(data: any, version: number) {
    if (!this.online) return false;
    await this.call('save', { data, version });
    return true;
  }
  async friends(): Promise<{ friends: Friend[]; invites: Invite[] }> {
    if (!this.online) return { friends: [], invites: [] };
    return this.call('friends');
  }
  /** friends list; in peer-to-peer mode each friend's online status arrives a moment later through onUpdate */
  async friendsLive(onUpdate?: (f: Friend) => void) {
    const r = await this.friends();
    if (this.presence === 'p2p') for (const f of r.friends) {
      f.checking = true; f.online = false; f.room = null;
      inbox.probe(f.friendCode).then(st => { f.checking = false; f.online = !!st; f.room = st?.room || null; if (st?.shopName) f.shopName = st.shopName; onUpdate?.(f); });
    }
    return r;
  }
  /** invite a friend into the shop you're hosting */
  async inviteFriend(f: Friend, room: string) {
    if (this.presence === 'p2p') {
      const ok = await inbox.invite(f.friendCode, { from: this.profile?.username || 'A friend', fromCode: this.profile?.friendCode || '', room });
      if (!ok) throw new Error(`${f.username} isn’t online right now.`);
      return;
    }
    await this.invite(f.id, room);
  }
  addFriend(code: string) { return this.call('addFriend', { code }); }
  removeFriend(id: string) { return this.call('removeFriend', { id }); }
  invite(to: string, room: string) { return this.call('invite', { to, room }); }
  dismiss(id: number) { return this.call('dismiss', { id }); }
  async heartbeat(room: string | null): Promise<Invite[]> {
    if (!this.online) return [];
    const r = await this.call('heartbeat', { room });
    return r.invites || [];
  }
  visit(code: string) { return this.call('visit', undefined, 'GET', '&code=' + encodeURIComponent(code)); }
}

export const api = new Api();
