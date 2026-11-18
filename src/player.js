import * as THREE from 'three';

const SPEED = 4, RADIUS = 0.3, EYE = 1.65, SENS = 0.0022;

/*
  First-person player. Moves and looks in real time; reports how fast it moved and turned so the
  time controller can decide how fast the world runs. Input becomes a queue of actions for main.js.
*/
export class Player {
  constructor(camera, dom) {
    this.camera = camera; this.dom = dom;
    this.rig = new THREE.Group(); this.rig.add(camera); camera.position.set(0, EYE, 0); camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.eyeY = EYE; this.radius = RADIUS;
    this.keys = new Set(); this.dYaw = 0; this.dPitch = 0; this.moveSpeed = 0; this.angSpeed = 0; this.bob = 0;
    this.actions = []; this.stick = { x: 0, y: 0 }; this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.locked = false;
    addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = e.code; this.keys.add(k);
      if (k === 'KeyF') this.actions.push('punch');
      if (k === 'KeyE') this.actions.push('throw');
      if (k === 'KeyR') this.actions.push('restart');
      if (k === 'Space') { this.actions.push('skip'); e.preventDefault(); }
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => { if (this.locked) { this.dYaw -= e.movementX * SENS; this.dPitch -= e.movementY * SENS; } });
    dom.addEventListener('mousedown', e => { if (!this.locked) return; if (e.button === 0) this.actions.push('fire'); if (e.button === 2) this.actions.push('throw'); });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; this.onLock && this.onLock(this.locked); });
    document.addEventListener('pointerlockerror', () => { this.locked = false; this.onLock && this.onLock(false, true); });
    if (this.touch) this.initTouch();
  }

  lock() { if (this.touch) return; try { const p = this.dom.requestPointerLock(); if (p && p.catch) p.catch(() => this.onLock && this.onLock(false, true)); } catch (e) { this.onLock && this.onLock(false, true); } }

  initTouch() {
    const ui = document.getElementById('touch'); ui.hidden = false;
    const zone = ui.querySelector('.stick'), knob = zone.querySelector('i');
    let sid = null, sx = 0, sy = 0, lid = null, lx = 0, ly = 0;
    zone.addEventListener('pointerdown', e => { sid = e.pointerId; const r = zone.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; zone.setPointerCapture(sid); move(e); });
    const move = e => { if (e.pointerId !== sid) return; let dx = (e.clientX - sx) / 50, dy = (e.clientY - sy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } this.stick.x = dx; this.stick.y = dy; knob.style.transform = `translate(${dx * 40}px,${dy * 40}px)`; };
    zone.addEventListener('pointermove', move);
    const end = e => { if (e.pointerId !== sid) return; sid = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    // drag anywhere else to look
    this.dom.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || lid !== null) return; lid = e.pointerId; lx = e.clientX; ly = e.clientY; });
    this.dom.addEventListener('pointermove', e => { if (e.pointerId !== lid) return; this.dYaw -= (e.clientX - lx) * 0.006; this.dPitch -= (e.clientY - ly) * 0.006; lx = e.clientX; ly = e.clientY; });
    const lend = e => { if (e.pointerId === lid) lid = null; };
    this.dom.addEventListener('pointerup', lend); this.dom.addEventListener('pointercancel', lend);
    for (const b of ui.querySelectorAll('[data-act]')) b.addEventListener('pointerdown', e => { e.stopPropagation(); this.actions.push(b.dataset.act); });
  }

  reset(start) {
    this.pos.set(start[0], 0, start[1]); this.yaw = start[2] || 0; this.pitch = 0; this.dYaw = this.dPitch = 0;
    this.moveSpeed = this.angSpeed = 0; this.actions.length = 0; this.apply();
  }

  apply() {
    this.rig.position.set(this.pos.x, 0, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(realDt, level) {
    // look: what turned this frame, as an angular speed for the time controller
    const turned = Math.hypot(this.dYaw, this.dPitch);
    this.yaw += this.dYaw; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + this.dPitch)); this.dYaw = this.dPitch = 0;
    const raw = realDt > 0 ? turned / realDt : 0;
    this.angSpeed += (raw - this.angSpeed) * Math.min(1, 25 * realDt);
    // move
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    f -= this.stick.y; s += this.stick.x;
    const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
    const ox = this.pos.x, oz = this.pos.z, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.pos.x += (-sy * f + cy * s) * SPEED * realDt;
    this.pos.z += (-cy * f - sy * s) * SPEED * realDt;
    level.collideCircle(this.pos, RADIUS);
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    this.moveSpeed = realDt > 0 ? moved / realDt : 0;
    this.bob += moved * 2.4;
    this.apply();
  }

  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }
}
