/*
  Co-op for up to 4 players. The host runs the simulation; guests mirror it and send their actions.
  Transport: Supabase Realtime (broadcast + presence) when the database is connected; otherwise a
  BroadcastChannel between tabs of the same browser (handy for local testing).
*/
import type { World, Customer, StaffNpc, PlayerPos } from '../sim/world';
import { migrate } from '../core/save';
import { api, type Look } from './api';
import { uid } from '../core/util';
import { P2PTransport } from './p2p';

export const MAX_PLAYERS = 4;
type Msg = { k: string; from: string; to?: string; [x: string]: any };
interface Peer { id: string; name: string; look: Look; host: boolean; at: number }

interface Transport {
  send(m: Msg): void;
  onMsg(f: (m: Msg) => void): void;
  onPeers(f: (peers: Peer[]) => void): void;
  ready: Promise<void>;
  close(): void;
}

class LocalTransport implements Transport {
  private bc: BroadcastChannel;
  private peers = new Map<string, Peer>();
  private msgF: (m: Msg) => void = () => {};
  private peerF: (p: Peer[]) => void = () => {};
  private timer: any;
  ready: Promise<void>;
  constructor(room: string, private me: Peer) {
    this.bc = new BroadcastChannel('gst-room-' + room);
    this.bc.onmessage = e => {
      const m = e.data as Msg;
      if (m.from === me.id) return;
      if (m.k === '_hello' || m.k === '_bye') {
        if (m.k === '_bye') this.peers.delete(m.from); else this.peers.set(m.from, { ...m.peer, at: Date.now() });
        this.emitPeers();
        return;
      }
      this.msgF(m);
    };
    const hello = () => { this.bc.postMessage({ k: '_hello', from: me.id, peer: this.me }); const now = Date.now(); let ch = false; for (const [k, p] of this.peers) if (now - p.at > 6000) { this.peers.delete(k); ch = true; } if (ch) this.emitPeers(); };
    hello(); this.timer = setInterval(hello, 1500);
    this.ready = Promise.resolve();
  }
  private emitPeers() { this.peerF([this.me, ...this.peers.values()]); }
  send(m: Msg) { this.bc.postMessage(m); }
  onMsg(f: (m: Msg) => void) { this.msgF = f; }
  onPeers(f: (p: Peer[]) => void) { this.peerF = f; this.emitPeers(); }
  close() { clearInterval(this.timer); this.bc.postMessage({ k: '_bye', from: this.me.id }); this.bc.close(); }
}

class SupaTransport implements Transport {
  private ch: any;
  private client: any;
  private msgF: (m: Msg) => void = () => {};
  private peerF: (p: Peer[]) => void = () => {};
  ready: Promise<void>;
  constructor(room: string, me: Peer, cfg: { url: string; key: string }) {
    this.ready = (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      this.client = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 40 } } });
      this.ch = this.client.channel('gst:' + room, { config: { broadcast: { self: false, ack: false }, presence: { key: me.id } } });
      this.ch.on('broadcast', { event: 'm' }, ({ payload }: any) => this.msgF(payload));
      this.ch.on('presence', { event: 'sync' }, () => {
        const st = this.ch.presenceState();
        const list: Peer[] = [];
        for (const k of Object.keys(st)) { const p = st[k][0]; if (p) list.push({ id: p.id, name: p.name, look: p.look, host: p.host, at: Date.now() }); }
        this.peerF(list);
      });
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error('Realtime connection timed out')), 12000);
        this.ch.subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') { clearTimeout(t); await this.ch.track(me); res(); }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); rej(new Error('Realtime ' + status)); }
        });
      });
    })();
  }
  send(m: Msg) { this.ch?.send({ type: 'broadcast', event: 'm', payload: m }); }
  onMsg(f: (m: Msg) => void) { this.msgF = f; }
  onPeers(f: (p: Peer[]) => void) { this.peerF = f; }
  close() { try { this.ch?.untrack(); this.client?.removeChannel(this.ch); } catch { /* ignore */ } }
}

// ---- compact encodings for the frequent messages ----
const encC = (c: Customer) => [c.id, c.model, c.tint, +c.x.toFixed(2), +c.z.toFixed(2), +c.ry.toFixed(2), c.anim, +c.progress.toFixed(2), c.bubble, c.state, c.target, c.seat, c.queueAt, c.scanned, c.cart, c.pay, c.given, c.type, c.order, c.regular, c.live ? 1 : 0, +c.y.toFixed(2), c.fl];
const decC = (a: any[]): Customer => ({ id: a[0], model: a[1], tint: a[2], x: a[3], z: a[4], y: a[21] || 0, fl: a[22] || 0, ry: a[5], anim: a[6], progress: a[7], bubble: a[8], state: a[9], target: a[10], seat: a[11], queueAt: a[12], scanned: a[13], cart: a[14] || [], pay: a[15], given: a[16], type: a[17], order: a[18] ?? null, regular: a[19] ?? null, live: !!a[20], t: 0, tMax: 0, patience: 0, path: [], speed: 0, plan: [], sat: 70, reasons: [], after: null });
const encS = (s: StaffNpc) => [s.id, s.role, s.name, s.body, +s.x.toFixed(2), +s.z.toFixed(2), +s.ry.toFixed(2), s.anim, s.carry, +s.y.toFixed(2), s.fl];
const decS = (a: any[]): StaffNpc => ({ id: a[0], role: a[1], name: a[2], body: a[3], x: a[4], z: a[5], ry: a[6], anim: a[7], carry: a[8], y: a[9] || 0, fl: a[10] || 0, state: '', t: 0, path: [], task: null, counter: null });

export type Role = 'solo' | 'host' | 'guest';

export class Coop {
  role: Role = 'solo';
  room: string | null = null;
  me: Peer;
  peers: Peer[] = [];
  hostId: string | null = null;
  world: World | null = null;
  apply: ((a: any, from: string) => { ok: boolean; msg?: string }) | null = null;
  onEvent: (e: { type: string; data: any }) => void = () => {};
  onPeersChange: (p: Peer[]) => void = () => {};
  onEnded: (why: string) => void = () => {};
  private t: Transport | null = null;
  private pending = new Map<string, (r: { ok: boolean; msg?: string }) => void>();
  private lastRev = -1;
  private snapT = 0; private dynT = 0; private posT = 0;
  private gotSnap: ((ok: boolean) => void) | null = null;
  stats = { sent: 0, recv: 0, bytes: 0 };

  constructor() { this.me = { id: uid('p'), name: 'Player', look: undefined as any, host: false, at: 0 }; }

  setMe(name: string, look: Look) { this.me.name = name; this.me.look = look; }
  get id() { return this.me.id; }
  get connected() { return this.role !== 'solo'; }

  /** Supabase Realtime when configured; otherwise peer-to-peer (WebRTC). `?local` (and dev builds) use tabs of this browser. */
  get transportKind(): 'supabase' | 'p2p' | 'local' {
    const q = new URLSearchParams(location.search);
    if (api.realtime) return 'supabase';
    if (q.has('local') || (import.meta.env.DEV && !q.has('p2p'))) return 'local';
    return 'p2p';
  }
  private transport(room: string): Transport {
    const k = this.transportKind;
    if (k === 'supabase') return new SupaTransport(room, this.me, api.realtime!);
    if (k === 'p2p') return new P2PTransport(room, this.me) as unknown as Transport;
    return new LocalTransport(room, this.me);
  }

  /** open your shop so friends can join (live visits) */
  async host(room: string, world: World, apply: Coop['apply']) {
    await this.leave();
    this.role = 'host'; this.room = room; this.world = world; this.apply = apply; this.hostId = this.me.id; this.me.host = true;
    world.isHost = true;
    const t = this.t = this.transport(room);
    t.onMsg(m => this.handle(m));
    t.onPeers(p => this.setPeers(p));
    try { await t.ready; } catch (e) { console.warn('co-op hosting unavailable', e); this.role = 'solo'; this.t = null; t.close(); }
    this.lastRev = -1;
  }

  /** join a friend's shop; resolves true once the first snapshot arrives */
  async join(room: string, world: World): Promise<{ ok: boolean; why?: string }> {
    await this.leave();
    this.role = 'guest'; this.room = room; this.world = world; this.me.host = false; this.hostId = null;
    world.isHost = false;
    const t = this.t = this.transport(room);
    t.onMsg(m => this.handle(m));
    t.onPeers(p => this.setPeers(p));
    try { await t.ready; } catch (e: any) { await this.leave(); return { ok: false, why: e.message || 'Could not connect' }; }
    // peer-to-peer connections take a few seconds to open, so keep knocking until the host answers
    let knock: any = null;
    const ok = await new Promise<boolean>(res => {
      this.gotSnap = res;
      const send = () => t.send({ k: 'join', from: this.me.id, name: this.me.name, look: this.me.look });
      send(); knock = setInterval(send, 1500);
      setTimeout(() => res(false), this.transportKind === 'p2p' ? 25000 : 12000);
    });
    clearInterval(knock);
    this.gotSnap = null;
    if (!ok) { const why = this.full ? 'That shop is full (4 players max).' : 'Couldn’t reach that shop. Is your friend online and playing?'; await this.leave(); return { ok: false, why }; }
    return { ok: true };
  }
  private full = false;
  private hostMissing = 0;
  private welcomed = new Set<string>();
  private lastHostMsg = 0;
  private ended = false;

  async leave() {
    if (this.t) { try { this.t.send({ k: 'bye', from: this.me.id }); } catch { /* ignore */ } this.t.close(); }
    this.t = null; this.role = 'solo'; this.room = null; this.peers = []; this.hostId = null; this.full = false; this.hostMissing = 0; this.ended = false;
    if (this.world) { this.world.players.clear(); this.world.isHost = true; }
  }

  private setPeers(p: Peer[]) {
    this.peers = p;
    if (this.world) {
      for (const id of [...this.world.players.keys()]) if (!p.find(x => x.id === id)) this.world.players.delete(id);
    }
    // presence can blink during reconnects: only give up after a grace period (see tick)
    if (this.role === 'guest' && this.hostId && !p.find(x => x.id === this.hostId)) { if (!this.hostMissing) this.hostMissing = performance.now(); }
    else this.hostMissing = 0;
    this.onPeersChange(p);
  }

  private send(m: Omit<Msg, 'from'>) {
    if (!this.t) return;
    const msg = { ...m, from: this.me.id } as Msg;
    this.stats.sent++;
    this.t.send(msg);
  }

  /** guest → host: perform an action, resolve with the host's verdict */
  act(a: any): Promise<{ ok: boolean; msg?: string }> {
    const seq = uid('a');
    return new Promise(res => {
      this.pending.set(seq, res);
      this.send({ k: 'act', to: this.hostId || undefined, seq, a });
      setTimeout(() => { if (this.pending.has(seq)) { this.pending.delete(seq); res({ ok: false, msg: 'The host didn’t answer' }); } }, 9000);
    });
  }

  private handle(m: Msg) {
    this.stats.recv++;
    if (m.to && m.to !== this.me.id) return;
    const w = this.world; if (!w) return;
    switch (m.k) {
      case 'join':
        if (this.role !== 'host') return;
        if (this.peers.filter(p => p.id !== this.me.id).length >= MAX_PLAYERS) { this.send({ k: 'full', to: m.from }); return; }
        this.lastRev = -1; this.snapT = 0;
        if (!this.welcomed.has(m.from)) { this.welcomed.add(m.from); this.onEvent({ type: 'toast', data: { msg: `👋 ${m.name} joined your shop!`, kind: 'good' } }); }
        break;
      case 'full': if (this.role === 'guest') { this.full = true; this.gotSnap?.(false); } break;
      case 'bye':
        w.players.delete(m.from);
        if (this.role === 'guest' && m.from === this.hostId) this.end('The host closed the shop.');
        break;
      case 'snap':
        if (this.role !== 'guest') return;
        this.hostId = m.from; this.lastHostMsg = performance.now();
        w.save = migrate(m.save);
        w.rev++; w.nav.rebuild(w.save);
        w.ev.emit('changed', undefined);
        this.gotSnap?.(true);
        break;
      case 'dyn':
        if (this.role !== 'guest') return;
        this.hostId = m.from; this.lastHostMsg = performance.now();
        w.save.money = m.money; w.save.time = m.time; w.save.open = m.open; w.save.xp = m.xp; w.save.level = m.level; w.save.day = m.day; w.save.dayOver = m.dayOver;
        w.customers = m.c.map(decC);
        w.staff = m.s.map(decS);
        w.summary = m.summary || null;
        break;
      case 'pos': {
        const p: PlayerPos = { id: m.from, name: m.name, look: m.look, x: m.x, y: m.y, z: m.z, ry: m.ry, pitch: m.pitch, carry: m.carry, anim: m.anim, at: Date.now(), host: m.host };
        w.players.set(m.from, p);
        break;
      }
      case 'act': {
        if (this.role !== 'host' || !this.apply) return;
        let r: { ok: boolean; msg?: string };
        try { r = this.apply(m.a, m.from); } catch (e: any) { console.error('action failed', e); r = { ok: false, msg: 'That didn’t work' }; }
        this.send({ k: 'res', to: m.from, seq: m.seq, ok: r.ok, msg: r.msg });
        break;
      }
      case 'res': { const f = this.pending.get(m.seq); if (f) { this.pending.delete(m.seq); f({ ok: m.ok, msg: m.msg }); } break; }
      case 'ev': if (this.role === 'guest') this.onEvent(m.e); break;
    }
  }

  /** host: forward a world event to guests */
  broadcastEvent(type: string, data: any) { if (this.role === 'host') this.send({ k: 'ev', e: { type, data } }); }

  private end(why: string) { if (this.ended) return; this.ended = true; this.onEnded(why); }

  /** per-frame networking */
  tick(dt: number, local: Omit<PlayerPos, 'id' | 'at'>) {
    if (!this.t || !this.world) return;
    const w = this.world;
    if (this.role === 'guest') {
      const now = performance.now();
      if (this.hostMissing && now - this.hostMissing > 8000) this.end('The host left the shop.');
      else if (this.lastHostMsg && now - this.lastHostMsg > 15000) this.end('Lost connection to the host.');
    }
    this.posT -= dt;
    if (this.posT <= 0) { this.posT = 1 / 8; this.send({ k: 'pos', ...local, name: this.me.name, look: this.me.look, host: this.role === 'host' }); }
    if (this.role !== 'host') return;
    this.snapT -= dt; this.dynT -= dt;
    if (w.rev !== this.lastRev && this.snapT <= 0 && this.peers.length > 1) {
      this.snapT = 0.25; this.lastRev = w.rev;
      const save = { ...w.save, reviews: w.save.reviews.slice(-30) };
      this.send({ k: 'snap', save });
    }
    if (this.dynT <= 0 && this.peers.length > 1) {
      this.dynT = 1 / 6;
      const s = w.save;
      this.send({ k: 'dyn', money: s.money, time: s.time, open: s.open, xp: s.xp, level: s.level, day: s.day, dayOver: s.dayOver, c: w.customers.map(encC), s: w.staff.map(encS), summary: w.summary });
    }
  }
}

export const coop = new Coop();
