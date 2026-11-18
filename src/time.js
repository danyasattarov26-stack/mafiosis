/*
  One global time scale. Everything in the world (enemies, bullets, shards, animation, audio pitch)
  advances by dt * scale; input and the camera use real dt.
*/
export const Time = {
  scale: 0.03,   // smoothed scale actually applied
  target: 0.03,  // what the player's motion asks for this frame
  force: 0,      // real seconds left of forced full speed (after firing, throwing, punching)
  game: 0,       // game seconds elapsed in the current level
  MIN: 0.03,

  reset() { this.scale = this.MIN; this.target = this.MIN; this.force = 0; this.game = 0; },

  /** Desktop: max(0.03, moveSpeed / 4, min(0.6, mouseAngularSpeed / 3)). XR: max(0.03, head / 1.2, hands / 2). */
  update(realDt, m) {
    let t = m.xr
      ? Math.max(this.MIN, m.headSpeed / 1.2, m.handSpeed / 2.0)
      : Math.max(this.MIN, m.moveSpeed / 4.0, Math.min(0.6, m.angSpeed / 3.0));
    if (this.force > 0) { this.force -= realDt; t = 1; }
    this.target = Math.min(1, t);
    this.scale += (this.target - this.scale) * Math.min(1, 12 * realDt);
    const dt = realDt * this.scale;
    this.game += dt;
    return dt;
  },

  /** Firing, throwing or punching runs the world at full speed for a moment. */
  kick(seconds = 0.15) { this.force = Math.max(this.force, seconds); },
};
