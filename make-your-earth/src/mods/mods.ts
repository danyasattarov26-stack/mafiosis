/*
  Mods: small JavaScript files that add items, blocks and recipes, or react to things happening in the game.
  Official mods live in /mods on the game's website (only the game's owner can publish them there, by
  adding a file and redeploying). Players switch them on in the Mods tab. The owner can also try a mod on
  their own device from the admin panel before publishing it. See MODS.md for how to write one.

  Mods load once when the page opens, before any world starts, so switching one on or off reloads the page.
*/
import * as THREE from 'three';
import { ITEMS, ITEM, RECIPES, type ItemDef, type Station } from '../shared/items';
import { rebaseCustom, encodeFace, type CustomBlock, type BlockFunction } from '../shared/custom';
import type { Tex } from '../shared/blocks';
import { paintTile } from '../render/textures';
import { lang } from '../i18n/i18n';
import type { Game } from '../game/game';

export interface ModInfo { id: string; name: string; pt?: string; description: string; descPt?: string; version: string; author: string; file: string; local?: boolean }
export type ModEvent = 'start' | 'tick' | 'blockBreak' | 'newLife' | 'kill';
type Hook = (game: Game, data?: any) => void;

const ENABLED = 'mye-mods', LOCAL = 'mye-local-mods';
export const HOOKS: Record<ModEvent, { mod: string; fn: Hook }[]> = { start: [], tick: [], blockBreak: [], newLife: [], kill: [] };
/** blocks mods asked for: they join each world as that world's custom blocks */
export const MOD_BLOCKS: CustomBlock[] = [];
export const loaded: ModInfo[] = [];
export const failed: { id: string; error: string }[] = [];

export function enabledMods(): string[] { try { return JSON.parse(localStorage.getItem(ENABLED) || '[]'); } catch { return []; } }
export function setEnabled(id: string, on: boolean) {
  const s = new Set(enabledMods()); on ? s.add(id) : s.delete(id);
  try { localStorage.setItem(ENABLED, JSON.stringify([...s])); } catch { /* storage full */ }
}
/** mods the owner is trying on this device (not published) */
export function localMods(): (ModInfo & { code: string })[] { try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; } }
export function saveLocalMod(m: ModInfo & { code: string }) {
  const l = localMods().filter(x => x.id !== m.id); l.push({ ...m, local: true });
  localStorage.setItem(LOCAL, JSON.stringify(l)); setEnabled(m.id, true);
}
export function removeLocalMod(id: string) { localStorage.setItem(LOCAL, JSON.stringify(localMods().filter(x => x.id !== id))); setEnabled(id, false); }

let official: Promise<ModInfo[]> | null = null;
export function officialMods() {
  if (!official) official = fetch('/mods/index.json').then(r => (r.ok ? r.json() : { mods: [] })).then(j => (j.mods ?? []) as ModInfo[]).catch(() => []);
  return official;
}

const SAFE_KEY = /^[a-z0-9_]{3,24}$/;
/** what a mod gets to work with */
function makeApi(info: ModInfo) {
  const own = (k: string) => { if (!SAFE_KEY.test(k)) throw new Error(`bad key "${k}" (use 3–24 letters, digits or _)`); return k; };
  return {
    id: info.id, THREE, lang: () => lang(),
    /** a new item (food, tool, material…); same fields as the built-in items */
    addItem(def: Partial<ItemDef> & { key: string; en: string }) {
      const key = own(def.key); if (ITEM[key]) throw new Error(`item "${key}" already exists`);
      const it: ItemDef = { kind: 'material', color: '#cccccc', stack: 64, pt: def.en, icon: 'ball', ...def, key } as ItemDef;
      ITEMS.push(it); ITEM[key] = it; return it;
    },
    /** a recipe: out item, how many it makes, ingredients { item: count } ("#planks" for any planks), where */
    addRecipe(out: string, n: number, ins: Record<string, number>, at: Station = 'hand') {
      for (const k of [out, ...Object.keys(ins)]) if (!k.startsWith('#') && !ITEM[k] && !MOD_BLOCKS.some(b => b.key === k)) throw new Error(`unknown item "${k}"`);
      RECIPES.push({ out, n: Math.max(1, n | 0), in: ins, at });
    },
    /** a new block, painted from the same patterns as the built-in ones (see MODS.md) */
    addBlock(def: { key: string; en: string; pt?: string; top: Tex; side?: Tex; bottom?: Tex; fn?: BlockFunction; recipe?: Record<string, number>; at?: Station; n?: number }) {
      const key = 'cb_' + own(def.key).replace(/_/g, '').slice(0, 12);
      if (key.length < 7) throw new Error('block key too short');
      const side = def.side ?? def.top, bottom = def.bottom ?? def.top;
      const faces = [side, side, def.top, bottom, side, side].map((t, i) => encodeFace(paintTile(t, key.length * 31 + i)));
      MOD_BLOCKS.push({ key, name: def.en, pt: def.pt, author: info.name, faces, fn: def.fn ?? 'solid', recipe: def.recipe ?? {}, at: def.at ?? 'workbench', n: def.n ?? 1, created: 0 });
      return key;
    },
    /** react to the game: start (a world opened), tick (every frame, with dt), blockBreak ({x,y,z,key}), newLife, kill ({key,x,y,z}) */
    on(ev: ModEvent, fn: Hook) { if (!HOOKS[ev]) throw new Error(`unknown event "${ev}"`); HOOKS[ev].push({ mod: info.id, fn }); },
  };
}
export type ModApi = ReturnType<typeof makeApi>;

/** load every switched-on mod (once, at startup) */
export async function loadMods() {
  const on = new Set(enabledMods());
  if (!on.size) return;
  const list = [...(await officialMods()), ...localMods()].filter(m => on.has(m.id));
  for (const m of list) {
    let url = '';
    try {
      if ((m as any).code) url = URL.createObjectURL(new Blob([(m as any).code], { type: 'text/javascript' }));
      const mod = await import(/* @vite-ignore */ url || `/mods/${m.file}`);
      const setup = mod.default ?? mod.setup;
      if (typeof setup !== 'function') throw new Error('a mod must export a default function(api)');
      await setup(makeApi(m));
      loaded.push(m);
    } catch (e: any) {
      console.warn('mod failed', m.id, e);
      failed.push({ id: m.id, error: String(e?.message ?? e) });
    } finally { if (url) URL.revokeObjectURL(url); }
  }
  rebaseCustom();      // mod items and recipes stay when worlds reset their custom blocks
}

/** run every mod hooked to an event; a broken mod can't take the game down with it */
const broken = new Set<string>();
export function runHooks(ev: ModEvent, game: Game, data?: any) {
  for (const h of HOOKS[ev]) {
    if (broken.has(h.mod)) continue;
    try { h.fn(game, data); } catch (e) { console.warn('mod error', h.mod, e); broken.add(h.mod); game.toast(`Mod "${h.mod}" stopped: ${String((e as any)?.message ?? e).slice(0, 80)}`, 'bad'); }
  }
}
export const modIds = () => loaded.map(m => m.id);
