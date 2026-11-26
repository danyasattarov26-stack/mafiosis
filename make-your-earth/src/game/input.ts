/* One set of player actions from keyboard + mouse, touch screens and gamepads. */
import { settings, isTouch } from './settings';

export class Input {
  move = { x: 0, z: 0 }; look = { x: 0, y: 0 };
  jump = false; sprint = false; crouch = false; primary = false;
  secondary = false;                         // right button / left trigger held (drawing a bow)
  private pressed = new Set<string>();     // one-shot actions this frame
  private keys = new Set<string>();
  locked = false; enabled = false;
  touch = isTouch();
  private joy: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
  private lookTouch: { id: number; x: number; y: number } | null = null;
  private padPrev: boolean[] = [];
  sprintToggle = false; private padWasUsed = false;

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', e => {
      if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) for (const [act, code] of Object.entries(settings.keys)) if (code === e.code) this.pressed.add(act);
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) this.pressed.add('slot' + (n - 1)); }
      this.keys.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.primary = false; this.secondary = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled || this.touch) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.primary = true; this.pressed.add('attack'); }
      if (e.button === 2) { this.pressed.add('use'); this.secondary = true; }
      if (e.button === 1) this.pressed.add('pick');
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.primary = false; if (e.button === 2) this.secondary = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => { if (this.locked) { this.look.x += e.movementX; this.look.y += e.movementY; } });
    addEventListener('wheel', e => { if (this.enabled && this.locked) this.pressed.add(e.deltaY > 0 ? 'next' : 'prev'); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked && this.enabled && !this.touch) this.pressed.add('unlocked'); });
    this.bindTouch();
  }
  requestLock() { if (!this.touch) (this.canvas as any).requestPointerLock?.()?.catch?.(() => {}); }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  hit(a: string) { return this.pressed.has(a); }
  press(a: string) { this.pressed.add(a); }
  endFrame() { this.pressed.clear(); this.look.x = 0; this.look.y = 0; }
  key(act: string) { return this.keys.has(settings.keys[act]); }

  /** read the current state (keyboard, touch joystick, gamepad all merged) */
  poll(dt: number) {
    let x = 0, z = 0;
    if (this.enabled) {
      if (this.key('forward')) z -= 1; if (this.key('back')) z += 1; if (this.key('left')) x -= 1; if (this.key('right')) x += 1;
    }
    this.jump = this.enabled && this.key('jump'); this.sprint = this.enabled && (this.key('sprint') || this.sprintToggle); this.crouch = this.enabled && this.key('crouch');
    if (this.joy) { const m = 46; x += Math.max(-1, Math.min(1, this.joy.dx / m)); z += Math.max(-1, Math.min(1, this.joy.dy / m)); if (Math.hypot(this.joy.dx, this.joy.dy) > m * 1.15) this.sprint = true; }
    if (this.touchJump) this.jump = true;
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !this.enabled) continue;
      const ax = (i: number) => { const v = p.axes[i] ?? 0; return Math.abs(v) < 0.15 ? 0 : v; };
      x += ax(0); z += ax(1);
      this.look.x += ax(2) * 900 * dt; this.look.y += ax(3) * 700 * dt;
      const b = (i: number) => (p.buttons[i]?.value ?? 0) > 0.5;
      if (b(0)) this.jump = true; if (b(10)) this.sprint = true; if (b(1)) this.crouch = true;
      this.primary = this.primary || b(7);
      this.secondary = b(6) || (this.secondary && !this.padWasUsed); this.padWasUsed = true;
      const edge: [number, string][] = [[6, 'use'], [7, 'attack'], [4, 'prev'], [5, 'next'], [3, 'inventory'], [2, 'eat'], [8, 'map'], [9, 'menu'], [12, 'chat'], [13, 'drop']];
      for (const [i, a] of edge) { const on = b(i); if (on && !this.padPrev[i]) this.pressed.add(a); this.padPrev[i] = on; }
      break;
    }
    const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    this.move.x = x; this.move.z = z;
  }

  // ---------------- touch ----------------
  touchJump = false;
  private bindTouch() {
    const el = this.canvas;
    el.addEventListener('touchstart', e => {
      if (!this.enabled) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth * 0.4 && !this.joy) { this.joy = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 }; this.showJoy(t.clientX, t.clientY, 0, 0); }
        else if (!this.lookTouch) { this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY }; (this.lookTouch as any).t0 = performance.now(); (this.lookTouch as any).moved = 0; }
      }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', e => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.joy && t.identifier === this.joy.id) { this.joy.dx = t.clientX - this.joy.x; this.joy.dy = t.clientY - this.joy.y; this.showJoy(this.joy.x, this.joy.y, this.joy.dx, this.joy.dy); }
        if (this.lookTouch && t.identifier === this.lookTouch.id) { const dx = t.clientX - this.lookTouch.x, dy = t.clientY - this.lookTouch.y; this.look.x += dx * 1.6; this.look.y += dy * 1.6; (this.lookTouch as any).moved += Math.abs(dx) + Math.abs(dy); this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.joy && t.identifier === this.joy.id) { this.joy = null; this.showJoy(-1, -1, 0, 0); }
        if (this.lookTouch && t.identifier === this.lookTouch.id) {
          // a quick tap on the world = use / place
          const lt = this.lookTouch as any; if (lt.moved < 12 && performance.now() - lt.t0 < 260) this.pressed.add('use');
          this.lookTouch = null;
        }
      }
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  private joyEl: HTMLElement | null = null;
  private showJoy(x: number, y: number, dx: number, dy: number) {
    if (!this.joyEl) { this.joyEl = document.createElement('div'); this.joyEl.className = 'joy'; this.joyEl.innerHTML = '<i></i>'; document.body.appendChild(this.joyEl); }
    this.joyEl.style.display = x < 0 ? 'none' : 'block';
    this.joyEl.style.left = x + 'px'; this.joyEl.style.top = y + 'px';
    const l = Math.min(46, Math.hypot(dx, dy)) / (Math.hypot(dx, dy) || 1);
    (this.joyEl.firstElementChild as HTMLElement).style.transform = `translate(${dx * l}px, ${dy * l}px)`;
  }
}
