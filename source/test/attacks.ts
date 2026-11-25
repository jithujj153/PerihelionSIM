import { Sim } from '../src/engine/sim';
import { sha256, hmac } from '../src/engine/sha';
import { createHash, createHmac } from 'node:crypto';
let fails = 0, passes = 0;
const check = (name: string, ok: boolean, extra = '') => { if (ok) passes++; else fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };
function until(s: Sim, f: () => boolean, max = 60) { for (let i = 0; i < max * 5 && !f(); i++) s.step(0.2); return f(); }
const has = (s: Sim, title: string, from = 0) => s.gov.alerts.slice(from).some((a) => a.title.includes(title));
const titles = (s: Sim, from = 0) => s.gov.alerts.slice(from).map((a) => a.title).join(' ; ');
function fresh(auto: 'approve' | 'ignore' | null = 'approve', seed = 7) { const s = new Sim(seed, false); s.autoDecide = () => auto; return s; }
function inside(s: Sim, gate: 'G1' | 'G2' | 'G3' = 'G1') { const x = s.sendTruck(gate); until(s, () => !!s.gov.trips.get(x.device!.id)?.inside && x.state === 'driving'); return x; }
function loaded(s: Sim) { const x = inside(s); until(s, () => s.gov.trips.get(x.device!.id)!.sensorNet !== undefined && x.state === 'driving'); return x; }

// crypto
for (const m of ['', 'abc', 'a'.repeat(200), 'ज्ञान ✓']) check('sha256 ' + m.length, sha256(m) === createHash('sha256').update(m).digest('hex'));
for (const k of ['k', 'x'.repeat(100)]) check('hmac ' + k.length, hmac(k, 'nonce-1') === createHmac('sha256', k).update('nonce-1').digest('hex'));

// clean haul: no alerts at all
{ const s = fresh(); const x = s.sendTruck('G1'); until(s, () => x.state === 'gone'); s.runTo(s.t + 5); check('honest haul raises nothing', s.gov.alerts.length === 0, titles(s)); check('honest haul delivered', s.gov.trips.get(x.device!.id)!.status === 'Delivered'); }
for (const g of ['G2', 'G3'] as const) { const s = fresh(); const x = s.sendTruck(g); until(s, () => x.state === 'gone'); s.runTo(s.t + 5); check('honest haul via ' + g, s.gov.alerts.length === 0 && s.gov.trips.get(x.device!.id)!.status === 'Delivered', titles(s) + ' ' + s.gov.trips.get(x.device!.id)!.status); }

const cases: [string, (s: Sim) => string, string, ('approve' | 'ignore')?][] = [
  ['jam', (s) => inside(s).uid, 'went silent'],
  ['open', (s) => inside(s).uid, 'housing opened'],
  ['spoof', (s) => inside(s).uid, 'false position'],
  ['power', (s) => inside(s).uid, 'power cut'],
  ['understate', (s) => loaded(s).uid, 'disagree'],
  ['roadload', (s) => inside(s).uid, 'Weight changed'],
  ['move', (s) => inside(s).uid, 'Device and plate do not match'],
  ['road', (s) => inside(s).uid, 'Late or off route'],
  ['repeat', (s) => inside(s).uid, 'Second entry refused'],
  ['wrongexit', (s) => loaded(s).uid, 'wrong exit'],
  ['noarrive', (s) => loaded(s).uid, 'never arrived'],
  ['nozone', () => '', 'No entry record'],
  ['fake', () => '', 'Fake device rejected'],
  ['stuck', () => '', 'left open'],
  ['tower', () => '', 'lost its view'],
  ['sneak', () => '', 'Drones count more'],
  ['leaveopen', () => '', 'Drones count fewer'],
];
for (const [kind, setup, title, auto] of cases) {
  const s = fresh(auto ?? 'approve'); const uid = setup(s); const from = s.gov.alerts.length;
  const r = s.attack(kind, uid);
  const got = r.ok && until(s, () => has(s, title, from), kind === 'sneak' || kind === 'leaveopen' ? 130 : 45);
  check(`${kind} -> ${title}`, got, r.msg + ' | ' + titles(s, from));
  s.runTo(s.t + 20); console.log('     then:', titles(s, from));
}
// held truck never gets out after tamper / jam
{ const s = fresh(); const x = inside(s); s.attack('open', x.uid); s.runTo(s.t + 30); check('opened device truck held at next gate', x.state === 'held', x.state + ' ' + x.at + ' | ' + titles(s)); }
// skim
{ const s = fresh(); s.attack('skim'); check('slow skim', until(s, () => has(s, 'Paper runs a little short'), 60), titles(s)); }
// gate stuck -> backup -> hand reopen -> secure reopen
{ const s = fresh(); s.attack('stuck'); until(s, () => s.gates.G3.mode === 'backup', 20); check('backup gate closes after two approvals', s.gates.G3.mode === 'backup');
  const h = s.attack('hand'); check('hand reopen refused', h.ok && s.gates.G3.mode === 'backup'); s.attack('reopen'); s.runTo(s.t + 1); check('secure reopen', s.gates.G3.mode === 'normal'); }
// two officers
{ const s = fresh(null); s.attack('stuck'); until(s, () => s.gov.proposals.length > 0, 20); const p = s.gov.proposals[0];
  s.gov.approve(p.id, 'Officer A'); check('one signature is not enough', p.state === 'pending' && s.gates.G3.mode === 'stuck');
  check('same officer cannot sign twice', !s.gov.approve(p.id, 'Officer A') && p.state === 'pending');
  s.gov.override(p.id, 'Officer A'); check('override blocked', has(s, 'Single-officer override blocked') && s.gates.G3.mode === 'stuck');
  s.runTo(s.t + 11); check('proposal expires as not acted', p.state === 'expired' && s.gov.counts.notActed === 1); }
// network cut
{ const s = fresh(); s.attack('net'); s.runTo(s.t + 2); const x = s.sendTruck('G1'); s.runTo(s.t + 5); check('offline gate still decides', !!s.gov.trips.get(x.device!.id)?.inside); const q = s.gov.queued.length; check('offline records held', q > 0); s.attack('net'); check('held records synced', s.gov.queued.length === 0 && s.gov.log.verify().ok && has(s, 'Gate link lost')); }
// log tamper
{ const s = new Sim(3); s.autoDecide = () => 'approve'; s.runTo(45); check('log verifies', s.gov.log.verify().ok);
  const i = s.gov.log.entries.findIndex((e) => e.kind === 'ALERT'); const old = s.gov.log.entries[i].text; s.gov.log.edit(i, 'nothing happened'); const v = s.gov.log.verify(); check('edit detected at entry', !v.ok && v.broken === i);
  s.gov.log.rewriteFrom(i); const w = s.gov.log.verify(); check('rewrite caught by anchors', !w.ok && !!w.anchor, JSON.stringify(w)); check('old text existed', old.length > 0); }
// weather
{ const s = fresh(); s.setWeather('monsoon'); until(s, () => s.gov.alerts.some((a) => a.title.includes('radar') || a.title.includes('Radar sees')) || s.gov.rounds.some((r) => r.verdict === 'missed'), 65); check('cloud: round missed', s.gov.rounds.some((r) => r.verdict === 'missed')); s.attack('sneak'); until(s, () => has(s, 'Radar sees'), 80); check('radar backup sees it', has(s, 'Radar sees') || s.gov.proposals.some((p) => p.kind === 'radar'), titles(s)); }
// permit
{ const s = fresh(); s.gov.setCap(50); s.sendTruck('G1'); s.at(0.5, () => s.sendTruck('G2')); until(s, () => has(s, 'Permit quantity exceeded'), 40); check('permit exceeded', has(s, 'Permit quantity exceeded'), titles(s)); const y = s.sendTruck('G1'); s.runTo(s.t + 4); check('entry refused beyond permit', has(s, 'entry refused') && !s.gov.trips.get(y.device!.id)); }
// drone rules over many hours and seeds
{ let bad = '', pulled = 0; for (let seed = 1; seed <= 150; seed++) { const s = new Sim(seed, false);
    for (let t = 0; t < 480; t++) { s.scheduler.ensure(Math.floor(t / 60)); if (t % 23 === 5) { s.scheduler.onAlert(t, { x: 0, z: 0 }, 0); pulled++; } for (let r; (r = s.scheduler.due(t));) r.status = 'done'; }
    for (let h = 0; h < 7; h++) { const rs = s.scheduler.rounds.filter((r) => r.hour === h); if (rs.length !== 2) bad += ` seed${seed}h${h}n${rs.length}`; }
    const ts = s.scheduler.rounds.map((r) => r.t).sort((a, b) => a - b); for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] < 5.99) { bad += ` seed${seed} gap ${(ts[i] - ts[i - 1]).toFixed(2)}`; break; }
    for (const r of s.scheduler.rounds) if (r.t < r.hour * 60 - 0.01 || r.t > (r.hour + 1) * 60 + 12) bad += ` seed${seed} time ${r.hour}:${r.t.toFixed(1)}`; }
  check('two rounds every hour, spaced', !bad, bad.slice(0, 400)); }
// every parked truck is counted by every round
{ let miss = 0, n = 0; for (let seed = 1; seed <= 25; seed++) { const s = new Sim(seed, false); s.autoDecide = () => 'approve'; s.runTo(130); for (const r of s.gov.rounds) { n++; if (r.verdict !== 'match') miss++; } } check(`quiet shifts always match (${n} rounds)`, miss === 0, 'mismatches ' + miss); }
// every intruder that waits through a round is found
{ let missed = 0; for (let seed = 1; seed <= 40; seed++) { const s = new Sim(seed, false); s.autoDecide = () => 'ignore'; s.intruder(150); s.runTo(125); if (!has(s, 'Drones count more')) missed++; } check('intruder found by rounds', missed === 0, 'missed ' + missed); }
// scripted story across seeds
for (const seed of [20261125]) { const a = new Sim(seed); a.autoDecide = () => 'approve'; a.runTo(100); const b = new Sim(seed); b.autoDecide = () => 'ignore'; b.runTo(100);
  check('story: swap refused', has(a, 'Swap attempt')); check('story: paper mismatch', has(a, 'Dispatch note')); check('story: ghost refused', has(a, 'Unregistered vehicle'));
  check('story: drones 15 v 14', a.gov.rounds.some((r) => r.expected === 14 && r.counted === 15)); check('story: approve -> no pile gap', !has(a, 'Ore missing'));
  check('story: ignore -> pile gap', (b.gov.piles.get('S2')!.gap > b.gov.piles.get('S2')!.band) && has(b, 'Ore missing')); }
console.log(`\n${passes} passed, ${fails} failed`);
