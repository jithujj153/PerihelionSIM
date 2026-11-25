import { along, dist, inPoly, pathLength, Rng, v, Vec } from './util';
import { DOCK, LEASE, SWEEPS, ZONE_IDS, zoneOf, ZoneId } from './layout';

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

/**
 * A new route for every round. Each zone's coverage loop (every place a truck can drive) is cut into
 * pieces that are flown in a random order and direction, with a wandering offset well inside the camera
 * swath and a detour over open ground when there is time. The route cannot be predicted, nothing
 * drivable is skipped, and a length budget keeps the drone's speed close to that of one plain loop.
 */
export function planSweep(rng: Rng, spot: Vec | null): ZoneFlight[] {
  return ZONE_IDS.map((zone) => {
    const L = pathLength(SWEEPS[zone]), budget = L * ROUTE_BUDGET;
    let best: ZoneFlight | null = null;
    // draw routes until one fits the budget; otherwise fly the shortest drawn
    for (let attempt = 0; attempt < 60; attempt++) {
      const path = drawRoute(rng, zone, spot), length = pathLength(path);
      if (!best || length < best.length) best = { zone, path, length };
      if (length <= budget) break;
    }
    return best!;
  });
}
export const ROUTE_BUDGET = 1.3;
function drawRoute(rng: Rng, zone: ZoneId, spot: Vec | null): Vec[] {
  const loop = SWEEPS[zone], L = pathLength(loop), n = Math.ceil(L / 40);
  const base = Array.from({ length: n }, (_, i) => along(loop, (L * i) / n).pos);
  // cut the loop at random places
  const count = 3 + rng.int(2), first = rng.int(n), cuts = [0];
  for (let k = 1; k < count; k++) cuts.push(Math.round(((k + rng.noise(0.3)) * n) / count));
  cuts.push(n);
  const left = cuts.slice(1).map((end, k) => Array.from({ length: end - cuts[k] + 1 }, (_, i) => base[(first + cuts[k] + i) % n]));
  const pieces: Vec[][] = [];
  // start with the alerted spot's piece, or any piece
  if (spot && zoneOf(spot) === zone) {
    let pi = 0, at = 0, bd = Infinity;
    left.forEach((p, i) => p.forEach((q, k) => { const d = dist(q, spot); if (d < bd) { bd = d; pi = i; at = k; } }));
    const [p] = left.splice(pi, 1);
    pieces.push(p.slice(at), p.slice(0, at + 1).reverse());
  } else {
    const [p] = left.splice(rng.int(left.length), 1);
    pieces.push(rng.next() < 0.5 ? p.reverse() : p);
  }
  // then hop to one of the two nearest unflown ends
  while (left.length) {
    const from = pieces[pieces.length - 1], here = from[from.length - 1];
    const ends = left.flatMap((p, i) => [{ i, flip: false, d: dist(here, p[0]) }, { i, flip: true, d: dist(here, p[p.length - 1]) }]).sort((x, y) => x.d - y.d);
    const pick = ends[rng.int(Math.min(2, ends.length))], [p] = left.splice(pick.i, 1);
    pieces.push(pick.flip ? p.reverse() : p);
  }
  const path: Vec[] = [], detourAfter = rng.int(pieces.length);
  pieces.forEach((p, i) => {
    // weave from side to side, never far enough to lose sight of the road below
    const amp = rng.range(25, 55) * (rng.next() < 0.5 ? -1 : 1), waves = rng.range(1, 2.5), m = p.length - 1;
    p.forEach((q, k) => {
      const a = p[Math.max(0, k - 1)], b = p[Math.min(m, k + 1)], d = dist(a, b) || 1, off = m ? amp * Math.sin((k / m) * Math.PI * waves) : 0;
      path.push(v(q.x - ((b.z - a.z) / d) * off, q.z + ((b.x - a.x) / d) * off));
    });
    // a detour over open ground
    if (i === detourAfter && i < pieces.length - 1) { const d = openGround(rng, zone, p[m]); if (d) path.push(d); }
  });
  return path;
}
/** A point in the same zone and inside the lease, away from where the drone is. */
function openGround(rng: Rng, zone: ZoneId, from: Vec): Vec | null {
  for (let i = 0; i < 12; i++) {
    const p = v(from.x + rng.noise(380), from.z + rng.noise(380));
    if (zoneOf(p) === zone && inPoly(p, LEASE) && dist(p, from) > 150) return p;
  }
  return null;
}
export function sweepPosition(f: ZoneFlight, elapsed: number): { pos: Vec; heading: number; alt: number; scanning: boolean } {
  const start = f.path[0], end = f.path[f.path.length - 1];
  const lerp = (a: Vec, b: Vec, u: number) => v(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u);
  if (elapsed < TRANSIT_MIN) { const u = elapsed / TRANSIT_MIN; return { pos: lerp(DOCK, start, u), heading: Math.atan2(start.x - DOCK.x, start.z - DOCK.z), alt: 15 + 85 * Math.min(1, u * 3), scanning: false }; }
  if (elapsed < TRANSIT_MIN + SWEEP_MIN) { const a = along(f.path, (f.length * (elapsed - TRANSIT_MIN)) / SWEEP_MIN); return { ...a, alt: 100, scanning: true }; }
  const u = Math.min(1, (elapsed - TRANSIT_MIN - SWEEP_MIN) / TRANSIT_MIN);
  return { pos: lerp(end, DOCK, u), heading: Math.atan2(DOCK.x - end.x, DOCK.z - end.z), alt: 100 - 85 * Math.max(0, u * 3 - 2), scanning: false };
}
