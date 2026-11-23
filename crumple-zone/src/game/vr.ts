/*
  VR driving (WebXR). You sit in the driver's seat with two gloved hands:
  - grip (side button) near the steering wheel rim to hold it, and turn it with one or both hands;
  - grip the gear knob and move it through the H-pattern (1-2 left, 3-4, 5-6/7, reverse far right and up);
  - grip the handbrake lever beside the seat and pull it up;
  - right trigger is the throttle, left trigger the brake.
  Buttons: left X recover, left Y automatic/manual gearbox, left stick press recentre your seat,
  right A thrusters (flying car) or launch (crash lab), right B rocket boost, right stick up/down climb/descend,
  right stick press back to start.
*/
import * as THREE from 'three';
import type { CarView, CarState } from '../render/carMesh';
import type { Spec } from '../cars/specs';

type Hold = null | 'wheel' | 'shifter' | 'handbrake';
interface Hand {
  grip: THREE.Group; glove: THREE.Group; fingers: THREE.Group; source: XRInputSource | null; side: 1 | -1;
  holding: Hold; wheelOff: number; prev: boolean[];
}

const WHEEL_LOCK = 2.4;          // radians of wheel turn for full steering lock
const COLS = [0.06, 0.02, -0.02, -0.06];   // gear lever columns, car-left to car-right (+x is the driver's left)

function makeGlove(side: 1 | -1) {
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: '#1d1f24', roughness: 0.75 });
  const accent = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.6 });
  const sleeve = new THREE.MeshStandardMaterial({ color: '#2c3e57', roughness: 0.9 });
  // grip space: the controller handle runs along Z, the back of the hand faces +X (right hand) or −X (left)
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.085, 0.1), leather);
  fist.position.set(0.022 * side, 0, 0.005);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.03, 0.03), accent);
  strap.position.set(0.024 * side, 0.03, 0.04);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.045, 4, 8).rotateX(Math.PI / 2), leather);
  thumb.position.set(0.004 * side, -0.022, -0.06);
  const fingers = new THREE.Group();
  fingers.position.set(0.02 * side, -0.042, 0.005);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.05, 4, 8).translate(0, -0.032, 0), leather);
    f.position.z = -0.034 + i * 0.023;
    fingers.add(f);
  }
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.05, 14), accent);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 0.3, 14).translate(0, 0.15, 0), sleeve);
  const wrist = new THREE.Group(); wrist.position.set(0.02 * side, 0.035, 0.06);
  wrist.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.55, 0.84).normalize());
  wrist.add(cuff, arm);
  g.add(fist, strap, thumb, fingers, wrist);
  return { g, fingers };
}

export class VR {
  supported = false; active = false;
  rig = new THREE.Group();
  hands: Hand[] = [];
  wheelAngle = 0; steer = 0;
  throttle = 0; brake = 0; hand = 0; lift = 0; boost = 0;
  auto = false;
  knob = { x: 0, z: 0 }; gear = 0;
  private headOff = new THREE.Vector3(); private headYaw = 0; private recenterIn = 0;
  private actions = new Set<string>();
  private screen: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; t: number } | null = null;
  private flash = { text: '', t: 0 };
  onStart: () => void = () => {}; onEnd: () => void = () => {};

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    this.rig.matrixAutoUpdate = false;
    scene.add(this.rig);
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const side: 1 | -1 = i === 0 ? -1 : 1;
      const { g, fingers } = makeGlove(side);
      grip.add(g); this.rig.add(grip);
      const h: Hand = { grip, glove: g, fingers, source: null, side, holding: null, wheelOff: 0, prev: [] };
      grip.addEventListener('connected', (e: any) => {
        h.source = e.data as XRInputSource;
        const s: 1 | -1 = h.source.handedness === 'left' ? -1 : 1;
        if (s !== h.side) { grip.remove(h.glove); const ng = makeGlove(s); h.glove = ng.g; h.fingers = ng.fingers; h.side = s; grip.add(ng.g); }
      });
      grip.addEventListener('disconnected', () => { h.source = null; h.holding = null; });
      this.hands.push(h);
    }
    renderer.xr.addEventListener('sessionstart', () => {
      this.active = true; this.rig.add(camera); this.recenterIn = 0.6;
      renderer.xr.setFoveation?.(1);
      this.onStart();
    });
    renderer.xr.addEventListener('sessionend', () => {
      this.active = false; scene.add(camera); camera.position.set(0, 2, 5); camera.quaternion.identity();
      this.onEnd();
    });
    const xr = (navigator as any).xr;
    if (xr?.isSessionSupported) xr.isSessionSupported('immersive-vr').then((ok: boolean) => { this.supported = ok; document.body.classList.toggle('has-vr', ok); }).catch(() => {});
  }

  async enter() {
    const xr = (navigator as any).xr; if (!xr) return;
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await this.renderer.xr.setSession(session);
  }
  exit() { this.renderer.xr.getSession()?.end(); }

  /** one-shot actions pressed this frame: recover, home, fly, launch */
  hit(a: string) { return this.actions.has(a); }
  /** what the physics should get as the gear: null for the automatic */
  gearFor(spec: Spec) { if (this.auto) return null; return Math.min(this.gear, spec.gears.length); }
  say(text: string) { this.flash = { text, t: 3 }; }
  recenter() { this.recenterIn = 0.05; }

  update(dt: number, view: CarView, st: CarState, spec: Spec) {
    this.actions.clear();
    const car = (view as any).interior.matrix as THREE.Matrix4;   // car layout → world
    const ck = view.cockpit;
    // ---- seat the player: car frame × eye position × recentre ----
    const eye = new THREE.Vector3(spec.driver.x, spec.driver.y + 0.12, spec.driver.z);
    if (this.recenterIn > 0) {
      this.recenterIn -= dt;
      if (this.recenterIn <= 0) {
        this.headOff.copy(this.camera.position);
        const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ'); this.headYaw = e.y;
      }
    }
    const M = this.rig.matrix.copy(car).multiply(new THREE.Matrix4().makeTranslation(eye.x, eye.y, eye.z))
      .multiply(new THREE.Matrix4().makeRotationY(-this.headYaw + Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(-this.headOff.x, -this.headOff.y, -this.headOff.z));
    void M;
    this.rig.updateMatrixWorld(true);
    // the XR camera looks down −Z; the car's front is +Z, hence the half turn above

    const inv = car.clone().invert();
    ck.wheel.updateMatrix(); ck.shifter.updateMatrix(); ck.handbrake.updateMatrix();
    const wheelInv = ck.wheel.matrix.clone().invert();
    const knobLocal = new THREE.Vector3(this.knob.x, 0, this.knob.z).add(ck.shifter.position);
    const hbGrip = new THREE.Vector3(0, 0, 0.22).applyMatrix4(ck.handbrake.matrix);
    let thr = 0, brk = 0, wheelHands = 0, wheelSum = 0, liftAxis = 0, boost = 0, stickSteer = 0, pull = -1;

    for (const h of this.hands) {
      const gp = h.source?.gamepad; if (!gp) continue;
      const b = (i: number) => gp.buttons[i]?.value ?? 0;
      const pressed = (i: number) => { const on = b(i) > 0.5, was = h.prev[i]; h.prev[i] = on; return on && !was; };
      const left = h.source!.handedness === 'left';
      const squeeze = b(1);
      h.fingers.rotation.z = h.side * (0.15 + Math.max(squeeze, b(0) * 0.5) * 1.35);
      if (left) {
        brk = Math.max(brk, b(0));
        if (Math.abs(gp.axes[2] ?? 0) > 0.15) stickSteer = gp.axes[2];
        if (pressed(4)) this.actions.add('recover');
        if (pressed(5)) { this.auto = !this.auto; this.say(this.auto ? 'Automatic gearbox' : 'Manual gearbox'); }
        if (pressed(3)) this.recenter();
      } else {
        thr = Math.max(thr, b(0));
        boost = Math.max(boost, b(5));
        if (Math.abs(gp.axes[3] ?? 0) > 0.2) liftAxis = -(gp.axes[3] ?? 0);
        if (pressed(4)) { this.actions.add('fly'); this.actions.add('launch'); }
        if (pressed(3)) this.actions.add('home');
      }
      // ---- grabbing ----
      const world = new THREE.Vector3().setFromMatrixPosition(h.grip.matrixWorld);
      const local = world.clone().applyMatrix4(inv);
      const grabbing = squeeze > 0.5, grabNow = pressed(1);
      if (!grabbing && h.holding) { h.holding = null; this.pulse(h, 0.2, 20); }
      if (grabNow && !h.holding) {
        const w = local.clone().applyMatrix4(wheelInv), r = Math.hypot(w.x, w.y);
        if (Math.abs(r - ck.wheelR) < 0.09 && Math.abs(w.z) < 0.1) { h.holding = 'wheel'; h.wheelOff = Math.atan2(w.y, w.x) - this.wheelAngle; }
        else if (local.distanceTo(knobLocal) < 0.11 && !this.auto) h.holding = 'shifter';
        else if (local.distanceTo(hbGrip) < 0.13) h.holding = 'handbrake';
        if (h.holding) this.pulse(h, 0.5, 30);
      }
      if (h.holding === 'wheel') {
        const w = local.clone().applyMatrix4(wheelInv);
        let want = Math.atan2(w.y, w.x) - h.wheelOff;
        while (want - this.wheelAngle > Math.PI) want -= Math.PI * 2;
        while (want - this.wheelAngle < -Math.PI) want += Math.PI * 2;
        wheelSum += want; wheelHands++;
      } else if (h.holding === 'shifter') this.moveKnob(local.x - ck.shifter.position.x, local.z - ck.shifter.position.z, spec, h);
      else if (h.holding === 'handbrake') pull = Math.max(pull, Math.max(0, Math.min(1, (local.y - ck.handbrake.position.y - 0.02) / 0.13)));
    }
    if (wheelHands) this.wheelAngle = Math.max(-WHEEL_LOCK, Math.min(WHEEL_LOCK, wheelSum / wheelHands));
    else if (stickSteer) this.wheelAngle += (stickSteer * WHEEL_LOCK - this.wheelAngle) * Math.min(1, dt * 8);
    else this.wheelAngle *= Math.exp(-dt * 2.5);    // self-centring
    this.steer = this.wheelAngle / WHEEL_LOCK;
    this.throttle = thr; this.brake = brk; this.lift = liftAxis; this.boost = boost;
    this.hand = pull >= 0 ? pull : Math.max(0, this.hand - dt * 4);   // the lever springs back down when let go
    // ---- move the levers in the model ----
    ck.knob.position.set(this.knob.x, 0, this.knob.z);
    ck.knob.rotation.set(this.knob.z * 4, 0, -this.knob.x * 4);
    ck.handbrake.rotation.x = -0.15 - this.hand * 0.75;
    this.drawScreen(dt, view, st, spec);
  }

  private moveKnob(tx: number, tz: number, spec: Spec, h: Hand) {
    const k = this.knob, n = spec.gears.length;
    tx = Math.max(-0.065, Math.min(0.065, tx)); tz = Math.max(-0.065, Math.min(0.065, tz));
    // which slots exist: column c forward is gear 2c+1, back is 2c+2; the last column forward is reverse
    const slot = (c: number, fwd: boolean) => (c === 3 ? (fwd ? -1 : null) : (fwd ? 2 * c + 1 : 2 * c + 2) <= n ? (fwd ? 2 * c + 1 : 2 * c + 2) : null);
    const near = COLS.findIndex(x => Math.abs(x - k.x) < 0.012);
    if (Math.abs(k.z) < 0.012) {
      k.x = tx;
      const c = COLS.findIndex(x => Math.abs(x - tx) < 0.014);
      if (c >= 0) { k.x = COLS[c]; const fwd = tz > 0; k.z = slot(c, fwd) != null ? tz : 0; }
      else k.z = 0;
    } else if (near >= 0) {
      const fwd = k.z > 0;
      k.z = fwd ? Math.max(0, tz) : Math.min(0, tz);
    }
    const c = COLS.findIndex(x => Math.abs(x - k.x) < 0.012);
    const g = c >= 0 && Math.abs(k.z) > 0.04 ? slot(c, k.z > 0) ?? 0 : 0;
    if (g !== this.gear) { this.gear = g; this.pulse(h, 0.7, 25); }
  }

  private pulse(h: Hand, strength: number, ms: number) {
    const a = (h.source?.gamepad as any)?.hapticActuators?.[0];
    try { a?.pulse?.(strength, ms); } catch { /* no rumble */ }
  }
  rumble(strength: number) { for (const h of this.hands) this.pulse(h, Math.min(1, strength), 60); }

  private drawScreen(dt: number, view: CarView, st: CarState, spec: Spec) {
    const d = view.cockpit.display; if (!d) return;
    d.visible = true;
    if (!this.screen) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      this.screen = { canvas, tex, t: 0 };
    }
    const S = this.screen; (d.material as THREE.MeshBasicMaterial).map = S.tex;
    S.t -= dt; this.flash.t -= dt; if (S.t > 0) return; S.t = 0.1;
    const g = S.canvas.getContext('2d')!, live = st as CarState & { rpm?: number; gear?: number; jets?: number[] };
    g.fillStyle = '#0d0f14'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#ffb400'; g.font = 'bold 120px system-ui'; g.textAlign = 'left';
    g.fillText(String(Math.round(Math.abs(st.speed) * 3.6)), 24, 130);
    g.fillStyle = '#a5abb6'; g.font = 'bold 30px system-ui'; g.fillText('km/h', 28, 172);
    const gearTxt = this.auto ? (live.gear === -1 ? 'R' : `A${live.gear ?? ''}`) : this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : String(this.gear);
    g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.font = 'bold 110px system-ui'; g.fillText(gearTxt, 488, 130);
    const rpm = (live.rpm ?? 0) / spec.maxRpm;
    g.fillStyle = '#2b2f38'; g.fillRect(24, 190, 464, 16); g.fillStyle = rpm > 0.9 ? '#e63946' : '#4cc38a'; g.fillRect(24, 190, 464 * Math.min(1, rpm), 16);
    g.textAlign = 'left'; g.font = 'bold 26px system-ui'; g.fillStyle = st.health > 0.5 ? '#4cc38a' : '#e63946';
    g.fillText(`Engine ${Math.round(st.health * 100)}%${this.hand > 0.1 ? '  ·  HANDBRAKE' : ''}${live.jets && (live.jets[0] > 0.05) ? '  ·  FLYING' : ''}`, 24, 240);
    if (this.flash.t > 0) { g.fillStyle = 'rgba(230,57,70,0.92)'; g.fillRect(0, 0, 512, 52); g.fillStyle = '#fff'; g.font = 'bold 30px system-ui'; g.textAlign = 'center'; g.fillText(this.flash.text, 256, 36); }
    S.tex.needsUpdate = true;
  }
}
