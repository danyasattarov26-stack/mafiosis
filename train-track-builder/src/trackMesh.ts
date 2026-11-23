/* Turns the sampled track into meshes: two steel rails, wooden sleepers, support pillars, boosters, the station and buffer stops. */
import * as THREE from 'three';
import type { Track, Sample, Frame } from './track';

const GAUGE = 0.75;               // rails sit this far left/right of the centre line
const RAIL_W = 0.13, RAIL_H = 0.16, RAIL_Y = 0.16;

const railMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.7, roughness: 0.3 });
const sleeperMat = new THREE.MeshStandardMaterial({ color: '#8a5a3b', roughness: 0.85 });
const pillarMat = new THREE.MeshStandardMaterial({ color: '#e76f51', roughness: 0.6 });
const boostMat = new THREE.MeshStandardMaterial({ color: '#ffb703', emissive: '#ff7b00', emissiveIntensity: 1.4 });
const spineMat = new THREE.MeshStandardMaterial({ color: '#5c677d', metalness: 0.4, roughness: 0.5 });

/** sweep a rectangle (in the track's right/up plane) along samples */
function sweep(samples: Sample[], cx: number, cy: number, w: number, h: number, pos: number[], nor: number[]) {
  const corners = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const faceN = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const pt = (s: Sample, c: number[]) => new THREE.Vector3().copy(s.p).addScaledVector(s.r, cx + c[0]).addScaledVector(s.u, cy + c[1]);
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    if (a.p.distanceToSquared(b.p) > 4) continue;   // gap between pieces (never, but be safe)
    for (let k = 0; k < 4; k++) {
      const c0 = corners[k], c1 = corners[(k + 1) % 4];
      const p0 = pt(a, c0), p1 = pt(a, c1), p2 = pt(b, c1), p3 = pt(b, c0);
      const na = new THREE.Vector3().addScaledVector(a.r, faceN[k][0]).addScaledVector(a.u, faceN[k][1]);
      const nb = new THREE.Vector3().addScaledVector(b.r, faceN[k][0]).addScaledVector(b.u, faceN[k][1]);
      for (const [p, n] of [[p0, na], [p1, na], [p2, nb], [p0, na], [p2, nb], [p3, nb]] as [THREE.Vector3, THREE.Vector3][]) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); }
    }
  }
}
function geo(pos: number[], nor: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export class TrackMesh {
  group = new THREE.Group();
  constructor(public stationName = 'Station') {}

  build(track: Track, ghost = false) {
    this.dispose();
    const rail: number[] = [], railN: number[] = [], spine: number[] = [], spineN: number[] = [];
    const boost: number[] = [], boostN: number[] = [];
    const sleepers: Sample[] = [], pillars: { x: number; z: number; h: number }[] = [];
    let nextSleeper = 0, nextPillar = 2;
    for (const seg of track.segs) {
      const sm = seg.samples;
      sweep(sm, -GAUGE, RAIL_Y, RAIL_W, RAIL_H, rail, railN);
      sweep(sm, GAUGE, RAIL_Y, RAIL_W, RAIL_H, rail, railN);
      // a steel spine under the sleepers where the track leaves the ground (coaster style)
      if (sm.some(s => s.p.y > 1.2 || s.u.y < 0.9)) sweep(sm, 0, -0.32, 0.36, 0.3, spine, spineN);
      if (seg.id === 'boost') sweep(sm, 0, RAIL_Y, 0.9, 0.05, boost, boostN);
      for (const s of sm) {
        if (s.s >= nextSleeper) { sleepers.push(s); nextSleeper = s.s + 0.65; }
        if (s.s >= nextPillar && s.u.y > 0.55 && s.p.y > 1.4) { pillars.push({ x: s.p.x, z: s.p.z, h: s.p.y - 0.3 }); nextPillar = s.s + 5; }
      }
    }
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const mesh = new THREE.Mesh(g, ghost ? ghostMat : m); mesh.castShadow = !ghost; mesh.receiveShadow = true; this.group.add(mesh); return mesh; };
    add(geo(rail, railN), railMat);
    if (spine.length) add(geo(spine, spineN), spineMat);
    if (boost.length) add(geo(boost, boostN), boostMat);
    // sleepers
    const sg = new THREE.BoxGeometry(2.3, 0.14, 0.36);
    const sl = new THREE.InstancedMesh(sg, ghost ? ghostMat : sleeperMat, sleepers.length);
    const m = new THREE.Matrix4(), basis = new THREE.Matrix4();
    sleepers.forEach((s, i) => {
      basis.makeBasis(s.r, s.u, s.f);
      m.copy(basis).setPosition(s.p.clone().addScaledVector(s.u, 0.08));
      sl.setMatrixAt(i, m);
    });
    sl.castShadow = !ghost; sl.receiveShadow = true; this.group.add(sl);
    // pillars down to the ground
    if (pillars.length && !ghost) {
      const pg = new THREE.CylinderGeometry(0.16, 0.22, 1, 8).translate(0, 0.5, 0);
      const pm = new THREE.InstancedMesh(pg, pillarMat, pillars.length);
      pillars.forEach((p, i) => { m.makeScale(1, p.h, 1).setPosition(p.x, 0, p.z); pm.setMatrixAt(i, m); });
      pm.castShadow = true; this.group.add(pm);
    }
    if (!ghost) {
      this.group.add(station(track, this.stationName));
      if (!track.closed) this.group.add(bufferStop(track.start, -1));
      if (!track.closed) this.group.add(bufferStop(track.end, 1));
    }
  }

  dispose() {
    this.group.traverse((o: any) => { if (o.isMesh) o.geometry.dispose(); });
    this.group.clear();
  }
}

const ghostMat = new THREE.MeshBasicMaterial({ color: '#7ae582', transparent: true, opacity: 0.5, depthWrite: false });

/** the platform beside the first piece, with a little roof and a sign */
function station(track: Track, name: string) {
  const g = new THREE.Group();
  const s0 = track.segs[0];
  const a = s0.samples[0], len = s0.len;
  const mid = a.p.clone().addScaledVector(a.f, len / 2);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, len - 1), new THREE.MeshStandardMaterial({ color: '#d4c7b0', roughness: 0.9 }));
  plat.position.copy(mid).addScaledVector(a.r, -3.2).setY(0.35); plat.receiveShadow = true; plat.castShadow = true; g.add(plat);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.72, len - 1), new THREE.MeshStandardMaterial({ color: '#ffd166' }));
  edge.position.copy(plat.position).addScaledVector(a.r, 1.5); g.add(edge);
  const roofM = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.6 }), postM = new THREE.MeshStandardMaterial({ color: '#2b2d42' });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, len * 0.6), roofM); roof.position.copy(plat.position).setY(3.4); roof.rotation.z = -0.12; roof.castShadow = true; g.add(roof);
  for (const dz of [-1, 1]) for (const dx of [-1.2, 1.2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8), postM); p.position.copy(plat.position).addScaledVector(a.f, dz * len * 0.25).addScaledVector(a.r, dx).setY(2.0); g.add(p); }
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d')!; c.fillStyle = '#1d3557'; c.fillRect(0, 0, 512, 128); c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(6, 6, 500, 116);
  c.fillStyle = '#fff'; c.font = '800 58px "Baloo 2", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, 256, 68);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  sign.position.copy(plat.position).setY(4.0); sign.lookAt(sign.position.clone().add(a.r)); g.add(sign);
  return g;
}

/** a buffer stop at an open end of the line */
function bufferStop(f: Frame, dir: 1 | -1) {
  const g = new THREE.Group();
  const frame = new THREE.Group(); frame.position.copy(f.p); frame.quaternion.copy(f.q); g.add(frame);
  const red = new THREE.MeshStandardMaterial({ color: '#d62828' }), dark = new THREE.MeshStandardMaterial({ color: '#333' });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.4), red); beam.position.set(0, 0.85, dir * 0.6); frame.add(beam);
  for (const x of [-0.75, 0.75]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 1.2), dark); leg.position.set(x, 0.55, dir * 0.9); leg.rotation.x = dir * 0.5; frame.add(leg);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 12), new THREE.MeshStandardMaterial({ color: '#ffd166' })); pad.rotation.x = Math.PI / 2; pad.position.set(x * 0.8, 0.85, dir * 0.3); frame.add(pad);
  }
  return g;
}
