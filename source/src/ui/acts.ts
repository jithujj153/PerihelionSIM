/* The twelve-minute story. Each act sets the camera, the view and the pace, and says what the panel should take away. */
import { pathLength } from '../engine/util';
import { NODES } from '../engine/layout';
import type { App } from './app';
import type { ViewMode } from '../view/scene';
import type { Shot } from '../view/camera';

export interface Act { id: number; name: string; minutes: string; start: number; learns: string; view: ViewMode; enter?(a: App): void; tick(a: App, s: number): void; speed(a: App): number }

/** Follow one truck, moving to the gate officer's side as it reaches a gate. */
export function follow(a: App, uid: string): boolean {
  const x = a.sim.find(uid); if (!x || x.state === 'gone') return false;
  let gate = '';
  const s = x.steps[0], n = x.steps[1];
  if ((x.state === 'gate' || x.state === 'held') && a.sim.gates[x.at]) gate = x.at;
  else if (s?.k === 'drive' && n?.k === 'node' && a.sim.gates[n.node] && pathLength(s.path) - x.d < 120) gate = n.node;
  const weighing = Math.hypot(x.pos.x - NODES.DEST.pos.x, x.pos.z - NODES.DEST.pos.z) < 55;
  a.rig.base = gate ? { k: 'gate', id: gate } : weighing ? { k: 'point', pos: NODES.DEST.pos, dist: 105 } : { k: 'chase', uid, far: x.state === 'loading' ? 1.5 : 1 };
  a.rig.subject = uid; if (gate) a.rig.gateId = gate; a.focus = uid;
  return true;
}
const shot = (a: App, s: Shot) => { a.rig.base = s; };
const atGate = (a: App, uid: string) => { const x = a.sim.find(uid); return !!x && (x.state === 'gate' || x.state === 'held'); };
const followDrone = (a: App) => {
  if (!a.sim.drones[4].active) return false;
  const uid = a.sim.follow?.uid;
  // never lose the swarm: lift-off, flight out, circling what it found, flight home, landing
  const el = a.sim.follow ? a.sim.t - a.sim.follow.t0 : 0;
  if (el < 0.3 || el >= 4.35) shot(a, { k: 'preset', name: 'dock' });
  else if (el >= 0.82 && el < 3.6 && uid && a.world.vehiclePos(uid)) shot(a, { k: 'chase', uid, far: 3.3 });
  else shot(a, { k: 'swarm' });
  return true;
};

const NET: [string, string, string, Shot][] = [
  ['fence', 'A gated pickup zone', 'The whole lease cannot be fenced, so loading is allowed only here, behind three zone gates.', { k: 'preset', name: 'zone' }],
  ['gates', 'Gates that decide for themselves', 'Laser count, number plate, a signed answer from the truck device, and the weight.', { k: 'gate', id: 'G1' }],
  ['pads', 'Weighing buried in the road', 'At every gate and at hidden spots. The Vendor cannot see or reach them. Shown here as an x-ray.', { k: 'preset', name: 'road' }],
  ['checks', 'Timed checkpoints', 'A short-range radio check: is the truck where its device says, and on time?', { k: 'preset', name: 'checks' }],
  ['towers', 'LiDAR towers over the stockpiles', 'They see any vehicle that no device answers for, and measure the piles.', { k: 'preset', name: 'towers' }],
  ['zones', 'Four drone zones for the open boundary', 'Two counting rounds every hour, at secret times and on a new route each time. Count inside must equal entries minus exits.', { k: 'preset', name: 'zones' }],
  ['zones', 'Drone charging station', 'Four drones patrol the zones. Four more wait charged as a reserve swarm for high-alert investigations.', { k: 'preset', name: 'dock' }],
];

export const ACTS: Act[] = [
  { id: 1, name: 'Arrival', minutes: '0:00', start: 0, view: 'truth', learns: 'Today the only record of what leaves a mine belongs to the people being checked.',
    enter(a) { a.rig.tour = 0; a.hero('PERIHELION', 'Independent monitoring of mine extraction and movement', 'Gandhamardan-B iron ore mine · a simulation', 5.5); a.setLayers({ fence: true, gates: true, pads: false, checks: false, towers: false, zones: false, boundary: true }); },
    tick(a, s) { a.rig.tour = s / 30; shot(a, { k: 'tour' });
      if (s > 14) a.once('paper', () => { a.setView('paper'); a.say('info', 'What the Governing Body sees today', 'The Vendor’s paper: its own weighbridge slips, its own cameras, its own register. On paper, everything is in order.', 14); }); },
    speed: () => 0.25 },
  { id: 2, name: 'The net', minutes: '0:30', start: 0, view: 'evidence', learns: 'Independent layers watch the ore and the trucks that carry it. None of them belongs to the Vendor.',
    enter(a) { a.setLayers({ fence: false, gates: true, pads: false, checks: false, towers: false, zones: false, boundary: true }); },
    tick(a, s) {
      // the first stop is short so the gates come early; every later stop lasts seven seconds
      const i = s < 4 ? 0 : Math.min(NET.length - 1, 1 + Math.floor((s - 4) / 7)), end = 4 + (NET.length - 1) * 7 + 2;
      for (let k = 0; k <= i; k++) a.once('net' + k, () => { a.setLayers({ [NET[k][0]]: true }); a.clearBanners(); a.say('info', NET[k][1], NET[k][2], 7.5); });
      shot(a, s > end ? { k: 'preset', name: 'site' } : NET[i][3]);
      if (s > end) a.once('all', () => { a.setLayers({ zones: false }); a.say('info', 'One control room, one tamper-evident log', 'AI runs the routine gates. Two officers approve anything bigger. Whatever is not acted on is recorded too.', 10); });
    },
    speed: () => 0 },
  { id: 3, name: 'Honest trip', minutes: '1:45', start: 1.0, view: 'evidence', learns: 'A genuine truck passes without waiting for anyone, and every independent weight agrees.',
    tick(a) {
      if (!follow(a, 'T1')) shot(a, { k: 'preset', name: 'zone' });
      const t = a.sim.gov.trips.get('DEV-1101');
      if (t?.destNet !== undefined) a.once('done', () => { a.say('ok', 'Honest trip: everything agrees', `Dispatch note ${t.paperNet?.toFixed(1)} t · truck sensor ${t.sensorNet?.toFixed(1)} t · exit pad ${t.exitNet?.toFixed(1)} t · destination ${t.destNet!.toFixed(1)} t. No person had to step in.`, 14); a.select('T1'); a.openTab('evidence'); });
    },
    speed: (a) => (atGate(a, 'T1') ? 0.16 : a.sim.find('T1')?.state === 'loading' ? 1.1 : 0.7) },
  { id: 4, name: 'Three cheats', minutes: '3:15', start: 27.0, view: 'evidence', learns: 'A swap, a false note and a cloned truck each leave a mismatch that names who to question.',
    enter(a) { a.say('info', 'Three cheats at once', 'A swap thief, an understated dispatch note, and a truck with a cloned number plate.', 7); },
    tick(a) {
      const t = a.sim.t;
      if (followDrone(a)) return;
      if (t < 30.4) { if (!follow(a, 'T2')) shot(a, { k: 'gate', id: 'G1' }); if (atGate(a, 'T2')) shot(a, { k: 'gate', id: 'G1', close: true }); }
      else if (t < 40.5) { if (!follow(a, 'T3')) shot(a, { k: 'preset', name: 'zone' }); }
      else if (t < 41.3) follow(a, 'T3') || shot(a, { k: 'point', pos: { x: 2330, z: 430 } });
      else if (t < 43.6) { shot(a, { k: 'gate', id: 'G3' }); a.focus = 'T4'; a.rig.subject = 'T4'; a.rig.gateId = 'G3'; }
      else {
        const seen = a.sim.gov.unknown.at(-1);
        if (seen && t - seen.t < 1 && seen.src.startsWith('tower') && a.world.vehiclePos('T4')) shot(a, { k: 'chase', uid: 'T4', far: 2.3 });
        else if (!follow(a, 'T4')) shot(a, { k: 'preset', name: 'zone' });
      }
    },
    speed: (a) => { const t = a.sim.t; if (atGate(a, 'T2') || atGate(a, 'T4') || (atGate(a, 'T3') && t > 36)) return 0.14; if (t > 43.5 && t < 47) return 1.1; return t > 31 && t < 36 ? 1.0 : 0.55; } },
  { id: 5, name: 'Open boundary', minutes: '6:45', start: 54.5, view: 'truth', learns: 'Where there is no fence, two drone rounds at secret times count the trucks and compare with the gate log.',
    enter(a) { a.say('info', 'No fence, no gate', 'A truck with no device drives in from the west. No gate will ever see it.', 9); a.setLayers({ zones: true }); },
    tick(a) {
      const g = a.sim.gov, flying = !!a.sim.flight && !a.sim.flight.done, found = g.rounds.some((r) => r.verdict === 'more' && r.t > 55);
      if (followDrone(a)) return;
      // once the advice is settled, close the case instead of waiting in silence for the next round
      if (found && !flying && !g.proposals.some((p) => p.kind === 'follow' && p.state === 'pending')) {
        a.once('closed', () => {
          a.caseClosed = true; a.clearBanners();
          const acted = g.proposals.some((p) => p.kind === 'follow' && p.state === 'approved' && p.t > 55);
          a.say(acted ? 'ok' : 'warn', acted ? 'Case closed: evidence saved' : 'Advice not acted on: recorded',
            acted ? 'The vehicle with no device was photographed, it left the lease, and the swarm is back on charge. Press \u2192 to check the stockpile.' : 'The decision is in the log. Press \u2192 to see what the stockpile shows.', 600);
        });
        shot(a, { k: 'preset', name: a.sim.drones[4].active ? 'dock' : 'site' }); return;
      }
      if (flying) { a.once('fly' + a.sim.flight!.round.id, () => { a.setView('evidence'); a.say('info', 'Counting round in the air', `One drone to each zone, on a new random route. The gate log says ${a.sim.flight!.atStart.length} trucks should be inside.`, 7); }); shot(a, { k: 'preset', name: found ? 'west' : a.sim.t - a.sim.flight!.t0 < 0.4 ? 'dock' : 'zones' }); return; }
      if (found) { shot(a, { k: 'preset', name: 'west' }); return; }
      const x = a.sim.find('T5');
      if (x && x.state === 'driving') follow(a, 'T5'); else shot(a, { k: 'preset', name: 'west' });
      if (x && x.state !== 'driving' && a.sim.t > 61) a.once('wait', () => a.say('info', 'The next round time is secret', 'Time runs faster while we wait. The Vendor cannot know when the drones will fly.', 8));
    },
    speed: (a) => { if (a.caseClosed) return 0; if (a.sim.drones[4].active) return 0.35; if (a.sim.flight && !a.sim.flight.done) return 0.7; if (a.sim.gov.rounds.some((r) => r.verdict === 'more' && r.t > 55)) return 0.4; return a.sim.find('T5')?.state === 'driving' ? 0.45 : 1.6; } },
  { id: 6, name: 'The pile does not lie', minutes: '8:15', start: 93.5, view: 'evidence', learns: 'Even if every other check is ignored, ore taken without a record shows up in the stockpile scan.',
    enter(a) { a.say('info', 'Compare the pile with the books', 'No new ore was added in this window, so opening scan minus recorded loads must equal what is there now.', 9); },
    tick(a) {
      shot(a, { k: 'preset', name: 'pile' });
      if (a.sim.t >= 95.9) a.once('scan', () => a.sim.scanPiles(1));
      if (a.sim.t > 97) a.once('verdict', () => {
        const p = a.sim.gov.piles.get('S2')!;
        if (p.gap > p.band) a.say('bad', `About ${Math.round(p.gap)} t has left stockpile S2 without a record`, 'The officers did not act on the AI’s advice about the unidentified truck. That choice is in the log, and the pile shows what it cost.', 600);
        else a.say('ok', 'The pile balances', 'The unidentified truck was followed and left before it could load.', 600, { label: 'What if the officers had ignored the advice?', act: 'whatif' });
      });
    },
    speed: (a) => (a.sim.t > 99 ? 0.25 : 0.45) },
  { id: 7, name: 'Be the Vendor', minutes: '9:15', start: 98, view: 'evidence', learns: 'The panel chooses the attack. The system shows which independent record catches it.',
    enter(a) { a.openTab('vendor'); a.sim.sendTruck('G1'); a.sim.at(a.sim.t + 1.2, () => a.sim.sendTruck('G2')); a.sim.at(a.sim.t + 5, () => a.sim.sendTruck('G3')); a.say('info', 'Your turn: try to cheat it', 'Pick a truck on the right, then an attack.', 9); },
    tick(a) { if (followDrone(a)) return; if (a.holdShot()) return; const uid = a.target && a.sim.find(a.target) && a.sim.find(a.target)!.state !== 'gone' ? a.target : a.sim.targets().at(-1)?.uid; if (!uid || !follow(a, uid)) shot(a, { k: 'preset', name: 'site' }); },
    speed: (a) => (a.target && atGate(a, a.target) ? 0.18 : 0.5) },
  { id: 8, name: 'Verdict', minutes: '11:00', start: 98, view: 'evidence', learns: 'Six questions answered from independent evidence, with a log nobody can quietly rewrite.',
    enter(a) { a.verdict(); }, tick(a) { shot(a, { k: 'preset', name: 'site' }); }, speed: () => 0 },
];
