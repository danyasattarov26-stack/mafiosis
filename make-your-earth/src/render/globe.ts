/* The main menu's slowly turning Earth: continents, ice caps and clouds from shader noise, an atmosphere glow,
   stars, and a little parallax when you move the mouse. Cheap: two spheres, one star field. */
import * as THREE from 'three';

const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);} vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=mod289(i);vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm(vec3 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*snoise(p);p*=2.03;a*=.5;}return s;}`;

export class Globe {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  private earth: THREE.Mesh; private clouds: THREE.Mesh; private group = new THREE.Group();
  private mouse = new THREE.Vector2(); private t = 0;
  constructor() {
    this.scene.background = new THREE.Color('#02040b');
    const sun = new THREE.Vector3(-1, 0.4, 0.8).normalize();
    const earthMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sun }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vW; void main(){ vN=normalize(normalMatrix*normal); vP=position; vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);} `,
      fragmentShader: NOISE + `
        uniform vec3 uSun; varying vec3 vN; varying vec3 vP; varying vec3 vW;
        void main(){
          vec3 p = normalize(vP);
          float h = fbm(p*1.6) + 0.12*fbm(p*7.0);
          float lat = abs(p.y);
          vec3 deep = vec3(0.02,0.09,0.24), shallow = vec3(0.05,0.32,0.55);
          vec3 col = mix(deep, shallow, smoothstep(-0.35, 0.0, h));
          if (h > 0.02) {
            float hum = fbm(p*2.3+7.0);
            vec3 green = mix(vec3(0.16,0.42,0.14), vec3(0.08,0.30,0.10), smoothstep(0.0,0.4,hum));
            vec3 desert = vec3(0.76,0.64,0.40);
            vec3 land = mix(green, desert, smoothstep(0.05,-0.25,hum) * smoothstep(0.75,0.2,lat));
            land = mix(land, vec3(0.45,0.40,0.36), smoothstep(0.25,0.45,h));
            col = mix(vec3(0.82,0.76,0.55), land, smoothstep(0.02,0.06,h));
          }
          col = mix(col, vec3(0.93,0.96,1.0), smoothstep(0.72,0.8, lat + 0.06*fbm(p*5.0)));
          vec3 n = normalize(vN);
          float d = dot(normalize((viewMatrix*vec4(uSun,0.)).xyz), n);
          float day = smoothstep(-0.15, 0.25, d);
          vec3 night = vec3(0.0) + vec3(1.0,0.75,0.4) * step(0.02,h) * step(0.6, snoise(p*60.0)) * 0.6 * (1.0-day);
          vec3 lit = col * (0.06 + 1.1*max(d,0.0)) ;
          float spec = pow(max(dot(reflect(-normalize((viewMatrix*vec4(uSun,0.)).xyz), n), vec3(0.,0.,1.)),0.), 30.) * step(h,0.02) * 0.5;
          gl_FragColor = vec4(mix(night, lit, day) + spec, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMat);
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sun }, uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(normalMatrix*normal); vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);} `,
      fragmentShader: NOISE + `uniform vec3 uSun; uniform float uTime; varying vec3 vN; varying vec3 vP;
        void main(){ vec3 p=normalize(vP); float c = smoothstep(0.08, 0.5, fbm(p*3.0 + vec3(uTime*0.01,0.,0.)));
          float d = dot(normalize((viewMatrix*vec4(uSun,0.)).xyz), normalize(vN));
          gl_FragColor = vec4(vec3(1.0)*(0.15+max(d,0.)), c*0.85*smoothstep(-0.3,0.2,d)+c*0.05);
          #include <colorspace_fragment>
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 48), cloudMat);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 48), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sun } }, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);} `,
      fragmentShader: `uniform vec3 uSun; varying vec3 vN; void main(){ float i = pow(0.75 - dot(vN, vec3(0.,0.,1.)), 3.0); float d = dot(normalize((viewMatrix*vec4(uSun,0.)).xyz), vN)*0.5+0.6; gl_FragColor = vec4(vec3(0.35,0.6,1.0)*i*d*1.6, 1.0);} `,
    }));
    this.group.add(this.earth, this.clouds, atmo);
    this.group.rotation.z = 0.41;
    this.scene.add(this.group);
    // stars
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 20); pos.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#cfe0ff', size: 0.09, sizeAttenuation: true })));
    this.camera.position.set(0, 0, 3.6);
    addEventListener('pointermove', e => { this.mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5); });
  }
  resize(w: number, h: number) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); const wide = w > h; this.group.position.x = wide ? 0.9 : 0; this.group.position.y = wide ? -0.05 : -0.55; this.camera.position.z = wide ? 3.6 : 4.6; }
  update(dt: number) {
    this.t += dt;
    this.earth.rotation.y += dt * 0.05; this.clouds.rotation.y += dt * 0.062;
    (this.clouds.material as THREE.ShaderMaterial).uniforms.uTime.value = this.t;
    this.camera.position.x += (this.mouse.x * 0.35 - this.camera.position.x) * Math.min(1, dt * 2);
    this.camera.position.y += (-this.mouse.y * 0.25 - this.camera.position.y) * Math.min(1, dt * 2);
    this.camera.lookAt(this.group.position.x * 0.6, this.group.position.y * 0.6, 0);
  }
}
