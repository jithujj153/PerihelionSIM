/*
 * The drone fleet as drawn: a charging station, four patrol drones and a reserve swarm.
 * Visual only. Where the patrol drones fly and what the system learns still comes from the engine.
 * The swarm is how an approved follow (high-alert mode) is shown: the lead drone plus three reserves.
 */
import { lamp } from './glow';
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DOCK } from '../engine/layout';
import { SWATH_RADIUS, SWEEP_MIN, TRANSIT_MIN } from '../engine/drones';
import type { Sim } from '../engine/sim';
import { height } from './terrain';
import * as M from './models';

export const PATROL_IDS = ['A', 'B', 'C', 'D'];
export const SWARM_IDS = ['F', 'S1', 'S2', 'S3'];
const IDS = [...PATROL_IDS, ...SWARM_IDS];
const DOCK_TURN = 0.2;
const PAD_TOP = 1.7;
/** Pad positions on the station, local metres. Patrol row in front, reserve swarm behind. */
const PADS: Record<string, [number, number]> = { A: [-27, 12], B: [-9, 12], C: [9, 12], D: [27, 12], F: [-27, -10], S1: [-9, -10], S2: [9, -10], S3: [27, -10] };
const FOLLOW_OUT = 0.8, FOLLOW_BACK = 3.6, FOLLOW_END = 4.6;
const LIFT = 0.3;
const ORBIT_RADIUS = 55, TRAIL = 70;
const CYAN = 0x39d8ff, RED = 0xff3b30, GREEN = 0x3dff8f;

export function padPosition(id: string): THREE.Vector3 {
  const [x, z] = PADS[id], c = Math.cos(DOCK_TURN), s = Math.sin(DOCK_TURN);
  return new THREE.Vector3(DOCK.x + x * c + z * s, height(DOCK.x, DOCK.z) + 0.2 + PAD_TOP, DOCK.z - x * s + z * c);
}

/** Solar-powered charging station with one pad and charger per drone. */
export function chargingStation() {
  const root = new THREE.Group();
  const parts = [
    M.box(76, 7, 50, 0, -2.4, 0, 0x4a525c),
    M.box(77, 0.5, 51, 0, 0.9, 0, 0x2f353d),
    // equipment cabin with door, vents and a solar roof
    M.rbox(16, 8, 14, -48, 4, 0, 0x48627a, 0.5), M.box(17, 0.8, 15, -48, 0.4, 0, 0x2b3036), M.box(3.4, 5.6, 0.3, -51, 3.2, 7.05, 0x24394c), M.box(0.3, 0.9, 0.4, -49.9, 3.2, 7.2, 0xd9dde2),
    M.box(19, 0.4, 17, -48, 8.6, 0, 0xc3c8d0),
    // mast with a second panel and a wind gauge
    M.cyl(0.3, 0.45, 14, 41, 7, -22, 0xc3c8d0, 10), M.cyl(0.16, 0.16, 3, 41, 15, -22, 0x2b3036, 8), M.box(2.6, 0.16, 0.16, 41, 16.4, -22, 0xd6452f),
  ];
  for (let y = 4.4; y < 7; y += 0.6) parts.push(M.box(4.6, 0.22, 0.3, -44.5, y, 7.05, 0x24394c));
  // photovoltaic cells with bright frames
  const panel = (cx: number, y: number, cz: number, cols: number, rows: number, w: number, d: number) => { for (let i = 0; i < cols; i++) for (let k = 0; k < rows; k++) parts.push(M.box(w / cols - 0.22, 0.16, d / rows - 0.22, cx - w / 2 + ((i + 0.5) * w) / cols, y, cz - d / 2 + ((k + 0.5) * d) / rows, 0x16355c)); };
  panel(-48, 8.9, 0, 6, 4, 18.6, 16.6);
  parts.push(M.box(10.4, 0.3, 7.4, 41, 12.2, -22, 0xc3c8d0)); panel(41, 12.45, -22, 4, 3, 10, 7);
  // guard rail with corner lights
  for (let x = -37; x <= 37; x += 9.25) for (const z of [-24.4, 24.4]) parts.push(M.box(0.35, 2.4, 0.35, x, 2.2, z, 0xf0b429));
  for (const z of [-24.4, 24.4]) parts.push(M.box(74.4, 0.2, 0.2, 0, 3.3, z, 0xc3c8d0));
  const rings: Record<string, THREE.Mesh> = {};
  for (const id of IDS) {
    const [x, z] = PADS[id], reserve = SWARM_IDS.includes(id);
    parts.push(M.cyl(7.4, 7.4, 0.25, x, 1.25, z, 0xe9ece6, 28), M.cyl(6, 6, 0.28, x, 1.32, z, reserve ? 0x70261f : 0x174e6b, 28));
    parts.push(M.rbox(1.4, 4.2, 1.4, x + 7.4, 3.1, z - 7.4, 0x262d36, 0.3), M.rbox(1.6, 0.5, 1.6, x + 7.4, 5.4, z - 7.4, 0xf0b429, 0.15), M.box(0.12, 1.4, 0.8, x + 6.66, 3.6, z - 7.4, 0x7fe4ff));
    // landing marks and the power cable from the charger
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push(M.box(2.2, 0.06, 0.35, x + dx * 2.9, 1.49, z + dz * 3.7, 0xe9ece6), M.box(0.35, 0.06, 2.2, x + dx * 3.8, 1.49, z + dz * 2.8, 0xe9ece6));
    parts.push(M.box(0.3, 0.2, 5.4, x + 7.4, 1.3, z - 3.9, 0x15171a));
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.2, 7.1, 36), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 1.55, z); root.add(ring); rings[id] = ring;
  }
  root.add(M.merged(parts));
  return { root, rings };
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.95)'); r.addColorStop(0.25, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export type DroneView = ReturnType<typeof M.droneModel> & { label: CSS2DObject };
interface Extra { glow: THREE.Sprite; tether: THREE.Line; trail: THREE.Line; points: THREE.Vector3[]; beam: THREE.Line }
export type FleetMode = 'idle' | 'patrol' | 'waiting' | 'swarm';

const line = (n: number, color: number, opacity: number) => {
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })); l.frustumCulled = false; return l;
};
const setPoints = (l: THREE.Line, pts: THREE.Vector3[]) => {
  const a = l.geometry.attributes.position as THREE.BufferAttribute;
  pts.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z)); a.needsUpdate = true; l.geometry.setDrawRange(0, pts.length);
};
const ease = (u: number) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };

export class Fleet {
  drones = new Map<string, DroneView>();
  private extra = new Map<string, Extra>();
  private station = chargingStation();
  private stationLabel: CSS2DObject;
  private target: THREE.Mesh;
  private spin = 0;
  private time = 0;
  mode: FleetMode = 'idle';
  private routes = new THREE.Group();
  private lastRoutes = new THREE.Group();
  private routeId = -1;

  constructor(group: THREE.Group, tag: (cls: string, html?: string) => CSS2DObject) {
    const s = this.station; s.root.position.set(DOCK.x, height(DOCK.x, DOCK.z) + 0.2, DOCK.z); s.root.rotation.y = DOCK_TURN; group.add(s.root);
    this.stationLabel = tag('site station'); this.stationLabel.position.set(0, 22, 0); s.root.add(this.stationLabel);
    const glowMap = glowTexture();
    for (const id of IDS) {
      const swarm = SWARM_IDS.includes(id), color = swarm ? RED : CYAN;
      const m = M.droneModel(swarm ? 0xff5a36 : 0xf4f6fa);
      const label = tag(swarm ? 'drone swarm' : 'drone'); label.position.set(0, 7, 0); m.root.add(label);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      glow.renderOrder = 11; m.root.add(glow);
      const tether = line(2, color, 0.45), trail = line(TRAIL, color, 1), beam = line(2, RED, 0.7);
      group.add(m.root, m.foot, tether, trail, beam);
      this.drones.set(id, { ...m, label });
      this.extra.set(id, { glow, tether, trail, points: [], beam });
    }
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 56), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    this.target.rotation.x = -Math.PI / 2; this.target.renderOrder = 10; this.target.visible = false; group.add(this.target);
    group.add(this.routes, this.lastRoutes);
  }

  reset() { for (const e of this.extra.values()) e.points = []; this.clear(this.routes); this.clear(this.lastRoutes); this.routeId = -1; }
  private clear(g: THREE.Group) { for (const o of [...g.children] as THREE.Line[]) { g.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }
  /** Draws the route of the round now flying, keeping the one before it so the two can be compared. */
  private showRoutes(sim: Sim, paper: boolean) {
    const f = sim.flight;
    if (f && f.round.id !== this.routeId) {
      this.routeId = f.round.id; this.clear(this.lastRoutes);
      for (const o of [...this.routes.children] as THREE.Line[]) { const m = o.material as THREE.LineDashedMaterial; m.color.set(0xffffff); m.opacity = 0.3; this.lastRoutes.add(o); }
      for (const plan of f.plans) {
        const pts: THREE.Vector3[] = [];
        for (let i = 1; i < plan.path.length; i++) {
          const a = plan.path[i - 1], b = plan.path[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 30));
          for (let k = 0; k < n; k++) { const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n; pts.push(new THREE.Vector3(x, height(x, z) + 36, z)); }
        }
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: CYAN, dashSize: 34, gapSize: 18, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
        l.computeLineDistances(); l.renderOrder = 7; l.frustumCulled = false; this.routes.add(l);
      }
    }
    const flying = !!f && !f.done;
    this.routes.visible = !paper && flying; this.lastRoutes.visible = !paper && flying;
  }

  /** Where a drone should be drawn now, or null when it is on its pad. */
  private pose(sim: Sim, id: string, centre: THREE.Vector3 | null): { pos: THREE.Vector3; heading: number; scanning: boolean; orbit: boolean } | null {
    const pad = padPosition(id);
    const swarmIndex = SWARM_IDS.indexOf(id);
    if (swarmIndex >= 0) {
      const f = sim.follow; if (!f || !centre) return null;
      const el = sim.t - f.t0; if (el >= FOLLOW_END) return null;
      const a = this.spin + (swarmIndex * Math.PI) / 2, x = centre.x + Math.cos(a) * ORBIT_RADIUS, z = centre.z + Math.sin(a) * ORBIT_RADIUS;
      const slot = new THREE.Vector3(x, height(x, z) + 46 + (swarmIndex % 2) * 12, z);
      const face = Math.atan2(centre.x - x, centre.z - z);
      if (el >= FOLLOW_OUT && el < FOLLOW_BACK) return { pos: slot, heading: face, scanning: true, orbit: true };
      // lift off together above the pads, then travel; come home the same way in reverse
      const hover = pad.clone(); hover.y += 30 + swarmIndex * 4;
      const out = el < FOLLOW_OUT, age = out ? el : FOLLOW_END - el;
      if (age < LIFT) return { pos: pad.clone().lerp(hover, ease(age / LIFT)), heading: DOCK_TURN, scanning: false, orbit: false };
      const span = out ? FOLLOW_OUT - LIFT : FOLLOW_END - FOLLOW_BACK - LIFT;
      const u = ease((age - LIFT) / span), p = hover.clone().lerp(slot, u); p.y += Math.sin(u * Math.PI) * (40 + swarmIndex * 9);
      const to = out ? slot : hover;
      return { pos: p, heading: Math.atan2(to.x - p.x, to.z - p.z), scanning: false, orbit: false };
    }
    const d = sim.drones.find((x) => x.id === id), f = sim.flight;
    if (!d?.active || !f) return null;
    const el = sim.t - f.t0;
    const pos = new THREE.Vector3(d.pos.x, height(d.pos.x, d.pos.z) + d.alt, d.pos.z);
    // leave from, and settle on, the drone's own pad
    const hover = pad.clone(); hover.y += 30;
    const age = el < TRANSIT_MIN ? el : el > TRANSIT_MIN + SWEEP_MIN ? 2 * TRANSIT_MIN + SWEEP_MIN - el : TRANSIT_MIN;
    if (age < LIFT) pos.lerpVectors(pad, hover, ease(age / LIFT));
    else if (age < TRANSIT_MIN) pos.lerpVectors(hover, pos.clone(), ease((age - LIFT) / (TRANSIT_MIN - LIFT)));
    return { pos, heading: d.heading, scanning: d.scanning && !f.done, orbit: false };
  }

  update(sim: Sim, dt: number, camera: THREE.Vector3, paper: boolean, target: THREE.Vector3 | null) {
    this.time += dt; this.spin += dt * 0.9;
    this.showRoutes(sim, paper);
    let ready = 0, airborne = 0;
    const fp = sim.follow?.p.pos;
    const centre = sim.follow ? target ?? (fp ? new THREE.Vector3(fp.x, height(fp.x, fp.z), fp.z) : padPosition('F')) : null;
    for (const id of IDS) {
      const m = this.drones.get(id)!, e = this.extra.get(id)!, swarm = SWARM_IDS.includes(id);
      const pose = this.pose(sim, id, centre);
      const ring = this.station.rings[id].material as THREE.MeshBasicMaterial;
      m.root.visible = !paper;
      if (!pose) {
        ready++;
        m.root.position.copy(padPosition(id)); m.root.rotation.y = DOCK_TURN; m.root.scale.setScalar(1.15);
        m.label.visible = false; m.cone.visible = false; m.foot.visible = false; e.glow.visible = false; e.tether.visible = false; e.trail.visible = false; e.beam.visible = false; e.points = [];
        // slow green pulse while charging; the reserve turns red when an alert is waiting for people
        const alerted = swarm && this.mode === 'waiting';
        ring.color.set(alerted ? RED : GREEN); ring.opacity = 0.45 + 0.4 * Math.abs(Math.sin(this.time * (alerted ? 7 : 1.6) + IDS.indexOf(id)));
        continue;
      }
      airborne++; ring.color.set(0x6d747c); ring.opacity = 0.35;
      if (m.root.position.distanceTo(pose.pos) > 160) { m.root.position.copy(pose.pos); e.points = []; }
      else m.root.position.lerp(pose.pos, Math.min(1, dt * 9));
      const p = m.root.position, dist = camera.distanceTo(p), scale = Math.max(1.4, Math.min(18, dist / 140));
      m.root.rotation.y = pose.heading; m.root.scale.setScalar(scale);
      m.rotors.forEach((r, i) => (r.rotation.z += dt * (i % 2 ? 40 : -40)));
      const flash = 0.5 + 0.5 * Math.sin(this.time * (swarm ? 14 : 6) + IDS.indexOf(id) * 1.7);
      lamp(m.beacon, swarm ? (flash > 0.5 ? RED : 0x2f6bff) : flash > 0.5 ? GREEN : 0xffffff, swarm ? 11 : 5);
      // glow keeps a drone findable from far away
      const glowSize = Math.max(14, dist * 0.052) * (0.8 + 0.35 * flash);
      e.glow.visible = !paper; e.glow.scale.setScalar(glowSize / scale);
      (e.glow.material as THREE.SpriteMaterial).color.set(swarm && flash < 0.5 ? 0x2f6bff : swarm ? RED : CYAN);
      m.label.visible = !paper;
      const name = id === 'F' ? 'Swarm lead' : swarm ? `Swarm ${id}` : `Drone ${id}`, doing = swarm ? 'high alert' : pose.scanning ? 'counting' : 'in transit';
      const html = `<b>${name}</b><i>${doing}</i>`;
      if (m.label.element.innerHTML !== html) m.label.element.innerHTML = html;
      const ground = height(p.x, p.z);
      e.tether.visible = !paper; setPoints(e.tether, [p.clone(), new THREE.Vector3(p.x, ground + 2, p.z)]);
      const last = e.points[e.points.length - 1];
      if (!last || last.distanceTo(p) > 5) { e.points.push(p.clone()); if (e.points.length > TRAIL) e.points.shift(); }
      e.trail.visible = !paper && e.points.length > 1; setPoints(e.trail, e.points);
      const radius = SWATH_RADIUS, inv = 1 / scale, patrolScan = !swarm && pose.scanning && !paper;
      m.cone.visible = patrolScan; m.cone.scale.set(radius * inv, Math.max(1, p.y - ground) * inv, radius * inv);
      m.foot.visible = patrolScan; m.foot.position.set(p.x, ground + 3, p.z); m.foot.scale.setScalar(radius);
      e.beam.visible = !paper && pose.orbit && !!centre;
      if (e.beam.visible) setPoints(e.beam, [p.clone(), centre!.clone().setY(centre!.y + 4)]);
    }
    const waiting = sim.gov.proposals.some((q) => q.kind === 'follow' && q.state === 'pending');
    this.mode = sim.follow ? 'swarm' : waiting ? 'waiting' : airborne ? 'patrol' : 'idle';
    this.target.visible = !paper && this.mode === 'swarm' && !!centre;
    if (this.target.visible) { this.target.position.copy(centre!).setY(centre!.y + 3); this.target.scale.setScalar(Math.max(26, camera.distanceTo(centre!) / 16) * (1 + 0.18 * Math.sin(this.time * 6))); }
    const state = this.mode === 'swarm' ? 'HIGH ALERT · swarm deployed' : this.mode === 'waiting' ? 'Swarm on standby · awaiting two officers' : `${ready} of ${IDS.length} charged and ready`;
    const html = `<b>Drone charging station</b><i>${state}</i>`;
    if (this.stationLabel.element.innerHTML !== html) this.stationLabel.element.innerHTML = html;
    this.stationLabel.element.className = `tag site station ${this.mode === 'swarm' ? 'bad' : this.mode === 'waiting' ? 'warn' : ''}`;
    this.stationLabel.visible = camera.distanceTo(this.station.root.position) < 3600;
  }
}
