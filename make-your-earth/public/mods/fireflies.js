// Fireflies: little glowing lights that drift around you on warm, clear nights.
export default function (api) {
  const { THREE } = api;
  let points = null, base = null, t = 0;
  const N = 60;
  api.on('start', game => {
    const pos = new Float32Array(N * 3); base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) base.set([(Math.random() - 0.5) * 30, Math.random() * 4 + 0.3, (Math.random() - 0.5) * 30], i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    points = new THREE.Points(g, new THREE.PointsMaterial({ color: '#d8ff6a', size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
    points.frustumCulled = false;
    game.scene.add(points);
  });
  api.on('tick', (game, dt) => {
    if (!points) return;
    t += dt;
    const night = game.sunLevel < 0.35, warm = game.ambient > 8 && game.weather === 'clear';
    points.visible = night && warm && !game.underwater;
    if (!points.visible) return;
    const p = game.player.pos, a = points.geometry.getAttribute('position');
    for (let i = 0; i < N; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      a.setXYZ(i, p.x + bx + Math.sin(t * 0.7 + i) * 1.5, p.y + by + Math.sin(t * 1.3 + i * 2) * 0.5, p.z + bz + Math.cos(t * 0.6 + i) * 1.5);
    }
    a.needsUpdate = true;
    points.material.opacity = 0.5 + Math.sin(t * 3) * 0.3;
  });
}
