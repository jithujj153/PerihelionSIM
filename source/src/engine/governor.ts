/*
 * The Governing Body's side: decision rules, records, alerts, approvals.
 * It sees only sensor readings. It never touches the simulated truth.
 * "AI" here means these transparent rules (a stand-in for the control-room models).
 */
import { hmac } from './sha';
import { TamperLog } from './log';
import { dist, f1, hhmm, inPoly, pathLength, Vec } from './util';
import { ENTRY_ROUTES, EXIT_ROUTE, LEASE, leg, NODES, nearestNodeLabel, PILES } from './layout';
import type * as T from './types';

export const NOMINAL_SPEED = 270; // metres per minute, about 16 km/h (assumed)
export const GATE_DWELL = 0.55;
export const OFFICERS = ['Officer A', 'Officer B'];
export const PERMIT = { tonnes: 250, trips: 15, vehicles: 26, minutes: 480 };

export interface Actions {
  follow(p: T.Proposal): void; radar(): void; backupGate(node: string): void; reopenGate(node: string): void; alertAt(pos: Vec): void;
}
export interface RoundResult { id: number; t: number; since: number; expected: string[]; sightings: T.Sighting[]; insideDuring: Set<string> }

export class Governor {
  t = 0;
  tol = 1.5;
  cap = { ...PERMIT };
  private capWarned = 0;
  log = new TamperLog();
  registry = new Map<string, T.Registration>();
  trips = new Map<string, T.Trip>();
  history: T.Trip[] = [];
  evidence: T.Evidence[] = [];
  alerts: T.Alert[] = [];
  proposals: T.Proposal[] = [];
  counts = { ai: 0, aiPerson: 0, person: 0, notActed: 0 };
  offline = new Set<string>();
  queued: { t: number; role: T.Role; kind: string; text: string; subject: string }[] = [];
  private ctxNode = '';
  /** Last time a fixed, independent sensor (gate, checkpoint, hidden pad or tower) confirmed a truck. */
  private confirmed = new Map<string, number>();
  private notInPictures = new Map<string, number>();
  /** Places where independent sensors saw a vehicle that no device answers for. */
  unknown: { t: number; pos: Vec; src: string; plate: string | null }[] = [];
  private spotted(pos: Vec, src: string, plate: string | null = null) { this.unknown.push({ t: this.t, pos: { ...pos }, src, plate }); }
  confirm(device: string) { this.confirmed.set(device, this.t); }
  private skim = new Map<string, { n: number; sum: number; alerted: boolean }>();
  piles = new Map<string, { base: number; last: number; gap: number; band: number; t: number; alertedGap: number }>();
  rounds: { id: number; t: number; expected: number; counted: number; verdict: string; unmatched: number; missing: number }[] = [];
  onAlert: (a: T.Alert) => void = () => {};
  onProposal: (p: T.Proposal) => void = () => {};
  actions: Actions;

  constructor(actions: Actions) { this.actions = actions; }

  /* ------------------------------------------------------------ records */
  record(role: T.Role, kind: string, text: string, subject = '') {
    if (this.ctxNode && this.offline.has(this.ctxNode)) { this.queued.push({ t: this.t, role, kind, text, subject }); return; }
    this.log.add(this.t, role, kind, text, subject);
    if (kind === 'DECISION' || kind === 'APPROVED' || kind === 'NOT ACTED' || kind === 'PENALTY') {
      if (role === 'AI') this.counts.ai++; else if (role === 'AI+person') this.counts.aiPerson++;
      else if (role === 'Person') this.counts.person++; else if (role === 'Not acted') this.counts.notActed++;
    }
  }
  private note(src: string, node: string, subject: string, kind: string, value: string, status: T.Evidence['status'] = '') {
    this.evidence.push({ i: this.evidence.length, t: this.t, src, node, subject, kind, value, status });
    this.record('Sensor', 'READING', `${src}${node ? ' at ' + node : ''}${subject ? ' | ' + subject : ''} | ${kind}: ${value}`, subject);
  }
  alert(sev: T.Severity, title: string, detail: string, subject: string, why: T.Why, pos: Vec | null = null, reshape = true): T.Alert {
    const a: T.Alert = { id: this.alerts.length, t: this.t, sev, title, detail, subject, pos, why, penalised: false };
    if (this.ctxNode && this.offline.has(this.ctxNode)) a.detail += ' (Held at the gate until the link returns.)';
    this.alerts.push(a);
    this.record('AI', 'ALERT', `${title}. ${detail}`, subject);
    this.onAlert(a);
    if (reshape && pos && sev !== 'low') this.actions.alertAt(pos);
    return a;
  }
  setOffline(node: string, off: boolean) {
    if (off) {
      this.offline.add(node);
    } else if (this.offline.delete(node)) {
      const q = this.queued.splice(0);
      this.record('AI', 'RECORD', `Link to ${NODES[node].label} restored. ${q.length} records held at the gate are now added with their original times.`);
      q.forEach((e) => this.record(e.role, e.kind, `[held at gate from ${hhmm(e.t)}] ${e.text}`, e.subject));
    }
  }
  linkLost(node: string) {
    this.alert('med', 'Gate link lost', `${NODES[node].label} stopped sending. It keeps deciding from its stored list and holds its records until the link returns. Loss of signal is treated as suspicious.`, node,
      { rule: 'A silent sensor is an event, not an absence', inputs: [['Gate', node], ['Last heartbeat', hhmm(this.t)]] }, NODES[node].pos);
  }
  threshold(net: number) { return Math.max(this.tol, 0.05 * Math.abs(net)); }

  /* ------------------------------------------------------------ approvals */
  propose(p: Omit<T.Proposal, 'id' | 't' | 'expires' | 'approvals' | 'state'>): T.Proposal {
    const full: T.Proposal = { ...p, id: this.proposals.length, t: this.t, expires: this.t + 10, approvals: [], state: 'pending' };
    this.proposals.push(full);
    this.record(p.origin === 'AI' ? 'AI+person' : 'Person', 'PROPOSAL', `${p.origin === 'AI' ? 'AI recommends' : 'Officer asks'}: ${p.text}. Needs two officers; expires ${hhmm(full.expires)}.`, p.subject);
    this.onProposal(full);
    return full;
  }
  approve(id: number, officer: string): boolean {
    const p = this.proposals[id];
    if (!p || p.state !== 'pending' || p.approvals.includes(officer)) return false;
    p.approvals.push(officer);
    const role: T.Role = p.origin === 'AI' ? 'AI+person' : 'Person';
    this.record(role, 'SIGNED', `${officer} approved (${p.approvals.length} of 2): ${p.text}.`, p.subject);
    if (p.approvals.length >= 2) {
      p.state = 'approved';
      this.record(role, 'APPROVED', `Two officers approved. Action taken: ${p.text}.`, p.subject);
      if (p.kind === 'follow') this.actions.follow(p);
      else if (p.kind === 'radar') this.actions.radar();
      else if (p.kind === 'backup') this.actions.backupGate(p.subject);
      else this.actions.reopenGate(p.subject);
    }
    return true;
  }
  ignore(id: number, officer = OFFICERS[0]) {
    const p = this.proposals[id];
    if (!p || p.state !== 'pending') return;
    p.state = 'ignored';
    this.record('Not acted', 'NOT ACTED', `AI recommended at ${hhmm(p.t)}: ${p.text}. ${officer} chose not to act. Recorded as not acted on.`, p.subject);
  }
  /** One officer trying to push an action through alone. */
  override(id: number, officer: string) {
    const p = this.proposals[id];
    if (!p || p.state !== 'pending') return;
    this.record('Person', 'BLOCKED', `${officer} tried to carry out "${p.text}" alone. Blocked: two different officers are required.`, p.subject);
    this.alert('med', 'Single-officer override blocked', `${officer} tried to act alone. The attempt is on record.`, officer,
      { rule: 'Two-person rule: no action on one signature', inputs: [['Signatures', '1 of 2'], ['Action', p.text]] }, null, false);
  }
  penalty(alertId: number) {
    const a = this.alerts[alertId];
    if (!a || a.penalised) return;
    a.penalised = true;
    this.record('Person', 'PENALTY', `Governing Body officer referred "${a.title}" (${a.subject}) for penalty or seizure review.`, a.subject);
  }

  /* ------------------------------------------------------------ gates */
  private label(device: string) { return this.registry.get(device)?.label ?? device; }
  onGate(r: T.GateReading): T.Command {
    this.ctxNode = r.node;
    try { return this.gate(r); } finally { this.ctxNode = ''; }
  }
  private gate(r: T.GateReading): T.Command {
    const n = NODES[r.node];
    const reg = r.reply ? this.registry.get(r.reply.device) : undefined;
    const macOk = !!(r.reply && reg && hmac(reg.key, r.nonce) === r.reply.mac);
    const subject = reg && macOk ? reg.device : `Unknown (${r.plate})`;
    this.note('Gate laser', r.node, subject, 'Count, shape, plate', `1 vehicle, ${f1(r.shape)} m, ${r.plate}`);
    if (!r.reply || !macOk) this.spotted(n.pos, `gate ${r.node}`, r.plate);
    if (!r.reply) this.note('Device radio', r.node, subject, 'Signed challenge', 'no reply', 'bad');
    else this.note('Device radio', r.node, subject, 'Signed challenge', macOk ? `${r.reply.device} answered, signature valid` : `${r.reply.device} answered, signature WRONG`, macOk ? 'ok' : 'bad');
    const decide = (cmd: T.Command, text: string) => { this.record('AI', 'DECISION', `${n.label}: ${cmd.replace('_', ' ')}. ${text}`, subject); return cmd; };
    const inputs: [string, string][] = [['Plate read', r.plate], ['Length measured', f1(r.shape) + ' m'], ['Buried pad', f1(r.gross) + ' t']];
    const entry = n.kind === 'entry';

    if (!r.reply) {
      this.note('Buried pad', r.node, subject, 'Gross weight', f1(r.gross) + ' t');
      const twin = [...this.registry.values()].find((x) => x.plate === r.plate);
      const twinTrip = twin && this.trips.get(twin.device);
      if (!entry && twinTrip?.inside && Math.abs(twin!.shape - r.shape) < 0.6) {
        twinTrip.flag = 'bad';
        this.alert('high', 'Gate held a truck with a dead device', `${twin!.label} (${r.plate}) is on record inside, but its device does not answer at ${n.label}. The gate stays shut.`, twin!.device,
          { rule: 'No device reply, no passage', inputs }, n.pos);
        return decide('HOLD', 'The device is not answering.');
      }
      let d = `No device answered at ${n.label}, so the gate stayed shut.`;
      if (twin) d += ` The plate belongs to ${twin.label}${twinTrip?.inside ? ', which is inside right now, so the plate is likely cloned' : ''}.`;
      if (twin && Math.abs(twin.shape - r.shape) > 0.6) d += ` Measured length ${f1(r.shape)} m differs from the registered ${f1(twin.shape)} m.`;
      this.alert('high', 'Unregistered vehicle turned away', d, subject,
        { rule: 'No valid device, no entry', inputs: [...inputs, ['Device reply', 'none'], ['Registered length', twin ? f1(twin.shape) + ' m' : 'plate unknown']] }, n.pos);
      return decide('TURN_AWAY', 'No device, no entry.');
    }
    if (!macOk) {
      this.alert('high', 'Fake device rejected', `A box claiming to be ${r.reply.device} answered the challenge with a wrong signature. It does not hold the secret key.`, subject,
        { rule: 'Challenge-response: the reply must be signed with the key inside the sealed chip', inputs: [...inputs, ['Claimed device', r.reply.device], ['Signature check', 'failed']] }, n.pos);
      return decide('TURN_AWAY', 'Signature check failed.');
    }
    const g = reg!, trip = this.trips.get(g.device);
    this.confirm(g.device);
    const loadedInside = !!(trip?.inside && trip.sensorNet !== undefined);
    if (entry && trip?.inside) {
      if (loadedInside) {
        trip.flag = 'warn';
        this.alert('med', 'Loaded truck tried the wrong exit', `${g.label} is loaded and tried to leave by ${n.label}. A loaded truck may leave only through G4.`, g.device,
          { rule: 'One exit for loaded trucks', inputs: [...inputs, ['Load on record', f1(trip.sensorNet!) + ' t'], ['Allowed exit', 'G4']] }, n.pos);
        return decide('HOLD', 'Wrong exit.');
      }
      this.alert('med', 'Second entry refused', `${g.device} is already inside. A second entry on the same device was refused.`, g.device,
        { rule: 'One open trip per device', inputs: [...inputs, ['Entered at', `${trip.gate}, ${hhmm(trip.tEntry)}`]] }, n.pos);
      return decide('TURN_AWAY', 'Repeat entry.');
    }
    if (r.plate !== g.plate) {
      if (trip) trip.flag = 'bad';
      this.alert('high', 'Device and plate do not match', `${g.device} is registered to ${g.plate}, but the laser camera read ${r.plate}. The device appears to be on another truck.`, g.device,
        { rule: 'Plate must match the device', inputs: [...inputs, ['Registered plate', g.plate]] }, n.pos);
      return decide('HOLD', 'Plate mismatch.');
    }
    this.note('Buried pad', r.node, g.device, 'Gross weight', f1(r.gross) + ' t');
    if (entry) {
      const used = this.permit();
      const over = used.tonnes >= this.cap.tonnes ? `Quantity limit reached: ${f1(used.tonnes)} of ${this.cap.tonnes} t` : used.trips >= this.cap.trips ? `Trip limit reached: ${used.trips} of ${this.cap.trips}`
        : !trip && used.vehicles >= this.cap.vehicles ? `Vehicle limit reached: ${used.vehicles} of ${this.cap.vehicles}` : this.t >= this.cap.minutes ? 'The permitted time period has ended' : '';
      if (over) {
        this.alert('high', 'Permit limit: entry refused', `${g.label} was turned away. ${over}.`, g.device,
          { rule: 'No entry beyond the contract limits', inputs: [['Quantity', `${f1(used.tonnes)} / ${this.cap.tonnes} t`], ['Trips', `${used.trips} / ${this.cap.trips}`], ['Vehicles', `${used.vehicles} / ${this.cap.vehicles}`]] }, n.pos, false);
        return decide('TURN_AWAY', 'Permit limit.');
      }
      if (Math.abs(r.gross - g.tare) > this.tol) {
        this.alert('high', 'Swap attempt prevented at entry', `${g.label} arrived ${f1(r.gross - g.tare)} t heavier than its registered empty weight. The gate stayed shut; nothing was loaded and nothing left.`, g.device,
          { rule: 'Entry weight must equal the registered empty weight', inputs: [...inputs, ['Registered empty', f1(g.tare) + ' t'], ['Allowed gap', '±' + f1(this.tol) + ' t']] }, n.pos);
        return decide('TURN_AWAY', `Entry weight ${f1(r.gross)} t, registered empty ${f1(g.tare)} t.`);
      }
      this.openTrip(g, r.node, r.gross);
      return decide('OPEN', `Device valid, plate matches, empty weight ${f1(r.gross)} t (registered ${f1(g.tare)} t).`);
    }
    if (!trip || !trip.inside) {
      this.alert('med', 'No entry record: turned away', `${g.label} reached ${n.label} without having passed a main gate.`, g.device,
        { rule: 'Inner gates need an open entry record', inputs }, n.pos);
      return decide('TURN_AWAY', 'No entry record.');
    }
    trip.lastSeen = this.t;
    this.markSeen(trip, r.node);
    if (n.kind === 'exit') return this.exitGate(trip, g, r, decide);
    const net = r.gross - g.tare;
    if (n.kind === 'zone' && trip.sensorNet !== undefined) {
      trip.zoneNet = net;
      if (Math.abs(net - trip.sensorNet) > this.threshold(net)) {
        trip.flag = 'warn';
        this.alert('med', 'Load sensor and buried pad disagree', `At ${n.label} the pad shows ${f1(net)} t net; the truck reports ${f1(trip.sensorNet)} t.`, g.device,
          { rule: 'Two independent weights must agree', inputs: [['Pad net', f1(net) + ' t'], ['Truck sensor', f1(trip.sensorNet) + ' t'], ['Allowed gap', f1(this.threshold(net)) + ' t']] }, n.pos);
        return decide('OPEN', 'Opened with a flag.');
      }
      trip.status = 'Loaded, leaving the zone';
      return decide('OPEN', `Zone exit: pad ${f1(net)} t net agrees with the truck sensor ${f1(trip.sensorNet)} t.`);
    }
    if (trip.sensorNet === undefined && net > this.tol) {
      this.weightChanged(trip, g, r.node, r.gross);
    }
    return decide('OPEN', `Device valid, plate matches, weight ${f1(r.gross)} t.`);
  }
  private openTrip(g: T.Registration, gate: string, gross: number) {
    const route = ENTRY_ROUTES[gate] ?? [];
    let t = this.t + GATE_DWELL;
    const expected: T.Trip['expected'] = [];
    for (let i = route.indexOf(gate) + 1; i < route.length; i++) {
      t += pathLength(leg(route[i - 1], route[i])) / NOMINAL_SPEED;
      const k = NODES[route[i]].kind;
      if (k === 'check') expected.push({ node: route[i], t, done: false, alerted: false });
      if (k === 'route' || k === 'zone') t += GATE_DWELL;
    }
    const trip: T.Trip = { device: g.device, plate: g.plate, gate, tEntry: this.t, entryGross: gross, inside: true, atStart: false, expected,
      lastSeen: this.t, claimed: NODES[gate].pos, silentAlerted: false, battery: false, destAlerted: false, outsideAlerted: false, flag: '', status: 'Inside, empty' };
    this.trips.set(g.device, trip); this.history.push(trip);
  }
  /** A registered truck that was already inside when the shift began. */
  startInside(g: T.Registration, pos: Vec) {
    const trip: T.Trip = { device: g.device, plate: g.plate, gate: 'earlier', tEntry: -20, entryGross: g.tare, inside: true, atStart: true, expected: [],
      lastSeen: 0, claimed: pos, silentAlerted: false, battery: false, destAlerted: false, outsideAlerted: false, flag: '', status: 'Inside (entered before 09:00)' };
    this.trips.set(g.device, trip);
    this.record('AI', 'RECORD', `Carried over from the entry log: ${g.label} (${g.plate}) is inside.`, g.device);
  }
  private markSeen(trip: T.Trip, node: string) { const e = trip.expected.find((x) => x.node === node); if (e) e.done = true; }
  private weightChanged(trip: T.Trip, g: T.Registration, node: string, gross: number) {
    if (trip.status === 'Weight changed') return;
    trip.flag = 'bad'; trip.status = 'Weight changed';
    this.alert('high', 'Weight changed outside the loading point', `${g.label} weighed ${f1(gross)} t at ${NODES[node].label}; it entered at ${f1(trip.entryGross)} t. Weight may rise only at the loading point.`, g.device,
      { rule: 'Weight may change only at the loading point', inputs: [['Entry weight', f1(trip.entryGross) + ' t'], ['Now', f1(gross) + ' t'], ['Allowed gap', '±' + f1(this.tol) + ' t']] }, NODES[node].pos);
  }
  private exitGate(trip: T.Trip, g: T.Registration, r: T.GateReading, decide: (c: T.Command, s: string) => T.Command): T.Command {
    const net = r.gross - g.tare, thr = this.threshold(net), dev = trip.sensorNet ?? 0;
    trip.exitGross = r.gross; trip.exitNet = net; trip.tExit = this.t; trip.inside = false; trip.status = 'On the road to the destination';
    this.checkPermit();
    const devBad = Math.abs(net - dev) > thr, paper = trip.paperNet, papBad = paper !== undefined && Math.abs(net - paper) > thr;
    if (devBad) {
      trip.flag = 'warn';
      this.alert('high', 'Exit weight disagrees with the device', `The buried pad shows ${f1(net)} t net; ${g.label}'s device says ${f1(dev)} t. The independent pad is trusted and the device is flagged.`, g.device,
        { rule: 'The pad is independent of the truck', inputs: [['Pad net', f1(net) + ' t'], ['Device net', f1(dev) + ' t'], ['Allowed gap', f1(thr) + ' t']] }, NODES[r.node].pos);
    }
    if (papBad) {
      trip.flag = 'warn';
      this.alert('high', 'Dispatch note does not match the load', `Note ${trip.note} says ${f1(paper!)} t; the buried pad says ${f1(net)} t. Gap ${f1(net - paper!)} t. Issued at weighbridge ${trip.wb} by operator ${trip.op}.`, `${trip.wb} / ${trip.op}`,
        { rule: 'Vendor paper is a claim, checked against measurements', inputs: [['Vendor note', f1(paper!) + ' t'], ['Pad net', f1(net) + ' t'], ['Truck sensor', f1(dev) + ' t'], ['Allowed gap', f1(thr) + ' t']] }, NODES[r.node].pos);
    } else if (paper !== undefined && net - paper > 0.4) {
      const s = this.skim.get(trip.op!) ?? { n: 0, sum: 0, alerted: false };
      s.n++; s.sum += net - paper; this.skim.set(trip.op!, s);
      if (!s.alerted && s.n >= 3 && s.sum > 2 * this.tol) {
        s.alerted = true;
        this.alert('med', 'Paper runs a little short, trip after trip', `Operator ${trip.op}: ${s.n} notes each passed alone, but together they are ${f1(s.sum)} t short.`, `${trip.wb} / ${trip.op}`,
          { rule: 'Running gap across trips', inputs: [['Trips short', String(s.n)], ['Running gap', f1(s.sum) + ' t'], ['Flag above', f1(2 * this.tol) + ' t']] }, null, false);
      }
    }
    if (!devBad && !papBad) { trip.flag = trip.flag || 'ok'; return decide('OPEN', `Exit weight ${f1(net)} t matches the device${paper !== undefined ? ' and the note' : ''}.`); }
    return decide('OPEN', 'Opened with a flag; the destination will confirm.');
  }

  setCap(tonnes: number) {
    this.cap.tonnes = tonnes; this.capWarned = 0;
    this.record('Person', 'RECORD', `Permit quantity for this shift set to ${tonnes} t (demonstration setting).`, 'Permit');
    this.checkPermit();
  }
  private checkPermit() {
    const used = this.permit().tonnes, share = used / this.cap.tonnes, level = share > 1 ? 2 : share >= 0.8 ? 1 : 0;
    if (level <= this.capWarned) return;
    this.capWarned = level;
    this.alert(level === 2 ? 'high' : 'med', level === 2 ? 'Permit quantity exceeded' : 'Permit quantity nearly used',
      level === 2 ? `${f1(used)} t has left against a limit of ${this.cap.tonnes} t. Further entries are refused.` : `${f1(used)} t of ${this.cap.tonnes} t has left the mine.`, 'Permit',
      { rule: 'Measured quantity against the contract', inputs: [['Measured out', f1(used) + ' t'], ['Limit', this.cap.tonnes + ' t']] }, null, false);
  }

  /* ------------------------------------------------------------ road and yard */
  onCheck(r: T.CheckReading) {
    const trip = this.trips.get(r.device);
    if (!trip?.inside) return;
    this.confirm(r.device);
    const off = dist(r.claimed, r.reader);
    trip.lastSeen = this.t;
    if (off > 350) {
      trip.flag = 'bad';
      this.note('Checkpoint', r.node, r.device, 'Radio check', `heard here, claims to be ${f1(off / 1000)} km away`, 'bad');
      this.alert('high', 'Device reports a false position', `${NODES[r.node].label} heard ${this.label(r.device)} within radio range, but its own position says ${f1(off / 1000)} km away.`, r.device,
        { rule: 'Short-range radio checks the claimed position', inputs: [['Reader', r.node], ['Claimed offset', Math.round(off) + ' m'], ['Radio range', 'about 100 m (assumed)']] }, NODES[r.node].pos);
    } else this.note('Checkpoint', r.node, r.device, 'Radio check', 'position confirmed', 'ok');
    this.markSeen(trip, r.node);
  }
  onHidden(r: T.HiddenReading) {
    const trip = r.device ? this.trips.get(r.device) : undefined;
    const g = r.device ? this.registry.get(r.device) : undefined;
    this.note('Hidden pad', r.node, r.device ?? 'Unknown', 'Gross weight', f1(r.gross) + ' t');
    if (r.device) this.confirm(r.device);
    if (!trip?.inside || !g || trip.sensorNet !== undefined) return;
    if (Math.abs(r.gross - trip.entryGross) > this.tol) this.weightChanged(trip, g, r.node, r.gross);
    else this.record('AI', 'CHECK', `Hidden pad ${r.node}: weight unchanged since entry.`, r.device!);
  }
  onLoad(r: T.LoadReading) {
    const trip = this.trips.get(r.device);
    this.note('Truck load sensor', r.pile, r.device, 'Weight gained at loading point', f1(r.net) + ' t');
    if (!trip) return;
    trip.sensorNet = r.net; trip.pile = r.pile; trip.status = 'Loaded';
  }
  onPaper(r: T.PaperReading) {
    const trip = this.trips.get(r.device);
    this.note('Vendor paper', r.wb, r.device, `Dispatch note ${r.note}`, f1(r.net) + ' t net');
    if (trip) { trip.paperNet = r.net; trip.note = r.note; trip.wb = r.wb; trip.op = r.op; }
  }
  onDest(r: T.DestReading) {
    const trip = this.trips.get(r.device), g = this.registry.get(r.device);
    if (!trip || !g || trip.exitGross === undefined) return;
    const net = r.gross - g.tare; trip.destNet = net; trip.tDest = this.t;
    this.note('Destination weighbridge', 'DEST', r.device, 'Arrival weight', f1(net) + ' t net');
    const ok = Math.abs(r.gross - trip.exitGross) <= this.threshold(net);
    trip.status = ok ? 'Delivered' : 'Delivered, weight mismatch';
    this.record('AI', 'RECONCILE', `${g.label} arrived with ${f1(net)} t net; it left the mine with ${f1(trip.exitNet!)} t. ${ok ? 'Match.' : 'MISMATCH.'}`, r.device);
    if (!ok) {
      trip.flag = 'bad';
      this.alert('high', 'Destination weight differs from exit weight', `${f1(net)} t at the destination, ${f1(trip.exitNet!)} t at gate G4.`, r.device,
        { rule: 'What left must be what arrives', inputs: [['Exit net', f1(trip.exitNet!) + ' t'], ['Destination net', f1(net) + ' t']] }, NODES.DEST.pos);
    } else if (trip.paperNet !== undefined && Math.abs(net - trip.paperNet) > this.threshold(net)) {
      this.alert('med', 'Destination confirms the measurement, not the paper', `Destination ${f1(net)} t; Vendor note ${f1(trip.paperNet)} t. The paper record is wrong.`, `${trip.wb} / ${trip.op}`,
        { rule: 'Third independent weighing settles the dispute', inputs: [['Vendor note', f1(trip.paperNet) + ' t'], ['Exit pad', f1(trip.exitNet!) + ' t'], ['Destination', f1(net) + ' t']] }, NODES.DEST.pos, false);
    } else if (!trip.flag) trip.flag = 'ok';
  }
  onHeartbeat(r: T.Heartbeat) {
    const trip = this.trips.get(r.device);
    if (!trip) return;
    trip.lastSeen = r.t; trip.claimed = r.claimed;
    if (r.battery && !trip.battery) {
      trip.battery = true;
      this.alert('med', 'Truck power cut: device on battery', `${this.label(r.device)} lost vehicle power. The device switched to its own battery and keeps reporting.`, r.device,
        { rule: 'Loss of power is an event', inputs: [['Power', 'internal battery'], ['Reporting', 'yes']] }, r.claimed);
    }
    if (trip.inside && !trip.outsideAlerted && !inPoly(r.claimed, LEASE) && dist(r.claimed, NODES[trip.gate]?.pos ?? r.claimed) > 150 && dist(r.claimed, NODES.G4.pos) > 150) {
      trip.outsideAlerted = true; trip.flag = 'bad';
      this.alert('high', 'Left the lease without passing an exit', `${this.label(r.device)} reports a position outside the boundary while the log still shows it inside.`, r.device,
        { rule: 'Position against boundary and exit log', inputs: [['Exit record', 'none'], ['Nearest point', nearestNodeLabel(r.claimed)]] }, r.claimed);
    }
  }
  onTamper(device: string, pos: Vec) {
    const trip = this.trips.get(device);
    if (trip) { trip.flag = 'bad'; trip.silentAlerted = true; }
    this.alert('high', 'Device housing opened', `${this.label(device)}'s device sent a tamper warning and locked itself. The next gate will not open for it.`, device,
      { rule: 'The sealed device stops working when opened', inputs: [['Tamper switch', 'tripped']] }, pos);
  }
  /** Time-driven checks: silence, lateness, non-arrival. */
  tick(t: number) {
    this.t = t;
    for (const p of this.proposals) if (p.state === 'pending' && t >= p.expires) {
      p.state = 'expired';
      this.record(p.origin === 'AI' ? 'Not acted' : 'Person', p.origin === 'AI' ? 'NOT ACTED' : 'RECORD', `${p.origin === 'AI' ? 'AI recommended' : 'Officer asked'} at ${hhmm(p.t)}: ${p.text}. Nobody completed the approval before it expired.`, p.subject);
    }
    for (const trip of this.trips.values()) {
      if (trip.inside) {
        if (!trip.silentAlerted && t - trip.lastSeen > 2.5) {
          trip.silentAlerted = true; trip.flag = 'bad';
          this.alert('high', 'Device went silent', `${this.label(trip.device)} has sent nothing since ${hhmm(trip.lastSeen)}: jammed or switched off. The next gate will hold it.`, trip.device,
            { rule: 'Silence from a registered device raises an alert', inputs: [['Last heard', hhmm(trip.lastSeen)], ['Expected every', '1 minute']] }, trip.claimed);
        }
        for (const e of trip.expected) if (!e.done && !e.alerted && t > e.t + 3) {
          e.alerted = true; trip.flag = trip.flag === 'bad' ? 'bad' : 'warn';
          this.alert('med', 'Late or off route', `${this.label(trip.device)} was due at ${NODES[e.node].label} by ${hhmm(e.t)} and has not been heard there.`, trip.device,
            { rule: 'Timed checkpoints', inputs: [['Due', hhmm(e.t)], ['Now', hhmm(t)], ['Allowed delay', '3 min']] }, NODES[e.node].pos);
        }
      } else if (trip.tExit !== undefined && trip.tDest === undefined && !trip.destAlerted) {
        const due = trip.tExit + pathLength(leg('G4', 'DEST')) / NOMINAL_SPEED + 6;
        if (t > due) {
          trip.destAlerted = true; trip.flag = 'bad'; trip.status = 'Never arrived';
          this.alert('high', 'Load never arrived', `${this.label(trip.device)} left G4 at ${hhmm(trip.tExit)} with ${f1(trip.exitNet!)} t and has not reached the destination.`, trip.device,
            { rule: 'Every exit must arrive in time', inputs: [['Left', hhmm(trip.tExit)], ['Due by', hhmm(due)], ['Unaccounted', f1(trip.exitNet!) + ' t']] }, NODES.DEST.pos, false);
        }
      }
    }
  }

  /* ------------------------------------------------------------ eyes: towers, drones, radar */
  private unknownSeen = new Map<string, number>();
  private followFor(s: T.Sighting, why: T.Why) {
    const subject = `Unknown (${s.plate ?? 'plate not read'})`;
    // do not repeat a request that is still open, or one just made for the same spot
    if (this.proposals.some((p) => p.kind === 'follow' && (p.state === 'pending' || (this.t - p.t < 8 && p.pos && dist(p.pos, s.pos) < 450)))) return;
    this.propose({ kind: 'follow', origin: 'AI', text: 'Send a drone to follow and photograph the vehicle with no device', subject, pos: s.pos, why });
  }
  onTower(tower: string, s: T.Sighting) {
    this.spotted(s.pos, `tower ${tower}`);
    const key = s.track, seen = (this.unknownSeen.get(key) ?? 0) + 1; this.unknownSeen.set(key, seen);
    this.note('LiDAR tower', tower, 'Unknown vehicle', 'Vehicle with no device answering', `${f1(s.shape)} m long, near ${nearestNodeLabel(s.pos)}`, 'bad');
    const why: T.Why = { rule: 'Every vehicle in the pickup area must have a device that answers', inputs: [['Seen by', tower], ['Length', f1(s.shape) + ' m'], ['Device reply', 'none']] };
    this.alert(seen > 1 ? 'low' : 'med', seen > 1 ? 'Untagged vehicle seen again' : 'Untagged vehicle near the pickup zone', seen > 1
      ? `Tower ${tower} sees the vehicle with no device again, near ${nearestNodeLabel(s.pos)}. The earlier recommendation is on record.`
      : `Tower ${tower} sees a vehicle near ${nearestNodeLabel(s.pos)} that no device answers for.`, 'Unknown vehicle', why, s.pos, seen === 1);
    if (seen === 1) this.followFor({ ...s, plate: null }, why);
  }
  onTowerTrack(tower: string, pos: Vec) { this.spotted(pos, `tower ${tower}`); }
  onFollow(s: T.Sighting | null, p: T.Proposal) {
    if (!s) { this.record('AI', 'RECORD', 'Follow drone arrived and found no vehicle. It had already left.', p.subject); return; }
    this.spotted(s.pos, 'follow drone', s.plate);
    this.note('Follow drone', '', p.subject, 'Photograph and plate', `${s.plate ?? 'plate hidden'}, ${f1(s.shape)} m, no device`, 'bad');
    const twin = [...this.registry.values()].find((x) => x.plate === s.plate);
    this.alert('high', twin ? 'Drone confirmed: no device, cloned plate' : 'Drone confirmed: vehicle with no device',
      twin ? `The vehicle wears ${twin.label}'s plate but has no device. Photographs and track are saved.` : `Photographs and track are saved for the vehicle near ${nearestNodeLabel(s.pos)}.`,
      `Unknown (${s.plate ?? 'plate hidden'})`, { rule: 'Visual confirmation', inputs: [['Plate', s.plate ?? 'hidden'], ['Device', 'none']] }, s.pos, false);
  }
  /** Compare a counting round with the entry and exit log. */
  onRound(r: RoundResult) {
    const byTrack = new Map<string, T.Sighting>();
    for (const s of r.sightings) { const prev = byTrack.get(s.track); if (!prev || (!prev.device && s.device)) byTrack.set(s.track, s); }
    // a vehicle seen at a gate is still being checked there
    const atGate = (p: Vec) => ['G1', 'G2', 'G3', 'G4'].some((g) => dist(NODES[g].pos, p) < 70);
    const seen = [...byTrack.values()];
    const paired = new Set(seen.filter((s) => s.device && r.insideDuring.has(s.device)).map((s) => s.device!));
    const unmatched = seen.filter((s) => (!s.device || !r.insideDuring.has(s.device)) && !atGate(s.pos));
    const elsewhere = r.expected.filter((d) => !paired.has(d) && (this.confirmed.get(d) ?? -99) >= r.since);
    const absent = r.expected.filter((d) => !paired.has(d) && !elsewhere.includes(d));
    for (const d of r.expected) if (!absent.includes(d)) this.notInPictures.delete(d);
    // alarm at once if the device is also silent, otherwise after a second round without a picture
    const missing = absent.filter((d) => {
      const n = (this.notInPictures.get(d) ?? 0) + 1; this.notInPictures.set(d, n);
      const trip = this.trips.get(d);
      return !trip || this.t - trip.lastSeen > 2.5 || n >= 2;
    });
    const recount = absent.filter((d) => !missing.includes(d));
    unmatched.forEach((u) => this.spotted(u.pos, 'drone count'));
    const expected = new Set([...r.expected, ...paired]).size, counted = paired.size + elsewhere.length + unmatched.length;
    const verdict = unmatched.length ? 'more' : missing.length ? 'fewer' : recount.length ? 'recount' : 'match';
    this.rounds.push({ id: r.id, t: this.t, expected, counted, verdict, unmatched: unmatched.length, missing: missing.length + recount.length });
    this.note('Drone count', 'zones A-D', '', `Round ${r.id}`, `log expects ${expected}, counted ${counted}`, verdict === 'match' ? 'ok' : verdict === 'recount' ? 'warn' : 'bad');
    const inputs: [string, string][] = [['Entries minus exits', String(expected)], ['Counted', String(counted)], ['Drone pictures paired with a device', String(paired.size)], ['Confirmed by a gate, checkpoint or tower during the round', String(elsewhere.length)], ['Unmatched', String(unmatched.length)], ['Not found', String(absent.length)]];
    if (verdict === 'match') this.record('AI', 'DECISION', `Drone round ${r.id}: count ${counted} matches the gate log. All clear.`);
    if (recount.length) this.record('AI', 'CHECK', `Drone round ${r.id}: ${recount.map((d) => this.label(d)).join(', ')} not in the pictures but its device still answers. It will be counted again next round.`);
    if (unmatched.length) {
      const s = unmatched[0];
      this.alert('high', 'Drones count more trucks than the log', `Log expects ${expected}, drones count ${counted}. ${unmatched.length} vehicle(s) with no matching entry, the first in zone ${s.zone} near ${nearestNodeLabel(s.pos)}.`,
        'Unknown vehicle', { rule: 'Inside = entries − exits', inputs }, s.pos, false);
      for (const u of unmatched) if (!u.device) this.followFor(u, { rule: 'Unmatched vehicle in a counting round', inputs });
    }
    if (missing.length) {
      const names = missing.map((d) => this.label(d)).join(', ');
      this.alert('med', 'Drones count fewer trucks than the log', `Not found: ${names}. The log shows it inside, but no drone, gate, checkpoint or tower accounts for it.`,
        missing[0], { rule: 'Inside = entries − exits', inputs }, this.trips.get(missing[0])?.claimed ?? null, false);
    }
    return { expected, counted, verdict, unmatched, missing };
  }
  roundMissed(id: number) {
    this.rounds.push({ id, t: this.t, expected: -1, counted: -1, verdict: 'missed', unmatched: 0, missing: 0 });
    this.alert('med', 'Counting round missed: drones grounded', 'Low cloud and rain. The missed round is on record.', 'Weather',
      { rule: 'A missed round is logged and raises an alert', inputs: [['Weather', 'monsoon']] }, null, false);
    this.proposeRadar();
  }
  proposeRadar() {
    if (this.proposals.some((p) => p.kind === 'radar' && p.state === 'pending')) return;
    this.propose({ kind: 'radar', origin: 'AI', text: 'Order a radar satellite image of the lease (about US$3,300)', subject: 'Radar', pos: null, why: { rule: 'Radar is the backup when drones cannot fly', inputs: [['Drones', 'grounded']] } });
  }
  onRadar(seen: T.Sighting[]) {
    const unknown = seen.filter((s) => !s.device);
    this.note('Radar satellite', 'lease', '', 'Image', `${seen.length} vehicles, ${unknown.length} with no device`, unknown.length ? 'bad' : 'ok');
    if (unknown.length) this.alert('high', 'Radar sees a vehicle with no device', `${unknown.length} vehicle(s) on the image that no device answers for.`, 'Unknown vehicle',
      { rule: 'Radar image against device positions', inputs: [['Vehicles on image', String(seen.length)], ['Without device', String(unknown.length)]] }, unknown[0].pos, false);
  }
  onTowerLost(tower: string, reason: string, pos: Vec) {
    this.alert('med', `LiDAR tower ${tower} lost its view`, `${reason} The control room treats lost data as suspicious.`, tower,
      { rule: 'Lost or degraded data raises an alert', inputs: [['Tower', tower], ['Cause', reason]] }, pos);
  }
  onGateStuck(node: string) {
    this.alert('high', `${NODES[node].label} left open`, 'The barrier has been open for 5 minutes with no vehicle.', node,
      { rule: 'An open barrier raises an alarm', inputs: [['Open for', '5 min']] }, NODES[node].pos);
    this.propose({ kind: 'backup', origin: 'AI', text: `Close the backup gate at ${node}`, subject: node, pos: NODES[node].pos, why: { rule: 'Backup barrier', inputs: [['Main barrier', 'stuck open']] } });
  }
  manualReopen(node: string) {
    this.record('AI', 'DECISION', `${NODES[node].label}: manual reopening REFUSED. Only a signed command from the control room reopens the backup gate.`, node);
    this.alert('med', 'Manual reopening refused', `Someone tried to open the backup gate at ${node} by hand.`, node, { rule: 'Backup gate opens only on a signed command', inputs: [['Method', 'by hand']] }, NODES[node].pos);
  }

  /* ------------------------------------------------------------ pile */
  onScan(r: T.ScanReading) {
    const prev = this.piles.get(r.pile);
    if (!prev) {
      this.piles.set(r.pile, { base: r.tonnes, last: r.tonnes, gap: 0, band: 0.01 * r.tonnes, t: this.t, alertedGap: 0 });
      this.note('LiDAR scan', r.pile, '', 'Opening scan', f1(r.tonnes) + ' t');
      return;
    }
    const out = this.recordedOut(r.pile), gap = prev.base - out - r.tonnes, band = 0.01 * r.tonnes;
    Object.assign(prev, { last: r.tonnes, gap, band, t: this.t });
    const bad = gap > band;
    this.note('LiDAR scan', r.pile, '', 'Pile balance', `scan ${f1(r.tonnes)} t, expected ${f1(prev.base - out)} t, gap ${f1(gap)} ± ${f1(band)} t`, bad ? 'bad' : 'ok');
    if (bad && gap > prev.alertedGap + band / 2) {
      prev.alertedGap = gap;
      this.alert('high', `Ore missing from stockpile ${r.pile}`, `About ${Math.round(gap)} t (±${Math.round(band)} t) left the pile with no recorded load.`, `Stockpile ${r.pile}`,
        { rule: 'Opening stock − recorded loads = expected pile (no new ore added in this window)', inputs: [['Opening scan', f1(prev.base) + ' t'], ['Recorded loads', f1(out) + ' t'], ['Scan now', f1(r.tonnes) + ' t'], ['Scan error band', '±' + f1(band) + ' t']] }, PILES.find((p) => p.id === r.pile)!.pos, false);
    }
  }
  recordedOut(pile: string) { return this.history.filter((x) => x.pile === pile).reduce((a, x) => a + (x.exitNet ?? x.sensorNet ?? 0), 0); }

  /* ------------------------------------------------------------ answers */
  expectedInside(): string[] { return [...this.trips.values()].filter((x) => x.inside).map((x) => x.device); }
  permit() {
    const out = this.history.filter((x) => x.exitNet !== undefined);
    const tonnes = out.reduce((a, x) => a + x.exitNet!, 0), paper = out.reduce((a, x) => a + (x.paperNet ?? 0), 0);
    const vehicles = new Set([...this.trips.keys()]).size;
    const capAt = tonnes > 0 && this.t > 5 ? (this.t * this.cap.tonnes) / tonnes : null;
    return { tonnes, paper, trips: out.length, vehicles, minutes: this.t, capAt };
  }
  ranking() {
    const score = new Map<string, { n: number; why: Set<string> }>();
    const add = (k: string, n: number, why: string) => { const s = score.get(k) ?? { n: 0, why: new Set<string>() }; s.n += n; s.why.add(why); score.set(k, s); };
    for (const a of this.alerts) { if (a.subject === 'Weather' || a.subject === 'Permit') continue; add(this.registry.get(a.subject)?.label ?? a.subject, a.sev === 'high' ? 40 : a.sev === 'med' ? 20 : 5, a.title); }
    if (this.counts.notActed) add('Control room shift (for review)', 15 * this.counts.notActed, 'AI advice not acted on');
    return [...score.entries()].map(([k, s]) => ({ k, n: s.n, why: [...s.why].join('; ') })).sort((a, b) => b.n - a.n);
  }
}
export const EXIT_PATH_NODES = EXIT_ROUTE;
