/*
 * The simulated world (the truth) and the virtual sensors that look at it.
 * Only readings produced here reach the Governor.
 */
import { along, dist, inPoly, pathLength, Rng, v, Vec } from './util';
import { BAYS, inPickupArea, ENTRY_ROUTES, EXIT_ROUTE, LEASE, leg, NODES, PILES, TOWERS, TRACKS, zoneOf, DOCK } from './layout';
import { hmac } from './sha';
import { GATE_DWELL, Governor, NOMINAL_SPEED, OFFICERS } from './governor';
import { Drone, planSweep, Round, RoundScheduler, ROUND_MIN, SWATH_RADIUS, SWEEP_MIN, sweepPosition, TRANSIT_MIN, ZoneFlight } from './drones';
import type { Command, Proposal, Registration, Sighting, Weather } from './types';

export interface DeviceTruth { id: string; key: string; silent: boolean; tampered: boolean }
export type Step =
  | { k: 'drive'; path: Vec[]; speed?: number }
  | { k: 'node'; node: string }
  | { k: 'load'; pile: string; tonnes: number; min: number; recorded: boolean }
  | { k: 'paper' }
  | { k: 'wait'; min: number }
  | { k: 'call'; fn: () => void }
  | { k: 'gone' };
export type VState = 'driving' | 'gate' | 'loading' | 'waiting' | 'held' | 'parked' | 'gone';
export interface Vehicle {
  uid: string; name: string; role: string; plate: string; shape: number; tare: number; load: number; extra: number; color: number;
  device: DeviceTruth | null; pos: Vec; heading: number; state: VState; steps: Step[]; d: number; timer: number; started: boolean; cmd: Command | null; at: string;
  spoof: Vec | null; deviceDelta: number; powerCut: boolean; paper: { net: number | null; note: string; op: string; wb: string; short: number } | null;
  noArrival: boolean; onTurnAway?: () => void; intercepted: boolean; scripted: boolean; loadingPile: string; ghostRuns: number;
}
export interface Fx { t: number; kind: 'scan' | 'open' | 'refuse' | 'hold' | 'radio' | 'weigh' | 'pileScan' | 'photo' | 'dest'; node: string; uid: string }
export interface GateState { mode: 'normal' | 'stuck' | 'backup'; open: number; light: 'idle' | 'scan' | 'green' | 'red' | 'amber'; lightT: number }

const LOAD_MIN = 5;
const BG_COLORS = [0x93a9b8, 0xa6b58c, 0xb8a58a, 0x85a0bb];

export class Sim {
  t = 0;
  rng: Rng;
  gov: Governor;
  scheduler: RoundScheduler;
  private routeRng: Rng;
  vehicles: Vehicle[] = [];
  piles = new Map<string, number>(PILES.map((p) => [p.id, p.tonnes]));
  weather: Weather = 'clear';
  towersOff = new Set<string>();
  gates: Record<string, GateState> = {};
  fx: Fx[] = [];
  drones: Drone[] = (['A', 'B', 'C', 'D', 'F'] as const).map((id) => ({ id, pos: DOCK, alt: 0, active: false, heading: 0, scanning: false }));
  flight: { round: Round; plans: ZoneFlight[]; t0: number; atStart: string[]; sightings: Sighting[]; seen: Set<string>; done: boolean } | null = null;
  follow: { p: Proposal; t0: number; uid: string | null; reported: boolean } | null = null;
  autoDecide: ((p: Proposal) => 'approve' | 'ignore' | null) | null = null;
  scanBusy = 0;
  skim = false;
  private events: { t: number; n: number; fn: () => void }[] = [];
  private n = 0;
  private nextBeat = 0;
  private nextTower = 0;
  private towerMemory = new Map<string, number>();
  private serial = 0;

  constructor(seed = 20261125, script = true) {
    this.rng = new Rng(seed);
    this.routeRng = new Rng(seed ^ 0xd1ce);
    this.scheduler = new RoundScheduler(new Rng(seed ^ 0x5eed));
    this.gov = new Governor({
      follow: (p) => this.startFollow(p),
      radar: () => { this.gov.record('AI+person', 'RECORD', 'Radar image ordered (about US$3,300). Expected in 6 minutes.'); this.at(this.t + 6, () => this.gov.onRadar(this.inLease().map((x) => this.sight(x)))); },
      backupGate: (node) => { this.gates[node].mode = 'backup'; this.gov.record('AI+person', 'RECORD', `Backup gate at ${node} closed.`, node); },
      reopenGate: (node) => { this.gates[node].mode = 'normal'; this.gates[node].open = 0; this.gov.record('Person', 'RECORD', `${NODES[node].label} reopened by signed command.`, node); },
      alertAt: (pos) => { const msg = this.scheduler.onAlert(this.t, pos, this.busyUntil()); this.gov.record('AI', 'PATTERN', msg, 'Drones'); },
    });
    for (const n of Object.values(NODES)) if (['entry', 'exit', 'route', 'zone'].includes(n.kind)) this.gates[n.id] = { mode: 'normal', open: 0, light: 'idle', lightT: 0 };
    this.scheduler.ensure(0);
    this.background();
    this.gov.record('AI', 'RECORD', 'Shift opened at 09:00. Registry, permit and gate log loaded.');
    this.scanPiles(0);
    this.beat();
    if (script) this.script();
  }
  at(t: number, fn: () => void) { this.events.push({ t, n: this.n++, fn }); this.events.sort((a, b) => a.t - b.t || a.n - b.n); }

  /* ------------------------------------------------------------ vehicles */
  private register(plate: string, device: string, tare: number, label: string, shape = 9.2): DeviceTruth {
    const key = hmac('governing-body-master', device);
    const reg: Registration = { device, key, plate, shape, tare, driver: 'DRV-' + device.slice(4), label };
    this.gov.registry.set(device, reg);
    return { id: device, key, silent: false, tampered: false };
  }
  private vehicle(o: Partial<Vehicle> & { uid: string; plate: string; pos: Vec }): Vehicle {
    const x: Vehicle = { name: o.uid, role: '', shape: 9.2, tare: 18, load: 0, extra: 0, color: 0xd9a21b, device: null, heading: 0, state: 'driving', steps: [], d: 0, timer: 0, started: false, cmd: null, at: '',
      spoof: null, deviceDelta: 0, powerCut: false, paper: null, noArrival: false, intercepted: false, scripted: false, loadingPile: '', ghostRuns: 0, ...o };
    this.vehicles.push(x); return x;
  }
  find(uid: string) { return this.vehicles.find((x) => x.uid === uid); }
  private background() {
    BAYS.forEach((p, i) => {
      const id = 'B' + String(i + 1).padStart(2, '0'), plate = `OD-14-K-${4100 + i * 7}`;
      const dev = this.register(plate, 'DEV-' + (4100 + i), 17.6 + (i % 5) * 0.2, `Truck ${id}`);
      const loaded = i % 3 === 0 ? 0 : 0;
      const x = this.vehicle({ uid: id, name: `Truck ${id}`, role: 'Registered, waiting inside', plate, pos: p, device: dev, load: loaded, tare: this.gov.registry.get(dev.id)!.tare, color: BG_COLORS[i % 4], state: 'parked', heading: (i % 5) * 0.4 + (i < 5 ? 1.6 : 0.5) });
      this.gov.startInside(this.gov.registry.get(dev.id)!, p);
      if (i === 1 || i === 9 || i === 12) {
        const q = v(p.x + (i === 1 ? 5 : -45), p.z + (i === 1 ? 62 : -8));
        const loop = () => { x.steps.push({ k: 'wait', min: 4 + i / 4 }, { k: 'drive', path: [p, q], speed: 90 }, { k: 'wait', min: 3 }, { k: 'drive', path: [q, p], speed: 90 }, { k: 'call', fn: loop }); };
        loop();
      }
    });
  }
  /** Drive and node steps for a list of nodes. */
  private routeSteps(route: string[], speed?: number): Step[] {
    const out: Step[] = [];
    for (let i = 1; i < route.length; i++) {
      out.push({ k: 'drive', path: leg(route[i - 1], route[i]), speed });
      if (NODES[route[i]].kind !== 'load' && NODES[route[i]].kind !== 'via') out.push({ k: 'node', node: route[i] });
    }
    return out;
  }
  private haulPlan(gate: string, load: number): Step[] {
    return [...this.routeSteps(ENTRY_ROUTES[gate]), { k: 'load', pile: 'S1', tonnes: load, min: LOAD_MIN, recorded: true }, { k: 'paper' }, ...this.routeSteps(EXIT_ROUTE),
      { k: 'wait', min: 1.2 }, { k: 'drive', path: [NODES.DEST.pos, v(2700, 560)] }, { k: 'gone' }];
  }
  /** A registered truck that drives the whole haul. */
  sendTruck(gate: 'G1' | 'G2' | 'G3' = 'G1', o: { uid?: string; name?: string; role?: string; plate?: string; device?: string; tare?: number; load?: number; paper?: number; op?: string; note?: string; color?: number } = {}) {
    const k = ++this.serial, uid = o.uid ?? 'F' + String(k).padStart(2, '0');
    const plate = o.plate ?? `OD-14-F-${5000 + k}`, device = o.device ?? 'DEV-' + (5000 + k), tare = o.tare ?? 17.8 + (k % 4) * 0.2, load = o.load ?? 28;
    const dev = this.register(plate, device, tare, o.name ?? `Truck ${uid}`);
    const start = NODES[ENTRY_ROUTES[gate][0]].pos;
    return this.vehicle({ uid, name: o.name ?? `Truck ${uid}`, role: o.role ?? 'Registered haul', plate, pos: start, device: dev, tare, color: o.color ?? 0xd9a21b, steps: this.haulPlan(gate, load),
      paper: { net: o.paper ?? null, note: o.note ?? 'DN-' + (500 + k), op: o.op ?? (this.skim ? 'OP-11' : 'OP-03'), wb: 'WB-A', short: this.skim && o.paper === undefined ? 1.2 : 0 } });
  }
  private retreat(x: Vehicle) {
    const back = along([NODES.W1.pos, NODES.G1.pos], 0).pos;
    const via = x.at.startsWith('G') ? NODES['W' + x.at[1]]?.pos ?? back : x.pos;
    x.steps = [{ k: 'wait', min: 1.5 }, { k: 'drive', path: [x.pos, via], speed: 200 }, { k: 'gone' }];
    x.d = 0; x.started = false; x.state = 'driving';
  }

  /* ------------------------------------------------------------ the scripted shift */
  private script() {
    this.at(1.2, () => this.sendTruck('G1', { uid: 'T1', name: 'Truck 1', role: 'Genuine', plate: 'OD-14-A-1101', device: 'DEV-1101', tare: 18.0, paper: 28.0, op: 'OP-03', note: 'DN-111', color: 0x3f98ea }));
    this.at(17, () => this.sendTruck('G2', { uid: 'T3', name: 'Truck 3', role: 'Understated paper', plate: 'OD-14-C-3303', device: 'DEV-3303', tare: 18.4, paper: 22.0, op: 'OP-07', note: 'DN-333', color: 0xf08a35 }));
    this.at(27.6, () => { const x = this.sendTruck('G1', { uid: 'T2', name: 'Truck 2', role: 'Swap thief', plate: 'OD-14-B-2202', device: 'DEV-2202', tare: 17.6, color: 0xa987e8 }); x.extra = 8.2; });
    this.at(40.6, () => this.ghost());
    this.at(55, () => this.intruder(66, 'T5', 'Truck 5', 'OD-02-X-5505'));
    for (const t of [24, 45, 70, 96]) this.at(t, () => this.scanPiles(1));
  }
  private ghost() {
    const x = this.vehicle({ uid: 'T4', name: 'Truck 4', role: 'Ghost: no device, cloned plate', plate: 'OD-14-A-1101', shape: 7.8, tare: 16, pos: NODES.W3.pos, color: 0xe2574c, scripted: true,
      steps: [{ k: 'drive', path: leg('W3', 'G3') }, { k: 'node', node: 'G3' }] });
    const lurk = v(850, 258), out = [lurk, v(1060, 400), v(1260, 640), v(1480, 880), v(1700, 940)];
    x.onTurnAway = () => {
      x.onTurnAway = undefined; x.state = 'driving'; x.d = 0; x.started = false;
      const run = () => {
        if (x.intercepted) return;
        if (this.gov.proposals.some((p) => p.state === 'pending' && p.kind === 'follow')) { x.steps.unshift({ k: 'wait', min: 1 }, { k: 'call', fn: run }); return; }
        if (x.ghostRuns >= 3) { x.steps.push({ k: 'drive', path: out, speed: 320 }, { k: 'gone' }); return; }
        x.ghostRuns++;
        const inPath = [lurk, v(822, 215), v(785, 158), v(735, 75)];
        x.steps.push({ k: 'drive', path: inPath, speed: 170 }, { k: 'load', pile: 'S2', tonnes: 28, min: 2.6, recorded: false }, { k: 'drive', path: inPath.slice().reverse(), speed: 170 },
          { k: 'drive', path: out.slice(0, 4), speed: 330 }, { k: 'call', fn: () => { x.load = 0; } }, { k: 'drive', path: out.slice(0, 4).reverse(), speed: 330 }, { k: 'wait', min: 0.5 }, { k: 'call', fn: run });
      };
      x.steps = [{ k: 'wait', min: 0.8 }, { k: 'drive', path: [x.pos, NODES.W3.pos, v(1700, 1500), v(1740, 1100)], speed: 360 }, { k: 'drive', path: [v(1740, 1100), ...out.slice().reverse()], speed: 360 }, { k: 'wait', min: 5 }, { k: 'call', fn: run }];
    };
  }
  /** A truck that comes in where there is neither fence nor gate. */
  intruder(stay: number, uid?: string, name?: string, plate?: string) {
    const k = ++this.serial, track = TRACKS[0];
    const x = this.vehicle({ uid: uid ?? 'U' + k, name: name ?? `Intruder ${k}`, role: 'Entered through the open boundary', plate: plate ?? `OD-02-X-${6000 + k}`, tare: 17, pos: track[0], color: 0xe2574c, scripted: true });
    x.steps = [{ k: 'drive', path: track, speed: 270 }, { k: 'wait', min: stay }, { k: 'drive', path: track.slice().reverse(), speed: 300 }, { k: 'gone' }];
    return x;
  }

  /* ------------------------------------------------------------ sensors */
  answering(x: Vehicle) { return !!x.device && !x.device.silent && !x.device.tampered; }
  private noise(a: number) { return this.rng.noise(a * (this.weather === 'monsoon' ? 1.6 : 1)); }
  private gross(x: Vehicle) { return x.tare + x.load + x.extra + this.noise(0.18); }
  private gateReading(x: Vehicle, node: string) {
    const nonce = Math.floor(this.rng.next() * 1e12).toString(16);
    return { node, t: this.t, nonce, plate: x.plate, shape: x.shape + this.rng.noise(this.weather === 'dust' ? 0.25 : 0.07), gross: this.gross(x),
      reply: this.answering(x) ? { device: x.device!.id, mac: hmac(x.device!.key, nonce) } : null };
  }
  sight(x: Vehicle): Sighting {
    return { t: this.t, track: x.uid, pos: { ...x.pos }, zone: zoneOf(x.pos), device: this.answering(x) ? x.device!.id : null, shape: x.shape + this.rng.noise(0.2), plate: x.plate, moving: x.state === 'driving' };
  }
  private inLease() { return this.vehicles.filter((x) => x.state !== 'gone' && inPoly(x.pos, LEASE)); }
  private beat() {
    for (const x of this.vehicles) if (x.state !== 'gone' && this.answering(x)) this.gov.onHeartbeat({ t: this.t, device: x.device!.id, claimed: x.spoof ?? { ...x.pos }, battery: x.powerCut });
    this.nextBeat = Math.floor(this.t + 1e-9) + 1;
  }
  private watchTowers() {
    for (const tw of TOWERS) {
      if (this.towersOff.has(tw.id)) continue;
      const range = tw.range * (this.weather === 'dust' ? 0.45 : this.weather === 'monsoon' ? 0.75 : 1);
      for (const x of this.inLease()) {
        if (dist(x.pos, tw.pos) > range) continue;
        if (this.answering(x)) { this.gov.confirm(x.device!.id); continue; }
        if (!inPickupArea(x.pos)) continue;
        const last = this.towerMemory.get(x.uid) ?? -99;
        this.towerMemory.set(x.uid, this.t);
        if (this.t - last > 5) this.gov.onTower(tw.id, { ...this.sight(x), plate: null }); else this.gov.onTowerTrack(tw.id, { ...x.pos });
      }
    }
  }
  scanPiles(window: number) {
    this.scanBusy = this.t + 1;
    this.fx.push({ t: this.t, kind: 'pileScan', node: 'S2', uid: '' });
    const take = () => { for (const p of PILES) this.gov.onScan({ t: this.t, pile: p.id, tonnes: this.piles.get(p.id)! + (window ? this.rng.noise(5) : 0) }); };
    if (!window) take(); else this.at(this.t + 0.5, take);
  }

  /* ------------------------------------------------------------ drones */
  private busyUntil() { return this.flight && !this.flight.done ? this.flight.t0 + ROUND_MIN : 0; }
  private runRounds() {
    const f = this.flight;
    if (!f || f.done) {
      const r = this.scheduler.due(this.t);
      if (r) {
        if (this.weather === 'monsoon') { r.status = 'missed'; this.gov.roundMissed(r.id); }
        else {
          r.status = 'flying';
          this.flight = { round: r, plans: planSweep(this.routeRng, r.spot), t0: this.t, atStart: this.gov.expectedInside(), sightings: [], seen: new Set(), done: false };
          this.gov.record('AI', 'RECORD', `Counting round ${r.id} launched (${r.trigger === 'alert' ? 'pulled forward by an alert' : 'random time'}): one drone to each of zones A to D.`, 'Drones');
        }
      }
    }
    const g = this.flight;
    if (!g) return;
    const el = this.t - g.t0;
    for (const plan of g.plans) {
      const d = this.drones.find((x) => x.id === plan.zone)!;
      if (g.done && el > ROUND_MIN) { d.active = false; d.scanning = false; continue; }
      const p = sweepPosition(plan, Math.min(el, ROUND_MIN)); Object.assign(d, p, { active: true });
      if (p.scanning && !g.done) for (const x of this.inLease()) if (!g.seen.has(x.uid) && dist(x.pos, p.pos) < SWATH_RADIUS) { g.seen.add(x.uid); g.sightings.push({ ...this.sight(x), plate: null, zone: plan.zone }); this.fx.push({ t: this.t, kind: 'photo', node: plan.zone, uid: x.uid }); }
    }
    if (!g.done && el >= TRANSIT_MIN + SWEEP_MIN) {
      g.done = true; g.round.status = 'done';
      const now = new Set(this.gov.expectedInside());
      this.gov.onRound({ id: g.round.id, t: this.t, since: g.t0, expected: g.atStart.filter((d) => now.has(d)), sightings: g.sightings, insideDuring: new Set([...g.atStart, ...now]) });
    }
  }
  private startFollow(p: Proposal) {
    if (this.weather === 'monsoon') { this.gov.record('AI', 'RECORD', 'Follow drone grounded by weather.', p.subject); this.gov.proposeRadar(); return; }
    this.follow = { p, t0: this.t, uid: null, reported: false };
    this.gov.record('AI', 'RECORD', 'High alert: the reserve swarm launched from the charging station.', p.subject);
  }
  private runFollow() {
    const f = this.follow, d = this.drones[4];
    if (!f) return;
    const el = this.t - f.t0, target = f.p.pos ?? DOCK;
    const mix = (a: Vec, b: Vec, u: number) => v(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u);
    d.active = true; d.alt = 55;
    if (el < 0.8) { d.pos = mix(DOCK, target, el / 0.8); d.scanning = false; }
    else if (el < 3.6) {
      if (!f.reported) {
        f.reported = true;
        const x = this.inLease().concat(this.vehicles.filter((y) => y.state !== 'gone')).filter((y) => !this.answering(y) && dist(y.pos, target) < 600).sort((a, b) => dist(a.pos, target) - dist(b.pos, target))[0];
        f.uid = x?.uid ?? null;
        this.gov.onFollow(x ? this.sight(x) : null, f.p);
        if (x) { this.fx.push({ t: this.t, kind: 'photo', node: 'F', uid: x.uid }); this.intercept(x); }
      }
      const x = f.uid ? this.find(f.uid) : undefined;
      d.pos = x && x.state !== 'gone' ? v(x.pos.x + 22, x.pos.z + 22) : target; d.scanning = true;
    } else if (el < 4.6) { d.pos = mix(target, DOCK, el - 3.6); d.scanning = false; }
    else { d.active = false; this.follow = null; }
  }
  /** Assumption for the story: a vehicle that has been followed and photographed leaves and stays away. */
  private intercept(x: Vehicle) {
    if (x.intercepted || !x.scripted) return;
    x.intercepted = true;
    const south = x.pos.x > 300;
    const out = south ? [{ ...x.pos }, v(1060, 400), v(1260, 640), v(1480, 880), v(1700, 940)] : [{ ...x.pos }, v(-420, 40), v(-700, -40), v(-1000, -90), v(-1640, -150)];
    x.steps = [{ k: 'wait', min: 2.2 }, { k: 'drive', path: out, speed: 320 }, { k: 'call', fn: () => this.gov.record('AI', 'RECORD', 'The photographed vehicle left the lease while being followed. Footage and track saved.', x.plate) }, { k: 'gone' }];
    x.d = 0; x.started = false; x.state = 'driving';
  }

  /* ------------------------------------------------------------ movement */
  private move(x: Vehicle, h: number) {
    let left = h, guard = 0;
    while (left > 1e-9 && x.state !== 'gone' && guard++ < 12) {
      const s = x.steps[0];
      if (!s) { if (x.state !== 'held') x.state = 'parked'; return; }
      const next = () => { x.steps.shift(); x.d = 0; x.started = false; };
      if (x.state === 'held') return;
      switch (s.k) {
        case 'drive': {
          x.state = 'driving';
          const speed = s.speed ?? NOMINAL_SPEED, L = pathLength(s.path), m = Math.min(speed * left, L - x.d);
          x.d += m; left -= m / speed;
          const a = along(s.path, x.d); x.pos = a.pos; if (L > 0.5) x.heading = a.heading;
          if (x.d >= L - 1e-6) next();
          break;
        }
        case 'node': {
          const n = NODES[s.node]; x.at = s.node;
          if (n.kind === 'check') { if (this.answering(x)) { this.gov.onCheck({ node: s.node, t: this.t, device: x.device!.id, claimed: x.spoof ?? { ...x.pos }, reader: n.pos }); this.fx.push({ t: this.t, kind: 'radio', node: s.node, uid: x.uid }); } next(); break; }
          if (n.kind === 'hidden') { this.gov.onHidden({ node: s.node, t: this.t, device: this.answering(x) ? x.device!.id : null, gross: this.gross(x) }); this.fx.push({ t: this.t, kind: 'weigh', node: s.node, uid: x.uid }); next(); break; }
          if (n.kind === 'dest') { if (this.answering(x)) this.gov.onDest({ t: this.t, device: x.device!.id, gross: this.gross(x) }); this.fx.push({ t: this.t, kind: 'dest', node: s.node, uid: x.uid }); next(); break; }
          const g = this.gates[s.node];
          if (!x.started) { x.started = true; x.cmd = null; x.timer = 0; x.state = 'gate'; g.light = 'scan'; g.lightT = this.t + GATE_DWELL; this.fx.push({ t: this.t, kind: 'scan', node: s.node, uid: x.uid }); }
          const use = Math.min(left, GATE_DWELL - x.timer); x.timer += use; left -= use;
          if (!x.cmd && x.timer >= GATE_DWELL * 0.55) {
            x.cmd = this.gov.onGate(this.gateReading(x, s.node));
            if (g.mode === 'backup') x.cmd = 'HOLD';
            g.light = x.cmd === 'OPEN' ? 'green' : x.cmd === 'HOLD' ? 'amber' : 'red'; g.lightT = this.t + (x.cmd === 'OPEN' ? 0.6 : 2.5);
            if (x.cmd === 'OPEN') g.open = this.t + 0.75;
            this.fx.push({ t: this.t, kind: x.cmd === 'OPEN' ? 'open' : x.cmd === 'HOLD' ? 'hold' : 'refuse', node: s.node, uid: x.uid });
          }
          if (x.timer >= GATE_DWELL - 1e-9) {
            if (x.cmd === 'OPEN') { next(); x.state = 'driving'; }
            else if (x.cmd === 'HOLD') { x.state = 'held'; g.lightT = Infinity; return; }
            else { if (x.onTurnAway) x.onTurnAway(); else this.retreat(x); }
          }
          break;
        }
        case 'load': {
          if (!x.started) { x.started = true; x.timer = 0; x.state = 'loading'; x.loadingPile = s.pile; }
          const use = Math.min(left, s.min - x.timer); x.timer += use; left -= use;
          const dt = (s.tonnes * use) / s.min; x.load += dt; this.piles.set(s.pile, this.piles.get(s.pile)! - dt);
          if (x.timer >= s.min - 1e-9) {
            if (s.recorded && this.answering(x)) this.gov.onLoad({ t: this.t, device: x.device!.id, pile: s.pile, net: s.tonnes + this.noise(0.25) + x.deviceDelta });
            x.loadingPile = ''; next(); x.state = 'driving';
          }
          break;
        }
        case 'paper': {
          if (x.paper && this.answering(x)) { const net = x.paper.net ?? Math.round((x.load - x.paper.short) * 10) / 10; this.gov.onPaper({ t: this.t, device: x.device!.id, note: x.paper.note, net, wb: x.paper.wb, op: x.paper.op }); }
          next(); break;
        }
        case 'wait': {
          if (!x.started) { x.started = true; x.timer = 0; x.state = x.state === 'parked' ? 'parked' : 'waiting'; }
          const use = Math.min(left, s.min - x.timer); x.timer += use; left -= use;
          if (x.timer >= s.min - 1e-9) next();
          break;
        }
        case 'call': next(); s.fn(); break;
        case 'gone': x.state = 'gone'; next(); break;
      }
      if (x.noArrival && x.at === 'G4' && s.k === 'node' && s.node === 'G4' && x.cmd === 'OPEN') {
        x.noArrival = false; x.steps = [{ k: 'drive', path: [NODES.G4.pos, v(1840, 80), v(2050, -220), v(2300, -330)], speed: 260 }, { k: 'gone' }]; x.d = 0;
      }
    }
  }

  /* ------------------------------------------------------------ clock */
  step(dt: number) {
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(0.04, left); left -= h; this.t += h; this.gov.t = this.t;
      while (this.events.length && this.events[0].t <= this.t) this.events.shift()!.fn();
      for (const x of this.vehicles) this.move(x, h);
      if (this.t >= this.nextBeat) this.beat();
      if (this.t >= this.nextTower) { this.nextTower = this.t + 0.2; this.watchTowers(); }
      this.runRounds(); this.runFollow();
      for (const g of Object.values(this.gates)) if (g.light !== 'idle' && this.t > g.lightT) g.light = 'idle';
      this.gov.tick(this.t);
      if (this.autoDecide) for (const p of this.gov.proposals) if (p.state === 'pending') {
        const d = this.autoDecide(p);
        if (d === 'approve') { this.gov.approve(p.id, OFFICERS[0]); this.gov.approve(p.id, OFFICERS[1]); } else if (d === 'ignore') this.gov.ignore(p.id);
      }
      if (this.fx.length > 200) this.fx.splice(0, 100);
    }
  }
  runTo(t: number) { if (t > this.t) this.step(t - this.t); }

  /* ------------------------------------------------------------ "Be the Vendor" */
  setWeather(w: Weather) {
    if (w === this.weather) return;
    this.weather = w;
    this.gov.record('AI', 'RECORD', `Weather now: ${w}.`, 'Weather');
    if (w === 'dust') this.at(this.t + 1, () => { if (this.weather === 'dust') this.gov.onTowerLost('TW1 to TW3', 'Dust has cut their usable range by more than half.', TOWERS[2].pos); });
    if (w === 'monsoon') this.at(this.t + 0.5, () => { if (this.weather === 'monsoon') this.gov.proposeRadar(); });
  }
  targets() { return this.vehicles.filter((x) => x.state !== 'gone' && x.device && !x.uid.startsWith('B') && x.uid !== 'T4'); }
  attack(kind: string, uid = ''): { ok: boolean; msg: string } {
    const ok = (msg: string) => ({ ok: true, msg }), no = (msg: string) => ({ ok: false, msg });
    const test = (m: string) => this.gov.record('Sensor', 'TEST', `Demonstration attack: ${m}.`, uid);
    const x = this.find(uid), trip = x?.device ? this.gov.trips.get(x.device.id) : undefined;
    const inside = !!(x && trip?.inside && x.state !== 'held' && x.state !== 'gone');
    const needInside = () => no(`${x?.name ?? 'The truck'} must be inside the mine and moving. Send a truck and let it pass its entry gate.`);
    const loaded = !!(trip && trip.sensorNet !== undefined);
    switch (kind) {
      case 'jam': if (!inside) return needInside(); test(`${x!.name}'s device is jammed`); x!.device!.silent = true; return ok('Device jammed. Watch for the silence alert, then the next gate.');
      case 'open': if (!inside) return needInside(); test(`${x!.name}'s device housing is opened`); x!.device!.tampered = true; this.gov.onTamper(x!.device!.id, { ...x!.pos }); return ok('Device opened. It locks itself; the next gate will hold the truck.');
      case 'spoof': if (!inside) return needInside(); test(`${x!.name}'s device reports a false position`); x!.spoof = { ...NODES.C6.pos }; if (dist(x!.pos, NODES.C6.pos) < 700) x!.spoof = { ...NODES.C2.pos }; return ok('False position set. The next checkpoint will compare.');
      case 'power': if (!inside) return needInside(); test(`${x!.name}'s vehicle power is cut`); x!.powerCut = true; return ok('Power cut. The device should report on its battery within a minute.');
      case 'understate': if (!inside || !loaded) return no('The truck must have loaded and not yet left through G4.'); test(`${x!.name}'s device understates its load by 6 t`); x!.deviceDelta = -6; trip!.sensorNet! -= 6; return ok('Device now says 6 t less. Watch the zone gate and G4.');
      case 'roadload': if (!inside || loaded) return no('The truck must be inside and not yet loaded.'); test(`${x!.name} picks up 5 t of ore on the road`); x!.extra += 5; return ok('5 t added on the road. The next buried pad will weigh it.');
      case 'move': if (!inside) return needInside(); test(`${x!.name}'s device is moved to a different truck`); x!.plate = 'OD-05-M-7788'; return ok('Same device, different truck. The next gate reads another plate.');
      case 'road': {
        if (!inside) return needInside();
        const s = x!.steps[0]; if (!s || s.k !== 'drive') return no('Wait until the truck is driving.');
        test(`${x!.name} takes a wrong road`);
        const L = pathLength(s.path), rest: Vec[] = [{ ...x!.pos }]; for (let d = x!.d + 30; d < L; d += 30) rest.push(along(s.path, d).pos); rest.push(s.path[s.path.length - 1]);
        const off = v(x!.pos.x - Math.cos(x!.heading) * 190, x!.pos.z + Math.sin(x!.heading) * 190);
        x!.steps.splice(0, 1, { k: 'drive', path: [{ ...x!.pos }, off] }, { k: 'wait', min: 11 }, { k: 'drive', path: [off, { ...x!.pos }] }, { k: 'drive', path: rest }); x!.d = 0;
        return ok('Off route. The timed checkpoint will notice in a few minutes.');
      }
      case 'repeat': { if (!inside) return needInside(); test(`a second entry is attempted on ${x!.device!.id}`); const r = this.gateReading(x!, 'G2'); this.gov.onGate(r); this.flash('G2'); return ok('Second entry tried at G2.'); }
      case 'wrongexit': {
        if (!inside || !loaded) return no('The truck must be loaded and not yet through G4.');
        test(`${x!.name} tries to leave by gate G2`);
        x!.steps = [{ k: 'drive', path: [{ ...x!.pos }, NODES.S1.pos] }, ...this.routeSteps(['S1', 'Z2', 'R2', 'HW3', 'C4', 'C3', 'HW2', 'G2'], 420), { k: 'gone' }]; x!.d = 0; x!.started = false; x!.state = 'driving';
        return ok('Truck is heading for G2 with a load.');
      }
      case 'noarrive': { if (!x || !trip || trip.tDest !== undefined || !x.paper) return no('Pick a truck that has not yet delivered.'); if (!trip.inside) { test(`${x.name} will never arrive`); x.steps = [{ k: 'drive', path: [{ ...x.pos }, v(x.pos.x + 80, x.pos.z - 400)] }, { k: 'gone' }]; x.d = 0; } else { test(`${x.name} will not go to the destination`); x.noArrival = true; } return ok('It will turn off after G4. The arrival timer catches it.'); }
      case 'nozone': { test('a truck with no entry record tries zone gate Z2'); const spare = this.register('OD-14-S-9001', 'DEV-9001', 18, 'Spare truck'); const y = { ...(this.vehicles[0]), uid: 'spare', plate: 'OD-14-S-9001', device: spare, tare: 18, load: 0, extra: 0 } as Vehicle; this.gov.onGate(this.gateReading(y, 'Z2')); this.flash('Z2'); return ok('Tried at Z2 without entering.'); }
      case 'fake': {
        test('a copied device box tries gate G1');
        const real = [...this.gov.registry.values()].find((r) => r.device === 'DEV-1101') ?? [...this.gov.registry.values()][0];
        const k = ++this.serial;
        this.vehicle({ uid: 'K' + k, name: 'Copy-box truck', role: 'Copied device ID, wrong key', plate: real.plate, tare: real.tare, pos: NODES.W1.pos, color: 0xe2574c, device: { id: real.device, key: 'guessed', silent: false, tampered: false }, scripted: true, steps: [{ k: 'drive', path: leg('W1', 'G1') }, { k: 'node', node: 'G1' }] });
        return ok('A truck with a copied box is driving to G1.');
      }
      case 'stuck': { if (this.gates.G3.mode !== 'normal') return no('G3 is already stuck or on backup.'); test('gate G3 is left open'); this.gates.G3.mode = 'stuck'; this.at(this.t + 5, () => { if (this.gates.G3.mode === 'stuck') this.gov.onGateStuck('G3'); }); return ok('G3 stuck open. The alarm comes after 5 minutes.'); }
      case 'hand': { if (this.gates.G3.mode !== 'backup') return no('First close the backup gate on G3 (leave G3 open, then approve).'); test('someone tries to reopen G3 by hand'); this.gov.manualReopen('G3'); return ok('Refused and logged.'); }
      case 'reopen': { if (this.gates.G3.mode !== 'backup') return no('G3 is not closed by the backup gate.'); this.gov.propose({ kind: 'reopen', origin: 'Person', text: 'Reopen G3 with a signed command from the control room', subject: 'G3', pos: NODES.G3.pos, why: { rule: 'Two officers', inputs: [] } }); return ok('Request raised. Two officers must sign.'); }
      case 'tower': {
        if (this.towersOff.delete('TW3')) { this.gov.record('AI', 'RECORD', 'Tower TW3 is reporting again.', 'TW3'); return ok('TW3 restored.'); }
        test('tower TW3 is switched off'); this.towersOff.add('TW3');
        this.at(this.t + 1, () => { if (!this.towersOff.has('TW3')) return; this.gov.onTowerLost('TW3', 'It stopped reporting: blocked, blinded or unplugged.', TOWERS[2].pos); this.gov.propose({ kind: 'follow', origin: 'AI', text: 'Launch the drone swarm to check the area watched by tower TW3', subject: 'TW3', pos: v(870, 240), why: { rule: 'Cover a blind spot', inputs: [['Tower', 'TW3 silent']] } }); });
        return ok('TW3 off. The control room notices within a minute.');
      }
      case 'net': {
        if (this.gov.offline.has('G1')) { this.gov.setOffline('G1', false); return ok('Link restored; held records synced.'); }
        test('the network link to gate G1 is cut'); this.gov.setOffline('G1', true); this.at(this.t + 1, () => { if (this.gov.offline.has('G1')) this.gov.linkLost('G1'); });
        return ok('G1 is offline. Send a truck through G1, then press again to restore.');
      }
      case 'sneak': { test('a truck enters through the open boundary'); this.intruder(75); return ok('An unregistered truck is driving in from the west. Wait for a counting round.'); }
      case 'dash': { test('a truck makes a quick run between drone rounds'); this.intruder(2); return ok('Quick run started. It may escape if no round flies.'); }
      case 'leaveopen': {
        const b = this.vehicles.find((y) => y.uid.startsWith('B') && y.state !== 'gone' && y.device && !y.device.silent);
        if (!b) return no('No waiting truck is left.');
        test(`${b.name} jams its device and leaves through the open boundary`); b.device!.silent = true;
        b.steps = [{ k: 'drive', path: [{ ...b.pos }, v(-250, 110), ...TRACKS[0].slice().reverse()], speed: 300 }, { k: 'gone' }]; b.d = 0; b.started = false; b.state = 'driving';
        return ok(`${b.name} is leaving unseen by any gate.`);
      }
      case 'skim': {
        test('the Vendor shaves about 1.2 t off every dispatch note'); this.skim = true;
        for (let i = 0; i < 3; i++) this.at(this.t + 0.2 + i * 2.2, () => { const was = this.skim; this.skim = true; this.sendTruck('G1'); this.skim = was; });
        this.at(this.t + 6, () => { this.skim = false; });
        return ok('Three trucks coming, each note 1.2 t short. Each passes alone.');
      }
      case 'scan': this.scanPiles(1); return ok('Stockpile scan started.');
    }
    return no('Unknown action.');
  }
  private flash(node: string) { const g = this.gates[node]; g.light = 'red'; g.lightT = this.t + 2; this.fx.push({ t: this.t, kind: 'refuse', node, uid: '' }); }
}
export { Rng };
