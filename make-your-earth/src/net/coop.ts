/*
  Co-op for up to 5 players with no game server: browsers connect directly (WebRTC via Trystero, which finds
  peers through public Nostr relays). One player hosts: their world is the real one. Friends get the seed and
  every block change, so they generate the same terrain locally. Each player sends their own position;
  the host also runs the animals and shares them.
  Friends: every game has a friend code and listens on an "inbox" room, so friends can see you're online
  and invite you to spawn together.
*/
export const APP_ID = 'make-your-earth.vercel.app/v1';
export const MAX_PLAYERS = 5;
let lib: Promise<any> | null = null;
const trystero = () => (lib ||= import('trystero'));

export type Msg = { k: string; [x: string]: any };
export class Room {
  private room: any = null; private act: any = null;
  peers = new Set<string>();
  onMsg: (m: Msg, from: string) => void = () => {};
  onJoin: (peer: string) => void = () => {};
  onLeave: (peer: string) => void = () => {};
  ready: Promise<void>;
  constructor(public code: string) {
    this.ready = (async () => {
      const { joinRoom } = await trystero();
      this.room = joinRoom({ appId: APP_ID }, 'room-' + code);
      this.act = this.room.makeAction('m');
      this.act.onMessage((d: any, ctx: any) => { const peer = typeof ctx === 'string' ? ctx : ctx?.peerId; if (d && typeof d === 'object' && typeof d.k === 'string') this.onMsg(d, peer); });
      this.room.onPeerJoin((ctx: any) => { const peer = typeof ctx === 'string' ? ctx : ctx?.peerId; this.peers.add(peer); this.onJoin(peer); });
      this.room.onPeerLeave((ctx: any) => { const peer = typeof ctx === 'string' ? ctx : ctx?.peerId; this.peers.delete(peer); this.onLeave(peer); });
    })();
  }
  send(m: Msg, to?: string) { if (!this.act) return; try { const p = to ? this.act.send(m, { target: to }) : this.act.send(m); p?.catch?.(() => {}); } catch { /* peer gone */ } }
  close() { try { this.room?.leave(); } catch { /* ignore */ } this.room = null; }
}

export const newCode = (n = 6) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

// ---------------- friends ----------------
export interface Friend { code: string; name: string }
export interface Profile { id: string; code: string; name: string }
export function profile(): Profile {
  let p: Profile | null = null;
  try { p = JSON.parse(localStorage.getItem('mye-profile') || 'null'); } catch { /* ignore */ }
  if (!p) { p = { id: 'p' + newCode(10), code: newCode(6), name: '' }; saveProfile(p); }
  return p;
}
export function saveProfile(p: Profile) { try { localStorage.setItem('mye-profile', JSON.stringify(p)); } catch { /* ignore */ } }
export function friends(): Friend[] { try { return JSON.parse(localStorage.getItem('mye-friends') || '[]'); } catch { return []; } }
export function saveFriends(f: Friend[]) { try { localStorage.setItem('mye-friends', JSON.stringify(f)); } catch { /* ignore */ } }

export interface Status { name: string; playing: string | null; room: string | null; players: number }
export interface Invite { from: string; fromCode: string; room: string }
class Inbox {
  private room: any = null; private code = '';
  status: () => Status = () => ({ name: '', playing: null, room: null, players: 0 });
  onInvite: (i: Invite) => void = () => {};
  async open(code: string) {
    if (!code || code === this.code) return;
    this.close(); this.code = code;
    try {
      const { joinRoom } = await trystero();
      const room = this.room = joinRoom({ appId: APP_ID }, 'inbox-' + code);
      const act = room.makeAction('m');
      act.onMessage((d: any, ctx: any) => {
        const peer = typeof ctx === 'string' ? ctx : ctx?.peerId;
        if (d?.k === 'ping') act.send({ k: 'pong', ...this.status() }, { target: peer }).catch(() => {});
        if (d?.k === 'invite' && typeof d.room === 'string') { this.onInvite({ from: String(d.from || '?').slice(0, 20), fromCode: String(d.fromCode || ''), room: d.room.slice(0, 12) }); act.send({ k: 'ack' }, { target: peer }).catch(() => {}); }
      });
    } catch (e) { console.warn('inbox unavailable', e); }
  }
  close() { try { this.room?.leave(); } catch { /* ignore */ } this.room = null; this.code = ''; }
  probe(code: string, ms = 9000) { return this.visit(code, ms, { k: 'ping' }, 'pong') as Promise<Status | null>; }
  async invite(code: string, payload: { from: string; fromCode: string; room: string }) { return !!(await this.visit(code, 10000, { k: 'invite', ...payload }, 'ack')); }
  private async visit(code: string, ms: number, msg: any, wait: string): Promise<any> {
    if (!code || code === this.code) return null;
    let room: any = null;
    try {
      const { joinRoom } = await trystero();
      room = joinRoom({ appId: APP_ID }, 'inbox-' + code);
      const act = room.makeAction('m');
      return await new Promise(res => {
        const tm = setTimeout(() => res(null), ms);
        act.onMessage((d: any) => { if (d?.k === wait) { clearTimeout(tm); res(d); } });
        room.onPeerJoin((ctx: any) => { const peer = typeof ctx === 'string' ? ctx : ctx?.peerId; act.send(msg, { target: peer }).catch(() => {}); });
      });
    } catch { return null; } finally { try { room?.leave(); } catch { /* ignore */ } }
  }
}
export const inbox = new Inbox();

// ---------------- chat safety ----------------
const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'merda', 'caralho', 'foda', 'puta', 'cabrão', 'cabrao', 'paneleiro', 'filho da puta', 'crl', 'fdp'];
export function clean(s: string, on = true) {
  s = s.replace(/[\u0000-\u001f]/g, '').slice(0, 200);
  if (!on) return s;
  return BAD.reduce((acc, w) => acc.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => '*'.repeat(m.length)), s);
}
export const cleanName = (s: string) => clean(s, true).replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
