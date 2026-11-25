import { Sim } from '../src/engine/sim';
const miss = new Map<string, number>();
let n = 0, bad = 0;
for (let seed = 1; seed <= 60; seed++) {
  const s = new Sim(seed, false); s.autoDecide = () => 'approve';
  for (let k = 0; k < 8; k++) s.at(1 + k * 14, () => s.sendTruck((['G1', 'G2', 'G3'] as const)[(k + seed) % 3]));
  const orig = s.gov.onRound.bind(s.gov);
  s.gov.onRound = (r) => { const res = orig(r); n++; if (res.missing.length || res.unmatched.length) { bad++; for (const d of res.missing) { const x = s.vehicles.find((v) => v.device?.id === d)!; const k = `${Math.round(x.pos.x / 100) * 100},${Math.round(x.pos.z / 100) * 100} ${x.state}`; miss.set(k, (miss.get(k) ?? 0) + 1); } if (res.unmatched.length) miss.set('UNMATCHED ' + res.unmatched[0].zone + ' ' + res.unmatched[0].device + ' ' + Math.round(res.unmatched[0].pos.x) + ',' + Math.round(res.unmatched[0].pos.z), 1); } return res; };
  s.runTo(130);
}
console.log(n, 'rounds', bad, 'bad'); console.log([...miss].sort((a, b) => b[1] - a[1]).slice(0, 60));
