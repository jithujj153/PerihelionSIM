export type Vec = { x: number; z: number };
export const v = (x: number, z: number): Vec => ({ x, z });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
export const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t * 60 + 1e-6));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
/** Time of day shown to the audience: the shift starts at 09:00. */
export const hhmm = (t: number) => {
  const m = Math.floor(540 + Math.max(0, t) + 1e-6);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  /** symmetric noise in [-amp, amp] */
  noise(amp: number) { return (this.next() - 0.5) * 2 * amp; }
  int(n: number) { return Math.floor(this.next() * n); }
}

export function pathLength(p: Vec[]): number { let l = 0; for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]); return l; }

/** Point and heading at distance d along a polyline. */
export function along(p: Vec[], d: number): { pos: Vec; heading: number } {
  if (p.length === 1) return { pos: p[0], heading: 0 };
  let left = Math.max(0, d);
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], l = dist(a, b);
    if (left <= l || i === p.length - 1) {
      const u = l ? Math.min(1, left / l) : 1;
      return { pos: v(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u), heading: Math.atan2(b.x - a.x, b.z - a.z) };
    }
    left -= l;
  }
  return { pos: p[p.length - 1], heading: 0 };
}

/** Catmull-Rom smoothing that passes through every control point. */
export function smooth(pts: Vec[], step = 14): Vec[] {
  if (pts.length < 3) return pts.slice();
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(1, Math.round(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push(v(c(p0.x, p1.x, p2.x, p3.x), c(p0.z, p1.z, p2.z, p3.z)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function inPoly(p: Vec, poly: Vec[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

export function segDist(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz, t = l ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}
