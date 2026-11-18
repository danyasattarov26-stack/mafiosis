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
