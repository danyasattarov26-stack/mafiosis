/*
  Block Maker: paint the six 16×16 faces of a new block, pick what it does and how it's crafted,
  and save it to your library and the current world. The 3D preview can be resized, but the block
  itself is always exactly one cube.
*/
import * as THREE from 'three';
import { t, nm } from '../i18n/i18n';
import { BLOCKS } from '../shared/blocks';
import { ITEMS, ITEM, type Station } from '../shared/items';
import { FUNCTIONS, encodeFace, facePixels, library, saveToLibrary, tiles6, customIds, type BlockFunction, type CustomBlock } from '../shared/custom';
import { newCode } from '../net/coop';
import { sound } from '../audio/audio';
import type { Game } from '../game/game';

const PALETTE = ['#000000', '#ffffff', '#7f7f7f', '#c8c8c8', '#8a5a32', '#b48a52', '#5f9e3c', '#2f6a35', '#2a6fb0', '#7fd7ff', '#e23b3b', '#f08a2a', '#f2d23a', '#9b5de5', '#f15bb5', '#3a3b40'];
const STATIONS: Station[] = ['hand', 'workbench', 'furnace', 'anvil', 'lab'];
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class BlockMaker {
  root: HTMLElement;
  private faces: Uint8ClampedArray[] = [];
  private face = 2; private tool: 'pencil' | 'fill' | 'erase' | 'pick' = 'pencil'; private color = '#5f9e3c';
  private fn: BlockFunction = 'solid'; private name = ''; private recipe: [string, number][] = [['', 1], ['', 1], ['', 1]]; private at: Station = 'workbench'; private n = 4;
  private renderer: THREE.WebGLRenderer | null = null; private scene = new THREE.Scene(); private cam = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  private cube!: THREE.Mesh; private textures: THREE.CanvasTexture[] = []; private canvases: HTMLCanvasElement[] = []; private raf = 0; private scale = 1;
  private painting = false; private prevCanvas: HTMLCanvasElement | null = null;

  constructor(private game: Game, private onClose: () => void) {
    this.root = document.createElement('div'); this.root.className = 'overlay bm-wrap';
    document.body.appendChild(this.root);
    this.loadFrom(BLOCKS.findIndex(b => b.key === 'oak_planks'));
    this.render();
  }
  close() { cancelAnimationFrame(this.raf); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.root.remove(); this.onClose(); }

  /** copy an existing block's six faces into the editor */
  private loadFrom(id: number) {
    const six = tiles6(id);
    this.faces = six.map(tile => {
      const c = this.game.atlas.canvasFor(tile);
      return new Uint8ClampedArray(c.getContext('2d')!.getImageData(0, 0, 16, 16).data);
    });
  }

  private render() {
    const opts = (sel: string, list: [string, string][]) => list.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const cubes = BLOCKS.map((b, i) => [i, b] as const).filter(([i, b]) => i > 0 && (b.render ?? 'cube') === 'cube' && b.hard >= 0);
    this.root.innerHTML = `<div class="bm">
      <button class="close">✕</button>
      <h3>${t('bm.title')}</h3>
      <div class="bm-cols">
        <div class="bm-edit">
          <div class="seg faces">${[2, 5, 0, 4, 1, 3].map(f => `<button data-face="${f}" class="${f === this.face ? 'on' : ''}">${t(('bm.face.' + f) as any)}</button>`).join('')}</div>
          <canvas class="pix" width="320" height="320"></canvas>
          <div class="seg tools">${(['pencil', 'fill', 'erase', 'pick'] as const).map(k => `<button data-tool="${k}" class="${k === this.tool ? 'on' : ''}">${t(('bm.' + k) as any)}</button>`).join('')}</div>
          <div class="row"><input type="color" class="col" value="${this.color}">${PALETTE.map(c => `<button class="sw" data-col="${c}" style="background:${c}"></button>`).join('')}</div>
          <div class="row"><button class="btn" data-a="mirror">${t('bm.mirror')}</button><button class="btn" data-a="copyall">${t('bm.copyAll')}</button><button class="btn" data-a="clear">${t('bm.clear')}</button></div>
          <label class="field"><span>${t('bm.from')}</span><select class="from"><option value="">—</option>${cubes.map(([i, b]) => `<option value="${i}">${esc(nm(b))}</option>`).join('')}</select></label>
        </div>
        <div class="bm-prev">
          <div class="prevslot"></div>
          <p class="muted">${t('bm.preview')}</p>
          <label class="field slider"><span>${t('bm.scale')}</span><input type="range" class="scale" min="0.4" max="2" step="0.05" value="${this.scale}"></label>
        </div>
        <div class="bm-def">
          <label class="field"><span>${t('bm.name')}</span><input class="bname" maxlength="24" value="${esc(this.name)}"></label>
          <label class="field"><span>${t('bm.fn')}</span><select class="fn">${opts(this.fn, FUNCTIONS.map(f => [f, t(('bm.fn.' + f) as any)]))}</select></label>
          <h4>${t('bm.recipe')}</h4>
          <datalist id="bm-items">${ITEMS.filter(i => !i.tags?.includes('custom')).map(i => `<option value="${esc(nm(i))}">`).join('')}</datalist>
          ${this.recipe.map(([k, n], i) => `<div class="row ing"><input list="bm-items" data-ing="${i}" placeholder="${t('bm.ingredient')}" value="${k ? esc(nm(ITEM[k])) : ''}"><input type="number" min="1" max="64" data-cnt="${i}" value="${n}"></div>`).join('')}
          <label class="field"><span>${t('bm.at')}</span><select class="at">${opts(this.at, STATIONS.map(s => [s, t(('inv.station.' + s) as any)]))}</select></label>
          <label class="field"><span>${t('bm.makes')}</span><input type="number" class="makes" min="1" max="16" value="${this.n}"></label>
          <button class="btn big" data-a="save">${t('bm.save')}</button>
          <h4>${t('bm.library')}</h4>
          <div class="bm-lib">${library().map(c => `<button class="libb" data-lib="${c.key}" title="${t('bm.edit')}"><img src="${faceURL(c.faces[0])}" alt=""><span>${esc(c.name)}</span></button>`).join('') || '<p class="muted">—</p>'}</div>
        </div>
      </div></div>`;
    const $ = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    $('.close').onclick = () => this.close();
    this.root.querySelectorAll<HTMLElement>('[data-face]').forEach(b => b.onclick = () => { this.face = +b.dataset.face!; this.syncLocal(); this.render(); });
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.onclick = () => { this.tool = b.dataset.tool as any; this.syncLocal(); this.render(); });
    this.root.querySelectorAll<HTMLElement>('[data-col]').forEach(b => b.onclick = () => { this.color = b.dataset.col!; $<HTMLInputElement>('.col').value = this.color; if (this.tool === 'erase' || this.tool === 'pick') { this.tool = 'pencil'; this.syncLocal(); this.render(); } });
    $<HTMLInputElement>('.col').oninput = e => { this.color = (e.target as HTMLInputElement).value; };
    $<HTMLSelectElement>('.from').onchange = e => { const v = (e.target as HTMLSelectElement).value; if (v) { this.loadFrom(+v); this.syncLocal(); this.render(); } };
    $<HTMLInputElement>('.scale').oninput = e => { this.scale = +(e.target as HTMLInputElement).value; };
    this.root.querySelector<HTMLElement>('[data-a=mirror]')!.onclick = () => { this.mirror(); };
    this.root.querySelector<HTMLElement>('[data-a=copyall]')!.onclick = () => { for (let f = 0; f < 6; f++) if (f !== this.face) this.faces[f] = new Uint8ClampedArray(this.faces[this.face]); this.refreshAll(); };
    this.root.querySelector<HTMLElement>('[data-a=clear]')!.onclick = () => { this.faces[this.face].fill(0); this.refreshAll(); };
    this.root.querySelector<HTMLElement>('[data-a=save]')!.onclick = () => this.save();
    this.root.querySelectorAll<HTMLElement>('[data-lib]').forEach(b => b.onclick = () => {
      const c = library().find(x => x.key === b.dataset.lib); if (!c) return;
      this.faces = c.faces.map(facePixels); this.name = c.name; this.fn = c.fn; this.at = c.at; this.n = c.n;
      this.recipe = [...Object.entries(c.recipe), ['', 1], ['', 1], ['', 1]].slice(0, 3) as [string, number][];
      this.render();
    });
    this.bindPainter($<HTMLCanvasElement>('.pix'));
    this.drawEditor();
    if (!this.prevCanvas) { this.prevCanvas = document.createElement('canvas'); this.prevCanvas.className = 'prev'; this.prevCanvas.width = this.prevCanvas.height = 220; }
    $('.prevslot').appendChild(this.prevCanvas);
    this.setupPreview(this.prevCanvas);
  }
  /** keep typed-in values when the panel re-renders */
  private syncLocal() {
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T | null;
    this.name = q<HTMLInputElement>('.bname')?.value ?? this.name;
    this.fn = (q<HTMLSelectElement>('.fn')?.value as BlockFunction) ?? this.fn;
    this.at = (q<HTMLSelectElement>('.at')?.value as Station) ?? this.at;
    this.n = +(q<HTMLInputElement>('.makes')?.value ?? this.n);
    this.recipe = this.recipe.map(([, n], i) => {
      const name = q<HTMLInputElement>(`[data-ing="${i}"]`)?.value.trim() ?? '';
      const it = ITEMS.find(x => nm(x).toLowerCase() === name.toLowerCase());
      return [it?.key ?? '', Math.max(1, Math.min(64, +(q<HTMLInputElement>(`[data-cnt="${i}"]`)?.value ?? n) || 1))];
    });
  }

  // ---------- painting ----------
  private bindPainter(cv: HTMLCanvasElement) {
    const at = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * 16), Math.floor((e.clientY - r.top) / r.height * 16)]; };
    cv.onpointerdown = e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); this.painting = true; const [x, y] = at(e); this.apply(x, y); };
    cv.onpointermove = e => { if (this.painting && (this.tool === 'pencil' || this.tool === 'erase')) { const [x, y] = at(e); this.apply(x, y); } };
    cv.onpointerup = () => { this.painting = false; };
  }
  private apply(x: number, y: number) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const px = this.faces[this.face], i = (y * 16 + x) * 4;
    const c = new THREE.Color(this.color), rgb = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
    if (this.tool === 'pick') { if (px[i + 3]) { this.color = '#' + [px[i], px[i + 1], px[i + 2]].map(v => v.toString(16).padStart(2, '0')).join(''); (this.root.querySelector('.col') as HTMLInputElement).value = this.color; } this.tool = 'pencil'; this.syncLocal(); this.render(); return; }
    if (this.tool === 'pencil') { px.set([...rgb, 255], i); }
    if (this.tool === 'erase') { px.set([0, 0, 0, 0], i); }
    if (this.tool === 'fill') {
      const target = px.slice(i, i + 4).join(), q = [[x, y]], seen = new Set<number>();
      while (q.length) {
        const [qx, qy] = q.pop()!; if (qx < 0 || qy < 0 || qx > 15 || qy > 15) continue;
        const k = qy * 16 + qx; if (seen.has(k)) continue; seen.add(k);
        if (px.slice(k * 4, k * 4 + 4).join() !== target) continue;
        px.set([...rgb, 255], k * 4); q.push([qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]);
      }
    }
    this.drawEditor(); this.updateFace(this.face);
  }
  private mirror() {
    const px = this.faces[this.face], out = new Uint8ClampedArray(px.length);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out.set(px.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4), (y * 16 + 15 - x) * 4);
    this.faces[this.face] = out; this.drawEditor(); this.updateFace(this.face);
  }
  private drawEditor() {
    const cv = this.root.querySelector<HTMLCanvasElement>('.pix'); if (!cv) return;
    const g = cv.getContext('2d')!, s = cv.width / 16, px = this.faces[this.face];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? '#3a3f4a' : '#2a2e37'; g.fillRect(x * s, y * s, s, s);
      const i = (y * 16 + x) * 4; if (px[i + 3]) { g.fillStyle = `rgba(${px[i]},${px[i + 1]},${px[i + 2]},${px[i + 3] / 255})`; g.fillRect(x * s, y * s, s, s); }
    }
    g.strokeStyle = 'rgba(255,255,255,0.06)'; for (let k = 0; k <= 16; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, cv.height); g.stroke(); g.beginPath(); g.moveTo(0, k * s); g.lineTo(cv.width, k * s); g.stroke(); }
  }

  // ---------- 3D preview ----------
  private setupPreview(cv: HTMLCanvasElement) {
    cancelAnimationFrame(this.raf);
    // one renderer for the life of the panel (browsers allow only a few WebGL contexts)
    if (!this.renderer) this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.clear();
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#556', 2.2));
    const d = new THREE.DirectionalLight('#fff', 1.2); d.position.set(2, 3, 2); this.scene.add(d);
    this.canvases = []; this.textures = [];
    const mats = this.faces.map((_, f) => {
      const c = document.createElement('canvas'); c.width = c.height = 16; this.canvases.push(c);
      const tx = new THREE.CanvasTexture(c); tx.magFilter = THREE.NearestFilter; tx.minFilter = THREE.NearestFilter; tx.colorSpace = THREE.SRGBColorSpace; this.textures.push(tx);
      this.updateFace(f);
      return new THREE.MeshLambertMaterial({ map: tx, transparent: true, alphaTest: 0.1 });
    });
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats); this.scene.add(this.cube);
    this.cam.position.set(1.7, 1.3, 2.1); this.cam.lookAt(0, 0, 0);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.cube.rotation.y += 0.01; this.cube.scale.setScalar(this.scale); this.renderer!.render(this.scene, this.cam); };
    loop();
  }
  private updateFace(f: number) {
    const c = this.canvases[f]; if (!c) return;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(this.faces[f]), 16, 16), 0, 0);
    this.textures[f].needsUpdate = true;
  }
  private refreshAll() { this.drawEditor(); for (let f = 0; f < 6; f++) this.updateFace(f); }

  // ---------- save ----------
  private save() {
    this.syncLocal();
    if (!this.name.trim()) return this.game.toast(t('bm.needName'), 'bad');
    const recipe: Record<string, number> = {};
    for (const [k, n] of this.recipe) if (k) recipe[k] = (recipe[k] ?? 0) + n;
    if (!Object.keys(recipe).length) return this.game.toast(t('bm.needRecipe'), 'bad');
    const c: CustomBlock = {
      key: 'cb_' + newCode(8).toLowerCase(), name: this.name.trim().slice(0, 24), author: this.game.player.name,
      faces: this.faces.map(encodeFace), fn: this.fn, recipe, at: this.at, n: Math.max(1, Math.min(16, this.n)), created: Date.now(),
    };
    if (!this.game.addCustomBlock(c)) return;
    saveToLibrary(c);
    sound.play('discover');
    this.game.toast(t('bm.saved', { name: c.name, at: t(('inv.station.' + c.at) as any) }), 'good');
    void customIds;
    this.render();
  }
}
function faceURL(b64: string) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  c.getContext('2d')!.putImageData(new ImageData(facePixels(b64), 16, 16), 0, 0);
  return c.toDataURL();
}
