import { Sim } from '../src/engine/sim';
import { clock } from '../src/engine/util';
const mode = (process as any).argv[2] ?? 'approve';
const s = new Sim();
s.autoDecide = (p) => (mode === 'ignore' ? 'ignore' : 'approve');
let ai = 0, pi = 0;
const flush = () => {
  for (; ai < s.gov.alerts.length; ai++) { const a = s.gov.alerts[ai]; console.log(clock(a.t), (a.t).toFixed(1).padStart(6), a.sev.padEnd(4), a.title, '|', a.subject); }
};
for (let t = 1; t <= 120; t++) { s.runTo(t); flush(); }
console.log('ROUNDS'); for (const r of s.gov.rounds) console.log(' ', r.t.toFixed(1), r.id, r.verdict, 'exp', r.expected, 'cnt', r.counted);
console.log('SCHEDULE', s.scheduler.rounds.map((r) => r.t.toFixed(1) + (r.trigger === 'alert' ? '*' : '')).join(' '));
console.log('TRIPS'); for (const x of s.gov.history.filter((h) => !h.atStart)) console.log(' ', x.device, x.gate, x.tEntry.toFixed(1), 'out', x.tExit?.toFixed(1), 'dest', x.tDest?.toFixed(1), x.sensorNet?.toFixed(1), x.paperNet, x.exitNet?.toFixed(1), x.destNet?.toFixed(1), x.flag, x.status);
console.log('PILES', [...s.gov.piles].map(([k, p]) => k + ':' + p.gap.toFixed(0) + '±' + p.band.toFixed(0)).join(' '));
console.log('counts', s.gov.counts, 'log', s.gov.log.entries.length, s.gov.log.verify().ok, s.gov.permit());
for (const v of s.vehicles.filter((v) => !v.uid.startsWith('B'))) console.log(v.uid, v.state, v.pos.x.toFixed(0), v.pos.z.toFixed(0), 'load', v.load.toFixed(1), v.intercepted);
