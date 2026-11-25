import { along, dist, pathLength, Rng, v, Vec } from './util';
import { DOCK, SWEEPS, ZONE_IDS, zoneOf, ZoneId } from './layout';

export const SWEEP_MIN = 5, TRANSIT_MIN = 0.5, ROUND_MIN = SWEEP_MIN + 2 * TRANSIT_MIN;
export const SWATH_RADIUS = 115; // metres either side of the drone (assumed camera swath)

export interface Round {
  id: number; hour: number; t: number; status: 'pending' | 'flying' | 'done' | 'missed';
  trigger: 'random' | 'alert'; pulled: boolean; spot: Vec | null;
}
/**
 * Exactly two counting rounds per clock hour. Times are drawn afresh each hour.
 * Alerts reshape the pattern but never add a round.
 */
export class RoundScheduler {
  rounds: Round[] = [];
  private drawn = new Map<number, [number, number]>();
  private n = 0;
  constructor(private rng: Rng) {}
  private lastBefore(hour: number) { return Math.max(-99, ...this.rounds.filter((r) => r.hour < hour).map((r) => r.t)); }
  ensure(hour: number) {
    if (this.drawn.has(hour)) return;
    if (hour > 0) this.ensure(hour - 1);
    const prev = this.drawn.get(hour - 1), base = hour * 60;
    let a = 0, b = 0;
    for (;;) {
      const x = this.rng.range(hour === 0 ? 3 : 0, 60), y = this.rng.range(hour === 0 ? 3 : 0, 60 - 0.01);
      [a, b] = x < y ? [x, y] : [y, x];
      if (b - a < ROUND_MIN) continue;
      if (base + a - this.lastBefore(hour) < ROUND_MIN) continue;
      if (prev && Math.abs(a - prev[0]) < 5 && Math.abs(b - prev[1]) < 5) continue;
      break;
    }
    this.drawn.set(hour, [a, b]);
    for (const m of [a, b]) this.rounds.push({ id: ++this.n, hour, t: base + m, status: 'pending', trigger: 'random', pulled: false, spot: null });
  }
  private of(hour: number) { return this.rounds.filter((r) => r.hour === hour).sort((x, y) => x.t - y.t); }
  private lastFlown() { return Math.max(-99, ...this.rounds.filter((r) => r.status !== 'pending').map((r) => r.t)); }
  /** Rounds never overlap: push a pending round back if an earlier one is still in the air. */
  private space() {
    let prev = -99;
    for (const r of [...this.rounds].sort((a, b) => a.t - b.t)) { if (r.status === 'pending' && r.t < prev + ROUND_MIN) r.t = prev + ROUND_MIN; prev = r.t; }
  }
  /** Returns a sentence describing what changed (for the log). */
  onAlert(t: number, pos: Vec, busyUntil = 0): string {
    const h = Math.floor(t / 60); this.ensure(h); this.ensure(h + 1);
    const open = this.of(h).filter((r) => r.status === 'pending');
    const earliest = Math.max(t + 0.3, busyUntil, this.lastFlown() + ROUND_MIN);
    let msg: string;
    if (open.length >= 2) {
      const [first, second] = open;
      if (!first.pulled && earliest < first.t && earliest + ROUND_MIN < (h + 1) * 60) {
        first.t = earliest; first.pulled = true; first.trigger = 'alert'; first.spot = pos;
        if (second.t < first.t + ROUND_MIN) second.t = first.t + ROUND_MIN;
        msg = earliest - t < 0.5 ? 'One counting round is flying now, starting at the alerted spot; the other keeps its secret time.'
          : 'One counting round comes forward to the moment the drones are free, starting at the alerted spot; the other keeps its secret time.';
      } else { for (const r of open) r.spot = pos; msg = 'Counting times are unchanged; the next paths start at the alerted spot.'; }
    } else if (open.length) {
      open[0].spot = pos; msg = 'The remaining counting round keeps its secret time; its path now starts at the alerted spot.';
    } else {
      const next = this.of(h + 1).filter((r) => r.status === 'pending');
      if (next.length < 2 || next[0].pulled) msg = 'The next round already starts at an alerted spot.';
      else {
        const [first, second] = next, start = (h + 1) * 60;
        if (first.t > start + 15) first.t = Math.max(start + this.rng.range(0.3, 15), earliest);
        first.pulled = true; first.trigger = 'alert'; first.spot = pos;
        if (second.t < first.t + ROUND_MIN) second.t = first.t + ROUND_MIN;
        msg = 'Both rounds this hour are flown; the next hour’s first round comes early and starts at the alerted spot.';
      }
    }
    this.space();
    return msg;
  }
  due(t: number): Round | undefined {
    this.ensure(Math.floor(t / 60));
    return this.rounds.find((r) => r.status === 'pending' && r.t <= t);
  }
}

export interface Drone { id: ZoneId | 'F'; pos: Vec; alt: number; active: boolean; heading: number; scanning: boolean }
export interface ZoneFlight { zone: ZoneId; path: Vec[]; length: number }

export function planSweep(rng: Rng, spot: Vec | null): ZoneFlight[] {
  return ZONE_IDS.map((zone) => {
    // densify the closed loop, then rotate it so that each round starts elsewhere and may run backwards
    const loop = SWEEPS[zone], L = pathLength(loop), n = Math.ceil(L / 40);
    let pts = Array.from({ length: n }, (_, i) => along(loop, (L * i) / n).pos);
    if (rng.next() < 0.5) pts = pts.reverse();
    let k = rng.int(n);
    if (spot && zoneOf(spot) === zone) k = pts.reduce((best, p, i) => (dist(p, spot) < dist(pts[best], spot) ? i : best), 0);
    const path = [...pts.slice(k), ...pts.slice(0, k), pts[k]];
    return { zone, path, length: pathLength(path) };
  });
}
export function sweepPosition(f: ZoneFlight, elapsed: number): { pos: Vec; heading: number; alt: number; scanning: boolean } {
  const start = f.path[0], end = f.path[f.path.length - 1];
  const lerp = (a: Vec, b: Vec, u: number) => v(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u);
  if (elapsed < TRANSIT_MIN) { const u = elapsed / TRANSIT_MIN; return { pos: lerp(DOCK, start, u), heading: Math.atan2(start.x - DOCK.x, start.z - DOCK.z), alt: 15 + 85 * Math.min(1, u * 3), scanning: false }; }
  if (elapsed < TRANSIT_MIN + SWEEP_MIN) { const a = along(f.path, (f.length * (elapsed - TRANSIT_MIN)) / SWEEP_MIN); return { ...a, alt: 100, scanning: true }; }
  const u = Math.min(1, (elapsed - TRANSIT_MIN - SWEEP_MIN) / TRANSIT_MIN);
  return { pos: lerp(end, DOCK, u), heading: Math.atan2(DOCK.x - end.x, DOCK.z - end.z), alt: 100 - 85 * Math.max(0, u * 3 - 2), scanning: false };
}
