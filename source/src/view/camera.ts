/* Cameras: an automatic director plus free, gate, driver, drone, tower and map views. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NODES, TOWERS } from '../engine/layout';
import { v, Vec } from '../engine/util';
import { height } from './terrain';
import type { World } from './scene';
import type { Stage } from './stage';

export type CamMode = 'director' | 'free' | 'gate' | 'driver' | 'drone' | 'tower' | 'map';
export const CAM_NAMES: Record<CamMode, string> = { director: 'Auto director', free: 'Free fly', gate: 'Gate officer', driver: 'Driver', drone: 'Drone', tower: 'Tower', map: 'Control-room map' };
export type Shot =
  | { k: 'chase'; uid: string; far?: number }
  | { k: 'gate'; id: string; close?: boolean }
  | { k: 'preset'; name: keyof typeof PRESETS }
  | { k: 'point'; pos: Vec; dist?: number }
  | { k: 'drone'; id: string }
  | { k: 'tour' };

type P = [number, number, number, number, number, number]; // camera x, height above ground, z, target x, height above ground, z
export const PRESETS = {
  site: [-500, 1500, 2350, 250, 0, -80] as P,
  zone: [180, 300, 450, 690, 0, -80] as P,
  zoneNear: [380, 170, 260, 700, 5, -70] as P,
  gates: [-1620, 190, -640, -1180, 0, -830] as P,
  road: [-420, 200, -130, -150, 0, -400] as P,
  checks: [-1060, 170, 700, -600, 0, 320] as P,
  towers: [1220, 330, 380, 640, 0, -150] as P,
  zones: [100, 2600, 1900, 100, 0, -150] as P,
  west: [-880, 330, 640, -400, 0, 0] as P,
  pile: [990, 150, 215, 760, 10, 20] as P,
  map: [150, 3500, 130, 150, 0, 0] as P,
};
const TOUR: P[] = [
  [-2500, 620, -1500, -1200, 0, -800], [-1500, 200, -950, -900, 0, -700], [-600, 360, -150, 300, 0, -200],
  [250, 230, 420, 660, 10, -80], [1450, 300, 350, 800, 0, -120], [1350, 780, 1750, 200, 0, 0], [-500, 1500, 2350, 250, 0, -80],
];
const at = (x: number, up: number, z: number) => new THREE.Vector3(x, height(x, z) + up, z);

export class Rig {
  mode: CamMode = 'director';
  base: Shot = { k: 'preset', name: 'site' };
  target = new THREE.Vector3(250, 0, -80);
  controls: OrbitControls;
  tour = 0;
  gateId = 'G1';
  subject = '';
  private snap = true;
  onFree: () => void = () => {};

  constructor(private stage: Stage) {
    const el = stage.renderer.domElement;
    this.controls = new OrbitControls(stage.camera, el);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: 1.5, minDistance: 25, maxDistance: 7000, screenSpacePanning: false, zoomSpeed: 1.2 });
    this.controls.enabled = false;
    // touching the scene hands the camera to the presenter
    let down: [number, number] | null = null;
    el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    window.addEventListener('pointerup', () => (down = null));
    el.addEventListener('pointermove', (e) => { if (down && this.mode !== 'free' && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) { this.set('free'); this.onFree(); } });
    el.addEventListener('wheel', () => { if (this.mode !== 'free') { this.set('free'); this.onFree(); } }, { passive: true });
    stage.camera.position.set(-2500, 700, -1500);
  }
  set(mode: CamMode) {
    this.mode = mode; this.controls.enabled = mode === 'free';
    if (mode === 'free') this.controls.target.copy(this.target);
  }
  cut() { this.snap = true; }
  private goal(shot: Shot, world: World): [THREE.Vector3, THREE.Vector3] {
    const preset = (n: keyof typeof PRESETS): [THREE.Vector3, THREE.Vector3] => { const p = PRESETS[n]; return [at(p[0], p[1], p[2]), at(p[3], p[4], p[5])]; };
    if (shot.k === 'preset') return preset(shot.name);
    if (shot.k === 'tour') {
      const u = Math.min(0.9999, this.tour) * (TOUR.length - 1), i = Math.floor(u), f = u - i;
      const get = (k: number) => TOUR[Math.max(0, Math.min(TOUR.length - 1, k))];
      const cr = (c: number) => { const a = get(i - 1)[c], b = get(i)[c], d = get(i + 1)[c], e = get(i + 2)[c]; return 0.5 * (2 * b + (-a + d) * f + (2 * a - 5 * b + 4 * d - e) * f * f + (-a + 3 * b - 3 * d + e) * f * f * f); };
      return [at(cr(0), cr(1), cr(2)), at(cr(3), cr(4), cr(5))];
    }
    if (shot.k === 'point') { const d = shot.dist ?? 160; return [at(shot.pos.x - d * 0.75, d * 0.7, shot.pos.z + d * 0.75), at(shot.pos.x, 4, shot.pos.z)]; }
    if (shot.k === 'gate') {
      const g = world.gates.get(shot.id);
      if (!g) { const n = NODES[shot.id]; return [at(n.pos.x - 60, 40, n.pos.z + 70), at(n.pos.x, 5, n.pos.z)]; }
      const d = g.dir, side = new THREE.Vector3(d.z, 0, -d.x), p = g.root.position;
      const c = shot.close ? [34, 20, 30] : [58, 34, 52];
      const cam = p.clone().addScaledVector(side, c[0]).addScaledVector(d, -c[2]); cam.y += c[1];
      const t = p.clone().addScaledVector(d, 2); t.y += shot.close ? 0 : 5;
      return [cam, t];
    }
    if (shot.k === 'drone') {
      const d = world.sim.drones.find((x) => x.id === shot.id), m = world.drones.get(shot.id);
      if (!d?.active || !m) return preset('zones');
      const p = m.root.position, f = new THREE.Vector3(Math.sin(d.heading), 0, Math.cos(d.heading));
      const cam = p.clone().addScaledVector(f, -85); cam.y += 48;
      const t = p.clone().addScaledVector(f, 40); t.y = height(t.x, t.z) + 20;
      return [cam, t];
    }
    const x = world.vehiclePos(shot.uid);
    if (!x) return preset('zone');
    const f = new THREE.Vector3(Math.sin(x.heading), 0, Math.cos(x.heading)), side = new THREE.Vector3(f.z, 0, -f.x), far = shot.far ?? 1;
    // while loading, stand on the side away from the loader
    const digger = world.loaderNear(x.pos); if (digger && side.dot(digger.sub(x.pos)) > 0) side.negate();
    const cam = x.pos.clone().addScaledVector(f, -52 * far).addScaledVector(side, 48 * far); cam.y += 34 * far;
    cam.y = Math.max(cam.y, height(cam.x, cam.z) + 14);
    const t = x.pos.clone().addScaledVector(f, 8); t.y += 5;
    return [cam, t];
  }
  update(dt: number, world: World) {
    const cam = this.stage.camera;
    if (this.mode === 'free') {
      this.controls.update();
      const g = height(cam.position.x, cam.position.z) + 8; if (cam.position.y < g) cam.position.y = g;
      this.target.copy(this.controls.target); return;
    }
    let pos: THREE.Vector3, look: THREE.Vector3, rate = 2.4;
    if (this.mode === 'driver') {
      const x = world.vehiclePos(this.subject) ?? [...world.vehicles.keys()].filter((k) => !k.startsWith('B')).map((k) => world.vehiclePos(k)).find(Boolean) ?? world.vehiclePos('B01')!;
      const f = new THREE.Vector3(Math.sin(x.heading), 0, Math.cos(x.heading));
      pos = x.pos.clone().addScaledVector(f, 9.6); pos.y += 8.2; look = x.pos.clone().addScaledVector(f, 70); look.y += 3; rate = 14;
    } else {
      let shot = this.base;
      if (this.mode === 'gate') shot = { k: 'gate', id: this.gateId, close: false };
      if (this.mode === 'map') shot = { k: 'preset', name: 'map' };
      if (this.mode === 'drone') { const d = world.sim.drones[4].active ? 'F' : world.sim.drones.find((x) => x.active)?.id; shot = d ? { k: 'drone', id: d } : { k: 'preset', name: 'zones' }; }
      if (this.mode === 'tower') { const t = TOWERS[2], u = world.sim.gov.unknown.at(-1), aim = u && world.sim.t - u.t < 3 ? u.pos : { x: 660, z: -80 }, d = Math.max(1, Math.hypot(aim.x - t.pos.x, aim.z - t.pos.z)); look = at(aim.x, 3, aim.z); pos = at(t.pos.x + ((aim.x - t.pos.x) / d) * 34, 58, t.pos.z + ((aim.z - t.pos.z) / d) * 34); }
      else [pos, look] = this.goal(shot, world);
      if (shot.k === 'chase') rate = 3.2;
      if (shot.k === 'tour') rate = 5;
    }
    const k = this.snap ? 1 : 1 - Math.exp(-dt * rate);
    // when a shot moves a long way, rise a little on the way so the camera does not plough through hills
    const jump = cam.position.distanceTo(pos!);
    cam.position.lerp(pos!, k); this.target.lerp(look!, this.snap ? 1 : 1 - Math.exp(-dt * rate * 1.35));
    const floor = height(cam.position.x, cam.position.z) + (this.mode === 'driver' ? 6 : 12 + Math.min(120, jump * 0.06));
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this.target); this.snap = false;
  }
}
export const nodePoint = (id: string) => v(NODES[id].pos.x, NODES[id].pos.z);
