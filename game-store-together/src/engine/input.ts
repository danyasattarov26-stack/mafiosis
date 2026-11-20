/* Keyboard, mouse (pointer lock) and touch controls, unified into one per-frame input state. */
import { settings } from '../core/settings';
import { el, isTouch } from '../core/util';

export type Btn = 'interact' | 'alt' | 'rotate' | 'inventory' | 'cancel' | 'menu' | 'jump' | 'debug' | 'drop';

class Input {
  keys = new Set<string>();
  private down = new Set<Btn>();      // pressed this frame
  private held = new Set<Btn>();
  lookX = 0; lookY = 0;
  move = { x: 0, y: 0 };
  run = false;
  locked = false;
  touch = false;
  enabled = true;                     // false while a menu has focus
  canvas!: HTMLElement;
  wheel = 0;
  private lockedAt = 0;
  // finger ids: null = no finger. (iOS Safari hands out huge ids that can be negative, so -1 can't mean "none".)
  private joy = { id: null as number | null, x0: 0, y0: 0, x: 0, y: 0 };
  private lookTouch = { id: null as number | null, x: 0, y: 0 };
  private touchRoot: HTMLElement | null = null;
  onLockChange: (locked: boolean) => void = () => {};

  init(canvas: HTMLElement) {
    this.canvas = canvas;
    addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const b = this.keyBtn(e.code);
      if (b) { this.down.add(b); this.held.add(b); }
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      const b = this.keyBtn(e.code);
      if (b) this.held.delete(b);
    });
    addEventListener('blur', () => { this.keys.clear(); this.held.clear(); });
    addEventListener('mousemove', e => {
      if (!this.locked || performance.now() - this.lockedAt < 120) return;
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return; // spurious jump right after locking
      this.lookX += e.movementX; this.lookY += e.movementY;
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) { this.down.add('interact'); this.held.add('interact'); }
      if (e.button === 2) { this.down.add('alt'); this.held.add('alt'); }
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.held.delete('interact'); if (e.button === 2) this.held.delete('alt'); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockedAt = performance.now();
      if (!this.locked) { this.held.clear(); this.keys.clear(); }
      this.onLockChange(this.locked);
    });
    this.touch = settings.touch === 'on' || (settings.touch === 'auto' && isTouch());
    if (this.touch) this.buildTouch();
  }

  private keyBtn(code: string): Btn | null {
    switch (code) {
      case 'KeyE': return 'interact';
      case 'KeyF': return 'alt';
      case 'KeyR': return 'rotate';
      case 'Tab': case 'KeyI': return 'inventory';
      case 'KeyQ': return 'cancel';
      case 'Escape': return 'menu';
      case 'Space': return 'jump';
      case 'F3': case 'Backquote': return 'debug';
      case 'KeyG': return 'drop';
    }
    return null;
  }

  lock() { if (this.touch) { this.locked = true; this.onLockChange(true); return; } try { (this.canvas as any).requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => (this.canvas as any).requestPointerLock()); } catch { (this.canvas as any).requestPointerLock?.(); } }
  unlock() { if (this.touch) { this.locked = false; this.onLockChange(false); return; } if (document.pointerLockElement) document.exitPointerLock(); }

  /** call once per frame before reading */
  update() {
    let x = 0, y = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.joy.id !== null) { x = this.joy.x; y = -this.joy.y; }
    }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    this.move.x = x; this.move.y = y;
    this.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (this.joy.id !== null && Math.hypot(this.joy.x, this.joy.y) > 0.92);
  }
  pressed(b: Btn) { return this.enabled && this.down.has(b); }
  isHeld(b: Btn) { return this.enabled && this.held.has(b); }
  /** clear edge-triggered state; call at end of frame */
  endFrame() { this.down.clear(); this.lookX = 0; this.lookY = 0; this.wheel = 0; }
  consume(b: Btn) { this.down.delete(b); }
  press(b: Btn) { this.down.add(b); }

  // ---------- touch ----------
  showTouch(v: boolean) { if (this.touchRoot) this.touchRoot.style.display = v ? '' : 'none'; }
  setTouchButtons(labels: Partial<Record<Btn, string | null>>) {
    if (!this.touchRoot) return;
    for (const [k, v] of Object.entries(labels)) {
      const b = this.touchRoot.querySelector(`[data-b="${k}"]`) as HTMLElement | null;
      if (!b) continue;
      b.style.display = v === null ? 'none' : '';
      if (v) b.querySelector('span')!.textContent = v;
    }
  }
  private buildTouch() {
    const knob = el('div', { class: 'joy-knob' });
    const joy = el('div', { class: 'joy' }, knob);
    const mk = (b: Btn, icon: string, label: string, cls = '') => {
      const e = el('button', { class: 'tbtn ' + cls, 'data-b': b }, el('b', {}, icon), el('span', {}, label));
      e.addEventListener('touchstart', ev => { ev.preventDefault(); ev.stopPropagation(); this.down.add(b); this.held.add(b); e.classList.add('on'); }, { passive: false });
      const up = (ev: Event) => { ev.preventDefault(); this.held.delete(b); e.classList.remove('on'); };
      e.addEventListener('touchend', up); e.addEventListener('touchcancel', up);
      return e;
    };
    const root = el('div', { class: 'touch' },
      joy,
      el('div', { class: 'tbtns' },
        mk('interact', '✋', 'Use', 'big'), mk('alt', '⚙️', 'Alt'), mk('rotate', '⟳', 'Rotate'), mk('cancel', '✕', 'Cancel'), mk('jump', '⤒', 'Jump')),
      el('div', { class: 'ttop' }, mk('inventory', '🎒', 'Items'), mk('menu', '☰', 'Menu')));
    document.body.appendChild(root);
    this.touchRoot = root;
    const area = this.canvas;
    // Touches that begin on the game itself (not on a button or panel) belong to us: claim them right away
    // (preventDefault on touchstart) so iOS Safari never turns a joystick drag into a page scroll, toolbar
    // swipe or zoom and cancels it. Moves and ends are followed on the window so a finger is never "lost".
    const onGame = (e: TouchEvent) => e.target === area;
    const start = (e: TouchEvent) => {
      if (!onGame(e)) return;
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth * 0.45 && this.joy.id === null) {
          this.joy.id = t.identifier; this.joy.x0 = t.clientX; this.joy.y0 = t.clientY; this.joy.x = 0; this.joy.y = 0;
          joy.style.left = t.clientX - 60 + 'px'; joy.style.top = t.clientY - 60 + 'px'; joy.style.bottom = 'auto'; joy.classList.add('on');
        } else if (this.lookTouch.id === null) { this.lookTouch.id = t.identifier; this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY; }
      }
    };
    const moveT = (e: TouchEvent) => {
      let mine = false;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) {
          mine = true;
          let dx = (t.clientX - this.joy.x0) / 55, dy = (t.clientY - this.joy.y0) / 55; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.joy.x = dx; this.joy.y = dy; knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
        } else if (t.identifier === this.lookTouch.id) {
          mine = true;
          this.lookX += (t.clientX - this.lookTouch.x) * 2.2; this.lookY += (t.clientY - this.lookTouch.y) * 2.2;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
      if (mine && e.cancelable) e.preventDefault();
    };
    const resetJoy = () => { this.joy.id = null; this.joy.x = this.joy.y = 0; knob.style.transform = ''; joy.classList.remove('on'); joy.style.top = ''; joy.style.left = ''; joy.style.bottom = ''; };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) resetJoy();
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = null;
      }
      // if the browser lost track of a finger, drop it
      if (e.touches.length === 0) { if (this.joy.id !== null) resetJoy(); this.lookTouch.id = null; }
    };
    area.addEventListener('touchstart', start, { passive: false });
    addEventListener('touchmove', moveT, { passive: false });
    addEventListener('touchend', end, { passive: true }); addEventListener('touchcancel', end, { passive: true });
    // no double-tap zoom / pinch on the game
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('dblclick', e => e.preventDefault());
    root.style.display = 'none';
  }
}

export const input = new Input();
