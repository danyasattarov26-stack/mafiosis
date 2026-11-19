/* Renderer, camera, sky, sun and the day/night look ("cozy day, neon night"). */
import * as THREE from 'three';
import { settings, preset } from '../core/settings';
import { clamp, lerp } from '../core/util';

const DAY = { top: new THREE.Color('#79b8ff'), bottom: new THREE.Color('#fde2c4'), sun: new THREE.Color('#fff1d6'), hemiSky: new THREE.Color('#dbeafe'), hemiGround: new THREE.Color('#b9a58e'), fog: new THREE.Color('#cfe3f2') };
const DUSK = { top: new THREE.Color('#4b3b8f'), bottom: new THREE.Color('#ff9e7a'), sun: new THREE.Color('#ffb27a'), hemiSky: new THREE.Color('#ffc6a8'), hemiGround: new THREE.Color('#5b4a6b'), fog: new THREE.Color('#c58b8f') };
const NIGHT = { top: new THREE.Color('#0b0b2b'), bottom: new THREE.Color('#2a1a4a'), sun: new THREE.Color('#8fa3ff'), hemiSky: new THREE.Color('#5a5fa8'), hemiGround: new THREE.Color('#231a3a'), fog: new THREE.Color('#1c1638') };

export class Gfx {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  stars: THREE.Points;
  night = 0;      // 0 day … 1 full night
  sunDir = new THREE.Vector3(-0.5, 0.7, 0.4).normalize();
  dusk = 0;
  private skyMat: THREE.ShaderMaterial;
  private tmp = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    const p = preset();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: p.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 400);
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, 2.2);
    this.sun.position.set(-20, 40, 25);
    this.sun.target.position.set(0, 0, -6);
    this.scene.add(this.sun, this.sun.target);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 110;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: DAY.top.clone() }, bottom: { value: DAY.bottom.clone() } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(vp.y*1.4+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.0); }',
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), this.skyMat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    const sg = new THREE.BufferGeometry(), pts: number[] = [];
    for (let i = 0; i < 500; i++) { const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08; const r = 280; pts.push(Math.cos(u) * Math.cos(v) * r, Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#fff', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
    this.scene.fog = new THREE.Fog(DAY.fog.clone(), 30, settings.renderDistance);
    this.applyQuality();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyQuality() {
    const p = preset();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, p.pixelRatio));
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (this.sun.shadow.mapSize.x !== p.shadowSize) { this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize); this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null; }
    this.camera.far = settings.renderDistance + 40;
    const sk = (this.camera.far * 0.85) / 300; this.sky.scale.setScalar(sk); this.stars.scale.setScalar(sk);
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    const f = this.scene.fog as THREE.Fog;
    f.far = settings.renderDistance; f.near = Math.min(30, settings.renderDistance * 0.35);
    this.renderer.shadowMap.needsUpdate = true;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** minutes since midnight → sky, sun, fog, night factor */
  setTime(min: number) {
    const h = min / 60;
    // dusk 17:30–19:30, night after 19:30, dawn before 8:00
    const dusk = clamp((h - 17.5) / 1.5, 0, 1) * (1 - clamp((h - 19.5) / 1.0, 0, 1));
    const night = h < 7 ? 1 : h < 8 ? 1 - (h - 7) : clamp((h - 18.5) / 1.5, 0, 1);
    this.night = night; this.dusk = dusk;
    const mix = (a: THREE.Color, b: THREE.Color, c: THREE.Color, out: THREE.Color) => out.copy(a).lerp(b, dusk).lerp(c, night);
    mix(DAY.top, DUSK.top, NIGHT.top, this.skyMat.uniforms.top.value);
    mix(DAY.bottom, DUSK.bottom, NIGHT.bottom, this.skyMat.uniforms.bottom.value);
    mix(DAY.sun, DUSK.sun, NIGHT.sun, this.sun.color);
    mix(DAY.hemiSky, DUSK.hemiSky, NIGHT.hemiSky, this.hemi.color);
    mix(DAY.hemiGround, DUSK.hemiGround, NIGHT.hemiGround, this.hemi.groundColor);
    mix(DAY.fog, DUSK.fog, NIGHT.fog, (this.scene.fog as THREE.Fog).color);
    this.sun.intensity = lerp(2.3, 0.35, night) * (1 - dusk * 0.35);
    this.hemi.intensity = lerp(1.6, 0.55, night);
    // sun path: east → west across the day
    const a = clamp((h - 6) / 14, 0, 1) * Math.PI;
    this.sunDir.set(Math.cos(a) * -45, 18 + Math.sin(a) * 30, 25).normalize();
    (this.stars.material as THREE.PointsMaterial).opacity = night * 0.9;
    this.renderer.toneMappingExposure = lerp(1.05, 1.25, night);
  }

  /** keep the sun's shadow box around the player */
  follow(p: THREE.Vector3) {
    this.sun.target.position.set(Math.round(p.x / 4) * 4, 0, Math.round(p.z / 4) * 4);
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 60);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
