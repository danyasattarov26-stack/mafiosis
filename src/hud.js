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
      <div class="banner"><b></b></div>
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
        <p class="go">Click to start</p>
        <p class="small">Every hit is fatal — theirs and yours.</p>
      </div>
      <div class="screen pause" hidden><h2>Paused</h2><p class="go">Click to resume</p></div>
      <div class="screen dead" hidden><h2>You died</h2><p class="go">R / tap to restart</p></div>
      <div class="screen end" hidden><h1>${title}</h1><p class="stats"></p><p class="go">Click to play again</p></div>
      <div class="debug" hidden></div>`;
  },
  show(name, on = true) { const el = $(`#hud .${name}`); if (el) el.hidden = !on; },
  hideScreens() { for (const s of document.querySelectorAll('#hud .screen')) s.hidden = true; },
  ammo(armed, n) { $('#hud .ammo').innerHTML = armed ? Array.from({ length: 6 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('') : '<span>unarmed</span>'; },
  level(i, total) { $('#hud .lvl').textContent = `${i + 1} / ${total}`; },
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
