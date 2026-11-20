/*
  Animated characters. Customers are Polyfork people (shared walk cycle); players and staff are Kenney
  retro characters with recoloured clothes and a hat. Sitting, typing, carrying and arcade poses are
  procedural: bones are aimed in model space on top of the base animation, so they work on both rigs.
*/
import * as THREE from 'three';
import { instance, loaded, polyWalk, polyIdleTime, characterTexture, ownMaterials } from '../engine/assets';
import { hat, emojiTexture, ringFrame, textCanvas, box, mat } from './props';
import type { Anim } from '../sim/world';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const TINTS = ['#ffffff', '#ffd6d6', '#d6e4ff', '#d8ffd6', '#fff1c9', '#ead6ff'];

function aim(root: THREE.Object3D, bone: THREE.Object3D | undefined, child: THREE.Object3D | undefined, dirModel: THREE.Vector3) {
  if (!bone || !child || !bone.parent) return;
  bone.updateWorldMatrix(true, false); child.updateWorldMatrix(false, false);
  bone.getWorldPosition(_v); child.getWorldPosition(_w);
  const cur = _w.sub(_v).normalize();
  root.getWorldQuaternion(_q3);
  const want = dirModel.clone().normalize().applyQuaternion(_q3);
  _q.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(_q2);
  _q.multiply(_q2);                                 // new world rotation
  bone.parent.getWorldQuaternion(_q2).invert();
  bone.quaternion.copy(_q2.multiply(_q));
  bone.updateWorldMatrix(false, true);
}

const D = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class CharView {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  kind: 'poly' | 'retro';
  bones: Record<string, THREE.Object3D> = {};
  private walk: THREE.AnimationAction | null = null;
  private idle: THREE.AnimationAction | null = null;
  private run: THREE.AnimationAction | null = null;
  private cur: THREE.AnimationAction | null = null;
  hipsY = 0.95;
  height = 1.75;
  ring: THREE.Sprite;
  bubble: THREE.Sprite;
  label: THREE.Sprite | null = null;
  anim: Anim = 'idle';
  t = Math.random() * 10;
  hatObj: THREE.Object3D | null = null;
  carryBox: THREE.Object3D | null = null;
  lookKey = '';
  seatY = 0.47;
  topY = 1.8;
  private headset: THREE.Object3D | null = null;
  private snack: THREE.Object3D | null = null;
  private labelKey = '';

  constructor(public modelName: string, opts: { tint?: number; look?: any } = {}) {
    this.kind = /^human(Male|Female)A$/.test(modelName) ? 'retro' : 'poly';
    this.model = instance(modelName);
    this.model.traverse((o: any) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; }
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    if (this.kind === 'poly') {
      const clip = polyWalk();
      if (clip) {
        this.walk = this.mixer.clipAction(clip);
        this.idle = this.mixer.clipAction(clip.clone()); this.idle.timeScale = 0; this.idle.time = polyIdleTime();
        this.run = this.walk;
      }
      if (opts.tint) { ownMaterials(this.model); const c = new THREE.Color(TINTS[opts.tint % TINTS.length]); this.model.traverse((o: any) => { if (o.isMesh && /top|coat/i.test(o.name)) o.material.color.copy(c); }); }
    } else {
      const g = loaded(modelName)!;
      const find = (n: string) => g.animations.find(a => a.name === n);
      if (find('idle')) this.idle = this.mixer.clipAction(find('idle')!);
      if (find('run')) { this.run = this.mixer.clipAction(find('run')!); this.walk = this.mixer.clipAction(find('run')!.clone()); this.walk.timeScale = 0.62; }
      if (opts.look) this.setLook(opts.look);
    }
    (this.idle || this.walk)?.play(); this.cur = this.idle || this.walk;
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    const hips = this.bones['Hips'];
    if (hips) { hips.getWorldPosition(_v); this.hipsY = _v.y; }
    const head = this.bones['Head'];
    if (head) { head.getWorldPosition(_v); this.height = _v.y + 0.25; }
    const bb = new THREE.Box3().setFromObject(this.model);
    if (isFinite(bb.max.y) && bb.max.y > 0.5) { this.topY = bb.max.y; this.height = Math.max(this.height, bb.max.y + 0.05); }
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringFrame(0), depthTest: false, transparent: true }));
    this.ring.scale.setScalar(0.42); this.ring.position.y = this.height + 0.32; this.ring.visible = false; this.ring.renderOrder = 9;
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('😊'), depthTest: false, transparent: true }));
    this.bubble.scale.setScalar(0.42); this.bubble.position.y = this.height + 0.3; this.bubble.visible = false; this.bubble.renderOrder = 9;
    this.root.add(this.ring, this.bubble);
  }

  /** retro characters: clothes colours, skin tone and hat */
  setLook(look: { body?: string; shirt: string; pants: string; skin: number; hat: string; hatColor: string }) {
    const key = JSON.stringify(look);
    if (key === this.lookKey || this.kind !== 'retro') return;
    this.lookKey = key;
    const tex = characterTexture(this.modelName === 'humanFemaleA' ? 'female' : 'male', look.shirt, look.pants, look.skin);
    if (tex) this.model.traverse((o: any) => { if (o.isMesh) { if (!o.userData.ownMat) { o.material = o.material.clone(); o.userData.ownMat = true; } o.material.map = tex; o.material.needsUpdate = true; } });
    if (this.hatObj) { this.hatObj.removeFromParent(); this.hatObj = null; }
    const h = hat(look.hat, look.hatColor);
    const head = this.bones['Head'];
    if (h && head) {
      // place relative to the head bone, in model scale
      this.mixer.update(0); this.model.updateMatrixWorld(true);
      const s = new THREE.Vector3(); head.getWorldScale(s);
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      const k = 1.25; // retro heads are big
      h.scale.setScalar(k / Math.max(0.001, s.x));
      // sit the hat on top of the hair: the model's highest point, measured in bind pose
      h.position.set(0, (this.topY - hp.y - 0.07) / Math.max(0.001, s.y), 0.0);
      head.add(h); this.hatObj = h;
    }
  }

  setLabel(text: string, color = '#ffd166') {
    if (this.labelKey === text + color) return;
    this.labelKey = text + color;
    if (this.label) { this.label.removeFromParent(); (this.label.material as THREE.SpriteMaterial).map?.dispose(); }
    const t = textCanvas(text, { w: 256, h: 64, bg: 'rgba(20,16,40,0.7)', fg: color });
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    this.label.scale.set(0.9, 0.225, 1); this.label.position.y = this.height + 0.15; this.label.renderOrder = 8;
    this.root.add(this.label);
  }

  setRing(p: number, warn = false) {
    this.ring.visible = p > 0.001 && p < 0.999;
    if (this.ring.visible) (this.ring.material as THREE.SpriteMaterial).map = ringFrame(p, warn);
  }
  /** emoji bubble; `stack` keeps it visible above the progress ring (streamers shouting, food orders) */
  setBubble(e: string, stack = false) {
    this.bubble.visible = !!e && (!this.ring.visible || stack);
    this.bubble.position.y = this.height + (this.ring.visible && stack ? 0.78 : 0.3);
    if (e) (this.bubble.material as THREE.SpriteMaterial).map = emojiTexture(e);
  }

  /** a VR headset on the head bone, only while playing VR */
  private wearHeadset(on: boolean) {
    if (on && !this.headset) {
      const head = this.bones['Head']; if (!head) return;
      const g = new THREE.Group();
      g.add(box(0.2, 0.11, 0.12, mat('#1b1b22', { rough: 0.4 }), 0, -0.055, 0));
      g.add(box(0.17, 0.035, 0.01, mat('#3ee6ff', { emissive: '#3ee6ff', ei: 1.8 }), 0, -0.04, 0.061));
      g.add(box(0.21, 0.03, 0.2, mat('#2b2d42'), 0, -0.015, -0.08));
      this.mixer.update(0); this.model.updateMatrixWorld(true);
      const s = new THREE.Vector3(); head.getWorldScale(s);
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      g.scale.setScalar((this.kind === 'retro' ? 1.4 : 1) / Math.max(0.001, s.x));
      g.position.set(0, (this.height - 0.25 + 0.1 - hp.y) / Math.max(0.001, s.y), 0.08 / Math.max(0.001, s.z));
      head.add(g); this.headset = g;
    }
    if (this.headset) this.headset.visible = on;
  }
  /** a pizza slice in the right hand while eating */
  private holdSnack(on: boolean) {
    if (on && !this.snack) {
      const hand = this.bones['RightHand']; if (!hand) return;
      const g = new THREE.Group();
      const slice = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 3).rotateX(Math.PI / 2).scale(1, 0.18, 1), mat('#f4a261', { rough: 0.8 }));
      slice.userData.ownGeo = true; g.add(slice);
      g.add(box(0.03, 0.006, 0.03, mat('#e63946'), 0, 0.012, 0.02), box(0.025, 0.006, 0.025, mat('#e63946'), 0.01, 0.012, -0.03));
      const s = new THREE.Vector3(); hand.getWorldScale(s);
      g.scale.setScalar(1 / Math.max(0.001, s.x));
      hand.add(g); this.snack = g;
    }
    if (this.snack) this.snack.visible = on;
  }

  private play(a: THREE.AnimationAction | null, fade = 0.2) {
    if (!a || a === this.cur) return;
    a.reset().play();
    if (this.cur) this.cur.crossFadeTo(a, fade, false);
    this.cur = a;
  }

  update(dt: number, anim: Anim, camPos?: THREE.Vector3) {
    this.t += dt;
    // skip animating far away characters on weak devices
    if (camPos) { this.root.getWorldPosition(_v); if (_v.distanceToSquared(camPos) > 900 && Math.floor(this.t * 20) % 3) return; }
    this.anim = anim;
    const moving = anim === 'walk' || anim === 'run' || anim === 'carry' || anim === 'eat';
    this.wearHeadset(anim === 'vr');
    this.holdSnack(anim === 'eat');
    if (anim === 'run') { this.play(this.run); if (this.run) this.run.timeScale = this.kind === 'poly' ? 1.7 : 1; }
    else if (moving) { this.play(this.walk); if (this.walk && this.kind === 'poly') this.walk.timeScale = 1; }
    else this.play(this.idle);
    this.mixer.update(dt);
    this.model.position.y = 0;
    const b = this.bones;
    // Kenney's retro clips keep the arms out in a T: bring them down, with a swing while walking
    if (this.kind === 'retro' && (anim === 'idle' || anim === 'walk' || anim === 'run')) {
      this.model.updateMatrixWorld(true);
      const sw = anim === 'idle' ? Math.sin(this.t * 1.6) * 0.03 : Math.sin(this.t * (anim === 'run' ? 11 : 7.5)) * (anim === 'run' ? 0.55 : 0.35);
      aim(this.model, b.LeftArm, b.LeftForeArm, D(0.18, -1, sw));
      aim(this.model, b.LeftForeArm, b.LeftHand, D(0.08, -1, 0.18 + Math.max(0, sw)));
      aim(this.model, b.RightArm, b.RightForeArm, D(-0.18, -1, -sw));
      aim(this.model, b.RightForeArm, b.RightHand, D(-0.08, -1, 0.18 + Math.max(0, -sw)));
    }
    if (anim === 'eat') {
      this.model.updateMatrixWorld(true);
      const bite = Math.max(0, Math.sin(this.t * 2.2)) * 0.25;
      aim(this.model, b.RightArm, b.RightForeArm, D(-0.25, -0.6, 0.45));
      aim(this.model, b.RightForeArm, b.RightHand, D(0.15, 0.6 + bite, 0.55));
    } else if (anim === 'vr') {
      // standing, waving at things only they can see
      this.model.updateMatrixWorld(true);
      const t = this.t;
      const lx = Math.sin(t * 2.1) * 0.6, ly = Math.sin(t * 3.3 + 1) * 0.5, rx = Math.sin(t * 2.7 + 2) * 0.6, ry = Math.cos(t * 2.4) * 0.5;
      aim(this.model, b.LeftArm, b.LeftForeArm, D(0.5 + lx * 0.3, ly, 0.8));
      aim(this.model, b.LeftForeArm, b.LeftHand, D(0.2 + lx * 0.4, ly + 0.3, 1));
      aim(this.model, b.RightArm, b.RightForeArm, D(-0.5 + rx * 0.3, ry, 0.8));
      aim(this.model, b.RightForeArm, b.RightHand, D(-0.2 + rx * 0.4, ry + 0.3, 1));
      if (b.Head && b.Neck) aim(this.model, b.Neck, b.Head, D(Math.sin(t * 1.3) * 0.35, 1, 0.15 + Math.sin(t * 1.7) * 0.2));
      if (b.Spine && b.Spine1) aim(this.model, b.Spine, b.Spine1, D(Math.sin(t * 1.1) * 0.12, 1, 0.05));
    } else if (anim === 'drive') {
      // low racing seat: legs out to the pedals, hands on the wheel
      this.model.updateMatrixWorld(true);
      for (const s of ['Left', 'Right']) {
        aim(this.model, b[s + 'UpLeg'], b[s + 'Leg'], D(s === 'Left' ? 0.1 : -0.1, 0.05, 1));
        aim(this.model, b[s + 'Leg'], b[s + 'Foot'], D(0, -0.45, 1));
      }
      this.model.position.y = this.seatY - this.hipsY + 0.06;
      if (b.Spine && b.Spine1) aim(this.model, b.Spine, b.Spine1, D(0, 1, -0.32));
      const steer = Math.sin(this.t * 1.6) * 0.12;
      aim(this.model, b.LeftArm, b.LeftForeArm, D(0.22, -0.25, 1));
      aim(this.model, b.LeftForeArm, b.LeftHand, D(-0.1, 0.25 + steer, 1));
      aim(this.model, b.RightArm, b.RightForeArm, D(-0.22, -0.25, 1));
      aim(this.model, b.RightForeArm, b.RightHand, D(0.1, 0.25 - steer, 1));
      if (b.Head && b.Neck) aim(this.model, b.Neck, b.Head, D(0, 1, 0.3));
    } else if (anim === 'sit' || anim === 'play') {
      this.model.updateMatrixWorld(true);
      for (const s of ['Left', 'Right']) {
        aim(this.model, b[s + 'UpLeg'], b[s + 'Leg'], D(s === 'Left' ? 0.08 : -0.08, -0.12, 1));
        aim(this.model, b[s + 'Leg'], b[s + 'Foot'], D(0, -1, 0.12));
      }
      this.model.position.y = this.seatY - this.hipsY + 0.06;
      if (anim === 'play') {
        const k = Math.sin(this.t * 9) * 0.04;
        aim(this.model, b.LeftArm, b.LeftForeArm, D(0.25, -0.75, 0.55));
        aim(this.model, b.LeftForeArm, b.LeftHand, D(0.15, -0.05 + k, 1));
        aim(this.model, b.RightArm, b.RightForeArm, D(-0.25, -0.75, 0.55));
        aim(this.model, b.RightForeArm, b.RightHand, D(-0.1, -0.05 - k, 1));
        if (b.Head && b.Neck) aim(this.model, b.Neck, b.Head, D(0, 1, 0.12));
      }
    } else if (anim === 'work') {
      this.model.updateMatrixWorld(true);
      const k = Math.sin(this.t * 7);
      aim(this.model, b.LeftArm, b.LeftForeArm, D(0.2, -0.45, 0.8));
      aim(this.model, b.LeftForeArm, b.LeftHand, D(0.05, -0.2 + k * 0.15, 1));
      aim(this.model, b.RightArm, b.RightForeArm, D(-0.2, -0.45, 0.8));
      aim(this.model, b.RightForeArm, b.RightHand, D(-0.05, -0.2 - k * 0.15, 1));
    } else if (anim === 'carry') {
      this.model.updateMatrixWorld(true);
      aim(this.model, b.LeftArm, b.LeftForeArm, D(0.25, -0.35, 0.9));
      aim(this.model, b.LeftForeArm, b.LeftHand, D(-0.35, 0.15, 1));
      aim(this.model, b.RightArm, b.RightForeArm, D(-0.25, -0.35, 0.9));
      aim(this.model, b.RightForeArm, b.RightHand, D(0.35, 0.15, 1));
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
