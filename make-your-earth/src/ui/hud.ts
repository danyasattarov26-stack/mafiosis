/* In-game UI: survival bars, hotbar, crosshair, toasts, downed/death screens, pause menu, inventory with
   crafting, and the M map. Plain DOM, rebuilt only when something changes. */
import { t, nm } from '../i18n/i18n';
import { ITEM, RECIPES, type Recipe } from '../shared/items';
import { BIOMES } from '../shared/biomes';
import { itemIcon } from '../render/textures';
import { HOTBAR, SLOTS, ARMOR_SLOTS, type Stack } from '../game/inventory';
import type { Game } from '../game/game';
import { sound } from '../audio/audio';
import { matchGrid, consume, pickIngredients } from '../game/crafting';
import { CHEST_SLOTS, SMELT_TIME, smeltResult, fuelOf, type Container } from '../game/containers';
import { builtinBlueprints, myBlueprints, saveBlueprint, deleteBlueprint, type Blueprint } from '../game/blueprints';

const $ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Hud {
  root: HTMLElement;
  open: 'inv' | 'map' | 'pause' | 'dead' | 'grave' | 'bp' | 'bm' | 'admin' | 'journal' | 'ending' | null = null;
  onBlockMaker: () => void = () => {};
  onAdmin: () => void = () => {};
  station = 'hand';
  container: string | null = null;          // the chest or furnace that's open (its block position)
  grid: (Stack | null)[] = new Array(9).fill(null);   // the crafting grid (2×2 by hand, 3×3 at a station)
  private pick = 0;                           // which result, when the grid fits several recipes
  private cursor: Stack | null = null;      // item held on the mouse while moving stacks
  private recipeFilter = ''; private onlyMakeable = false;
  onQuit: () => void = () => {};
  onRebirth: () => void = () => {};
  coop: { code: string; players: number } | null = null;

  constructor(private game: Game) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="cross"></div>
      <div class="topleft"><div class="coords"></div><div class="biome"></div><div class="coopinfo"></div><div class="goal"></div></div>
      <div class="bossbar" hidden><b></b><i><u></u></i></div>
      <div class="starcompass" hidden><span class="needle">➤</span><small></small></div>
      <div class="bars"></div>
      <div class="hotbar"></div>
      <div class="toasts"></div>
      <div class="sitebar" hidden></div>
      <div class="vignette"></div>
      <div class="fade"></div>
      <div class="revive" hidden></div>
      <div class="loading"><div class="spinner"></div><p>${t('hud.loading')}</p></div>
      <div class="panel" hidden></div>
      <div class="cursor-item" hidden></div>
      ${game.input.touch ? `<div class="touchbtns">
        <button data-act="rotate" class="b-rot">⟳</button><button data-act="inventory">🎒<small>${t('touch.inv')}</small></button><button data-act="map">🗺<small>${t('touch.map')}</small></button><button data-act="journal">📜</button><button data-act="menu">☰</button>
      </div>
      <div class="touchact"><button class="b-hit" data-hold="primary">⛏<small>${t('touch.break')}</small></button><button class="b-use" data-act="use">✋<small>${t('touch.use')}</small></button><button class="b-jump" data-hold="jump">⤒<small>${t('touch.jump')}</small></button><button class="b-run" data-toggle="sprint">🏃<small>${t('touch.sprint')}</small></button><button class="b-eat" data-act="eat">🍖</button></div>` : ''}`;
    document.body.appendChild(this.root);
    // touch buttons
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.game.input.press(b.dataset.act!); }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(b => {
      const k = b.dataset.hold!;
      const on = (v: boolean) => (e: Event) => { e.preventDefault(); e.stopPropagation(); if (k === 'primary') { this.game.input.primary = v; if (v) this.game.input.press('attack'); } else this.game.input.touchJump = v; b.classList.toggle('on', v); };
      b.addEventListener('pointerdown', on(true)); b.addEventListener('pointerup', on(false)); b.addEventListener('pointercancel', on(false)); b.addEventListener('pointerleave', on(false));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.game.input.sprintToggle = !this.game.input.sprintToggle; b.classList.toggle('on', this.game.input.sprintToggle); }));
    addEventListener('mousemove', e => { const c = $('.cursor-item', this.root); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; });
    this.renderHotbar(); this.renderBars();
  }
  destroy() { this.root.remove(); }

  toast(msg: string, kind = '') {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
    const box = $('.toasts', this.root); box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 2600); setTimeout(() => el.remove(), 3000);
  }

  // ---------------- every frame (cheap parts only) ----------------
  private lastBars = ''; private reviveMode = '';
  frame() {
    const g = this.game, p = g.player;
    $('.loading', this.root).style.display = g.ready ? 'none' : 'flex';
    $('.coords', this.root).textContent = t('hud.coords', { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y), z: Math.floor(p.pos.z) }) + '   ' + t('hud.day', { n: g.day }) + ' ' + this.clock();
    $('.biome', this.root).textContent = nm(BIOMES[g.biome]);
    // the story: what to do next, the compass, the Colossus
    this.goalT -= 1; if (this.goalT <= 0) { this.goalT = 30; const pr = g.questProgress(); $('.goal', this.root).textContent = pr.step === 'done' ? '' : '🎯 ' + t(('quest.goal.' + pr.step) as any, { n: pr.stones.length }); }
    const cp = $('.starcompass', this.root); cp.hidden = !g.compass;
    if (g.compass) {
      const a = Math.atan2(g.compass.x - p.pos.x, g.compass.z - p.pos.z), rel = a - (p.yaw + Math.PI);
      ($('.needle', cp) as HTMLElement).style.transform = `rotate(${(-rel * 180 / Math.PI) - 90}deg)`;
      $('small', cp).textContent = `${g.compass.label} · ${Math.round(g.compass.dist)} m`;
    }
    const boss = g.animals.bossAlive(), bb = $('.bossbar', this.root);
    bb.hidden = !boss || boss.pos.distanceTo(p.pos) > 70;
    if (boss && !bb.hidden) { $('b', bb).textContent = nm(boss.def); ($('u', bb) as HTMLElement).style.width = `${Math.max(0, boss.hp / boss.def.hp) * 100}%`; }
    const s = p.stats;
    const sig = [s.health, s.hunger, s.thirst, s.stamina, s.temp * 10, s.sick * 100, p.air * 10].map(v => Math.round(v)).join();
    if (sig !== this.lastBars) { this.lastBars = sig; this.renderBars(); }
    const v = $('.vignette', this.root);
    v.style.opacity = String(Math.max(g.redFlash, p.downed > 0 ? 0.8 : 0, s.health < 25 ? (25 - s.health) / 40 : 0));
    v.style.background = g.flash > 0 ? 'rgba(255,255,255,0.6)' : '';
    $('.fade', this.root).style.opacity = String(Math.min(1, g.sleepFade));
    g.redFlash = Math.max(0, g.redFlash - 0.045); g.flash = Math.max(0, g.flash - 0.03);
    // being down
    const rv = $('.revive', this.root);
    const friend = g.downedFriendNear();
    // only rebuild when what's shown changes, so the button stays clickable
    const mode = p.downed > 0 ? 'down' : friend ? 'friend:' + friend.name : '';
    if (mode !== this.reviveMode) {
      this.reviveMode = mode; rv.hidden = !mode;
      if (mode === 'down') { rv.innerHTML = `<b>${t('hud.downed')}</b><p class="secs"></p><button class="btn">${t('hud.giveUp')}</button>`; ($('button', rv) as HTMLButtonElement).onclick = () => g.giveUp(); }
      else if (friend) rv.innerHTML = `<p>${t('hud.revive', { name: esc(friend.name) })}</p>`;
    }
    if (mode === 'down') $('.secs', rv).textContent = t('hud.downedHint', { s: Math.ceil(p.downed) });
    if (this.coop) $('.coopinfo', this.root).textContent = `${t('hud.roomCode', { code: this.coop.code })} · ${t('hud.players', { n: this.coop.players })}`;
    const sb = $('.sitebar', this.root), st = g.siteStatus();
    sb.hidden = !st; if (st && sb.textContent !== st) sb.textContent = st;
    const c = $('.cross', this.root); c.classList.toggle('busy', !!g.breaking);
    c.style.setProperty('--p', String(Math.min(1, g.breaking?.p ?? 0)));
  }
  private goalT = 0;
  /** the journal: the story so far and what's next */
  openJournal() {
    this.open = 'journal'; this.game.paused = true; this.root.classList.add('panel-open');
    const panel = $('.panel', this.root); panel.hidden = false;
    const g = this.game, pr = g.questProgress(), q = g.data.quest!;
    const steps: [string, boolean, string][] = [
      ['compass', pr.done.compass, ''], ['stones', pr.done.stones, ` (${pr.stones.length}/4)`], ['beacon', pr.done.beacon, ''],
      ['sky', pr.done.sky, ''], ['bells', pr.done.bells, ` (${q.bells.length}/4)`], ['colossus', pr.done.colossus, ''], ['plant', pr.done.plant, ''],
    ];
    panel.innerHTML = `<div class="journal"><button class="close">✕</button><h2>📜 ${t('quest.title')}</h2><p class="muted">${t('quest.intro')}</p>
      <ol>${steps.map(([k, done, extra], i) => `<li class="${done ? 'done' : pr.step === k ? 'now' : ''}"><b>${done ? '✔' : pr.step === k ? '➤' : (i + 1) + '.'} ${t(('quest.step.' + k) as any)}${extra}</b><p>${t(('quest.hint.' + k) as any)}</p></li>`).join('')}</ol>
      <div class="stones">${['starstone_ember', 'starstone_frost', 'starstone_verdant', 'starstone_tide'].map(k => `<span class="${pr.stones.includes(k) ? 'have' : ''}" title="${esc(nm(ITEM[k]))}"><img src="${itemIcon(k)}" alt="">${esc(nm(ITEM[k]))}</span>`).join('')}</div>
      <p class="muted">${t('quest.stats', { days: g.day, kills: q.kills, deaths: q.deaths })}</p></div>`;
    $('.close', panel).onclick = () => { this.close(); g.input.requestLock(); };
  }
  /** the end of the story */
  showEnding() {
    const g = this.game, q = g.data.quest!;
    this.open = 'ending'; g.paused = true; this.root.classList.add('panel-open');
    const panel = $('.panel', this.root); panel.hidden = false;
    const lines = [t('ending.l1'), t('ending.l2'), t('ending.l3'), t('ending.l4')];
    panel.innerHTML = `<div class="ending"><h1>${t('ending.title')}</h1>${lines.map((l, i) => `<p style="animation-delay:${0.8 + i * 1.6}s">${esc(l)}</p>`).join('')}
      <div class="estats" style="animation-delay:${0.8 + lines.length * 1.6}s">${t('quest.stats', { days: g.day, kills: q.kills, deaths: q.deaths })}</div>
      <button class="btn big" style="animation-delay:${1.2 + lines.length * 1.6}s">${t('ending.continue')}</button></div>`;
    sound.play('discover'); setTimeout(() => sound.play('bell', { vol: 0.6 }), 1500);
    panel.querySelector<HTMLElement>('button')!.onclick = () => { this.close(); g.input.requestLock(); };
  }
  private clock() { const f = (this.game.time % 1200) / 1200 * 24; const h = Math.floor(f), m = Math.floor((f - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

  renderBars() {
    const s = this.game.player.stats, p = this.game.player;
    const bar = (cls: string, label: string, v: number, extra = '') => `<div class="bar ${cls}" title="${label}"><span>${extra}</span><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
    const temp = s.temp < 35.8 ? `❄ ${t('hud.cold')}` : s.temp > 38.6 ? `🔥 ${t('hud.hot')}` : '';
    $('.bars', this.root).innerHTML =
      bar('hp', t('hud.health'), s.health, '❤') + bar('food', t('hud.hunger'), s.hunger, '🍖') + bar('water', t('hud.thirst'), s.thirst, '💧') +
      bar('stam', t('hud.stamina'), s.stamina, '⚡') +
      (p.air < 10 ? bar('air', 'Air', p.air * 10, '🫧') : '') +
      `<div class="status">${s.sick > 0.05 ? `<em class="sick">🤢 ${t('hud.sick')} ${Math.round(s.sick * 100)}%</em>` : ''}${temp ? `<em>${temp} ${s.temp.toFixed(1)}°</em>` : `<em class="ok">🌡 ${s.temp.toFixed(1)}°</em>`}</div>`;
  }
  renderHotbar() {
    const inv = this.game.inv;
    $('.hotbar', this.root).innerHTML = inv.slots.slice(0, HOTBAR).map((s, i) => `<div class="slot ${i === inv.sel ? 'sel' : ''}" data-hot="${i}">${this.stackHTML(s)}</div>`).join('');
    this.root.querySelectorAll<HTMLElement>('[data-hot]').forEach(el => el.addEventListener('pointerdown', e => { e.stopPropagation(); inv.sel = +el.dataset.hot!; this.renderHotbar(); }));
    const held = inv.held();
    const name = held ? nm(ITEM[held.k]) : '';
    let tip = $('.helditem', this.root); if (!tip) { tip = document.createElement('div'); tip.className = 'helditem'; this.root.appendChild(tip); }
    tip.textContent = name; tip.classList.remove('show'); void tip.offsetWidth; if (name) tip.classList.add('show');
  }
  stackHTML(s: Stack | null) {
    if (!s) return '';
    const d = ITEM[s.k], dur = d?.tool ? 1 - (s.d ?? 0) / d.tool.durability : d?.armor ? 1 - (s.d ?? 0) / d.armor.durability : 1;
    return `<img src="${itemIcon(s.k)}" alt="" draggable="false">${s.n > 1 ? `<b>${s.n}</b>` : ''}${dur < 1 ? `<u style="width:${dur * 100}%;background:${dur > 0.5 ? '#6c6' : dur > 0.2 ? '#ec4' : '#e44'}"></u>` : ''}`;
  }
  refresh() { this.renderHotbar(); this.renderBars(); if (this.open === 'inv') this.renderInventory(); }

  // ---------------- panels ----------------
  close() {
    if (this.cursor) { this.game.inv.add(this.cursor.k, this.cursor.n); this.cursor = null; this.renderCursor(); }
    if (this.container) { this.game.closeLid(); this.container = null; }
    this.returnGrid();
    this.open = null; $('.panel', this.root).hidden = true; this.root.classList.remove('panel-open');
    this.game.paused = false;
  }
  openContainer(key: string) {
    this.container = key; this.station = 'hand'; this.open = 'inv'; this.game.paused = true; this.root.classList.add('panel-open');
    $('.panel', this.root).hidden = false; this.renderInventory();
  }
  private cont(): Container | null { return this.container ? this.game.containers[this.container] ?? null : null; }
  private containerHTML(slot: (s: Stack | null, id: string, extra?: string) => string) {
    const c = this.cont()!;
    if (c.kind === 'chest') return `<h3>${t('chest.title')}</h3><div class="grid chest">${c.slots.map((s, i) => slot(s, 'c' + i)).join('')}</div><p class="hint">${t('cont.hint')}</p>`;
    const cook = Math.min(1, c.cook / SMELT_TIME), burn = c.burnMax ? c.burn / c.burnMax : 0;
    const res = c.input ? smeltResult(c.input.k) : null;
    return `<h3>${t('furnace.title')}</h3>
      <div class="furnace">
        <div class="fcol"><small>${t('furnace.input')}</small>${slot(c.input, 'fin')}<div class="flame"><i style="height:${Math.round(burn * 100)}%"></i></div>${slot(c.fuel, 'ffu')}<small>${t('furnace.fuel')}</small></div>
        <div class="farrow"><i style="width:${Math.round(cook * 100)}%"></i>${res ? `<img src="${itemIcon(res.out)}" alt="">` : ''}</div>
        <div class="fcol"><small>${t('furnace.output')}</small>${slot(c.out, 'fout', 'big')}</div>
      </div><p class="hint">${t('furnace.hint')}</p><p class="hint">${t('cont.hint')}</p>`;
  }
  openInventory(station = 'hand') {
    this.station = station; this.container = null; this.open = 'inv'; this.game.paused = true; this.root.classList.add('panel-open');
    $('.panel', this.root).hidden = false; this.renderInventory();
  }
  private tooltip(k: string) {
    const d = ITEM[k]; if (!d) return '';
    const lines = [nm(d)];
    if (d.tool) lines.push(t('inv.tier', { n: d.tool.tier }), t('inv.damage', { n: d.tool.damage }));
    if (d.food?.hunger) lines.push(t('inv.food', { n: d.food.hunger })); if (d.food?.thirst && d.food.thirst > 0) lines.push(t('inv.water', { n: d.food.thirst }));
    if (d.food?.sick) lines.push('⚠ ' + t('inv.risky')); if (d.food?.cure) lines.push('✚ ' + t('inv.cures'));
    return esc(lines.join('\n'));
  }
  /** put everything in the crafting grid back in your bags */
  private returnGrid() {
    const g = this.game;
    for (let i = 0; i < 9; i++) { const s = this.grid[i]; if (!s) continue; const left = g.inv.add(s.k, s.n); if (left) g.dropItem(s.k, left, g.player.pos.clone().setY(g.player.pos.y + 1), false); this.grid[i] = null; }
  }
  private gridSize() { const st = this.game.stations; return this.station !== 'hand' || [...st].some(s => s !== 'hand' && s !== 'furnace') ? 3 : 2; }
  /** recipe book: fill the grid with what a recipe needs from your bags */
  private fillGrid(r: Recipe) {
    const g = this.game, inv = g.inv, size = this.gridSize();
    this.returnGrid(); this.pick = 0;
    const parts = pickIngredients(r, k => inv.count(k), () => inv.all());
    if (parts.length > size * size) { this.toast(t('inv.needBigger'), 'bad'); return; }
    let slot = 0, missing = false;
    for (const p of parts) {
      const take = Math.min(p.n, inv.count(p.k));
      if (take < p.n) missing = true;
      if (take > 0) { inv.remove(p.k, take); const idx = size === 3 ? slot : [0, 1, 3, 4][slot]; this.grid[idx] = { k: p.k, n: take }; }
      slot++;
    }
    if (missing) this.toast(t('inv.missing'), 'bad');
  }
  private craftHTML(slot: (s: Stack | null, id: string, extra?: string) => string) {
    const size = this.gridSize(), stations = new Set(this.game.stations); if (this.station !== 'hand') stations.add(this.station);
    if (size === 2) for (const i of [2, 5, 6, 7, 8]) if (this.grid[i]) { const s = this.grid[i]!; this.grid[i] = null; this.game.inv.add(s.k, s.n); }
    const ms = matchGrid(this.grid, stations), m = ms[this.pick % Math.max(1, ms.length)];
    const cells = size === 3 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 3, 4];
    return `<div class="craft">
      <div class="cgrid s${size}">${cells.map(i => slot(this.grid[i], 'g' + i)).join('')}</div>
      <div class="carrow">➜</div>
      <div class="cout">
        <div class="slot big result ${m ? 'ok' : ''}" data-out title="${m ? this.tooltip(m.r.out) : ''}">${m ? this.stackHTML({ k: m.r.out, n: m.r.n }) : ''}</div>
        ${ms.length > 1 ? `<button class="btn small" data-nextout>⟳ ${this.pick % ms.length + 1}/${ms.length}</button>` : ''}
        ${m && m.times > 1 ? `<small>×${m.times}</small>` : ''}
      </div></div>
      <p class="hint">${t('inv.gridHint')}</p>`;
  }
  renderInventory() {
    const g = this.game, inv = g.inv, panel = $('.panel', this.root);
    const slot = (s: Stack | null, id: string, extra = '') => `<div class="slot ${extra}" data-slot="${id}" title="${s ? this.tooltip(s.k) : ''}">${this.stackHTML(s)}</div>`;
    const stations = g.stations; if (this.station !== 'hand') stations.add(this.station);
    const list = RECIPES.filter(r => stations.has(r.at) && r.at !== 'furnace')
      .filter(r => !this.recipeFilter || nm(ITEM[r.out]).toLowerCase().includes(this.recipeFilter.toLowerCase()))
      .filter(r => !this.onlyMakeable || inv.canCraft(r));
    // group: makeable first
    list.sort((a, b) => Number(inv.canCraft(b)) - Number(inv.canCraft(a)));
    const shown = list.slice(0, 120);
    const locked = RECIPES.filter(r => !stations.has(r.at) && r.at !== 'furnace').map(r => r.at);
    const nextStation = [...new Set(locked)].slice(0, 4).map(s => t(('inv.station.' + s) as any)).join(', ');
    if (this.cont()) {
      const c = this.cont()!;
      panel.innerHTML = `<div class="inv chestui ${c.kind}"><button class="close">✕</button>
        <div class="ctop">${this.containerHTML(slot)}</div>
        <div class="cbags"><h4>🎒 ${t('cont.yours')}</h4>
          <div class="grid main">${inv.slots.slice(HOTBAR, SLOTS).map((s2, i) => slot(s2, String(HOTBAR + i))).join('')}</div>
          <div class="grid hot">${inv.slots.slice(0, HOTBAR).map((s2, i) => slot(s2, String(i), i === inv.sel ? 'sel' : '')).join('')}</div></div></div>`;
    } else panel.innerHTML = `
      <div class="inv">
        <div class="col left">
          <h3>${t('inv.title')} ${g.stations.has('designer') ? `<button class="btn small" data-bm>🧱 ${t('bm.open')}</button>` : ''}</h3>
          <div class="armor">${ARMOR_SLOTS.map((a, i) => slot(inv.armor[i], 'a' + i, 'armor-' + a)).join('')}${slot(inv.offhand, 'off', 'offhand')}</div>
          <div class="grid main">${inv.slots.slice(HOTBAR, SLOTS).map((s, i) => slot(s, String(HOTBAR + i))).join('')}</div>
          <div class="grid hot">${inv.slots.slice(0, HOTBAR).map((s, i) => slot(s, String(i), i === inv.sel ? 'sel' : '')).join('')}</div>
          <p class="hint">${t('inv.dropHint')}</p>
        </div>
        ${this.cont() ? `<div class="col right">${this.containerHTML(slot)}</div>` : `<div class="col right">
          <h3>${t('inv.crafting')} · <span class="st">${[...stations].map(s => t(('inv.station.' + s) as any)).join(' · ')}</span></h3>
          ${this.craftHTML(slot)}
          <h4 class="bookh">📖 ${t('inv.book')}</h4>
          <div class="rtools"><input class="rsearch" placeholder="${t('inv.search')}" value="${esc(this.recipeFilter)}"><label><input type="checkbox" class="rmake" ${this.onlyMakeable ? 'checked' : ''}> ${t('inv.canMake')}</label></div>
          <div class="recipes">${shown.map((r, i) => this.recipeHTML(r, i, inv.canCraft(r))).join('')}</div>
          ${nextStation ? `<p class="hint">${t('inv.nearStation', { s: nextStation })}</p>` : ''}
        </div>`}
        <button class="close">✕</button>
      </div>`;
    $('.close', panel).onclick = () => this.close();
    const bm = panel.querySelector<HTMLElement>('[data-bm]'); if (bm) bm.onclick = () => { this.close(); this.onBlockMaker(); };
    const out = panel.querySelector<HTMLElement>('[data-out]');
    if (out) out.addEventListener('pointerdown', e => {
      e.preventDefault();
      const st = new Set(g.stations); if (this.station !== 'hand') st.add(this.station);
      const ms = matchGrid(this.grid, st), m = ms[this.pick % Math.max(1, ms.length)]; if (!m) return;
      let made = 0;
      const batches = e.shiftKey ? m.times : 1;
      for (let b = 0; b < batches; b++) {
        if (!consume(this.grid, m.r)) break;
        const left = inv.add(m.r.out, m.r.n); if (left) g.dropItem(m.r.out, left, g.player.pos.clone().setY(g.player.pos.y + 1), false);
        made++;
      }
      if (made) { sound.play('craft', { vol: 0.5 }); this.toast(t('inv.made', { n: made * m.r.n, item: nm(ITEM[m.r.out]) }), 'good'); }
      this.renderInventory(); this.renderHotbar();
    });
    const nx = panel.querySelector<HTMLElement>('[data-nextout]'); if (nx) nx.onclick = () => { this.pick++; this.renderInventory(); };
    const search = panel.querySelector<HTMLInputElement>('.rsearch');
    if (search) search.oninput = () => { this.recipeFilter = search.value; const pos = search.selectionStart; this.renderInventory(); const s2 = $<HTMLInputElement>('.rsearch', panel); s2.focus(); s2.setSelectionRange(pos, pos); };
    const rmake = panel.querySelector<HTMLInputElement>('.rmake'); if (rmake) rmake.onchange = e => { this.onlyMakeable = (e.target as HTMLInputElement).checked; this.renderInventory(); };
    // recipe book: tap a recipe to lay its ingredients in the grid, then take the result
    panel.querySelectorAll<HTMLElement>('[data-recipe]').forEach(el => el.addEventListener('click', () => {
      this.fillGrid(shown[+el.dataset.recipe!]); sound.play('click', { vol: 0.3 });
      this.renderInventory(); this.renderHotbar();
    }));
    panel.querySelectorAll<HTMLElement>('[data-slot]').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); this.clickSlot(el.dataset.slot!, e.button === 2, e.shiftKey); });
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('touchstart', e => { e.preventDefault(); this.clickSlot(el.dataset.slot!, false, false); }, { passive: false });
    });
  }
  private recipeHTML(r: Recipe, i: number, ok: boolean) {
    const TAG_ICON: Record<string, string> = { '#planks': 'oak_planks', '#log': 'oak_log', '#raw_meat': 'raw_venison', '#cooked_meat': 'cooked_venison' };
    const ins = Object.entries(r.in).map(([k, n]) => {
      const key = TAG_ICON[k] ?? k;
      const have = this.game.inv.count(k);
      return `<span class="${have >= n ? 'have' : 'need'}"><img src="${itemIcon(key)}" alt="">${n}</span>`;
    }).join('');
    return `<div class="recipe ${ok ? 'ok' : ''}" data-recipe="${i}" title="${this.tooltip(r.out)}"><img src="${itemIcon(r.out)}" alt=""><div><b>${esc(nm(ITEM[r.out]))}${r.n > 1 ? ' ×' + r.n : ''}</b><div class="ins">${ins}</div></div></div>`;
  }
  private getSlot(id: string): Stack | null {
    const inv = this.game.inv, c = this.cont();
    if (id[0] === 'g') return this.grid[+id.slice(1)];
    if (id === 'off') return inv.offhand; if (id[0] === 'a') return inv.armor[+id.slice(1)];
    if (c?.kind === 'chest' && id[0] === 'c') return c.slots[+id.slice(1)];
    if (c?.kind === 'furnace' && id[0] === 'f') return id === 'fin' ? c.input : id === 'ffu' ? c.fuel : c.out;
    return inv.slots[+id];
  }
  private setSlot(id: string, s: Stack | null) {
    const inv = this.game.inv, c = this.cont();
    if (id[0] === 'g') { this.grid[+id.slice(1)] = s; this.pick = 0; return; }
    if (id === 'off') inv.offhand = s; else if (id[0] === 'a') inv.armor[+id.slice(1)] = s;
    else if (c?.kind === 'chest' && id[0] === 'c') c.slots[+id.slice(1)] = s;
    else if (c?.kind === 'furnace' && id[0] === 'f') { if (id === 'fin') c.input = s; else if (id === 'ffu') c.fuel = s; else c.out = s; }
    else inv.slots[+id] = s;
    if ((id[0] === 'c' || id[0] === 'f') && this.container) this.game.containerChanged(this.container);
  }
  private fits(id: string, s: Stack | null) {
    if (!s) return true;
    if (id === 'fout') return false;
    if (id === 'ffu') return fuelOf(s.k) > 0;
    if (id[0] !== 'a') return true;
    return ITEM[s.k]?.armor?.slot === ARMOR_SLOTS[+id.slice(1)];
  }
  /** shift-click between your inventory and an open chest or furnace */
  private quickMove(id: string, cur: Stack) {
    const inv = this.game.inv, c = this.cont()!;
    if (id[0] === 'c' || id[0] === 'f') { this.setSlot(id, null); const left = inv.add(cur.k, cur.n); if (left) this.setSlot(id, { ...cur, n: left }); return; }
    if (c.kind === 'furnace') {
      const to = smeltResult(cur.k) && !(c.input && c.input.k !== cur.k) ? 'fin' : fuelOf(cur.k) > 0 && !(c.fuel && c.fuel.k !== cur.k) ? 'ffu' : null;
      if (!to) return;
      const there = this.getSlot(to), max = ITEM[cur.k].stack, m = Math.min(cur.n, max - (there?.n ?? 0));
      if (m <= 0) return;
      this.setSlot(to, { k: cur.k, n: (there?.n ?? 0) + m }); cur.n -= m; if (cur.n <= 0) this.setSlot(id, null);
      return;
    }
    let left = cur.n; const max = ITEM[cur.k]?.stack ?? 64;
    for (let i = 0; i < CHEST_SLOTS && left; i++) { const s = c.slots[i]; if (s && s.k === cur.k && !s.d && s.n < max) { const m = Math.min(left, max - s.n); s.n += m; left -= m; } }
    for (let i = 0; i < CHEST_SLOTS && left; i++) if (!c.slots[i]) { c.slots[i] = { ...cur, n: left }; left = 0; }
    this.setSlot(id, left ? { ...cur, n: left } : null);
    this.game.containerChanged(this.container!);
  }
  private clickSlot(id: string, right: boolean, shift: boolean) {
    const inv = this.game.inv;
    let cur = this.getSlot(id);
    if (shift && cur && !this.cursor && this.cont()) { this.quickMove(id, cur); inv.onChange(); sound.play('click', { vol: 0.3 }); this.renderInventory(); return; }
    if (shift && cur && !this.cursor) {
      // quick move between hotbar/backpack, or wear armour
      const d = ITEM[cur.k];
      if (d?.armor && id[0] !== 'a') { const ai = ARMOR_SLOTS.indexOf(d.armor.slot); const old = inv.armor[ai]; inv.armor[ai] = cur; this.setSlot(id, old); }
      else {
        this.setSlot(id, null);
        const n = +id, toHot = isNaN(n) || n >= HOTBAR;
        const range = toHot ? [0, HOTBAR] : [HOTBAR, SLOTS];
        let left = cur.n;
        for (let i = range[0]; i < range[1] && left; i++) { const s = inv.slots[i]; if (s && s.k === cur.k && !s.d && s.n < ITEM[s.k].stack) { const m = Math.min(left, ITEM[s.k].stack - s.n); s.n += m; left -= m; } }
        for (let i = range[0]; i < range[1] && left; i++) if (!inv.slots[i]) { inv.slots[i] = { ...cur, n: left }; left = 0; }
        if (left) this.setSlot(id, { ...cur, n: left });
      }
      inv.onChange(); this.renderInventory(); return;
    }
    if (!this.cursor) {
      if (!cur) return;
      if (right && cur.n > 1) { const half = Math.ceil(cur.n / 2); this.cursor = { ...cur, n: half }; cur.n -= half; }
      else { this.cursor = cur; this.setSlot(id, null); }
    } else {
      if (!this.fits(id, this.cursor)) return;
      if (!cur) {
        if (right) { this.setSlot(id, { ...this.cursor, n: 1 }); this.cursor.n--; if (this.cursor.n <= 0) this.cursor = null; }
        else { this.setSlot(id, this.cursor); this.cursor = null; }
      } else if (cur.k === this.cursor.k && !cur.d && !this.cursor.d) {
        const max = ITEM[cur.k].stack, m = Math.min(right ? 1 : this.cursor.n, max - cur.n);
        cur.n += m; this.cursor.n -= m; if (this.cursor.n <= 0) this.cursor = null;
      } else { this.setSlot(id, this.cursor); this.cursor = cur; }
    }
    sound.play('click', { vol: 0.3 });
    if (this.container && (id[0] === 'c' || id[0] === 'f')) this.game.containerChanged(this.container);
    inv.onChange(); this.renderCursor(); this.renderInventory();
  }
  private renderCursor() { const c = $('.cursor-item', this.root); c.hidden = !this.cursor; c.innerHTML = this.stackHTML(this.cursor); }

  // ---------------- blueprint table ----------------
  openBlueprints() {
    this.open = 'bp'; this.game.paused = true; this.root.classList.add('panel-open');
    const panel = $('.panel', this.root); panel.hidden = false;
    const g = this.game, paper = g.inv.count('blueprint_paper');
    const card = (bp: Blueprint, mine: boolean) => {
      const need = g.planNeeds(bp), ok = need.every(n => n.have >= n.n);
      const name = bp.nameKey ? t(bp.nameKey as any) : bp.name;
      return `<div class="bpcard"><div class="bphead"><b>${esc(name)}</b><small>${bp.w}×${bp.h}×${bp.d} · ${t('bp.blocks', { n: need.reduce((a, n) => a + n.n, 0) })}</small></div>
        <div class="ins">${need.map(n => `<span class="${n.have >= n.n ? 'have' : 'need'}" title="${esc(nm(ITEM[n.k]))}"><img src="${itemIcon(n.k)}" alt="">${n.n}</span>`).join('')}</div>
        <div class="row"><button class="btn ${ok ? 'big' : ''}" data-use="${bp.id}">${t('bp.make')}</button>${mine ? `<button class="icon" data-delbp="${bp.id}">🗑</button>` : ''}</div></div>`;
    };
    const mine = myBlueprints(), built = builtinBlueprints();
    panel.innerHTML = `<div class="bp"><button class="close">✕</button>
      <h3>${t('bp.title')} <small>· ${nm(ITEM.blueprint_paper)}: ${paper}</small></h3>
      <h4>${t('bp.builtin')}</h4><div class="bpgrid">${built.map(b => card(b, false)).join('')}</div>
      <h4>${t('bp.mine')}</h4><div class="bpgrid">${mine.map(b => card(b, true)).join('') || '<p class="muted">—</p>'}</div>
      <h4>${t('bp.save')}</h4><p class="muted">${t('bp.cornerHint')}</p>
      <div class="row"><input class="bpname" maxlength="24" placeholder="${t('bp.saveName')}"><button class="btn" data-mark>${t('bp.cornerA')} → ${t('bp.cornerB')}</button></div></div>`;
    $('.close', panel).onclick = () => this.close();
    panel.querySelectorAll<HTMLElement>('[data-use]').forEach(b => b.onclick = () => {
      const bp = [...built, ...mine].find(x => x.id === b.dataset.use)!;
      if (g.inv.count('blueprint_paper') < 1) { this.toast(t('bp.noPaper'), 'bad'); return; }
      g.inv.remove('blueprint_paper', 1); g.startGhost(bp); this.close(); g.input.requestLock();
    });
    panel.querySelectorAll<HTMLElement>('[data-delbp]').forEach(b => b.onclick = () => { deleteBlueprint(b.dataset.delbp!); this.openBlueprints(); });
    panel.querySelector<HTMLElement>('[data-mark]')!.onclick = () => {
      const name = (panel.querySelector('.bpname') as HTMLInputElement).value.trim() || t('bp.mine');
      g.startSelecting(name.slice(0, 24)); this.close(); g.input.requestLock();
    };
    g.onCaptured = r => {
      if (r === 'big') this.toast(t('bp.tooBig'), 'bad');
      else if (r === 'empty') this.toast(t('bp.empty'), 'bad');
      else { saveBlueprint(r); this.toast(t('bp.saved', { name: r.name, n: r.cells.filter(c => c[3] !== 'air').length }), 'good'); sound.play('discover'); }
    };
  }

  openPause(onSettings: () => void) {
    this.open = 'pause'; this.game.paused = true; this.root.classList.add('panel-open');
    const panel = $('.panel', this.root); panel.hidden = false;
    panel.innerHTML = `<div class="pause"><h2>${t('hud.paused')}</h2>
      <button class="btn big" data-a="resume">${t('hud.resume')}</button>
      <button class="btn" data-a="settings">${t('tab.settings')}</button>
      <button class="btn" data-a="quit">${t('hud.saveQuit')}</button></div>`;
    panel.querySelector<HTMLElement>('[data-a=resume]')!.onclick = () => { this.close(); this.game.input.requestLock(); };
    panel.querySelector<HTMLElement>('[data-a=settings]')!.onclick = () => onSettings();
    panel.querySelector<HTMLElement>('[data-a=quit]')!.onclick = () => this.onQuit();
  }
  showDeath(newName: string | null, grave: { x: number; z: number } | null) {
    this.open = 'dead'; this.game.paused = true; this.root.classList.add('panel-open');
    const panel = $('.panel', this.root); panel.hidden = false;
    panel.innerHTML = `<div class="pause dead"><h2>${t('hud.dead')}</h2>${newName ? `<p>${esc(t('hud.newLife', { name: newName, x: grave ? grave.x : '—', z: grave ? grave.z : '—' }))}</p>` : ''}<button class="btn big">${t('hud.continue')}</button></div>`;
    panel.querySelector<HTMLElement>('button')!.onclick = () => { this.close(); this.onRebirth(); };
  }

  // ---------------- map ----------------
  private mapScale = 0.6;
  openMap() {
    this.open = 'map'; this.game.paused = true; this.root.classList.add('panel-open');
    const panel = $('.panel', this.root); panel.hidden = false;
    panel.innerHTML = `<div class="mapwrap"><h3>${t('map.title')} <small>${t('map.addWaypoint')}</small></h3><canvas class="map"></canvas>
      <div class="maptools"><span class="mcoords"></span><button class="btn" data-a="clear">${t('map.clear')}</button><button class="btn" data-a="close">${t('map.close')}</button></div></div>`;
    panel.querySelector<HTMLElement>('[data-a=close]')!.onclick = () => this.close();
    panel.querySelector<HTMLElement>('[data-a=clear]')!.onclick = () => { this.game.waypoints = []; this.drawMap(); };
    const cv = $<HTMLCanvasElement>('canvas.map', panel);
    cv.onclick = e => {
      const r = cv.getBoundingClientRect(), p = this.game.player.pos, s = this.mapScale * (cv.width / r.width);
      const x = Math.round(p.x + (e.clientX - r.left - r.width / 2) * s), z = Math.round(p.z + (e.clientY - r.top - r.height / 2) * s);
      this.game.waypoints.push({ x, z, label: String(this.game.waypoints.length + 1) }); this.toast(t('hud.waypointAdded')); this.drawMap();
    };
    cv.onwheel = e => { this.mapScale = Math.max(0.5, Math.min(16, this.mapScale * (e.deltaY > 0 ? 1.25 : 0.8))); this.drawMap(); };
    this.drawMap();
  }
  drawMap() {
    const cv = this.root.querySelector<HTMLCanvasElement>('canvas.map'); if (!cv) return;
    const W = Math.min(900, innerWidth - 40), H = Math.min(640, innerHeight - 140);
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!, game = this.game, p = game.player.pos, s = this.mapScale;
    g.fillStyle = '#0b0f17'; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H), step = 3;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const wx = Math.floor(p.x + (x - W / 2) * s), wz = Math.floor(p.z + (y - H / 2) * s);
      if (!game.explored.has(`${wx >> 3},${wz >> 3}`)) continue;
      const c = game.world.gen.column(wx, wz), b = BIOMES[c.biome];
      const n = parseInt(b.color.slice(1), 16); let r = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
      const shade = c.biome === 0 ? 0.6 + (c.h - 30) / 80 : 0.75 + (c.h - 62) / 160;
      if (c.river) { r = 50; gg = 110; bb = 190; }
      for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) { const i = ((y + dy) * W + x + dx) * 4; img.data[i] = r * shade; img.data[i + 1] = gg * shade; img.data[i + 2] = bb * shade; img.data[i + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    const toPx = (x: number, z: number) => [W / 2 + (x - p.x) / s, H / 2 + (z - p.z) / s];
    // graves, waypoints, friends, you
    for (const gr of game.myGraves()) { const [x, y] = toPx(gr.x, gr.z); g.font = '18px system-ui'; g.fillText('🪦', x - 9, y + 6); }
    g.fillStyle = '#ffd23f'; g.font = 'bold 13px system-ui';
    for (const w of game.waypoints) { const [x, y] = toPx(w.x, w.z); g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.fillText(`${w.label} (${w.x}, ${w.z})`, x + 9, y + 4); }
    for (const r of game.remotes.values()) { const [x, y] = toPx(r.pos.x, r.pos.z); g.fillStyle = '#4cc9f0'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText(r.name, x + 9, y + 4); }
    g.save(); g.translate(W / 2, H / 2); g.rotate(-game.player.yaw + Math.PI); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(-7, 8); g.closePath(); g.fill(); g.restore();
    const mc = this.root.querySelector<HTMLElement>('.mcoords'); if (mc) mc.textContent = `${t('map.you')}: ${t('hud.coords', { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })}`;
  }
}
