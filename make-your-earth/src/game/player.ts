/*
  The player's body: walking, sprinting, jumping, swimming and climbing against the voxel world,
  fall damage, and survival stats (health, hunger, thirst, stamina, body temperature, sickness).
*/
import * as THREE from 'three';
import type { World } from '../world/world';
import { BLOCKS, B } from '../shared/blocks';
import type { Input } from './input';
import { EXTRA } from '../shared/custom';

export const PW = 0.3, PH = 1.8, EYE = 1.62;
export interface Stats { health: number; hunger: number; thirst: number; stamina: number; temp: number; sick: number }
export type Cause = 'fall' | 'hunger' | 'thirst' | 'cold' | 'heat' | 'sick' | 'animal' | 'drown' | 'fire' | 'lava' | 'player';

export class Player {
  pos = new THREE.Vector3(); vel = new THREE.Vector3();
  yaw = 0; pitch = 0; onGround = false; inWater = false; headInWater = false; onLadder = false; crouching = false;
  stats: Stats = { health: 100, hunger: 100, thirst: 100, stamina: 100, temp: 37, sick: 0 };
  air = 10;                 // seconds of breath under water
  downed = 0;               // seconds left while downed (0 = up)
  dead = false;
  name = ''; look = 0; id = '';
  private fallStart = 0; private stepT = 0;
  onStep: (blockBelow: number) => void = () => {};
  onHurt: (amount: number, cause: Cause) => void = () => {};
  onDowned: () => void = () => {};
  autoStep = false; god = false;

  solidAt(w: World, x: number, y: number, z: number) {
    const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z));
    if (id < 0) return true;                       // unloaded: treat as a wall so nobody falls out of the world
    return id > 0 && BLOCKS[id].solid !== false;
  }
  private collides(w: World, p: THREE.Vector3, h: number) {
    for (let x = Math.floor(p.x - PW); x <= Math.floor(p.x + PW); x++)
      for (let y = Math.floor(p.y); y <= Math.floor(p.y + h - 0.001); y++)
        for (let z = Math.floor(p.z - PW); z <= Math.floor(p.z + PW); z++)
          if (this.solidAt(w, x + 0.5, y + 0.5, z + 0.5)) return true;
    return false;
  }
  blockAt(w: World, dy = 0) { return w.get(Math.floor(this.pos.x), Math.floor(this.pos.y + dy), Math.floor(this.pos.z)); }

  update(dt: number, w: World, inp: Input, sens: number, invertY: boolean) {
    if (this.dead) return;
    // look
    this.yaw -= inp.look.x * 0.0022 * sens;
    this.pitch -= inp.look.y * 0.0022 * sens * (invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    if (this.downed > 0) { this.vel.x = 0; this.vel.z = 0; this.physics(dt, w, 0, 0, false); return; }
    const feet = this.blockAt(w, 0.1), head = this.blockAt(w, EYE);
    this.inWater = feet === B.water || this.blockAt(w, 0.9) === B.water;
    this.headInWater = head === B.water;
    const mid = this.blockAt(w, 1);
    this.onLadder = feet === B.ladder || mid === B.ladder || !!EXTRA[feet]?.climb || !!EXTRA[mid]?.climb;
    this.crouching = inp.crouch && !this.inWater;
    const tired = this.stats.stamina < 2;
    let speed = this.crouching ? 1.6 : 4.3;
    const sprinting = inp.sprint && !this.crouching && !tired && (inp.move.x || inp.move.z) && this.stats.hunger > 6;
    if (sprinting) speed = 6.6;
    if (this.inWater) speed *= 0.55;
    if (this.stats.sick > 0.5) speed *= 0.85;
    // wish direction in world space
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = inp.move.x * c + inp.move.z * s, wz = -inp.move.x * s + inp.move.z * c;
    const accel = this.onGround ? 14 : this.inWater ? 6 : 3;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, accel * dt);
    // stamina
    if (sprinting) this.stats.stamina = Math.max(0, this.stats.stamina - 11 * dt);
    else this.stats.stamina = Math.min(100, this.stats.stamina + (this.stats.sick > 0.3 ? 6 : 14) * dt);
    // jump / swim / climb
    if (this.onLadder && (inp.move.z < -0.1 || inp.jump)) this.vel.y = 3.2;
    else if (this.inWater) { if (inp.jump) this.vel.y = Math.min(this.vel.y + 18 * dt, 3.4); }
    else if (inp.jump && this.onGround && this.stats.stamina > 3) { this.vel.y = 8.2; this.stats.stamina -= 3; this.onGround = false; }
    // auto step-up (touch players): walking into a one-block ledge hops it
    if (this.autoStep && this.onGround && (inp.move.x || inp.move.z)) {
      const ahead = new THREE.Vector3(this.pos.x + wx * 0.5, this.pos.y + 0.5, this.pos.z + wz * 0.5);
      if (this.solidAt(w, ahead.x, ahead.y, ahead.z) && !this.solidAt(w, ahead.x, ahead.y + 1, ahead.z) && !this.solidAt(w, this.pos.x, this.pos.y + 2.2, this.pos.z)) this.vel.y = 7.4;
    }
    // conveyor belts carry you east
    const under = this.blockAt(w, -0.2);
    if (this.onGround && EXTRA[under]?.conveyor) this.vel.x += (3 - this.vel.x) * Math.min(1, dt * 8);
    this.physics(dt, w, wx, wz, sprinting);
    // breath
    if (this.headInWater) { this.air -= dt; if (this.air < 0) { this.air = 0; this.hurt(8 * dt, 'drown'); } }
    else this.air = Math.min(10, this.air + dt * 3);
    if (feet === B.lava) this.hurt(25 * dt, 'lava');
    if (feet === B.fire) this.hurt(6 * dt, 'fire');
  }

  private physics(dt: number, w: World, wx: number, wz: number, sprinting: boolean) {
    const g = this.inWater ? 5 : this.onLadder ? 0 : 24;
    this.vel.y -= g * dt;
    if (this.inWater) { this.vel.y *= Math.pow(0.35, dt); this.vel.y = Math.max(this.vel.y, -3); }
    if (this.onLadder && this.vel.y < -2) this.vel.y = -2;
    this.vel.y = Math.max(this.vel.y, -50);
    const h = this.crouching ? 1.5 : PH;
    const before = this.pos.y;
    const p = this.pos.clone();
    // move one axis at a time so we slide along walls
    for (const ax of ['x', 'z', 'y'] as const) {
      const step = this.vel[ax] * dt;
      if (!step) continue;
      const n = Math.max(1, Math.ceil(Math.abs(step) / 0.4));
      for (let i = 0; i < n; i++) {
        const prev = p[ax]; p[ax] += step / n;
        if (this.collides(w, p, h)) {
          p[ax] = prev;
          if (ax === 'y') {
            if (this.vel.y < 0) {
              if (!this.onGround) { const fall = this.fallStart - p.y; if (fall > 3.5 && !this.inWater) this.hurt((fall - 3.5) * 7, 'fall'); }
              this.onGround = true;
            }
            this.vel.y = 0;
          } else this.vel[ax] = 0;
          break;
        } else if (ax === 'y') this.onGround = false;
      }
    }
    // crouching stops you walking off edges
    if (this.crouching && this.onGround) {
      const under = (x: number, z: number) => this.solidAt(w, x, p.y - 0.2, z);
      if (!under(p.x, p.z) && under(this.pos.x, this.pos.z)) { p.x = this.pos.x; p.z = this.pos.z; this.vel.x = 0; this.vel.z = 0; }
    }
    if (this.onGround || this.inWater || this.onLadder) this.fallStart = p.y;
    else if (p.y > this.fallStart) this.fallStart = p.y;
    this.pos.copy(p);
    // footsteps
    if (this.onGround && (wx || wz)) {
      this.stepT -= dt * (sprinting ? 1.5 : 1) * Math.hypot(this.vel.x, this.vel.z) / 4.3;
      if (this.stepT <= 0) { this.stepT = 0.42; this.onStep(this.blockAt(w, -0.5)); }
    }
    void before;
  }

  hurt(amount: number, cause: Cause, armor = 0) {
    if (this.downed > 0 || this.dead || amount <= 0 || this.god) return;
    const reduced = cause === 'animal' || cause === 'player' ? amount * (1 - Math.min(0.7, armor * 0.04)) : amount;
    this.stats.health -= reduced;
    this.onHurt(reduced, cause);
    if (this.stats.health <= 0) { this.stats.health = 0; this.downed = 60; this.onDowned(); }
  }

  /** survival stats tick: env = air temperature (°C) around you, warmth from clothes and fire */
  tickStats(dt: number, ambient: number, warmth: number, moving: boolean) {
    if (this.downed > 0 || this.dead) return;
    const s = this.stats;
    const sickMul = 1 + s.sick * 0.6;
    s.hunger = Math.max(0, s.hunger - dt * (0.065 + (moving ? 0.02 : 0)) * sickMul);
    s.thirst = Math.max(0, s.thirst - dt * (0.1 + Math.max(0, ambient - 28) * 0.01) * sickMul);
    // body temperature drifts toward what the weather and your clothes allow
    const feels = ambient + warmth * 3.2;
    let target = 37;
    if (feels < 8) target = 37 - (8 - feels) * 0.12;
    else if (feels > 34) target = 37 + (feels - 34) * 0.1;
    s.temp += (target - s.temp) * Math.min(1, dt * 0.02);
    // health
    if (s.hunger <= 0) this.hurt(0.8 * dt, 'hunger');
    if (s.thirst <= 0) this.hurt(1.2 * dt, 'thirst');
    if (s.temp < 35) { this.hurt((35 - s.temp) * 0.6 * dt, 'cold'); s.sick = Math.min(1, s.sick + dt * 0.004); }
    if (s.temp > 39.5) { this.hurt((s.temp - 39.5) * 0.8 * dt, 'heat'); s.thirst = Math.max(0, s.thirst - dt * 0.2); }
    if (s.sick > 0.5) this.hurt(0.12 * dt, 'sick');
    if (s.sick > 0 && s.hunger > 50 && s.thirst > 50) s.sick = Math.max(0, s.sick - dt * 0.0025);
    if (s.hunger > 55 && s.thirst > 55 && s.sick < 0.2 && s.temp > 35.5 && s.temp < 39) s.health = Math.min(100, s.health + dt * 0.35);
  }
}
