/*
  Peer-to-peer networking with Trystero (WebRTC; peers find each other through public Nostr relays, so there
  is no game server to run). Used when Supabase Realtime isn't configured.
  - P2PTransport: a co-op shop room ("shop-<friend code>").
  - Inbox: every open game listens on "inbox-<its friend code>" so friends can see it's online (ping/pong)
    and send co-op invites without any database writes.
*/
import type { Look } from './api';

export const APP_ID = 'game-store-together.vercel.app/v1';
type Room = any;

let lib: Promise<any> | null = null;
export const trystero = () => (lib ||= import('trystero'));

export interface Peer { id: string; name: string; look: Look; host: boolean; at: number }
type Msg = { k: string; from: string; [x: string]: any };

export class P2PTransport {
  private room: Room = null;
  private act: any = null;
  private peers = new Map<string, Peer>();   // trystero peerId → our peer info
  private msgF: (m: Msg) => void = () => {};
  private peerF: (p: Peer[]) => void = () => {};
  ready: Promise<void>;

  constructor(roomName: string, private me: Peer) {
    this.ready = (async () => {
      const { joinRoom } = await trystero();
      this.room = joinRoom({ appId: APP_ID }, 'shop-' + roomName);
      this.act = this.room.makeAction('m');
      this.act.onMessage((d: any, ctx: { peerId: string }) => {
        if (!d || typeof d !== 'object') return;
        if (d.k === '_hello') {
          this.peers.set(ctx.peerId, { ...d.peer, at: Date.now() });
          this.emit();
          if (d.reply) this.act.send({ k: '_hello', peer: this.me }, { target: ctx.peerId }).catch(() => {});
          return;
        }
        this.msgF(d);
      });
      this.room.onPeerJoin((ctx: { peerId: string }) => { this.act.send({ k: '_hello', peer: this.me, reply: true }, { target: ctx.peerId }).catch(() => {}); });
      this.room.onPeerLeave((ctx: { peerId: string }) => { if (this.peers.delete(ctx.peerId)) this.emit(); });
      this.emit();
    })();
  }
  private emit() { this.peerF([this.me, ...this.peers.values()]); }
  send(m: Msg) { this.act?.send(m).catch(() => {}); }
  onMsg(f: (m: Msg) => void) { this.msgF = f; }
  onPeers(f: (p: Peer[]) => void) { this.peerF = f; this.emit(); }
  close() { try { this.room?.leave(); } catch { /* ignore */ } this.room = null; }
}

export interface InboxStatus { name: string; shopName: string; level: number; room: string | null }
export interface Invite { from: string; fromCode: string; room: string; at: number }

class Inbox {
  private room: Room = null;
  private code = '';
  status: () => InboxStatus = () => ({ name: '', shopName: '', level: 1, room: null });
  onInvite: (i: Invite) => void = () => {};
  private probes = new Map<string, Promise<InboxStatus | null>>();

  /** start listening on your own inbox (call again if the friend code changes) */
  async open(code: string) {
    if (!code || code === this.code) return;
    this.close();
    this.code = code;
    try {
      const { joinRoom } = await trystero();
      const room = this.room = joinRoom({ appId: APP_ID }, 'inbox-' + code);
      const act = room.makeAction('m');
      act.onMessage((d: any, ctx: { peerId: string }) => {
        if (d?.k === 'ping') act.send({ k: 'pong', ...this.status() }, { target: ctx.peerId }).catch(() => {});
        if (d?.k === 'invite' && typeof d.room === 'string') { this.onInvite({ from: String(d.from || 'A friend').slice(0, 16), fromCode: String(d.fromCode || ''), room: d.room.slice(0, 40), at: Date.now() }); act.send({ k: 'ack' }, { target: ctx.peerId }).catch(() => {}); }
      });
    } catch (e) { console.warn('inbox unavailable', e); this.room = null; }
  }
  close() { try { this.room?.leave(); } catch { /* ignore */ } this.room = null; this.code = ''; }

  /** is this friend's game open? resolves with their status, or null after the timeout */
  probe(code: string, ms = 9000): Promise<InboxStatus | null> {
    if (!code || code === this.code) return Promise.resolve(null);
    const running = this.probes.get(code); if (running) return running;
    const p = this.visit(code, ms, { k: 'ping' }, 'pong').then(r => r as InboxStatus | null).finally(() => this.probes.delete(code));
    this.probes.set(code, p);
    return p;
  }
  /** deliver a co-op invite to a friend whose game is open */
  async invite(code: string, payload: { from: string; fromCode: string; room: string }) {
    return !!(await this.visit(code, 10000, { k: 'invite', ...payload }, 'ack'));
  }

  private async visit(code: string, ms: number, msg: any, wait: string): Promise<any> {
    let room: Room = null;
    try {
      const { joinRoom } = await trystero();
      room = joinRoom({ appId: APP_ID }, 'inbox-' + code);
      const act = room.makeAction('m');
      return await new Promise(res => {
        const t = setTimeout(() => res(null), ms);
        act.onMessage((d: any) => { if (d?.k === wait) { clearTimeout(t); res(d); } });
        room.onPeerJoin((ctx: { peerId: string }) => { act.send(msg, { target: ctx.peerId }).catch(() => {}); });
      });
    } catch (e) { console.warn('p2p visit failed', e); return null; }
    finally { try { room?.leave(); } catch { /* ignore */ } }
  }
}

export const inbox = new Inbox();
