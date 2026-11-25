/* Draws the simulation. Three views: what happened, what the system can prove, what the Vendor's paper says. */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inPickupArea, LEASE, NODES, PICKUP_ZONE, PILES, TOWERS, DOCK, CONTROL_ROOM, PLANT, ENTRY_ROUTES, EXIT_ROUTE, leg, BAYS } from '../engine/layout';
import { dist, f1, hhmm, inPoly, Rng, v, Vec } from '../engine/util';
import type { Sim, Vehicle } from '../engine/sim';
import { SWATH_RADIUS } from '../engine/drones';
import { buildTerrain, height, noise, ribbon, roadInfo } from './terrain';
import * as M from './models';
import type { Stage } from './stage';

export type ViewMode = 'truth' | 'evidence' | 'paper';
export type Layer = 'fence' | 'gates' | 'pads' | 'checks' | 'towers' | 'zones' | 'boundary';
export type Pick = { type: 'vehicle' | 'gate' | 'tower' | 'pile'; id: string };

function tag(cls: string, html = '') {
  const el = document.createElement('div'); el.className = 'tag ' + cls; el.innerHTML = html;
  const o = new CSS2DObject(el); (o as any).cache = html; return o;
}
const setTag = (o: CSS2DObject, html: string) => { if ((o as any).cache !== html) { (o as any).cache = html; o.element.innerHTML = html; } };
const v3 = (p: Vec, up = 0) => new THREE.Vector3(p.x, height(p.x, p.z) + up, p.z);
const nice = (n: number) => Math.round(n).toLocaleString('en-IN');

interface VView { model: M.TruckModel; label: CSS2DObject; heading: number; last: THREE.Vector3; plate: string; ghost: boolean }
interface PileView { mesh: THREE.Mesh; expected: THREE.Mesh; label: CSS2DObject; shown: number; shownExp: number; H: number; R: number; side: number; cloud: THREE.Points }

export class World {
  group = new THREE.Group();
  view: ViewMode = 'truth';
  layers: Record<Layer, boolean> = { fence: true, gates: true, pads: true, checks: true, towers: true, zones: false, boundary: true };
  vehicles = new Map<string, VView>();
  gates = new Map<string, M.GateModel & { label: CSS2DObject; dir: THREE.Vector3 }>();
  private checks = new Map<string, ReturnType<typeof M.checkpointModel> & { ping: number; label: CSS2DObject }>();
  private hidden = new Map<string, { group: THREE.Group; glow: THREE.Mesh; ping: number }>();
  private towers = new Map<string, ReturnType<typeof M.towerModel> & { label: CSS2DObject; look: number }>();
  piles = new Map<string, PileView>();
  drones = new Map<string, ReturnType<typeof M.droneModel> & { label: CSS2DObject }>();
  private diggers: { x: ReturnType<typeof M.excavator>; at: Vec; face: number }[] = [];
  private fenceGroup = new THREE.Group();
  private boundaryGroup = new THREE.Group();
  private zoneGroup = new THREE.Group();
  private weightTags: { o: CSS2DObject; until: number }[] = [];
  private markers: { root: THREE.Group; label: CSS2DObject }[] = [];
  private seenFx = 0;
  private seenEv = 0;
  private scanStart = -99;
  private lastFxT = -1;
  time = 0;
  selected = '';

  constructor(private stage: Stage, public sim: Sim, private onPick: (p: Pick) => void) {
    stage.scene.add(this.group);
    this.group.add(buildTerrain());
    this.buildSite();
    this.setSim(sim);
  }
  setSim(sim: Sim) {
    this.sim = sim;
    for (const x of this.vehicles.values()) this.drop(x);
    this.vehicles.clear(); this.weightTags.forEach((w) => this.group.remove(w.o)); this.weightTags = [];
    this.seenFx = 0; this.seenEv = sim.gov.evidence.length; this.lastFxT = sim.t; this.scanStart = -99;
    for (const p of this.piles.values()) { p.shown = -1; p.shownExp = -1; }
    for (const g of this.gates.values()) g.open = 0;
  }
  private drop(x: VView) { this.group.remove(x.model.root); x.model.root.remove(x.label); x.label.element.remove(); x.model.plates.forEach((p) => (p.material as THREE.MeshBasicMaterial).map?.dispose()); }

  private clickable(o: CSS2DObject, p: Pick) { o.element.classList.add('click'); o.element.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onPick(p); }); return o; }
  private heading(node: string): number {
    for (const route of [...Object.values(ENTRY_ROUTES), EXIT_ROUTE]) {
      const i = route.indexOf(node); if (i < 0) continue;
      const before = i > 0 ? leg(route[i - 1], node) : [NODES[node].pos];
      const after = i < route.length - 1 ? leg(node, route[i + 1]) : [NODES[node].pos];
      const a = before.length > 1 ? before[before.length - 2] : NODES[node].pos, b = after.length > 1 ? after[1] : NODES[node].pos;
      return Math.atan2(b.x - a.x, b.z - a.z);
    }
    return 0;
  }
  private buildSite() {
    const g = this.group;
    for (const n of Object.values(NODES)) {
      const h = this.heading(n.id);
      if (n.kind === 'entry' || n.kind === 'exit' || n.kind === 'route' || n.kind === 'zone') {
        const m = M.gateModel(n.kind); m.root.position.copy(v3(n.pos, 0.4)); m.root.rotation.y = h; g.add(m.root);
        const label = this.clickable(tag('gate'), { type: 'gate', id: n.id }); label.position.set(0, 18, 0); m.root.add(label);
        setTag(label, `<b>${n.id}</b><i>${n.kind === 'entry' ? 'Entry gate' : n.kind === 'exit' ? 'Exit gate · loaded trucks' : n.kind === 'route' ? 'Route gate' : 'Zone gate'}</i>`);
        this.gates.set(n.id, { ...m, label, dir: new THREE.Vector3(Math.sin(h), 0, Math.cos(h)) });
      } else if (n.kind === 'check') {
        const m = M.checkpointModel(); m.root.position.copy(v3(n.pos)); m.root.rotation.y = h; g.add(m.root);
        const label = tag('minor', `<b>${n.id}</b><i>Checkpoint</i>`); label.position.set(12.5, 17, 0); m.root.add(label);
        this.checks.set(n.id, { ...m, ping: -9, label });
      } else if (n.kind === 'hidden') {
        const m = M.buriedPad(16, 22); m.group.position.copy(v3(n.pos, 0.6)); m.group.rotation.y = h; g.add(m.group);
        const label = tag('minor buried', `<b>${n.id}</b><i>Buried weighing</i>`); label.position.set(0, 6, 0); m.group.add(label);
        this.hidden.set(n.id, { group: m.group, glow: m.glow, ping: -9 });
      }
    }
    for (const t of TOWERS) {
      const m = M.towerModel(t.range); m.root.position.copy(v3(t.pos, -0.5)); g.add(m.root);
      const ringPts = Array.from({ length: 121 }, (_, i) => { const a = (i / 120) * Math.PI * 2; return v3(v(t.pos.x + Math.cos(a) * t.range, t.pos.z + Math.sin(a) * t.range), 2); });
      m.ring.geometry.dispose(); m.ring.geometry = new THREE.BufferGeometry().setFromPoints(ringPts); g.add(m.ring);
      const beam = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 6), 3)), new THREE.LineBasicMaterial({ color: 0x7cffd8, transparent: true, opacity: 0.4, depthWrite: false }));
      beam.frustumCulled = false; m.beam = beam as unknown as typeof m.beam; g.add(beam);
      const label = this.clickable(tag('minor', `<b>${t.id}</b><i>LiDAR tower</i>`), { type: 'tower', id: t.id }); label.position.set(0, m.height + 9, 0); m.root.add(label);
      this.towers.set(t.id, { ...m, label, look: 0 });
    }
    const place = (o: THREE.Object3D, p: Vec, rot: number, name: string, up: number) => { o.position.copy(v3(p, 0.2)); o.rotation.y = rot; g.add(o); if (name) { const l = tag('site', name); l.position.set(0, up, 0); o.add(l); } };
    place(M.controlRoom(), CONTROL_ROOM, -0.5, '<b>AI control room</b><i>Governing Body</i>', 34);
    place(M.droneDock(), DOCK, 0.2, '<b>Drone dock</b>', 14);
    place(M.plantShed(), PLANT, 0.5, '', 0);
    place(M.weighbridge(), NODES.DEST.pos, this.heading('DEST') || 1.2, '<b>Destination weighbridge</b><i>third, separate weighing</i>', 20);
    // stockpiles
    for (const p of PILES) {
      const R = p.radius, H = R * 0.55, node = NODES.S1.pos, side = Math.atan2((p.id === 'S2' ? 75 : node.z) - p.pos.z, (p.id === 'S2' ? 735 : node.x) - p.pos.x);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const mesh = new THREE.Mesh(this.pileGeometry(R, H, side, 0), mat); mesh.position.copy(v3(p.pos, 0.1)); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      const expected = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }));
      expected.position.copy(mesh.position); expected.visible = false; expected.renderOrder = 6; g.add(expected);
      const label = this.clickable(tag('pile'), { type: 'pile', id: p.id }); label.position.set(0, H + 14, 0); mesh.add(label);
      const cloud = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 1.7, vertexColors: true, transparent: true, depthWrite: false })); cloud.position.copy(mesh.position); cloud.visible = false; g.add(cloud);
      this.piles.set(p.id, { mesh, expected, label, shown: -1, shownExp: -1, H, R, side, cloud });
    }
    for (const [at, from, face] of [[NODES.S1.pos, PILES[0].pos, 0], [v(735, 75), PILES[1].pos, 0]] as [Vec, Vec, number][]) {
      const x = M.excavator(); const u = 31 / dist(at, from); const p = v(at.x + (from.x - at.x) * u, at.z + (from.z - at.z) * u);
      const toTruck = Math.atan2(at.x - p.x, at.z - p.z); x.root.position.copy(v3(p, 0.2)); x.root.rotation.y = toTruck; g.add(x.root); this.diggers.push({ x, at, face: face + toTruck });
    }
    // loading zone fence with gaps at the roads and one at the weak spot near S2
    const posts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < PICKUP_ZONE.length; i++) {
      const a = PICKUP_ZONE[i], b = PICKUP_ZONE[(i + 1) % PICKUP_ZONE.length], L = dist(a, b), n = Math.ceil(L / 7), ang = Math.atan2(b.x - a.x, b.z - a.z);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, p = v(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u);
        const road = roadInfo(p.x, p.z); if ((road.w > 8 && road.d < 17) || dist(p, v(803, 187)) < 17) continue;
        const y = height(p.x, p.z), seg = L / n;
        for (const part of [M.box(0.5, 4.6, 0.5, 0, 2.3, -seg / 2, 0x555b63), M.box(0.18, 0.28, seg, 0, 4.1, 0, 0xffa62b), M.box(0.14, 0.2, seg, 0, 2.6, 0, 0xc9ced6), M.box(0.14, 0.2, seg, 0, 1.2, 0, 0xc9ced6)]) { part.rotateY(ang); part.translate(p.x, y, p.z); posts.push(part); }
      }
    }
    this.fenceGroup.add(M.merged(posts));
    const gapTag = tag('warnspot', '<b>Fence gap</b><i>no gate here</i>'); gapTag.position.copy(v3(v(803, 187), 8)); (gapTag as any).truthOnly = true; this.fenceGroup.add(gapTag);
    const zt = tag('site', '<b>Gated pickup zone</b>'); zt.position.copy(v3(v(660, -295), 14)); this.fenceGroup.add(zt);
    g.add(this.fenceGroup);
    // lease boundary
    const dash = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const dashes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < LEASE.length; i++) {
      const a = LEASE[i], b = LEASE[(i + 1) % LEASE.length], n = Math.max(1, Math.round(dist(a, b) / 38));
      for (let k = 0; k < n; k++) { const q = (u: number) => v(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u); const m = q((k + 0.29) / n), road = roadInfo(m.x, m.z); if (road.w > 8 && road.d < 42) continue; dashes.push(ribbon([q(k / n), q((k + 0.58) / n)], 4.5, 2.2, dash, 6).geometry); }
    }
    this.boundaryGroup.add(new THREE.Mesh(mergeGeometries(dashes)!, dash));
    for (const p of [v(-1385, -150), v(-420, -2300), v(1600, 800), v(-200, 1660)]) { const l = tag('warnspot', '<b>Open boundary</b><i>no fence · no gate</i>'); l.position.copy(v3(p, 22)); this.boundaryGroup.add(l); }
    g.add(this.boundaryGroup);
    // drone zones
    const zm = new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 });
    const clip = (a: Vec, b: Vec) => { const pts: Vec[] = []; for (let u = 0; u <= 1.0001; u += 1 / 200) { const p = v(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u); if (inPoly(p, LEASE)) pts.push(p); } if (pts.length > 1) this.zoneGroup.add(ribbon(pts, 5, 3, zm, 20)); };
    clip(v(-300, -2700), v(-300, 1800)); clip(v(-300, -300), v(1700, -300)); clip(v(-300, 420), v(1700, 420));
    for (const [z, p] of [['A', v(-850, -200)], ['B', v(560, -1150)], ['C', v(250, 20)], ['D', v(350, 1450)]] as [string, Vec][]) { const l = tag('zone', `<b>Zone ${z}</b><i>drone ${z}</i>`); l.position.copy(v3(p, 60)); this.zoneGroup.add(l); }
    g.add(this.zoneGroup);
    for (const id of ['A', 'B', 'C', 'D', 'F']) {
      const m = M.droneModel(id === 'F' ? 0x8a2b2b : 0x2a2d33); const label = tag('drone', id === 'F' ? '<b>Follow drone</b>' : `<b>Drone ${id}</b>`); label.position.set(0, 9, 0); m.root.add(label);
      g.add(m.root, m.foot); m.root.visible = m.foot.visible = false; this.drones.set(id, { ...m, label });
    }
  }
  private pileGeometry(R: number, H: number, side: number, removed: number) {
    const rings = 22, segs = 72, pos: number[] = [], col: number[] = [], idx: number[] = [], c = new THREE.Color(), a1 = new THREE.Color(0x4d1d18), a2 = new THREE.Color(0x8c4332);
    // removal shows as a bite on the loading side; its depth is exaggerated so the eye can follow it
    const bite = Math.min(0.85, removed * 16);
    for (let i = 0; i <= rings; i++) {
      const u = i / rings;
      for (let j = 0; j <= segs; j++) {
        const t = ((j % segs) / segs) * Math.PI * 2, rr = R * u * (1 + (noise(Math.cos(t) * 3 + 9, Math.sin(t) * 3 + 4) - 0.5) * 0.28);
        const x = Math.cos(t) * rr, z = Math.sin(t) * rr;
        let y = H * (1 - Math.pow(u, 1.25)) + (noise(x / 7 + 3, z / 7) - 0.5) * H * 0.16 * (1 - u);
        let d = Math.atan2(Math.sin(t - side), Math.cos(t - side));
        const w = Math.exp(-(d * d) / 0.32) * Math.max(0, 1 - Math.pow((u - 0.5) / 0.48, 2));
        y *= 1 - bite * w;
        pos.push(x, i === rings ? -1 : Math.max(0, y), z);
        c.copy(a1).lerp(a2, noise(x / 11, z / 11 + 7)); col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + segs + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  setView(view: ViewMode) {
    this.view = view;
    this.stage.renderer.domElement.classList.toggle('paper', view === 'paper');
    this.stage.labels.domElement.classList.toggle('paper', view === 'paper');
  }
  loaderNear(p: THREE.Vector3): THREE.Vector3 | null { const d = this.diggers.find((g) => g.x.root.position.distanceTo(p) < 48); return d ? d.x.root.position.clone() : null; }
  pick(ray: THREE.Raycaster): Pick | null {
    let best: Pick | null = null, bd = Infinity;
    const test = (o: THREE.Object3D, p: Pick) => { if (!o.visible) return; const h = ray.intersectObject(o, true).filter((x) => (x.object as THREE.Mesh).isMesh)[0]; if (h && h.distance < bd) { bd = h.distance; best = p; } };
    for (const [id, x] of this.vehicles) test(x.model.root, { type: 'vehicle', id });
    for (const [id, x] of this.gates) test(x.root, { type: 'gate', id });
    for (const [id, x] of this.piles) test(x.mesh, { type: 'pile', id });
    return best;
  }
  /** World position of a vehicle as drawn. */
  vehiclePos(uid: string): { pos: THREE.Vector3; heading: number } | null {
    const x = this.vehicles.get(uid); return x && x.model.root.visible ? { pos: x.model.root.position, heading: x.model.root.rotation.y } : null;
  }

  /* ------------------------------------------------------------ per frame */
  private vehicleLabel(x: Vehicle, claimedSilent: boolean): { html: string; cls: string; halo: number } {
    const gov = this.sim.gov, reg = x.device ? gov.registry.get(x.device.id) : undefined, trip = x.device ? gov.trips.get(x.device.id) : undefined;
    const story = !x.uid.startsWith('B');
    let cls = 'veh' + (story ? '' : ' bg'), halo = 0, sub = '';
    if (this.view === 'paper') {
      const p = trip?.paperNet;
      sub = p !== undefined ? `Note ${trip!.note}: <u>${f1(p)} t</u>` : trip?.inside ? 'Registered, inside' : 'Registered';
      return { html: `<b>${x.name}</b><i>${sub}</i>`, cls, halo };
    }
    if (this.view === 'truth') {
      sub = story ? x.role : '';
      if (x.load + x.extra > 0.3) sub += `${sub ? ' · ' : ''}${f1(x.load + x.extra)} t ${x.extra > 0.3 && x.load < 0.3 ? 'extra on board' : 'on board'}`;
      if (!x.device) { cls += ' bad'; halo = 0xff3b30; }
      else if (x.device.silent || x.device.tampered || x.spoof || x.extra > 0.3) { cls += ' warn'; halo = 0xffb020; }
      return { html: `<b>${x.name}</b>${sub ? `<i>${sub}</i>` : ''}`, cls, halo };
    }
    // evidence: only what sensors have established
    if (!reg || !trip) {
      if (!x.device) return { html: '<b>Unidentified vehicle</b><i>no device answers</i>', cls: cls + ' bad', halo: 0xff3b30 };
      return { html: `<b>${reg?.label ?? 'Vehicle'}</b><i>${x.state === 'gate' ? 'being checked' : 'not entered'}</i>`, cls, halo };
    }
    if (claimedSilent) return { html: `<b>${reg.label}</b><i>last heard ${hhmm(trip.lastSeen)}</i>`, cls: cls + ' bad lost', halo: 0xff3b30 };
    sub = trip.status;
    if (trip.sensorNet !== undefined && trip.inside) sub = `Loaded ${f1(trip.sensorNet)} t (truck sensor)`;
    if (trip.exitNet !== undefined && !trip.destNet) sub = `Left with ${f1(trip.exitNet)} t (pad)`;
    if (trip.destNet !== undefined) sub = `Delivered ${f1(trip.destNet)} t`;
    if (trip.flag === 'bad') { cls += ' bad'; halo = 0xff3b30; } else if (trip.flag === 'warn') { cls += ' warn'; halo = 0xffb020; } else if (trip.flag === 'ok') cls += ' ok';
    return { html: `<b>${reg.label}</b><i>${sub}</i>`, cls, halo };
  }
  /** Can an independent sensor see this unanswered vehicle at this moment? */
  private inSight(x: Vehicle) {
    const s = this.sim;
    if (['G1', 'G2', 'G3', 'G4'].some((g) => dist(NODES[g].pos, x.pos) < 110)) return true;
    if (inPickupArea(x.pos) && TOWERS.some((t) => !s.towersOff.has(t.id) && dist(t.pos, x.pos) < t.range * (s.weather === 'dust' ? 0.45 : s.weather === 'monsoon' ? 0.75 : 1))) return true;
    return s.drones.some((d) => d.active && d.scanning && dist(d.pos, x.pos) < (d.id === 'F' ? 70 : SWATH_RADIUS));
  }
  private updateVehicles(dt: number, camPos: THREE.Vector3) {
    const sim = this.sim, live = new Set<string>(), slots = new Map<string, number>();
    let claim: { real: Vec; said: Vec } | null = null;
    const high = camPos.y > 1100;
    for (const x of sim.vehicles) {
      if (x.state === 'gone') continue;
      live.add(x.uid);
      let view = this.vehicles.get(x.uid);
      if (!view) {
        const model = M.truckModel(x.color, x.plate, x.shape);
        const label = this.clickable(tag('veh'), { type: 'vehicle', id: x.uid }); label.position.set(0, 14, 0); model.root.add(label); this.group.add(model.root);
        view = { model, label, heading: x.heading, last: new THREE.Vector3(1e9, 0, 0), plate: x.plate, ghost: false };
        this.vehicles.set(x.uid, view);
      }
      if (view.plate !== x.plate) { view.plate = x.plate; view.model.setPlate(x.plate); }
      const trip = x.device ? sim.gov.trips.get(x.device.id) : undefined;
      let p = x.pos, visible = true, claimedSilent = false;
      if (this.view === 'evidence') {
        const answering = sim.answering(x);
        // once a reader has caught a false position, show where the truck was really heard
        if (answering && x.spoof) { const caught = sim.gov.alerts.some((a) => a.subject === x.device!.id && a.title.includes('false position')); if (caught) claim = { real: x.pos, said: x.spoof }; else p = x.spoof; }
        if (!answering) {
          const atGate = x.state === 'gate' || x.state === 'held';
          if (x.device && trip?.inside && !atGate) { p = trip.claimed; claimedSilent = true; }
          else if (!atGate) visible = this.inSight(x);
        }
      } else if (this.view === 'paper') visible = !!x.device && !x.scripted;
      // vehicles that share a spot stand side by side
      let ox = 0, oz = 0;
      if (x.state === 'loading' || (x.state === 'held') || (x.state === 'parked' && !x.uid.startsWith('B'))) {
        const key = `${Math.round(p.x / 18)},${Math.round(p.z / 18)}`, n = slots.get(key) ?? 0; slots.set(key, n + 1);
        ox = n * 11 * Math.cos(x.heading); oz = -n * 11 * Math.sin(x.heading);
      }
      const q = v(p.x + ox, p.z + oz), y = height(q.x, q.z) + 0.45;
      const m = view.model, moved = view.last.x > 1e8 ? 0 : Math.hypot(q.x - view.last.x, q.z - view.last.z);
      let d = Math.atan2(Math.sin(x.heading - view.heading), Math.cos(x.heading - view.heading));
      view.heading += moved > 60 ? d : d * Math.min(1, dt * 7);
      const ahead = v(q.x + Math.sin(view.heading) * 8, q.z + Math.cos(view.heading) * 8), behind = v(q.x - Math.sin(view.heading) * 8, q.z - Math.cos(view.heading) * 8);
      m.root.position.set(q.x, y, q.z);
      m.root.rotation.set(0, 0, 0); m.root.rotation.order = 'YXZ'; m.root.rotation.y = view.heading;
      m.root.rotation.x = -Math.atan2(height(ahead.x, ahead.z) - height(behind.x, behind.z), 16);
      view.last.copy(m.root.position);
      if (moved < 40 && moved > 0.001) M.turnWheels(m, moved);
      m.root.visible = visible;
      view.label.visible = visible;
      if (!visible) continue;
      const trueLoad = x.load + x.extra;
      M.setHeap(m, this.view === 'truth' ? trueLoad : this.view === 'paper' ? trip?.paperNet ?? 0 : x.state === 'loading' && this.sim.answering(x) ? x.load : trip?.sensorNet ?? (this.sim.answering(x) ? 0 : trueLoad));
      m.box.visible = !!x.device; m.led.visible = !!x.device && this.view !== 'paper';
      if (x.device) (m.led.material as THREE.MeshBasicMaterial).color.set(x.device.tampered || x.device.silent ? 0xff3b30 : x.powerCut ? 0xffb020 : 0x4dff88);
      m.led.scale.setScalar(1 + 0.35 * Math.sin(this.time * 6));
      const info = this.vehicleLabel(x, claimedSilent);
      const dd = camPos.distanceTo(m.root.position);
      const selected = this.selected === x.uid;
      setTag(view.label, info.html);
      // from high up, routine trucks become dots so the whole site reads as a live map
      const dot = high && !selected && x.uid.startsWith('B') && !info.cls.includes('bad') && !info.cls.includes('warn');
      view.label.element.className = `tag click ${info.cls}${selected ? ' sel' : ''}${dot ? ' dot' : ''}`;
      view.label.position.y = dot ? 2 : 14;
      view.label.visible = selected || dot || (x.uid.startsWith('B') ? dd < 420 : true);
      if (dd > 1300 && !selected) view.label.element.classList.add('far');
      m.halo.visible = (info.halo !== 0 || selected) && this.view !== 'paper';
      if (m.halo.visible) { const hm = m.halo.material as THREE.MeshBasicMaterial; hm.color.set(info.halo || 0xffffff); m.halo.scale.setScalar((1 + 0.12 * Math.sin(this.time * 5)) * Math.max(1, dd / 500)); }
      if (claimedSilent !== view.ghost) { view.ghost = claimedSilent; for (const part of [m.body, m.wheels, m.heap, ...m.plates]) part.visible = !claimedSilent; }
      if (claimedSilent) m.heap.visible = false;
    }
    for (const [uid, x] of this.vehicles) if (!live.has(uid)) { this.drop(x); this.vehicles.delete(uid); }
    this.showClaim(claim, camPos);
    // evidence view: where a sensor last saw something that no device answers for
    const spots: { pos: Vec; t: number; src: string; plate: string | null }[] = [];
    if (this.view === 'evidence') for (let i = sim.gov.unknown.length - 1; i >= 0 && spots.length < 5; i--) {
      const u = sim.gov.unknown[i]; if (sim.t - u.t > 4) break;
      if (!spots.some((s) => dist(s.pos, u.pos) < 260)) spots.push(u);
    }
    while (this.markers.length < spots.length) {
      const root = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(14, 18, 40), new THREE.MeshBasicMaterial({ color: 0xff3b30, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthTest: false })); ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; root.add(ring);
      const pin = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 4), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false })); pin.rotation.x = Math.PI; pin.position.y = 30; pin.renderOrder = 10; root.add(pin);
      const label = tag('veh bad'); label.position.set(0, 44, 0); root.add(label); this.group.add(root); this.markers.push({ root, label });
    }
    this.markers.forEach((mk, i) => {
      const s = spots[i]; mk.root.visible = mk.label.visible = !!s; if (!s) return;
      const near = [...this.vehicles.values()].some((x) => x.model.root.visible && Math.hypot(x.model.root.position.x - s.pos.x, x.model.root.position.z - s.pos.z) < 25);
      mk.root.position.copy(v3(s.pos, 1)); mk.root.scale.setScalar(Math.max(1, camPos.distanceTo(mk.root.position) / 600));
      const age = Math.round((sim.t - s.t) * 60);
      setTag(mk.label, `<b>Unidentified vehicle</b><i>seen by ${s.src}${age > 5 ? ` ${age < 90 ? age + ' s' : Math.round(age / 60) + ' min'} ago` : ''}</i>`);
      mk.label.visible = !near; mk.root.visible = !near;
    });
  }
  private claim: { root: THREE.Group; label: CSS2DObject; line: THREE.Line } | null = null;
  /** A false position: mark the spot the device claims and join it to where it was heard. */
  private showClaim(c: { real: Vec; said: Vec } | null, camPos: THREE.Vector3) {
    if (!this.claim) {
      if (!c) return;
      const root = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(13, 17, 40), new THREE.MeshBasicMaterial({ color: 0xffb020, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false })); ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; root.add(ring);
      const label = tag('veh warn', '<b>Claimed position</b><i>nothing is here</i>'); label.position.set(0, 18, 0); root.add(label);
      const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(33 * 3), 3)), new THREE.LineDashedMaterial({ color: 0xffb020, dashSize: 26, gapSize: 16, depthTest: false }));
      line.renderOrder = 10; line.frustumCulled = false; this.group.add(root, line); this.claim = { root, label, line };
    }
    const m = this.claim; m.root.visible = m.label.visible = m.line.visible = !!c; if (!c) return;
    m.root.position.copy(v3(c.said, 2)); m.root.scale.setScalar(Math.max(1, camPos.distanceTo(m.root.position) / 600));
    const a = m.line.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i <= 32; i++) { const k = i / 32, x = c.real.x + (c.said.x - c.real.x) * k, z = c.real.z + (c.said.z - c.real.z) * k; a.setXYZ(i, x, height(x, z) + 14 + Math.sin(k * Math.PI) * 60, z); }
    a.needsUpdate = true; m.line.computeLineDistances();
  }
  private events() {
    const sim = this.sim;
    for (const f of sim.fx) {
      if (f.t <= this.lastFxT) continue;
      if (f.kind === 'radio') { const c = this.checks.get(f.node); if (c) c.ping = this.time; }
      if (f.kind === 'weigh') { const h = this.hidden.get(f.node); if (h) h.ping = this.time; }
      if (f.kind === 'pileScan') this.startScan();
    }
    if (sim.fx.length) this.lastFxT = Math.max(this.lastFxT, sim.fx[sim.fx.length - 1].t);
    // weights read by the pads float above them for a few seconds
    const ev = sim.gov.evidence;
    for (; this.seenEv < ev.length; this.seenEv++) {
      const e = ev[this.seenEv]; if (!/pad|weighbridge/i.test(e.src) || this.view === 'paper') continue;
      const node = NODES[e.node]; if (!node) continue;
      const o = tag('weight', `<i>${e.src === 'Hidden pad' ? 'Buried pad' : e.src}</i><b>${e.value}</b>`); o.position.copy(v3(node.pos, 27)); this.group.add(o);
      if (/pad/i.test(e.src)) o.element.querySelector('b')!.append(' gross');
      this.weightTags.push({ o, until: this.time + 5.5 });
    }
    this.weightTags = this.weightTags.filter((w) => { if (this.time < w.until && this.view !== 'paper') return true; this.group.remove(w.o); w.o.element.remove(); return false; });
  }
  /** Hide labels that would sit on top of a more important one. */
  declutter() {
    const rank = (c: DOMTokenList) => c.contains('weight') ? 100 : c.contains('dot') ? 60 : c.contains('sel') ? 95 : c.contains('veh') ? (c.contains('bad') ? 90 : c.contains('bg') ? 20 : 75) : c.contains('pile') ? (c.contains('bad') ? 85 : 42)
      : c.contains('gate') ? (/ (scan|red|amber|green|bad)/.test(c.value) ? 80 : 45) : c.contains('zone') ? 55 : c.contains('drone') ? 30 : c.contains('site') ? 40 : c.contains('warnspot') ? 35 : 10;
    const list = [...this.stage.labels.domElement.children].filter((e) => (e as HTMLElement).style.display !== 'none') as HTMLElement[];
    const items = list.map((e) => ({ e, r: e.getBoundingClientRect(), k: rank(e.classList) })).sort((a, b) => b.k - a.k);
    const kept: DOMRect[] = [];
    for (const it of items) {
      const hit = kept.some((r) => it.r.left < r.right - 4 && it.r.right > r.left + 4 && it.r.top < r.bottom - 3 && it.r.bottom > r.top + 3);
      it.e.style.visibility = hit ? 'hidden' : '';
      if (!hit) kept.push(it.r);
    }
  }
  startScan() {
    this.scanStart = this.time; const r = new Rng(4);
    for (const p of this.piles.values()) {
      const src = p.mesh.geometry.attributes.position, idx = p.mesh.geometry.index!, n = 5200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      const pts: [number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const t = r.int(idx.count / 3) * 3; A.fromBufferAttribute(src, idx.getX(t)); B.fromBufferAttribute(src, idx.getX(t + 1)); C.fromBufferAttribute(src, idx.getX(t + 2));
        let a = r.next(), b = r.next(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
        A.addScaledVector(B.sub(A), a).addScaledVector(C.sub(this.tmp.fromBufferAttribute(src, idx.getX(t))), b);
        pts.push([A.x, A.y + 0.7, A.z]);
      }
      pts.sort((x, y) => x[0] - y[0]);
      pts.forEach((q, i) => { pos.set(q, i * 3); c.setHSL(0.55 - 0.45 * Math.min(1, q[1] / p.H), 0.95, 0.62); col.set([c.r, c.g, c.b], i * 3); });
      p.cloud.geometry.dispose(); p.cloud.geometry = new THREE.BufferGeometry(); p.cloud.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); p.cloud.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
  }
  private tmp = new THREE.Vector3();
  update(dt: number) {
    this.time += dt;
    const sim = this.sim, cam = this.stage.camera.position, paper = this.view === 'paper';
    this.events();
    this.updateVehicles(dt, cam);
    this.fenceGroup.visible = this.layers.fence; this.boundaryGroup.visible = this.layers.boundary;
    this.fenceGroup.children.forEach((c) => { if (c instanceof CSS2DObject) c.visible = this.layers.fence && !((c as any).truthOnly && this.view !== 'truth') && cam.distanceTo(c.position) < 2600; });
    this.boundaryGroup.children.forEach((c) => { if (c instanceof CSS2DObject) c.visible = this.layers.boundary && cam.distanceTo(c.position) > 250; });
    const flying = sim.drones.slice(0, 4).some((d) => d.active);
    this.zoneGroup.visible = (this.layers.zones || flying) && !paper;
    this.zoneGroup.children.forEach((c) => { if (c instanceof CSS2DObject) c.visible = this.zoneGroup.visible; });
    for (const [id, g] of this.gates) {
      const s = sim.gates[id]; g.root.visible = this.layers.gates;
      const want = s.mode === 'stuck' || s.mode === 'backup' || sim.t < s.open ? 1 : 0;
      g.open += (want - g.open) * Math.min(1, dt * 4); g.arm.rotation.z = g.open * 1.42;
      g.backup.visible = s.mode === 'backup' || g.backup.position.y > -4.4;
      g.backup.position.y += ((s.mode === 'backup' ? 0 : -4.5) - g.backup.position.y) * Math.min(1, dt * 3);
      const col = paper ? 0x777777 : s.mode === 'stuck' ? 0xff3b30 : { idle: 0x6d747c, scan: 0x3fb6ff, green: 0x35e06f, red: 0xff3b30, amber: 0xffb020 }[s.light];
      (g.lamp.material as THREE.MeshBasicMaterial).color.set(col); g.lamp.scale.setScalar(s.light === 'idle' && s.mode === 'normal' ? 1 : 1.35 + 0.2 * Math.sin(this.time * 8));
      g.laser.visible = s.light === 'scan' && !paper; g.laser.position.z = Math.sin(this.time * 5.5) * 10;
      g.pad.visible = this.layers.pads && !paper;
      const gm = g.padGlow.material as THREE.MeshBasicMaterial; gm.opacity = s.light === 'idle' ? 0.1 : 0.34 + 0.12 * Math.sin(this.time * 9); gm.color.set(s.light === 'red' ? 0xff4a3d : s.light === 'amber' ? 0xffb020 : s.light === 'green' ? 0x35e06f : 0x28c7ff);
      g.label.visible = this.layers.gates && cam.distanceTo(g.root.position) < 3600;
      g.label.element.className = `tag click gate ${paper ? '' : s.mode !== 'normal' ? 'bad' : s.light}`;
    }
    for (const [, c] of this.checks) {
      c.root.visible = this.layers.checks;
      const age = this.time - c.ping;
      c.rings.forEach((r, i) => { const u = age * 0.9 - i * 0.22, on = u > 0 && u < 1 && !paper; (r.material as THREE.MeshBasicMaterial).opacity = on ? 0.8 * (1 - u) : 0; r.scale.setScalar(on ? 6 + 55 * u : 0.01); });
      (c.tip.material as THREE.MeshBasicMaterial).color.set(age < 1.4 ? 0xffffff : 0x59d2ff);
      c.label.visible = this.layers.checks && cam.distanceTo(c.root.position) < 900;
    }
    for (const [, h] of this.hidden) {
      h.group.visible = this.layers.pads && !paper;
      const age = this.time - h.ping, m = h.glow.material as THREE.MeshBasicMaterial; m.opacity = age < 3 ? 0.55 - age * 0.15 : 0.1;
      h.group.children.forEach((c) => { if (c instanceof CSS2DObject) c.visible = h.group.visible && cam.distanceTo(h.group.position) < 700; });
    }
    for (const [id, t] of this.towers) {
      t.root.visible = this.layers.towers; const on = !sim.towersOff.has(id) && !paper;
      t.ring.visible = this.layers.towers && on; t.beam.visible = this.layers.towers && on;
      (t.lamp.material as THREE.MeshBasicMaterial).color.set(sim.towersOff.has(id) ? 0xff3b30 : 0x35ff8d);
      const spec = TOWERS.find((x) => x.id === id)!;
      const target = sim.gov.unknown.slice(-12).reverse().find((u) => sim.t - u.t < 0.6 && u.src === `tower ${id}`);
      t.look = target ? Math.atan2(target.pos.x - spec.pos.x, target.pos.z - spec.pos.z) : t.look + dt * 0.8;
      t.head.rotation.y = t.look;
      if (t.beam.visible) {
        const range = spec.range * (sim.weather === 'dust' ? 0.45 : sim.weather === 'monsoon' ? 0.75 : 1);
        const a = t.beam.geometry.attributes.position as THREE.BufferAttribute, top = t.root.position.y + t.height;
        for (let i = 0; i < 16; i++) { const r = target ? dist(target.pos, spec.pos) * (0.9 + (i / 16) * 0.2) : (range * (i + 1)) / 16, an = t.look + (target ? (i - 8) * 0.006 : 0); const x = spec.pos.x + Math.sin(an) * r, z = spec.pos.z + Math.cos(an) * r; a.setXYZ(i * 2, spec.pos.x, top, spec.pos.z); a.setXYZ(i * 2 + 1, x, height(x, z) + 1, z); }
        a.needsUpdate = true; (t.beam.material as THREE.LineBasicMaterial).color.set(target ? 0xff5a4a : 0x7cffd8);
      }
      t.label.visible = this.layers.towers && cam.distanceTo(t.root.position) < 2200;
      t.label.element.className = `tag click minor ${sim.towersOff.has(id) ? 'bad' : ''}`;
    }
    this.updatePiles(cam);
    for (const d of sim.drones) {
      const m = this.drones.get(d.id)!; const on = d.active && !paper;
      m.root.visible = on; m.foot.visible = on && d.scanning; m.label.visible = on; if (!on) continue;
      const gy = height(d.pos.x, d.pos.z), want = new THREE.Vector3(d.pos.x, gy + d.alt, d.pos.z);
      if (m.root.position.distanceTo(want) > 120) m.root.position.copy(want); else m.root.position.lerp(want, Math.min(1, dt * 8));
      m.root.rotation.y = d.heading; m.root.scale.setScalar(Math.max(1, Math.min(4, cam.distanceTo(m.root.position) / 450)));
      m.rotors.forEach((r, i) => (r.rotation.z += dt * (i % 2 ? 40 : -40)));
      const radius = d.id === 'F' ? 42 : SWATH_RADIUS, inv = 1 / m.root.scale.x;
      m.cone.visible = d.scanning; m.cone.scale.set(radius * inv, d.alt * inv, radius * inv);
      m.foot.position.set(m.root.position.x, gy + 3, m.root.position.z); m.foot.scale.setScalar(radius);
    }
    for (const dg of this.diggers) {
      const busy = sim.vehicles.some((x) => x.state === 'loading' && dist(x.pos, dg.at) < 40);
      const c = busy ? (this.time * 0.55) % 1 : 0, swing = busy ? Math.sin(c * Math.PI * 2) : 0;
      dg.x.turret.rotation.y = busy ? (Math.max(0, -swing) * 2.2) : 0.4;
      dg.x.boom.rotation.x = busy ? -0.12 + 0.28 * Math.cos(c * Math.PI * 4) : 0.05; dg.x.stick.rotation.x = busy ? 0.35 * swing : 0.15;
    }
  }
  private updatePiles(cam: THREE.Vector3) {
    const sim = this.sim, scanAge = this.time - this.scanStart;
    for (const spec of PILES) {
      const p = this.piles.get(spec.id)!, now = sim.piles.get(spec.id)!, rec = sim.gov.piles.get(spec.id);
      const claimed = spec.tonnes - sim.gov.history.filter((x) => x.pile === spec.id).reduce((a, x) => a + (x.paperNet ?? x.sensorNet ?? 0), 0);
      const shownT = this.view === 'truth' ? now : this.view === 'paper' ? claimed : rec?.last ?? spec.tonnes;
      const removed = Math.max(0, (spec.tonnes - shownT) / spec.tonnes);
      if (Math.abs(removed - p.shown) > 0.0002) { p.shown = removed; p.mesh.geometry.dispose(); p.mesh.geometry = this.pileGeometry(p.R, p.H, p.side, removed); }
      const missing = this.view !== 'paper' && !!rec && rec.gap > rec.band;
      p.expected.visible = missing;
      if (missing) {
        const exp = Math.max(0, removed - rec!.gap / spec.tonnes);
        if (Math.abs(exp - p.shownExp) > 0.0002) { p.shownExp = exp; p.expected.geometry.dispose(); p.expected.geometry = this.pileGeometry(p.R * 1.004, p.H * 1.004, p.side, exp); }
        (p.expected.material as THREE.MeshBasicMaterial).opacity = 0.34 + 0.16 * Math.sin(this.time * 4);
      }
      let html: string;
      if (this.view === 'truth') html = `<b>Stockpile ${spec.id}</b><i>${nice(now)} t on the ground</i>`;
      else if (this.view === 'paper') html = `<b>Stockpile ${spec.id}</b><i>books show ${nice(claimed)} t</i>`;
      else if (!rec) html = `<b>Stockpile ${spec.id}</b>`;
      else if (missing) html = `<b>${spec.id}: about ${nice(rec.gap)} t missing</b><i>scan ${nice(rec.last)} t · expected ${nice(rec.last + rec.gap)} t · ±${nice(rec.band)} t</i><i class="small">red shows the expected surface (shape exaggerated)</i>`;
      else html = `<b>Stockpile ${spec.id}</b><i>scan ${nice(rec.last)} t · balances within ±${nice(rec.band)} t</i>`;
      setTag(p.label, html); p.label.element.className = `tag click pile ${missing ? 'bad' : ''}`;
      p.label.visible = cam.distanceTo(p.mesh.position) < (missing ? 4000 : 800);
      const show = scanAge < 7 && this.view !== 'paper'; p.cloud.visible = show;
      if (show) { p.cloud.geometry.setDrawRange(0, Math.floor(5200 * Math.min(1, scanAge / 2.6))); (p.cloud.material as THREE.PointsMaterial).opacity = Math.min(1, (7 - scanAge) / 1.5); }
    }
  }
  get scanning() { return this.time - this.scanStart < 7; }
}
export { BAYS };
