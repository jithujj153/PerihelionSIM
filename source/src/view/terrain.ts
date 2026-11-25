/* The ground: report-based quarry levels, haul roads, forest. y = elevation - 960 m. */
import * as THREE from 'three';
import { DUMPS, LEASE, NODES, PICKUP_ZONE, QUARRIES, ROADS, TRACKS, PILES, DOCK, CONTROL_ROOM, PLANT } from '../engine/layout';
import { dist, inPoly, Rng, Vec } from '../engine/util';

export const X0 = -2700, X1 = 3200, Z0 = -3300, Z1 = 2600;
const clamp = (a: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, a));
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (x: number, y: number) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}
const base = (x: number, z: number) => {
  const far = sstep(1500, 3000, Math.hypot(x - 100, z + 200));
  return (noise(x / 620 + 7, z / 620 + 3) - 0.5) * 34 + (noise(x / 170, z / 170) - 0.5) * 9 + far * (noise(x / 900 + 11, z / 900) * 150 - 25);
};
function boxDist(x: number, z: number, b: { x0: number; x1: number; z0: number; z1: number }, r: number) {
  const dx = Math.max(b.x0 + r - x, x - (b.x1 - r)), dz = Math.max(b.z0 + r - z, z - (b.z1 - r));
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - r;
}
export function segDist(x: number, z: number, a: Vec, b: Vec) {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz, t = l ? clamp(((x - a.x) * dx + (z - a.z) * dz) / l) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
export function polyDist(p: Vec, poly: Vec[]) { let d = 1e9; for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p.x, p.z, poly[i], poly[(i + 1) % poly.length])); return d; }

/** Ground without roads or pads. */
function raw(x: number, z: number): number {
  let h = base(x, z);
  for (const q of QUARRIES) {
    const wob = (noise(x / 90 + 31, z / 90) - 0.5) * 30;
    const d = boxDist(x, z, q, 130) + wob, rim = q.top - 960, floor = q.floor - 960;
    if (d > 0) h = h + (rim - h) * (1 - sstep(0, 270, d));
    else {
      const k = -d / 21, step = Math.floor(k) + sstep(0.72, 0.98, k - Math.floor(k));
      h = Math.max(floor, rim - step * 10);
    }
  }
  for (const p of DUMPS) {
    const d = boxDist(x, z, p, Math.min(60, (p.x1 - p.x0) / 3));
    if (d < 40) { const t = sstep(40, -50, d); h += p.h * (Math.floor(t * 3) + sstep(0.5, 0.95, (t * 3) % 1)) / 3.3; }
  }
  return h;
}

interface Sample { x: number; z: number; h: number; w: number }
const CELL = 60;
const grid = new Map<string, Sample[]>();
function addSample(s: Sample) { const k = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(s); }
function buildProfiles() {
  const run = (path: Vec[], half: number) => {
    const pts: Vec[] = [];
    for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(dist(a, b) / 8)); for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n }); }
    pts.push(path[path.length - 1]);
    const hs = pts.map((p) => raw(p.x, p.z));
    for (let pass = 0; pass < 3; pass++) { const c = hs.slice(); for (let i = 0; i < hs.length; i++) { let s = 0, n = 0; for (let k = -12; k <= 12; k++) { const j = Math.min(hs.length - 1, Math.max(0, i + k)); s += c[j]; n++; } hs[i] = s / n; } }
    pts.forEach((p, i) => addSample({ x: p.x, z: p.z, h: hs[i], w: half }));
  };
  ROADS.forEach((r) => run(r, 13));
  TRACKS.forEach((r) => run(r, 6));
}
export function roadInfo(x: number, z: number): { d: number; h: number; w: number } {
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  let d = 1e9, h = 0, w = 0, sh = 0, sw = 0;
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const s of grid.get(`${i},${j}`) ?? []) {
    const q = Math.hypot(x - s.x, z - s.z);
    if (q - s.w < d - w) { d = q; w = s.w; h = s.h; }
    if (q < 40) { const k = 1 / (q * q + 20); sh += s.h * k; sw += k; }
  }
  return { d, h: sw ? sh / sw : h, w };
}
let zoneH = 0;
const PADS: { p: Vec; r: number; h: number }[] = [];
export function height(x: number, z: number): number {
  let h = raw(x, z);
  const p = { x, z };
  // the loading zone and yard are levelled
  if (x > 280 && x < 1030 && z > -420 && z < 280) { const d = inPoly(p, PICKUP_ZONE) ? 0 : polyDist(p, PICKUP_ZONE); h += (zoneH - h) * sstep(80, 5, d); }
  for (const pad of PADS) { const d = Math.hypot(x - pad.p.x, z - pad.p.z); if (d < pad.r * 2) h += (pad.h - h) * sstep(pad.r * 2, pad.r, d); }
  const r = roadInfo(x, z);
  if (r.d < r.w + 30) h += (r.h - h) * sstep(r.w + 30, r.w, r.d);
  return h;
}
function init() {
  zoneH = raw(640, -60) * 0.4;
  for (const [p, r] of [[NODES.G1.pos, 40], [NODES.G2.pos, 40], [NODES.G3.pos, 40], [NODES.G4.pos, 40], [NODES.DEST.pos, 70], [DOCK, 60], [CONTROL_ROOM, 55], [PLANT, 50]] as const) PADS.push({ p, r, h: raw(p.x, p.z) * 0.6 });
  buildProfiles();
}
init();

const C = (n: number) => new THREE.Color(n);
const COL = { forest: C(0x38582a), forest2: C(0x536f34), scrub: C(0x7d7a45), soil: C(0xa25a3a), soil2: C(0x8a4a33), ore: C(0x74352a), ore2: C(0x4f2a26), rock: C(0x6a5248), dump: C(0x8c6a4c), road: C(0xb98a67), yard: C(0x96634f), track: C(0x96744f) };

export function disturbed(x: number, z: number): number {
  let m = 0;
  for (const q of QUARRIES) m = Math.max(m, sstep(110, 10, boxDist(x, z, q, 130) + (noise(x / 60, z / 60) - 0.5) * 70));
  for (const q of DUMPS) m = Math.max(m, sstep(50, 0, boxDist(x, z, q, 40) + (noise(x / 50, z / 50) - 0.5) * 50));
  if (x > 180 && x < 1560 && z > -540 && z < 380) { const p = { x, z }; const d = inPoly(p, PICKUP_ZONE) ? 0 : polyDist(p, PICKUP_ZONE); m = Math.max(m, sstep(90, 0, d + (noise(x / 40, z / 40) - 0.5) * 60)); }
  for (const pad of PADS) m = Math.max(m, sstep(pad.r * 1.7, pad.r, Math.hypot(x - pad.p.x, z - pad.p.z)));
  return m;
}
const tmp = new THREE.Color();
function groundColor(x: number, z: number, h: number, slope: number, out: THREE.Color) {
  const n = noise(x / 45, z / 45), n2 = noise(x / 13 + 5, z / 13);
  out.copy(COL.forest).lerp(COL.forest2, n);
  if (n > 0.72) out.lerp(COL.scrub, (n - 0.72) * 2.2);
  const m = disturbed(x, z);
  if (m > 0) {
    tmp.copy(COL.soil).lerp(COL.soil2, n);
    for (const q of QUARRIES) if (boxDist(x, z, q, 130) < 15) { tmp.copy(COL.ore).lerp(COL.ore2, noise(x / 30, (z + h * 6) / 30)); if (slope < 0.25) tmp.lerp(COL.soil, 0.35); }
    for (const q of DUMPS) if (boxDist(x, z, q, 40) < 15) tmp.copy(COL.dump).lerp(COL.rock, n);
    if (x > 360 && x < 950 && z > -330 && z < 200) tmp.lerp(COL.yard, 0.6);
    out.lerp(tmp, m);
  }
  if (slope > 0.55) out.lerp(COL.rock, clamp((slope - 0.55) * 1.6) * (0.35 + 0.65 * m));
  const r = roadInfo(x, z);
  if (r.d < r.w + 12) out.lerp(r.w > 8 ? COL.road : COL.track, sstep(r.w + 12, r.w - 3, r.d) * (r.w > 8 ? 0.85 : 0.65));
  out.multiplyScalar(0.9 + n2 * 0.2);
}

function patch(x0: number, x1: number, z0: number, z1: number, step: number, skip: ((x: number, z: number) => boolean) | null, mat: THREE.Material) {
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3);
  // one extra ring of samples, so neighbouring tiles shade without a seam
  const w = nx + 2, hs = new Float32Array(w * (nz + 2));
  for (let j = -1; j <= nz; j++) for (let i = -1; i <= nx; i++) hs[(j + 1) * w + i + 1] = height(x0 + i * step, z0 + j * step);
  const at = (i: number, j: number) => hs[(j + 1) * w + i + 1];
  const c = new THREE.Color(), n = new THREE.Vector3();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * step, z = z0 + j * step;
    const y = at(i, j);
    pos.set([x, y, z], k * 3);
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
    groundColor(x, z, y, Math.hypot(gx, gz), c);
    col.set([c.r, c.g, c.b], k * 3);
    n.set(-gx, 1, -gz).normalize(); nor.set([n.x, n.y, n.z], k * 3);
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (skip && skip(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  if (!idx.length) return null;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.matrixAutoUpdate = false;
  return m;
}

/** Flat ribbon that follows the ground. */
export function ribbon(path: Vec[], width: number, lift: number, mat: THREE.Material, step = 8) {
  const pts: Vec[] = [];
  for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(dist(a, b) / step)); for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n }); }
  pts.push(path[path.length - 1]);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let run = 0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    if (i) run += dist(pts[i - 1], p);
    for (const s of [-1, 1]) { const x = p.x + (nx * s * width) / 2, z = p.z + (nz * s * width) / 2; pos.push(x, height(x, z) + lift, z); uv.push(s < 0 ? 0 : 1, run / width); }
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  if ((mat as THREE.MeshBasicMaterial).side !== THREE.DoubleSide) (mat as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  return m;
}

function roadTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!, r = new Rng(5);
  g.fillStyle = '#a97a5c'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1500; i++) { g.fillStyle = r.next() < 0.5 ? 'rgba(70,40,28,.22)' : 'rgba(230,190,150,.16)'; g.fillRect(r.next() * 128, r.next() * 128, 1 + r.next() * 3, 1 + r.next() * 3); }
  g.fillStyle = 'rgba(70,42,30,.35)'; for (const x of [28, 44, 80, 96]) g.fillRect(x, 0, 7, 128);
  const e = g.createLinearGradient(0, 0, 128, 0); e.addColorStop(0, 'rgba(120,90,55,.9)'); e.addColorStop(0.12, 'rgba(120,90,55,0)'); e.addColorStop(0.88, 'rgba(120,90,55,0)'); e.addColorStop(1, 'rgba(120,90,55,.9)'); g.fillStyle = e; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildTerrain() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const S = 15;
  const snap = (a: number, o: number) => o + Math.round((a - o) / S) * S;
  const fine = QUARRIES.map((q) => ({ x0: snap(q.x0 - 60, X0), x1: snap(q.x1 + 60, X0), z0: snap(q.z0 - 60, Z0), z1: snap(q.z1 + 60, Z0) }));
  const x1 = snap(X1, X0), z1 = snap(Z1, Z0);
  // tiles let the graphics card skip ground that is out of view
  const T = S * 60, inFine = (x: number, z: number) => fine.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  for (let x = X0; x < x1; x += T) for (let z = Z0; z < z1; z += T) { const m = patch(x, Math.min(x1, x + T), z, Math.min(z1, z + T), S, inFine, mat); if (m) group.add(m); }
  for (const b of fine) group.add(patch(b.x0, b.x1, b.z0, b.z1, 5, null, mat)!);
  // distant ground so the horizon is never empty
  const far = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: 0x3d5a30 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -110; group.add(far);
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const r of ROADS) group.add(ribbon(r, 17, 0.35, roadMat));
  const trackMat = new THREE.MeshLambertMaterial({ color: 0x8f6a48, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  for (const r of TRACKS) group.add(ribbon(r, 7, 0.3, trackMat));
  return group;
}

/** Instanced forest. Count follows the quality setting. */
export function buildTrees(max: number) {
  const r = new Rng(99), spots: { x: number; z: number; s: number; kind: number; tint: number }[] = [];
  const clear = (x: number, z: number) => {
    if (disturbed(x, z) > 0.15) return false;
    const road = roadInfo(x, z); if (road.d < road.w + 15) return false;
    for (const p of PILES) if (Math.hypot(x - p.pos.x, z - p.pos.z) < p.radius + 30) return false;
    return true;
  };
  let guard = 0;
  while (spots.length < max && guard++ < max * 6) {
    // denser where the cameras go
    const near = r.next() < 0.62;
    const x = near ? r.range(-1850, 2500) : r.range(X0, X1), z = near ? r.range(-1500, 2000) : r.range(Z0, Z1);
    if (noise(x / 140 + 2, z / 140) < 0.3 || !clear(x, z)) continue;
    spots.push({ x, z, s: r.range(0.55, 1.12), kind: r.next() < 0.7 ? 0 : 1, tint: r.next() });
  }
  const group = new THREE.Group();
  const crownA = new THREE.IcosahedronGeometry(5.2, 0); crownA.scale(1, 1.15, 1); crownA.translate(0, 7.4, 0);
  const crownB = new THREE.ConeGeometry(3.8, 12, 6); crownB.translate(0, 8.4, 0);
  const trunk = new THREE.CylinderGeometry(0.5, 0.8, 4.4, 5); trunk.translate(0, 2.2, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const leaf = new THREE.MeshLambertMaterial({ flatShading: true }), bark = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
  const cells = new Map<string, typeof spots>();
  for (const s of spots) { const k = `${Math.floor(s.x / 1200)},${Math.floor(s.z / 1200)}`; const list = cells.get(k); if (list) list.push(s); else cells.set(k, [s]); }
  for (const list of cells.values()) {
    const crowns = [crownA, crownB].map((g, k) => new THREE.InstancedMesh(g, leaf, Math.max(1, list.filter((s) => s.kind === k).length)));
    const trunks = new THREE.InstancedMesh(trunk, bark, list.length);
    const idx = [0, 0];
    list.forEach((s, i) => {
      const y = height(s.x, s.z) - 0.6;
      q.setFromAxisAngle(up, s.tint * 6.28);
      m.compose(new THREE.Vector3(s.x, y, s.z), q, new THREE.Vector3(s.s, s.s * (0.85 + s.tint * 0.4), s.s));
      trunks.setMatrixAt(i, m);
      c.setHSL(0.24 + s.tint * 0.09, 0.42 + s.tint * 0.12, 0.2 + s.tint * 0.12);
      crowns[s.kind].setMatrixAt(idx[s.kind], m); crowns[s.kind].setColorAt(idx[s.kind]++, c);
    });
    crowns.forEach((x, k) => { if (!idx[k]) return; x.castShadow = true; x.computeBoundingSphere(); group.add(x); });
    trunks.computeBoundingSphere(); group.add(trunks);
  }
  return group;
}
export { LEASE };
