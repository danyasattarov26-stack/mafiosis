/* A co-op session: the host shares the world (seed + edits), everyone shares their position, and the host
   runs the animals. Limits the room to 5 players. Guests spawn next to the host. */
import { Room, MAX_PLAYERS, clean, type Msg } from './coop';
import type { Game, Grave, SaveData } from '../game/game';
import { settings } from '../game/settings';

export interface ChatLine { from: string; text: string; ch: string; at: number }
export class Session {
  room: Room; host: boolean; game: Game | null = null;
  names = new Map<string, string>(); muted = new Set<string>(); blocked = new Set<string>();
  chat: ChatLine[] = [];
  onChat: () => void = () => {};
  onToast: (s: string, kind?: string) => void = () => {};
  onFull: () => void = () => {};
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
      case 'block': g.world.set(m.x | 0, m.y | 0, m.z | 0, m.id | 0, true); break;
      case 'animals': if (!this.host) g.animals.applySnapshot(m.list); break;
      case 'attack': {
        if (!this.host) return;
        const b = g.animals.list.find(q => q.id === m.id);
        if (b) g.hitAnimal(b, Math.min(20, +m.dmg || 1), g.player.pos.clone().set(+m.x, +m.y, +m.z), from);
        break;
      }
      case 'give': for (const [k, n] of m.items ?? []) g.give(String(k), Math.min(64, n | 0)); break;
      case 'grave': {
        if (m.remove) { g.graves = g.graves.filter(q => q.id !== m.remove); }
        else if (m.g && !g.graves.some(q => q.id === m.g.id)) g.graves.push(m.g as Grave);
        break;
      }
      case 'time': if (!this.host) { g.time = +m.time; g.weather = m.weather; } break;
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
      this.timeT -= dt; if (this.timeT <= 0) { this.timeT = 5; this.room.send({ k: 'time', time: g.time, weather: g.weather }); }
    }
    // hold E next to a downed friend for 3 seconds to bring them back
    const f = g.downedFriendNear();
    if (f && reviveHeld) { this.reviveT += dt; if (this.reviveT > 3) { this.room.send({ k: 'revive', target: 'me' }, f.id); this.reviveT = 0; } }
    else this.reviveT = 0;
  }
  close() { this.room.close(); }
}
