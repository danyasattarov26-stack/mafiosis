import * as THREE from 'three';
/* DOM HUD: crosshair, ammo pips, level number; plus the start, pause, death, banner, replay and end screens. */
const $ = s => document.querySelector(s);

export const HUD = {
  init(title) {
    document.title = title;
    $('#hud').innerHTML = `
      <div class="xh"></div>
      <div class="ammo"></div>
      <div class="lvl"></div>
      <div class="flash"></div>
      <div class="banner"><b></b><div class="res"></div></div>
      <div class="tag replay" hidden>REPLAY · <span>Space / tap to skip</span></div>
      <div class="screen start">
        <h1>${title}</h1>
        <p class="sub">Time moves when you move.</p>
        <ul>
          <li><b>WASD</b> move · <b>mouse</b> look</li>
          <li><b>Left click</b> shoot (punch when empty-handed)</li>
          <li><b>Right click / E</b> throw your gun · <b>F</b> punch</li>
          <li>Walk over a dropped pistol to take it · <b>R</b> restart</li>
        </ul>
        <label class="name">Name for the leaderboards <input id="pname" maxlength="12" autocomplete="off" spellcheck="false" placeholder="ANON"></label>
        <div class="modes"><button class="go" data-mode="story">Play the rooms</button><button class="go alt" data-mode="gauntlet">Gauntlet</button></div>
        <p class="small">Katana cuts bullets · rifles go through a whole line · bottles, glasses and extinguishers are for throwing.</p>
        <p class="small top"></p>
        <p class="small"><a href="/models/CREDITS.md" target="_blank" rel="noopener">Model credits</a> · free models from Patch's library</p>
      </div>
      <div class="screen pause" hidden><h2>Paused</h2><p class="go">Click to resume</p></div>
      <div class="screen dead" hidden><h2>You died</h2><p class="go">R / tap to restart</p></div>
      <div class="screen over" hidden><h2>Gauntlet over</h2><p class="stats"></p><div class="board"></div><div class="modes"><button class="go" data-mode="gauntlet">Again</button><button class="go alt" data-mode="menu">Menu</button></div></div>
      <div class="screen end" hidden><h1>${title}</h1><p class="stats"></p><div class="modes"><button class="go" data-mode="story">Play again</button><button class="go alt" data-mode="gauntlet">Gauntlet</button></div></div>
      <div class="debug" hidden></div>`;
  },
  show(name, on = true) { const el = $(`#hud .${name}`); if (el) el.hidden = !on; },
  hideScreens() { for (const s of document.querySelectorAll('#hud .screen')) s.hidden = true; },
  ammo(kind, n, K) {
    const key = kind + ':' + n; if (key === this._ammo) return; this._ammo = key;
    $('#hud .ammo').innerHTML = !kind ? '<span>fists</span>' : K.gun
      ? `<span>${K.label}</span>` + Array.from({ length: K.ammo }, (_, i) => `<i class="${i < n ? 'on' : ''}${K.ammo < 6 ? ' wide' : ''}"></i>`).join('')
      : `<span>${K.label}${K.throwable ? ' · throw' : ''}</span>`;
  },
  level(i, total) { $('#hud .lvl').textContent = `${i + 1} / ${total}`; },
  label(text) { $('#hud .lvl').textContent = text; },
  results(html) { $('#hud .banner .res').innerHTML = html; },
  over(stats, board) { $('#hud .over .stats').innerHTML = stats; $('#hud .over .board').innerHTML = board; this.show('over'); },
  overBoard(board) { $('#hud .over .board').innerHTML = board; },
  startTop(text) { $('#hud .start .top').textContent = text; },
  /** A leaderboard as HTML rows, marking the player's own name. */
  board(res, me, fmt) {
    if (!res) return '<p class="small">Leaderboard offline: your best is saved on this device.</p>';
    if (!res.top.length) return '<p class="small">No scores yet. You are first.</p>';
    return '<ol class="lb">' + res.top.map(e => `<li class="${e.name === me ? 'me' : ''}"><span>${e.name}</span><b>${fmt(e.value)}</b></li>`).join('') + '</ol>'
      + (res.rank && res.rank > res.top.length ? `<p class="small">You: #${res.rank} of ${res.count}</p>` : '');
  },
  flash(color = 'rgba(232,38,43,.75)', ms = 450) {
    const f = $('#hud .flash'); f.style.transition = 'none'; f.style.background = color; f.style.opacity = 1;
    requestAnimationFrame(() => { f.style.transition = `opacity ${ms}ms ease-out`; f.style.opacity = 0; });
  },
  banner(text, on = true) { const b = $('#hud .banner'); b.querySelector('b').textContent = text; b.classList.toggle('on', on); },
  end(stats) { $('#hud .end .stats').innerHTML = stats; this.show('end'); },
  debug(text) { const d = $('#hud .debug'); d.hidden = false; d.textContent = text; },
};

/* In VR the DOM is invisible, so messages go on a panel floating in front of the headset. */
export const XRHud = {
  init(camera) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    this.c = c; this.g = c.getContext('2d'); this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.mesh.position.set(0, -0.05, -1.4); this.mesh.renderOrder = 999; this.mesh.visible = false; camera.add(this.mesh); this.key = '';
  },
  show(title, sub = '', red = false, small = false) {
    const key = title + '|' + sub + red + small; this.mesh.visible = true; if (key === this.key) return; this.key = key;
    const g = this.g, W = 1024, H = 512; g.clearRect(0, 0, W, H);
    g.fillStyle = red ? 'rgba(232,38,43,0.96)' : 'rgba(21,21,21,0.82)';
    const h = small ? 120 : H, y = small ? 0 : 0; g.beginPath(); g.roundRect(small ? 212 : 0, y, small ? 600 : W, h, 36); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (small) { g.font = 'bold 54px Arial Black, Arial, sans-serif'; g.fillText(title, W / 2, 62); }
    else {
      g.font = 'italic 900 132px Arial Black, Arial, sans-serif'; g.fillText(title, W / 2, sub ? 200 : H / 2, W - 60);
      if (sub) { g.font = 'bold 50px Arial, sans-serif'; sub.split('\n').forEach((l, i) => g.fillText(l, W / 2, 340 + i * 64, W - 60)); }
    }
    this.tex.needsUpdate = true;
  },
  hide() { if (this.mesh) { this.mesh.visible = false; this.key = ''; } },
};
