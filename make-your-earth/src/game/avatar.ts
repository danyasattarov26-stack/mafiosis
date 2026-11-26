/*
  A player's body as other people see it (and as you see yourself with the F5 camera): one of the four
  characters, holding what's in their hands, moving the way they move. Mining, chopping, sword swings,
  shield blocks, drawing and loosing a bow, eating, sitting in a boat or on a horse, lying down when hurt.
  The everyday clips come with each character; the rest come from a shared animation pack that all four
  characters can use (they share one skeleton).
*/
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadModel } from './animals';
import { ITEM } from '../shared/items';
import { tiles6 } from '../shared/custom';
import { itemIcon, type Atlas } from '../render/textures';

export const LOOKS = ['barbarian', 'knight', 'rogue', 'ranger'];
export interface AvatarState { anim: string; held: string; off: string; downed: boolean }

/** pose name (sent over the network) → animation clip */
const CLIPS: Record<string, string> = {
  idle: 'Idle_A', walk: 'Walking_A', run: 'Running_A', back: 'Walking_Backwards', jump: 'Jump_Idle',
  mine: 'Pickaxing', dig: 'Digging', chop: 'Chopping', hammer: 'Hammering', hit: 'Melee_1H_Attack_Chop',
  slash: 'Melee_1H_Attack_Slice_Diagonal', stab: 'Melee_1H_Attack_Stab', block: 'Melee_Blocking',
  bow: 'Ranged_Bow_Idle', draw: 'Ranged_Bow_Aiming_Idle', release: 'Ranged_Bow_Release', bowrun: 'Running_HoldingBow',
  eat: 'Use_Item', sit: 'Sit_Floor_Idle', ride: 'Sit_Chair_Idle', down: 'Lie_Idle',
};
const ONCE = new Set(['slash', 'stab', 'hit', 'release']);
let pack: Promise<THREE.AnimationClip[]> | null = null;
const animPack = () => (pack ??= loadModel('player-anims').then(g => g?.animations ?? []));

const mat = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
/** turns something built pointing up (+Y) to point the way a hand slot points (forward along +Y, up along +Z) */
const BOW_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));

/** a bow for the left hand, with a string that can be drawn */
function makeBow() {
  const g = new THREE.Group(), wood = mat('#6b4a2b'), s = new THREE.Group(); g.add(s);
  const stave = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 5, 18, Math.PI * 0.86), wood); stave.rotation.z = -Math.PI * 0.43; s.add(stave);
  const ty = Math.sin(Math.PI * 0.43) * 0.42, tx = Math.cos(Math.PI * 0.43) * 0.42;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  s.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#f2eee0' })));
  const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.015, 0.015), mat('#c8a870')); s.add(arrow);
  s.position.x = -0.42;
  g.setRotationFromMatrix(BOW_BASIS); g.scale.setScalar(1.3);
  const pull = (k: number) => {
    const nock = tx - k * 0.45, a = geo.getAttribute('position') as THREE.BufferAttribute;
    a.setXYZ(0, tx, ty, 0); a.setXYZ(1, nock, 0, 0); a.setXYZ(2, tx, -ty, 0); a.needsUpdate = true;
    arrow.visible = k > 0.05; arrow.position.x = nock + 0.37;
  };
  pull(0);
  return { g, pull };
}

export class Avatar {
  obj = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private cur = '';
  private handR: THREE.Object3D | null = null; private handL: THREE.Object3D | null = null;
  private heldKey = '~'; private offKey = '~'; private gearR: THREE.Object3D | null = null; private gearL: THREE.Object3D | null = null;
  private bowPull: ((k: number) => void) | null = null; private drawK = 0;
  constructor(public look: number, private atlas: Atlas) { this.load(); }

  private async load() {
    const [g, extra] = await Promise.all([loadModel(LOOKS[this.look % LOOKS.length]), animPack()]);
    if (!g) return;
    const m = cloneSkinned(g.scene); m.scale.setScalar(0.95); this.obj.add(m); this.model = m;
    m.traverse((o: any) => { if (o.isMesh) o.frustumCulled = false; });
    this.mixer = new THREE.AnimationMixer(m);
    for (const c of [...g.animations, ...extra]) this.actions[c.name] = this.mixer.clipAction(c);
    for (const k of ONCE) { const a = this.actions[CLIPS[k]]; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
    const find = (n: string) => { let f: THREE.Object3D | null = null; m.traverse(o => { if (!f && o.name.replace(/[^a-z]/gi, '').toLowerCase() === n) f = o; }); return f; };
    this.handR = find('handslotr'); this.handL = find('handslotl');
    this.heldKey = this.offKey = '~';
  }

  /** what to show in a hand */
  private gear(key: string, left: boolean): THREE.Object3D | null {
    const d = ITEM[key]; if (!d) return null;
    if (left && d.shield) {
      const g = new THREE.Group(), s = new THREE.Group(); g.add(s);
      box(s, 0.55, 0.68, 0.05, mat(d.color, { metalness: 0.3 }), 0, 0, 0); box(s, 0.6, 0.73, 0.03, mat(d.color2 ?? '#4a4d52'), 0, 0, -0.03); box(s, 0.12, 0.12, 0.06, mat(d.color2 ?? '#4a4d52'), 0, 0, 0.04);
      s.scale.setScalar(1.25); (g as any).shield = s;
      return g;
    }
    if (key === 'bow') { const b = makeBow(); this.bowPull = b.pull; return b.g; }
    const t = d.tool?.type;
    if (t === 'sword' || t === 'knife' || t === 'spear' || t === 'hammer') {
      const g = new THREE.Group(), metal = mat(d.color, { metalness: 0.5, roughness: 0.35 }), wood = mat('#6b4a2b'), dark = mat('#3a2a1e');
      if (t === 'spear') { box(g, 0.04, 1.4, 0.04, wood, 0, 0.45, 0); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), metal); tip.position.y = 1.25; g.add(tip); }
      else if (t === 'hammer') { box(g, 0.05, 0.6, 0.05, wood, 0, 0.2, 0); box(g, 0.3, 0.16, 0.16, metal, 0, 0.5, 0); }
      else { const L = t === 'sword' ? 0.75 : 0.35; box(g, 0.07, L, 0.02, metal, 0, 0.12 + L / 2, 0); box(g, 0.24, 0.04, 0.06, dark, 0, 0.12, 0); box(g, 0.05, 0.2, 0.05, wood, 0, 0.02, 0); }
      g.scale.setScalar(1.3);
      return g;
    }
    if (t === 'axe' || t === 'pickaxe' || t === 'shovel' || t === 'hoe') {
      const g = new THREE.Group();
      loadModel('tool-' + t).then(m => {
        if (!m) return;
        const c = m.scene.clone(true);
        c.traverse((o: any) => { if (o.isMesh) { o.material = o.material.clone(); if (o.material.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45) o.material.color.set(d.color); } });
        c.scale.setScalar(2.2); c.rotation.set(Math.PI / 2, 0, 0); c.position.y = -0.12; g.add(c);
      });
      return g;
    }
    if (d.block != null) {
      const six = tiles6(d.block), mats = six.map(tile => { const tx = new THREE.CanvasTexture(this.atlas.canvasFor(tile)); tx.magFilter = THREE.NearestFilter; tx.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: tx, transparent: true, alphaTest: 0.4 }); });
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mats); c.position.y = 0.12; return c;
    }
    const tex = new THREE.TextureLoader().load(itemIcon(key)); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    sp.rotation.x = Math.PI / 2; sp.position.y = 0.12;
    return sp;
  }
  private setGear(state: AvatarState) {
    // bows and shields go in the left hand, everything else in the right
    const right = state.held === 'bow' ? '' : state.held, left = state.held === 'bow' ? 'bow' : ITEM[state.off]?.shield ? state.off : '';
    if (right !== this.heldKey && this.handR) {
      this.heldKey = right; if (this.gearR) this.handR.remove(this.gearR);
      this.gearR = right ? this.gear(right, false) : null; if (this.gearR) this.handR.add(this.gearR);
    }
    if (left !== this.offKey && this.handL) {
      this.offKey = left; if (this.gearL) this.handL.remove(this.gearL);
      if (left !== 'bow') this.bowPull = null;
      this.gearL = left ? this.gear(left, true) : null; if (this.gearL) this.handL.add(this.gearL);
    }
  }

  update(dt: number, state: AvatarState, yaw: number) {
    if (!this.model || !this.mixer) return;
    this.setGear(state);
    let pose = state.downed ? 'down' : state.anim;
    // holding a bow changes how you stand and run
    if (state.held === 'bow' && (pose === 'idle' || pose === 'walk')) pose = 'bow';
    if (state.held === 'bow' && pose === 'run') pose = 'bowrun';
    const want = CLIPS[pose] && this.actions[CLIPS[pose]] ? CLIPS[pose] : CLIPS.idle;
    if (want !== this.cur && this.actions[want]) {
      const prev = this.actions[this.cur], next = this.actions[want];
      next.reset().fadeIn(0.15).play(); if (prev && prev !== next) prev.fadeOut(0.15);
      this.cur = want;
    }
    // sitting: lower the body into the boat or onto the horse
    this.model.position.y += (((pose === 'ride') ? -0.5 : pose === 'sit' ? -0.05 : 0) - this.model.position.y) * Math.min(1, dt * 10);
    this.mixer.update(dt);
    this.drawK += ((pose === 'draw' ? 1 : 0) - this.drawK) * Math.min(1, dt * (pose === 'draw' ? 3 : 20));
    this.bowPull?.(this.drawK);
    // a shield faces forward and stands upright whatever the hand is doing
    const sh = (this.gearL as any)?.shield as THREE.Object3D | undefined;
    if (sh && this.handL) {
      this.obj.updateMatrixWorld(true);
      const qs = new THREE.Quaternion(); this.handL.getWorldQuaternion(qs);
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(up, fwd);
      const qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, fwd));
      sh.quaternion.copy(qs.invert().multiply(qd)); sh.position.set(0, 0.1, 0.05);
      sh.parent!.updateMatrixWorld(true);
    }
  }
}
