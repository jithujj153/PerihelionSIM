/*
 * A tracked excavator with a jointed arm. The arm is solved so the bucket really reaches the
 * stockpile to dig and the truck bed to tip, and ore falls from the bucket into the truck.
 * Visual only: how much is loaded still comes from the engine.
 */
import * as THREE from 'three';
import { box, cyl, merged, oreMaterial, V_SCALE } from './models';

const L1 = 6.6, L2 = 5.3;          // boom and stick, local metres
const PIVOT = new THREE.Vector3(0.35, 2.4, 0.9); // boom foot above the ground
const TURRET_Y = 1.4, CYCLE = 3.2; // seconds per bucket
const Y = 0xf2a71b, Y2 = 0xd88f10, DARK = 0x23262a, STEEL = 0x8b929c, GLASS = 0x6aa7d6;

export interface Excavator {
  root: THREE.Group; turret: THREE.Group; boom: THREE.Group; stick: THREE.Group; bucket: THREE.Group;
  load: THREE.Mesh; ram: THREE.Mesh; rocks: THREE.Group; clock: number; now: Pose;
}
/** yaw, distance out and height of the bucket joint, and the bucket's angle (0 = level, negative = down). */
interface Pose { yaw: number; r: number; h: number; tip: number }

export function excavatorModel(): Excavator {
  const root = new THREE.Group(); root.scale.setScalar(V_SCALE);
  const base: THREE.BufferGeometry[] = [];
  for (const x of [-1.55, 1.55]) {
    base.push(box(0.85, 0.9, 4.4, x, 0.55, 0, DARK), cyl(0.55, 0.55, 0.9, x, 0.55, 2.2, DARK, 20, 'x'), cyl(0.55, 0.55, 0.9, x, 0.55, -2.2, DARK, 20, 'x'));
    for (const z of [2.2, -2.2]) base.push(cyl(0.27, 0.27, 0.98, x, 0.55, z, STEEL, 14, 'x'));
    for (const z of [-1.2, 0, 1.2]) base.push(cyl(0.2, 0.2, 0.96, x, 0.32, z, STEEL, 10, 'x'));
    for (let z = -2.2; z <= 2.21; z += 0.4) base.push(box(0.98, 0.09, 0.24, x, 1.08, z, 0x3b3f45), box(0.98, 0.09, 0.24, x, 0.03, z, 0x3b3f45));
  }
  base.push(box(2.3, 0.45, 2.5, 0, 0.95, 0, 0x33363a), cyl(1.15, 1.15, 0.24, 0, 1.28, 0, STEEL, 28));
  root.add(merged(base));
  const turret = new THREE.Group(); turret.position.y = TURRET_Y; root.add(turret);
  const body: THREE.BufferGeometry[] = [
    box(3.15, 0.32, 3.9, 0, 0.16, -0.35, Y2),
    box(3.05, 1.35, 1.65, 0, 1.0, -1.4, Y), box(3.2, 1.25, 0.5, 0, 0.93, -2.4, Y2), cyl(0.62, 0.62, 3.2, 0, 0.93, -2.6, Y2, 20, 'x'),
    box(1.15, 0.95, 1.75, 1.0, 0.8, 0.35, Y), box(1.18, 0.08, 1.3, 1.0, 1.32, 0.35, DARK),
    cyl(0.13, 0.13, 1.0, 1.05, 2.15, -1.5, DARK, 12), cyl(0.18, 0.18, 0.2, 1.05, 2.7, -1.5, STEEL, 12),
    // cab: sill, glass, posts, roof, beacon
    box(1.3, 0.55, 1.75, -0.95, 0.6, 0.55, Y), box(1.18, 1.4, 1.62, -0.95, 1.57, 0.55, GLASS),
    box(1.34, 0.16, 1.82, -0.95, 2.36, 0.55, Y), cyl(0.14, 0.14, 0.16, -0.95, 2.52, 0.2, 0xff6a2a, 10),
    box(3.0, 0.06, 0.06, 0, 2.05, -2.15, STEEL), box(0.06, 0.4, 0.06, 1.45, 1.85, -2.15, STEEL), box(0.06, 0.4, 0.06, -1.45, 1.85, -2.15, STEEL),
  ];
  for (const [x, z] of [[-1.55, 1.36], [-0.35, 1.36], [-1.55, -0.26], [-0.35, -0.26]]) body.push(box(0.1, 1.45, 0.1, x, 1.57, z, DARK));
  for (let z = -1.95; z <= -0.9; z += 0.26) body.push(box(0.05, 0.75, 0.09, 1.55, 1.05, z, DARK), box(0.05, 0.75, 0.09, -1.55, 1.05, z, DARK));
  turret.add(merged(body));

  const boom = new THREE.Group(); boom.position.set(PIVOT.x, PIVOT.y - TURRET_Y, PIVOT.z); turret.add(boom);
  const rise = 0.95, bend = L1 * 0.45, a = Math.hypot(rise, bend), b = Math.hypot(rise, L1 - bend);
  boom.add(merged([
    box(0.55, 0.72, a + 0.25, 0, rise / 2, bend / 2, Y, -Math.atan2(rise, bend)), box(0.55, 0.66, b + 0.25, 0, rise / 2, bend + (L1 - bend) / 2, Y, Math.atan2(rise, L1 - bend)),
    cyl(0.3, 0.3, 0.85, 0, 0, 0, STEEL, 16, 'x'), cyl(0.22, 0.22, 0.75, 0, 0, L1, STEEL, 16, 'x'), cyl(0.2, 0.2, 0.7, 0, rise + 0.2, bend, STEEL, 14, 'x'),
    cyl(0.11, 0.11, L1 * 0.42, 0, rise + 0.28, bend + L1 * 0.22, STEEL, 10, 'z'),
  ]));
  const stick = new THREE.Group(); stick.position.z = L1; boom.add(stick);
  stick.add(merged([box(0.42, 0.52, L2 + 0.2, 0, 0, L2 / 2, Y), box(0.38, 0.3, 1.1, 0, 0.36, -0.2, Y2), cyl(0.19, 0.19, 0.66, 0, 0, L2, STEEL, 14, 'x'), cyl(0.09, 0.09, L2 * 0.55, 0, 0.42, L2 * 0.55, STEEL, 10, 'z')]));
  const bucket = new THREE.Group(); bucket.position.z = L2; stick.add(bucket);
  const scoop: THREE.BufferGeometry[] = [
    box(1.75, 0.14, 1.15, 0, 0.48, 0.55, DARK, 0.12), box(1.75, 0.14, 1.45, 0, -0.42, 0.72, DARK, -0.18), box(1.75, 1.0, 0.16, 0, 0.02, 0.04, DARK),
    box(0.12, 0.95, 1.3, 0.87, 0.02, 0.68, Y2), box(0.12, 0.95, 1.3, -0.87, 0.02, 0.68, Y2),
  ];
  for (const x of [-0.66, -0.22, 0.22, 0.66]) scoop.push(box(0.16, 0.1, 0.45, x, -0.57, 1.6, STEEL, -0.18));
  bucket.add(merged(scoop));
  const load = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), oreMaterial()); load.scale.set(1.25, 0.6, 0.95); load.position.set(0, 0.02, 0.8); load.visible = false; bucket.add(load);
  // hydraulic ram, re-aimed every frame between the turret and the boom
  const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1, 10), new THREE.MeshLambertMaterial({ color: STEEL })); turret.add(ram);
  const rocks = new THREE.Group();
  const rock = new THREE.DodecahedronGeometry(0.75, 0);
  for (let i = 0; i < 22; i++) { const m = new THREE.Mesh(rock, oreMaterial()); m.visible = false; rocks.add(m); }
  return { root, turret, boom, stick, bucket, load, ram, rocks, clock: 0, now: { yaw: 0, r: 7, h: 3, tip: -1 } };
}

const shortest = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = (u: number) => u * u * (3 - 2 * u);
const _up = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3();

/** World point to the excavator's own yaw, reach and height. */
function local(x: Excavator, p: THREE.Vector3) {
  const dx = p.x - x.root.position.x, dz = p.z - x.root.position.z;
  return { yaw: Math.atan2(dx, dz) - x.root.rotation.y, r: Math.hypot(dx, dz) / V_SCALE, h: (p.y - x.root.position.y) / V_SCALE };
}

/** Two-link solution for the boom and stick, elbow up. */
function aim(x: Excavator, p: Pose) {
  x.turret.rotation.y = p.yaw;
  const r = p.r - PIVOT.z, h = p.h - PIVOT.y, d = Math.min(L1 + L2 - 0.05, Math.max(Math.abs(L1 - L2) + 0.1, Math.hypot(r, h)));
  const boomUp = Math.atan2(h, r) + Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d));
  const elbow = Math.acos((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2));
  const stickUp = boomUp - (Math.PI - elbow);
  x.boom.rotation.x = -boomUp; x.stick.rotation.x = Math.PI - elbow; x.bucket.rotation.x = -(p.tip - stickUp);
  // ram from the deck to a point part-way up the boom
  _a.set(PIVOT.x, 0.45, PIVOT.z + 1.15);
  _b.set(PIVOT.x, PIVOT.y - TURRET_Y + Math.sin(boomUp) * L1 * 0.4, PIVOT.z + Math.cos(boomUp) * L1 * 0.4);
  _m.subVectors(_b, _a); const len = _m.length();
  x.ram.position.copy(_a).addScaledVector(_m, 0.5); x.ram.scale.y = len; x.ram.quaternion.setFromUnitVectors(_up, _m.normalize());
}

/**
 * @param dig world point on the pile face
 * @param bed world point at the top of the waiting truck's bed, or null when no truck is loading
 */
export function updateExcavator(x: Excavator, dt: number, dig: THREE.Vector3, bed: THREE.Vector3 | null) {
  const pile = local(x, dig);
  let want: Pose = { yaw: pile.yaw, r: pile.r * 0.72, h: pile.h + 3.2, tip: -1.1 };
  let carrying = false, tipping = false;
  if (bed) {
    x.clock = (x.clock + dt / CYCLE) % 1;
    const t = local(x, bed), over = t.h + 2.3;
    // keys: [time, yaw, reach, height, bucket angle]
    const keys: [number, number, number, number, number][] = [
      [0.0, pile.yaw, pile.r * 0.85, pile.h + 2.8, -0.7],
      [0.16, pile.yaw, pile.r, pile.h + 1.2, -1.45],
      [0.3, pile.yaw, pile.r * 0.74, pile.h + 1.5, 0.55],
      [0.43, pile.yaw, pile.r * 0.7, over + 0.8, 0.95],
      [0.62, t.yaw, t.r, over + 0.6, 0.95],
      [0.73, t.yaw, t.r, over, -1.5],
      [0.84, t.yaw, t.r, over, -1.5],
      [1.0, pile.yaw, pile.r * 0.85, pile.h + 2.8, -0.7],
    ];
    const i = Math.max(1, keys.findIndex((k) => k[0] >= x.clock)), a = keys[i - 1], b = keys[i], u = smooth((x.clock - a[0]) / (b[0] - a[0]));
    want = { yaw: a[1] + shortest(a[1], b[1]) * u, r: a[2] + (b[2] - a[2]) * u, h: a[3] + (b[3] - a[3]) * u, tip: a[4] + (b[4] - a[4]) * u };
    carrying = x.clock > 0.24 && x.clock < 0.71; tipping = x.clock >= 0.69 && x.clock < 0.9;
  } else x.clock = 0;
  const k = Math.min(1, dt * 12), n = x.now;
  n.yaw += shortest(n.yaw, want.yaw) * k; n.r += (want.r - n.r) * k; n.h += (want.h - n.h) * k; n.tip += (want.tip - n.tip) * k;
  aim(x, n);
  x.load.visible = carrying;
  // ore leaving the bucket and dropping into the bed
  if (tipping && bed) {
    x.root.updateWorldMatrix(true, true); x.load.getWorldPosition(_m);
    x.rocks.children.forEach((r, j) => {
      const age = (x.clock - 0.69) / 0.21 - (j / x.rocks.children.length) * 0.65, fall = Math.max(0, Math.min(1, age / 0.35));
      r.visible = age > 0 && fall < 1;
      const sx = Math.sin(j * 12.9) * 1.7, sz = Math.cos(j * 7.3) * 1.7;
      r.position.set(_m.x + (bed.x - _m.x) * fall + sx, _m.y + (bed.y - 2.2 - _m.y) * fall * fall, _m.z + (bed.z - _m.z) * fall + sz);
      r.rotation.set(j + x.clock * 20, j * 2, 0);
    });
  } else x.rocks.children.forEach((r) => (r.visible = false));
}
