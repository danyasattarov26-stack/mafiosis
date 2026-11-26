/* A co-op session: the host shares the world (seed + edits), everyone shares their position, and the host
   runs the animals. Limits the room to 5 players. Guests spawn next to the host. */
import { Room, MAX_PLAYERS, clean, type Msg } from './coop';
import * as THREE from 'three';
import type { Game, Grave, SaveData } from '../game/game';
import { settings } from '../game/settings';
import { BLOCK_ID } from '../shared/blocks';
import { t } from '../i18n/i18n';

/** a custom block from someone else: six faces of 16×16 pixels and a sane recipe */
function validBlock(c: any) {
  return c && typeof c.key === 'string' && /^cb_[a-z0-9]{4,12}$/.test(c.key) && typeof c.name === 'string' && Array.isArray(c.faces) && c.faces.length === 6
    && c.faces.every((f: any) => typeof f === 'string' && f.length < 1500) && c.recipe && typeof c.recipe === 'object' && Object.keys(c.recipe).length <= 3;
}
export interface ChatLine { from: string; text: string; ch: string; at: number }
export class Session {
  room: Room; host: boolean; game: Game | null = null;
  names = new Map<string, string>(); muted = new Set<string>(); blocked = new Set<string>();
  chat: ChatLine[] = [];
  onChat: () => void = () => {};
  onToast: (s: string, kind?: string) => void = () => {};
  onFull: () => void = () => {};
  onKicked: (banned: boolean) => void = () => {};
  onInventory: (name: string, items: { k: string; n: number }[]) => void = () => {};
  private animT = 0; private timeT = 0; private hostPeer: string | null = null;
  welcome: Promise<{ save: SaveData; spawn: [number, number, number] } | null> | null = null;
  private reviveT = 0;

  constructor(code: string, host: boolean) {
    this.host = host; this.room = new Room(code);
    this.room.onLeave = peer => { const n = this.names.get(peer); this.game?.removeRemote(peer); if (n) this.onToast(n + ' ✕'); this.names.delete(peer); };
  }
  players() { return 1 + this.names.size; }

  /** guest: ask the host for the world and wait for it */
  join(myName: string, timeoutMs = 25000) {
    this.welcome = new Promise(res => {
      const tm = setTimeout(() => res(null), timeoutMs);
      this.room.onJoin = peer => this.room.send({ k: 'hello', name: myName }, peer);
      const prev = this.room.onMsg;
      this.room.onMsg = (m, from) => {
        if (m.k === 'full') { clearTimeout(tm); this.onFull(); res(null); return; }
        if (m.k === 'welcome') { clearTimeout(tm); this.hostPeer = from; this.names.set(from, String(m.name || 'Host')); res({ save: m.save, spawn: m.spawn }); return; }
        prev(m, from);
      };
    });
    return this.welcome;
  }

  /** wire the room to a running game */
  attach(game: Game) {
    this.game = game; game.isGuest = !this.host;
    game.animals.host = this.host;
    game.net.block = (x, y, z, id) => this.room.send({ k: 'block', x, y, z, id });
    game.net.grave = (g, removeId) => this.room.send({ k: 'grave', g, remove: removeId });
    game.netAttack = (id, dmg) => this.room.send({ k: 'attack', id, dmg, x: game.player.pos.x, y: game.player.pos.y, z: game.player.pos.z }, this.hostPeer ?? undefined);
    game.giveTo = (peer, items) => this.room.send({ k: 'give', items }, peer);
    game.net.blockdef = c => this.room.send({ k: 'blockdef', c }, this.hostPeer ?? undefined);
    game.net.blockdefs = list => this.room.send({ k: 'blockdefs', list });
    const host = () => this.hostPeer ?? undefined;
    game.net.hurt = (peer, dmg, from) => this.room.send({ k: 'hurt', dmg, x: from.x, y: from.y, z: from.z }, peer);
    game.net.arrow = (from, vel) => this.room.send({ k: 'arrow', p: [from.x, from.y, from.z], v: [vel.x, vel.y, vel.z] });
    game.net.cont = (key, c) => this.room.send({ k: 'cont', key, c });
    game.net.crop = (key, t) => this.room.send({ k: 'crop', key, t });
    game.net.sleep = () => this.room.send({ k: 'sleep' }, host());
    game.net.tame = id => this.room.send({ k: 'tame', id }, host());
    game.net.saddle = id => this.room.send({ k: 'saddle', id }, host());
    let rideT = 0;
    game.net.ride = b => { const now = performance.now(); if (now - rideT < 90) return; rideT = now; this.room.send({ k: 'ride', id: b.id, x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw, anim: b.cur }, host()); };
    game.onSlept = () => this.syncTime();
    game.net.travel = () => this.room.send({ k: 'travel' }, host());
    game.net.dim = (to, at) => this.room.send({ k: 'dim', dim: to, at });
    game.net.beam = (x, y, z) => this.room.send({ k: 'beam', x, y, z });
    game.net.ending = () => this.room.send({ k: 'plant' }, host());
    game.net.ended = () => this.room.send({ k: 'ended' });
    game.net.toastAll = (key, vars) => this.room.send({ k: 'qtoast', key, vars });
    this.room.onJoin = peer => {
      if (this.host) return;   // hosts wait for hello
      this.room.send({ k: 'state', ...game.myState() }, peer);
    };
    this.room.onMsg = (m, from) => this.handle(m, from);
  }

  private handle(m: Msg, from: string) {
    const g = this.game; if (!g) return;
    switch (m.k) {
      case 'hello': {
        if (!this.host) return;
        if (this.players() >= MAX_PLAYERS) { this.room.send({ k: 'full' }, from); return; }
        if ((g.data.admin?.banned ?? []).includes(String(m.name))) { this.room.send({ k: 'kick', ban: true }, from); return; }
        g.save();
        const p = g.player.pos, a = Math.random() * Math.PI * 2;
        this.room.send({ k: 'welcome', name: g.player.name, save: { ...g.data, player: null }, spawn: [p.x + Math.cos(a) * 2, p.y + 0.5, p.z + Math.sin(a) * 2] }, from);
        break;
      }
      case 'state': {
        if (this.blocked.has(from)) return;
        const first = !this.names.has(from);
        this.names.set(from, String(m.name).slice(0, 16));
        g.upsertRemote(from, { name: String(m.name).slice(0, 16), look: m.look | 0, x: +m.x, y: +m.y, z: +m.z, yaw: +m.yaw, anim: String(m.anim), downed: !!m.downed });
        if (first) this.onToast(`${m.name} ✓`, 'good');
        break;
      }
      case 'block': {
        g.world.set(m.x | 0, m.y | 0, m.z | 0, m.id | 0, true);
        if (this.host && (m.id | 0) === BLOCK_ID.sky_beacon && g.dim === 'earth') g.data.quest!.beacon = [m.x | 0, m.y | 0, m.z | 0];
        break;
      }
      case 'travel': if (this.host) g.travel(); break;
      case 'dim': if (!this.host && from === this.hostPeer && (m.dim === 'sky' || m.dim === 'earth') && Array.isArray(m.at)) g.followDim(m.dim, [+m.at[0], +m.at[1], +m.at[2]]); break;
      case 'beam': g.showBeam(m.x | 0, m.y | 0, m.z | 0); break;
      case 'plant': if (this.host && g.data.quest!.beacon) { const b = g.data.quest!.beacon; g.ending(b[0], b[1], b[2]); } break;
      case 'ended': if (!this.host && from === this.hostPeer && !g.data.quest!.ended) { g.data.quest!.ended = true; g.onEnding?.(); } break;
      case 'qtoast': if (from === this.hostPeer && typeof m.key === 'string' && m.key.startsWith('quest.')) g.toast(t(m.key as any, m.vars ?? {}), 'good'); break;
      case 'animals': if (!this.host) g.animals.applySnapshot(m.list); break;
      case 'attack': {
        if (!this.host) return;
        const b = g.animals.list.find(q => q.id === m.id);
        if (b) g.hitAnimal(b, Math.min(20, +m.dmg || 1), g.player.pos.clone().set(+m.x, +m.y, +m.z), from);
        break;
      }
      case 'give': if (!this.host && from !== this.hostPeer) break;   // only the host hands out items
        for (const [k, n] of m.items ?? []) g.give(String(k), Math.min(576, n | 0)); break;
      case 'tp': if (!this.host && from === this.hostPeer) { g.player.pos.set(+m.x, +m.y, +m.z); g.player.vel.set(0, 0, 0); } break;
      case 'invreq': if (!this.host && from === this.hostPeer) this.room.send({ k: 'inv', items: g.inv.all().map(x => ({ k: x.k, n: x.n })) }, from); break;
      case 'inv': if (this.host) this.onInventory(this.names.get(from) ?? '?', (m.items ?? []).slice(0, 60)); break;
      case 'kick': if (!this.host && from === this.hostPeer) this.onKicked(!!m.ban); break;
      case 'blockdef': if (this.host && validBlock(m.c)) g.addCustomBlock(m.c); break;
      case 'blockdefs': if (!this.host && from === this.hostPeer && Array.isArray(m.list)) g.applyCustomList(m.list.filter(validBlock)); break;
      case 'grave': {
        if (m.remove) { g.graves = g.graves.filter(q => q.id !== m.remove); }
        else if (m.g && !g.graves.some(q => q.id === m.g.id)) g.graves.push(m.g as Grave);
        break;
      }
      case 'time': if (!this.host) { const jump = +m.time - g.time > 60; g.time = +m.time; g.weather = m.weather; if (jump) g.sleepFade = 1.6; if (m.quest && typeof m.quest === 'object') Object.assign(g.data.quest!, m.quest); } break;
      case 'hurt': if (!this.host && from === this.hostPeer) g.hurtBy(Math.min(40, +m.dmg || 0), new THREE.Vector3(+m.x, +m.y, +m.z), false); break;
      case 'arrow': if (Array.isArray(m.p) && Array.isArray(m.v)) g.projectiles.fire(new THREE.Vector3(+m.p[0], +m.p[1], +m.p[2]), new THREE.Vector3(+m.v[0], +m.v[1], +m.v[2]), 'ghost', 0); break;
      case 'cont': if (typeof m.key === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(m.key) && (m.c === null || (m.c && (m.c.kind === 'chest' || m.c.kind === 'furnace')))) g.setContainer(m.key, m.c); break;
      case 'crop': if (typeof m.key === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(m.key)) g.setCrop(m.key, m.t == null ? null : +m.t); break;
      case 'sleep': if (this.host && g.sunLevel <= 0.35) g.skipNight(); break;
      case 'tame': if (this.host) { const b = g.animals.list.find(q => q.id === m.id); if (b) g.animals.tame(b, from); } break;
      case 'saddle': if (this.host) { const b = g.animals.list.find(q => q.id === m.id); if (b) g.animals.saddle(b); } break;
      case 'ride': if (this.host) g.animals.rideRemote(String(m.id), +m.x, +m.y, +m.z, +m.yaw, String(m.anim || '')); break;
      case 'revive': if (m.target === 'me') g.revive(); break;
      case 'chat': {
        if (this.muted.has(from) || this.blocked.has(from)) return;
        this.chat.push({ from: this.names.get(from) ?? '?', text: clean(String(m.text), settings.profanity), ch: String(m.ch || 'global'), at: Date.now() });
        this.chat = this.chat.slice(-60); this.onChat();
        break;
      }
    }
  }

  say(text: string, ch = 'global') {
    text = clean(text, settings.profanity); if (!text.trim()) return;
    this.room.send({ k: 'chat', text, ch });
    this.chat.push({ from: this.game?.player.name ?? 'me', text, ch, at: Date.now() }); this.onChat();
  }

  tick(dt: number, reviveHeld: boolean) {
    const g = this.game; if (!g || !g.ready) return;
    if (g.sendTick(dt)) this.room.send({ k: 'state', ...g.myState() });
    if (this.host) {
      this.animT -= dt; if (this.animT <= 0) { this.animT = 0.2; this.room.send({ k: 'animals', list: g.animals.snapshot() }); }
      this.timeT -= dt; if (this.timeT <= 0) { this.timeT = 5; this.room.send({ k: 'time', time: g.time, weather: g.weather, quest: g.data.quest }); }
    }
    // hold E next to a downed friend for 3 seconds to bring them back
    const f = g.downedFriendNear();
    if (f && reviveHeld) { this.reviveT += dt; if (this.reviveT > 3) { this.room.send({ k: 'revive', target: 'me' }, f.id); this.reviveT = 0; } }
    else this.reviveT = 0;
  }
  syncTime() { const g = this.game; if (g && this.host) this.room.send({ k: 'time', time: g.time, weather: g.weather }); }
  private isHostPeer(p: string) { return p === this.hostPeer; }
  close() { this.room.close(); }
}
