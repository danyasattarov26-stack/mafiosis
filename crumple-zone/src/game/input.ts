/* Keyboard, gamepad and on-screen touch controls, merged into one set of driving inputs. */
export interface Drive { throttle: number; brake: number; steer: number; hand: number }

export class Controls {
  keys = new Set<string>();
  touch = { gas: false, brake: false, left: false, right: false, hand: false };
  tilt = 0; useTilt = false;
  steer = 0;
  private pressed = new Set<string>();   // one-shot actions this frame
  private padPrev: boolean[] = [];

  constructor() {
    addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('deviceorientation', e => {
      if (e.beta == null || e.gamma == null) return;
      // landscape: steering is the phone's roll around its long side
      const ang = (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;
      const roll = ang === 90 ? e.beta : ang === -90 || ang === 270 ? -e.beta : e.gamma;
      this.tilt = Math.max(-1, Math.min(1, roll / 28));
    });
  }

  /** bind an on-screen button (pointer events, works with several fingers) */
  bindButton(el: HTMLElement, key: keyof Controls['touch'] | string, onTap?: () => void) {
    const down = (e: PointerEvent) => { e.preventDefault(); el.classList.add('on'); if (key in this.touch) (this.touch as any)[key] = true; onTap?.(); try { el.setPointerCapture(e.pointerId); } catch { /* */ } };
    const up = () => { el.classList.remove('on'); if (key in this.touch) (this.touch as any)[key] = false; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** true once when an action's key/button was just pressed */
  hit(action: string) {
    const map: Record<string, string[]> = {
      camera: ['KeyC'], reset: ['KeyR'], repair: ['KeyT', 'Backspace'], menu: ['Escape', 'KeyP'], slow: ['KeyM'], launch: ['KeyL', 'Enter'], aids: ['KeyG'],
    };
    return (map[action] || []).some(k => this.pressed.has(k)) || this.pressed.has('pad:' + action);
  }
  endFrame() { this.pressed.clear(); }

  read(dt: number, speed: number): Drive {
    const k = this.keys;
    let thr = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brk = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let target = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let hand = k.has('Space') ? 1 : 0;
    let analog = false;
    if (this.touch.gas) thr = 1;
    if (this.touch.brake) brk = 1;
    if (this.touch.hand) hand = 1;
    if (this.touch.left || this.touch.right) target = (this.touch.right ? 1 : 0) - (this.touch.left ? 1 : 0);
    else if (this.useTilt) { target = this.tilt; analog = true; }
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const b = (i: number) => p.buttons[i]?.value ?? 0;
      const x = p.axes[0] ?? 0;
      if (Math.abs(x) > 0.12) { target = Math.sign(x) * ((Math.abs(x) - 0.12) / 0.88) ** 1.4; analog = true; }
      thr = Math.max(thr, b(7)); brk = Math.max(brk, b(6)); hand = Math.max(hand, b(0) > 0.5 ? 1 : 0);
      const acts: [number, string][] = [[3, 'camera'], [1, 'reset'], [2, 'repair'], [9, 'menu'], [8, 'slow'], [5, 'launch']];
      for (const [i, a] of acts) { const on = b(i) > 0.5; if (on && !this.padPrev[i]) this.pressed.add('pad:' + a); this.padPrev[i] = on; }
      break;
    }
    // keyboard steering eases in, and less lock at speed
    const lim = 1 / (1 + Math.max(0, speed - 8) / 30);
    if (analog) this.steer = target * Math.max(lim, 0.45);
    else {
      const rate = target === 0 ? 5 : Math.sign(target) !== Math.sign(this.steer) ? 7 : 2.6;
      const goal = target * lim;
      const d = goal - this.steer, step = rate * dt;
      this.steer += Math.abs(d) < step ? d : Math.sign(d) * step;
    }
    return { throttle: thr, brake: brk, steer: this.steer, hand };
  }
}
