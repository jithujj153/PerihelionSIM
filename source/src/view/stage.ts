/* Renderer, daylight sky, sun, weather and quality settings. */
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { SUN_DIR, skyMaterial } from './atmosphere';
import { setReflections } from './models';
import { buildVegetation, disposeVegetation, updateVegetation } from './vegetation';
import type { Weather } from '../engine/types';

export type Quality = 'low' | 'medium' | 'high';
/* pixels caps the render size, so a dense laptop screen does not cost four times the work */
const Q = {
  low: { ratio: 1, pixels: 2.1e6, shadow: 0, trees: 4000, rocks: 0, detail: 0.45, rain: 1200 },
  medium: { ratio: 1.25, pixels: 2.3e6, shadow: 1536, trees: 8500, rocks: 700, detail: 0.7, rain: 2500 },
  high: { ratio: 2, pixels: 3.2e6, shadow: 2048, trees: 13000, rocks: 1400, detail: 1, rain: 4500 },
};
const LOOK = {
  clear: { top: 0x3d7fcb, horizon: 0xc3dbee, fog: 0xb7d0e4, near: 2100, far: 10500, sun: 3.5, hemi: 1.55, sunColor: 0xffecca, cover: 0.46, cloud: 1.05 },
  dust: { top: 0x9b8d74, horizon: 0xd3b78c, fog: 0xc7a578, near: 120, far: 2100, sun: 1.7, hemi: 1.8, sunColor: 0xffd9a8, cover: 0.2, cloud: 0.8 },
  monsoon: { top: 0x44515f, horizon: 0x8795a1, fog: 0x82909c, near: 250, far: 3600, sun: 0.85, hemi: 1.85, sunColor: 0xd8e2ee, cover: 1, cloud: 0.55 },
};

export class Stage {
  renderer: THREE.WebGLRenderer;
  labels = new CSS2DRenderer();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(46, 1, 2, 30000);
  inset = new THREE.PerspectiveCamera(48, 16 / 10, 2, 20000);
  sun = new THREE.DirectionalLight(0xffffff, 2.5);
  hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8f6c4c, 1.55);
  quality: Quality = 'high';
  weather: Weather = 'clear';
  private sky: THREE.Mesh;
  private uni: ReturnType<typeof skyMaterial>['uniforms'];
  private trees: THREE.Group | null = null;
  private rain: THREE.LineSegments;
  private dust: THREE.Points;
  private clouds = new THREE.Group();
  private cur = { near: 1800, far: 9500, sun: 2.7, hemi: 1.25 };

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.labels.domElement.id = 'labels';
    host.appendChild(this.labels.domElement);
    const sky = skyMaterial(); this.uni = sky.uniforms;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), sky.material); this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    this.scene.fog = new THREE.Fog(0xbcd4e4, 1800, 9500);
    this.sun.shadow.bias = -0.00025; this.sun.shadow.radius = 2;
    this.rain = this.makeRain(Q.high.rain); this.dust = this.makeDust();
    this.makeClouds();
    this.scene.add(this.rain, this.dust, this.clouds);
    this.setWeather('clear', true);
    this.makeReflections();
    this.resize();
  }
  /** A small picture of the sky and the red ground, mirrored in glass and paint. */
  private makeReflections() {
    const room = new THREE.Scene(), sky = skyMaterial(), l = LOOK.clear;
    sky.uniforms.top.value.set(l.top); sky.uniforms.horizon.value.set(l.horizon); sky.uniforms.cover.value = l.cover; sky.uniforms.glare.value = 0.4;
    room.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), sky.material));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 32), new THREE.MeshBasicMaterial({ color: 0x5c3e2c })); ground.rotation.x = -Math.PI / 2; ground.position.y = -3; room.add(ground);
    const gen = new THREE.PMREMGenerator(this.renderer);
    setReflections(gen.fromScene(room, 0.03).texture);
    gen.dispose();
  }
  private makeRain(n: number) {
    const a = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = (Math.random() - 0.5) * 520, y = Math.random() * 300, z = (Math.random() - 0.5) * 520; a.set([x, y, z, x + 1.4, y + 9, z + 0.6], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.45, depthWrite: false })); l.frustumCulled = false; l.visible = false; return l;
  }
  private sprite(inner: string) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, inner); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  private makeDust() {
    const n = 1400, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([(Math.random() - 0.5) * 700, Math.random() * 120, (Math.random() - 0.5) * 700], i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ map: this.sprite('rgba(214,176,124,.55)'), size: 26, transparent: true, depthWrite: false, opacity: 0.7 })); p.frustumCulled = false; p.visible = false; return p;
  }
  private makeClouds() {
    const t = this.sprite('rgba(255,255,255,.75)');
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: 0xaab4bd, transparent: true, depthWrite: false, opacity: 0.8, fog: false }));
      s.position.set((Math.random() - 0.5) * 6000, 520 + Math.random() * 220, (Math.random() - 0.5) * 6000); s.scale.set(900 + Math.random() * 600, 260 + Math.random() * 160, 1); this.clouds.add(s);
    }
    this.clouds.visible = false;
  }
  setWeather(w: Weather, instant = false) {
    this.weather = w; const l = LOOK[w];
    if (instant) this.cur = { near: l.near, far: l.far, sun: l.sun, hemi: l.hemi };
    this.rain.visible = w === 'monsoon'; this.dust.visible = w === 'dust'; this.clouds.visible = w === 'monsoon';
    if (instant) { this.uni.cover.value = l.cover; this.uni.cloudLight.value = l.cloud; }
    this.uni.glare.value = w === 'clear' ? 1 : w === 'dust' ? 0.35 : 0;
    if (instant) { this.uni.top.value.set(l.top); this.uni.horizon.value.set(l.horizon); (this.scene.fog as THREE.Fog).color.set(l.fog); }
  }
  setQuality(q: Quality) {
    this.quality = q; const s = Q[q];
    this.renderer.shadowMap.enabled = s.shadow > 0; this.sun.castShadow = s.shadow > 0;
    if (s.shadow) { this.sun.shadow.mapSize.set(s.shadow, s.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.trees) { this.scene.remove(this.trees); disposeVegetation(this.trees); }
    this.trees = buildVegetation(s.trees, s.rocks); this.scene.add(this.trees);
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && !Array.isArray(m)) m.needsUpdate = true; });
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight, s = Q[this.quality];
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, s.ratio, Math.sqrt(s.pixels / (w * h))));
    this.renderer.setPixelRatio(ratio); this.renderer.setSize(w, h); this.labels.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  /** Draws everything once while the loading screen is still up, so that the graphics card
      prepares its programs now and not in the middle of the presentation. */
  warmUp() {
    const hidden: THREE.Object3D[] = [], culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    this.renderer.render(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
  }
  /** Draw the main view. */
  render() { this.renderer.render(this.scene, this.camera); }
  /** Per frame: keep sky and weather around the viewer and fit the shadow box to what is in view. */
  update(dt: number, focus: THREE.Vector3) {
    const l = LOOK[this.weather], k = Math.min(1, dt * 1.6), cam = this.camera.position;
    this.uni.top.value.lerp(new THREE.Color(l.top), k); this.uni.horizon.value.lerp(new THREE.Color(l.horizon), k);
    const fog = this.scene.fog as THREE.Fog; fog.color.lerp(new THREE.Color(l.fog), k);
    for (const key of ['near', 'far', 'sun', 'hemi'] as const) this.cur[key] += (l[key] - this.cur[key]) * k;
    // haze thins out when the camera is high, so the overview stays readable
    const lift = Math.max(0, Math.min(1, (cam.y - 200) / 1500)) * (this.weather === 'clear' ? 1 : 0.55);
    fog.near = this.cur.near * (1 + lift * 2); fog.far = this.cur.far * (1 + lift * 1.4);
    this.sun.intensity = this.cur.sun; this.hemi.intensity = this.cur.hemi; this.sun.color.set(l.sunColor);
    this.sky.position.copy(cam);
    const d = Math.min(1500, Math.max(90, cam.distanceTo(focus) * 0.75));
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - d) > d * 0.12) {
      sc.left = -d; sc.right = d; sc.top = d; sc.bottom = -d; sc.near = 10; sc.far = d * 4 + 800; sc.updateProjectionMatrix();
      this.sun.shadow.normalBias = Math.max(0.12, Math.min(1.6, ((2 * d) / (Q[this.quality].shadow || 1024)) * 2.4));
    }
    // move the shadow box in whole shadow pixels, so shadow edges do not crawl as the camera flies
    const texel = (2 * sc.right) / (Q[this.quality].shadow || 1024);
    const side = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, SUN_DIR).normalize(), top = new THREE.Vector3().crossVectors(SUN_DIR, side);
    const a1 = focus.dot(side), a2 = focus.dot(top);
    const held = focus.clone().addScaledVector(side, Math.round(a1 / texel) * texel - a1).addScaledVector(top, Math.round(a2 / texel) * texel - a2);
    this.sun.target.position.copy(held); this.sun.position.copy(held).addScaledVector(SUN_DIR, d * 2 + 300);
    this.uni.time.value += dt; this.uni.cover.value += (l.cover - this.uni.cover.value) * k; this.uni.cloudLight.value += (l.cloud - this.uni.cloudLight.value) * k;
    if (this.trees) updateVegetation(this.trees, cam, Q[this.quality].detail);
    if (this.rain.visible) {
      this.rain.position.set(focus.x * 0.3 + cam.x * 0.7, cam.y - 170, focus.z * 0.3 + cam.z * 0.7);
      const a = this.rain.geometry.attributes.position as THREE.BufferAttribute, arr = a.array as Float32Array, n = Math.min(arr.length / 6, Q[this.quality].rain), fall = dt * 260;
      for (let i = 0; i < n; i++) { let y = arr[i * 6 + 1] - fall; if (y < 0) y += 300; arr[i * 6 + 1] = y; arr[i * 6 + 4] = y + 9; }
      this.rain.geometry.setDrawRange(0, n * 2); a.needsUpdate = true;
    }
    if (this.dust.visible) { this.dust.position.set(focus.x, focus.y, focus.z); this.dust.rotation.y += dt * 0.06; }
  }
}
