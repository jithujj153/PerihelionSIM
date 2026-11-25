/* Procedural models. Vehicles and gates are drawn about twice life size so they read on screen. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Rng } from '../engine/util';

export const V_SCALE = 2;
const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
/* vehicle paint and glass mirror the sky; everything fixed to the ground stays matt */
const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.18, envMapIntensity: 0.75 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x5b7f9c, roughness: 0.05, metalness: 0.85, envMapIntensity: 1.5 });
export function setReflections(env: THREE.Texture) { for (const m of [paintMat, glassMat]) { m.envMap = env; m.needsUpdate = true; } }
function paint(g: THREE.BufferGeometry, color: number) {
  const gg = g.index ? g.toNonIndexed() : g, n = gg.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  gg.setAttribute('color', new THREE.BufferAttribute(a, 3)); gg.deleteAttribute('uv');
  return gg;
}
export const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return paint(g, color); };
export const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, color: number, seg = 10, axis: 'x' | 'y' | 'z' = 'y') => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(x, y, z); return paint(g, color); };
/** A box with softened edges, which catch the light the way pressed steel does. */
export const rbox = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, r = 0.1, rx = 0) => { const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.98); if (rx) g.rotateX(rx); g.translate(x, y, z); return paint(g, color); };
export function merged(parts: THREE.BufferGeometry[], cast = true) { const m = new THREE.Mesh(mergeGeometries(parts)!, mat); m.castShadow = cast; m.receiveShadow = true; return m; }

export function plateTexture(text: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c418'; g.fillRect(0, 0, 256, 64); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 58);
  g.fillStyle = '#111'; g.font = 'bold 32px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 35);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export interface TruckModel {
  root: THREE.Group; body: THREE.Mesh; wheels: THREE.InstancedMesh; wheelPos: [number, number, number][]; heap: THREE.Mesh; led: THREE.Mesh; box: THREE.Mesh; plates: THREE.Mesh[]; halo: THREE.Mesh; spin: number; length: number;
  setPlate(text: string): void;
}
let heapGeo: THREE.BufferGeometry | null = null;
function oreHeap() {
  if (heapGeo) return heapGeo;
  const g = new THREE.ConeGeometry(1, 1, 34, 11), r = new Rng(12), p = g.attributes.position;
  const jitter = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    if (!jitter.has(k)) jitter.set(k, p.getY(i) > -0.45 ? r.range(0.88, 1.13) : 1);
    const j = jitter.get(k)!; p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
  }
  g.deleteAttribute('uv');
  const parts: THREE.BufferGeometry[] = [g.toNonIndexed()];
  for (let i = 0; i < 90; i++) {
    const u = Math.sqrt(r.next()) * 0.92, a = r.next() * 6.283, s = r.range(0.045, 0.1);
    const lump = new THREE.DodecahedronGeometry(s, 0); lump.deleteAttribute('uv'); lump.scale(1, 0.7, 0.75); lump.rotateY(r.next() * 6); lump.rotateX(r.next() * 2);
    lump.translate(Math.cos(a) * u, 0.5 - u + s * 0.25, Math.sin(a) * u); parts.push(lump);
  }
  const all = mergeGeometries(parts)!; all.translate(0, 0.5, 0); all.computeVertexNormals();
  return (heapGeo = all);
}
const oreMat = new THREE.MeshLambertMaterial({ color: 0x6e2b22, flatShading: true });
const wheelGeo = (() => {
  const tyre = new THREE.LatheGeometry([[0.34, -0.23], [0.47, -0.27], [0.58, -0.24], [0.62, -0.15], [0.62, 0.15], [0.58, 0.24], [0.47, 0.27], [0.34, 0.23]].map(([r, y]) => new THREE.Vector2(r, y)), 22);
  const parts = [paint(tyre, 0x1b1b1e)];
  parts.push(paint(new THREE.CylinderGeometry(0.36, 0.36, 0.4, 20), 0x8b9097), paint(new THREE.CylinderGeometry(0.27, 0.27, 0.46, 20), 0x4a4e55), paint(new THREE.CylinderGeometry(0.15, 0.17, 0.58, 12), 0xc4c8ce));
  // one bar across the hub shows the wheel turning
  parts.push(paint(new THREE.BoxGeometry(0.12, 0.54, 0.5), 0x6a6e76));
  return mergeGeometries(parts)!.rotateZ(Math.PI / 2);
})();
/** Road dust settles on the lower half of a working truck. */
function dusty(g: THREE.BufferGeometry) {
  const p = g.attributes.position, c = g.attributes.color, dust = new THREE.Color(0x8a5238), r = new Rng(31);
  for (let i = 0; i < p.count; i++) {
    const k = Math.max(0, Math.min(1, (2.15 - p.getY(i)) / 1.5)) * 0.55 + ((r.next() - 0.5) * 0.05);
    c.setXYZ(i, c.getX(i) + (dust.r - c.getX(i)) * Math.max(0, k), c.getY(i) + (dust.g - c.getY(i)) * Math.max(0, k), c.getZ(i) + (dust.b - c.getZ(i)) * Math.max(0, k));
  }
  return g;
}

/** A tipper truck facing +z, wheels on y = 0. */
export function truckModel(color: number, plate: string, length: number): TruckModel {
  const root = new THREE.Group(), inner = new THREE.Group(); inner.scale.setScalar(V_SCALE); root.add(inner);
  const L = length, half = L / 2, bedL = L - 3.3, bedZ = -half + bedL / 2 + 0.1;
  const dark = 0x25272b;
  const bedColor = new THREE.Color(color).multiplyScalar(0.9).getHex();
  const front = half - 0.25, chrome = 0xc3c7cd, trim = 0x34373d;
  const parts = [
    // chassis
    box(0.22, 0.34, L - 0.5, 0.52, 0.95, 0, dark), box(0.22, 0.34, L - 0.5, -0.52, 0.95, 0, dark), box(1.2, 0.2, L - 1.4, 0, 0.86, -0.2, 0x15161a),
    // cab, roof fairing and sun visor
    rbox(2.5, 1.8, 2.0, 0, 2.15, half - 1.25, color, 0.24), rbox(2.3, 0.42, 1.55, 0, 3.18, half - 1.45, color, 0.18), rbox(2.42, 0.09, 0.36, 0, 3.03, front + 0.07, trim, 0.04),
    box(0.07, 0.8, 0.07, 0, 2.55, front + 0.05, trim),
    // grille and bumper
    rbox(1.46, 0.48, 0.08, 0, 1.78, front, 0x17181c, 0.03), box(1.3, 0.05, 0.05, 0, 1.92, front + 0.05, chrome), box(1.3, 0.05, 0.05, 0, 1.79, front + 0.05, chrome), box(1.3, 0.05, 0.05, 0, 1.66, front + 0.05, chrome),
    rbox(2.64, 0.48, 0.34, 0, 1.15, half - 0.15, trim, 0.12),
    // mud flaps, rear bar and tail lamps
    box(0.56, 0.62, 0.06, 1.12, 0.7, -half + 0.22, 0x121317), box(0.56, 0.62, 0.06, -1.12, 0.7, -half + 0.22, 0x121317),
    box(2.4, 0.16, 0.2, 0, 1.0, -half + 0.12, 0x8f241d), rbox(0.34, 0.18, 0.08, 0.95, 1.2, -half + 0.08, 0xe0342a, 0.04), rbox(0.34, 0.18, 0.08, -0.95, 1.2, -half + 0.08, 0xe0342a, 0.04),
    // fuel tank with straps (left side; the device sits on the right), exhaust and air filter
    cyl(0.42, 0.42, 1.25, -0.98, 0.98, half - 2.75, 0x9aa0a8, 18, 'z'), cyl(0.44, 0.44, 0.09, -0.98, 0.98, half - 3.1, dark, 18, 'z'), cyl(0.44, 0.44, 0.09, -0.98, 0.98, half - 2.4, dark, 18, 'z'),
    cyl(0.12, 0.12, 2.1, -1.0, 2.4, half - 2.5, 0x7c8087, 12), cyl(0.17, 0.17, 0.8, -1.0, 2.2, half - 2.5, 0x55585e, 12), cyl(0.2, 0.2, 0.55, -0.35, 2.1, half - 2.45, trim, 14),
    // tipping ram
    cyl(0.1, 0.1, 0.8, 0, 1.2, bedZ + bedL / 2 - 0.7, chrome, 10),
    // open dump body with top rails
    box(2.5, 0.16, bedL, 0, 1.55, bedZ, bedColor), rbox(0.14, 1.35, bedL, 1.25, 2.25, bedZ, bedColor, 0.04), rbox(0.14, 1.35, bedL, -1.25, 2.25, bedZ, bedColor, 0.04),
    rbox(2.6, 1.7, 0.16, 0, 2.4, bedZ + bedL / 2, bedColor, 0.05), rbox(2.5, 1.25, 0.14, 0, 2.2, bedZ - bedL / 2, bedColor, 0.05),
    rbox(0.24, 0.14, bedL + 0.1, 1.27, 2.95, bedZ, color, 0.06), rbox(0.24, 0.14, bedL + 0.1, -1.27, 2.95, bedZ, color, 0.06), rbox(2.62, 0.14, 0.22, 0, 2.85, bedZ - bedL / 2, color, 0.06),
    rbox(2.72, 0.12, 1.1, 0, 3.28, bedZ + bedL / 2 + 0.45, bedColor, 0.05),
  ];
  for (const x of [1, -1]) {
    parts.push(
      rbox(0.4, 0.24, 0.1, 0.88 * x, 1.42, half - 0.0, 0xfff4cd, 0.05), rbox(0.14, 0.14, 0.09, 1.2 * x, 1.42, half - 0.0, 0xffa221, 0.04),
      // steps, mirrors and roof beacons
      box(0.32, 0.08, 0.7, 1.16 * x, 0.72, half - 2.0, trim),
      box(0.34, 0.05, 0.05, 1.38 * x, 2.95, half - 0.42, dark), box(0.05, 0.05, 0.05, 1.5 * x, 2.7, half - 0.42, dark), rbox(0.12, 0.56, 0.22, 1.56 * x, 2.66, half - 0.42, dark, 0.05),
      cyl(0.1, 0.13, 0.14, 0.75 * x, 3.46, half - 1.3, 0xffa221, 10),
    );
    for (const z of [half - 1.15, -half + 2.35, -half + 0.95]) { const arch = new THREE.CylinderGeometry(0.76, 0.76, 0.5, 18, 1, true, 0, Math.PI); arch.rotateZ(Math.PI / 2); arch.translate(1.15 * x, 0.66, z); parts.push(paint(arch, trim)); }
  }
  for (let z = bedZ - bedL / 2 + 0.7; z < bedZ + bedL / 2 - 0.3; z += 1.15) parts.push(rbox(2.68, 1.25, 0.13, 0, 2.2, z, color, 0.05));
  const body = new THREE.Mesh(dusty(mergeGeometries(parts)!), paintMat); body.castShadow = true; body.receiveShadow = true; inner.add(body);
  const panes = [
    new RoundedBoxGeometry(2.14, 0.8, 0.06, 2, 0.028).translate(0, 2.55, front + 0.012),
    ...[1, -1].map((x) => new RoundedBoxGeometry(0.05, 0.68, 0.88, 2, 0.022).translate(1.258 * x, 2.55, half - 1.05)),
  ];
  body.add(new THREE.Mesh(mergeGeometries(panes)!, glassMat));
  const wheelPos: [number, number, number][] = [];
  for (const z of [half - 1.15, -half + 2.35, -half + 0.95]) for (const x of [-1.15, 1.15]) wheelPos.push([x, 0.62, z]);
  const wheels = new THREE.InstancedMesh(wheelGeo, paintMat, wheelPos.length); wheels.castShadow = true; inner.add(wheels);
  const heap = new THREE.Mesh(oreHeap(), oreMat); heap.position.set(0, 1.62, bedZ); heap.visible = false; heap.castShadow = true; inner.add(heap);
  const dev = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.4, 0.8, 2, 0.08), new THREE.MeshLambertMaterial({ color: 0x1d5f9f, emissive: 0x0a2a55 }));
  dev.position.set(1.15, 1.2, half - 2.6); inner.add(dev);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0x4dff88 })); led.position.set(1.42, 1.34, half - 2.4); inner.add(led);
  const plates = [1, -1].map((s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), new THREE.MeshBasicMaterial({ map: plateTexture(plate) })); m.position.set(0, s > 0 ? 1.13 : 1.45, s > 0 ? half + 0.04 : -half - 0.0); if (s < 0) m.rotation.y = Math.PI; inner.add(m); return m; });
  const halo = new THREE.Mesh(new THREE.RingGeometry(13, 14.6, 48), new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.8; halo.visible = false; halo.renderOrder = 5; root.add(halo);
  const t: TruckModel = { root, body, wheels, wheelPos, heap, led, box: dev, plates, halo, spin: 0, length: L,
    setPlate(text: string) { const tex = plateTexture(text); plates.forEach((p) => { const m = p.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.map = tex; m.needsUpdate = true; }); } };
  turnWheels(t, 0);
  return t;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _x = new THREE.Vector3(1, 0, 0);
export function turnWheels(t: TruckModel, d: number) {
  t.spin = (t.spin + d / (0.62 * V_SCALE)) % (Math.PI * 2); _q.setFromAxisAngle(_x, t.spin);
  t.wheelPos.forEach((p, i) => t.wheels.setMatrixAt(i, _m.compose(_p.set(...p), _q, _s)));
  t.wheels.instanceMatrix.needsUpdate = true;
}
export function setHeap(t: TruckModel, tonnes: number) {
  const u = Math.max(0, Math.min(1.15, tonnes / 28)); t.heap.visible = u > 0.02;
  const bedL = t.length - 3.3, s = Math.cbrt(u);
  t.heap.scale.set(1.2 * (0.55 + 0.45 * s), 2.5 * s, (bedL / 2) * (0.5 + 0.48 * s));
}

/** A survey quadcopter: shell, four arms with motors, landing skids and a camera that looks down. */
export function droneModel(color = 0x2a2d33) {
  const root = new THREE.Group(), inner = new THREE.Group(); inner.scale.setScalar(3.2); root.add(inner);
  const dark = 0x1c1f25, alloy = 0x6d737d, Y = 0.5, ARM = 1.5;
  const parts = [
    rbox(0.92, 0.34, 1.34, 0, Y, 0, color, 0.17), rbox(0.62, 0.2, 0.8, 0, Y + 0.23, -0.12, color, 0.1), rbox(0.5, 0.08, 0.34, 0, Y + 0.34, -0.28, 0x16314f, 0.04),
    rbox(0.52, 0.22, 0.2, 0, Y - 0.02, 0.72, dark, 0.09),
    // camera on its gimbal
    box(0.08, 0.2, 0.08, 0, Y - 0.24, 0.42, alloy), rbox(0.38, 0.3, 0.34, 0, Y - 0.42, 0.45, dark, 0.12), cyl(0.11, 0.11, 0.12, 0, Y - 0.42, 0.65, 0x3b6a8f, 14, 'z'), cyl(0.065, 0.065, 0.14, 0, Y - 0.42, 0.67, 0x07090c, 12, 'z'),
    cyl(0.025, 0.025, 0.4, -0.22, Y + 0.45, -0.52, dark, 6), cyl(0.025, 0.025, 0.4, 0.22, Y + 0.45, -0.52, dark, 6),
  ];
  for (const x of [-0.5, 0.5]) {
    parts.push(cyl(0.045, 0.045, 1.5, x * 1.12, -0.06, 0, dark, 8, 'z'));
    for (const z of [-0.42, 0.42]) { const leg = new THREE.CylinderGeometry(0.04, 0.04, 0.52, 7); leg.rotateZ(x > 0 ? 0.3 : -0.3); leg.translate(x * 0.96, 0.18, z); parts.push(paint(leg, dark)); }
  }
  const hubs: [number, number][] = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const x = (sx * ARM) / Math.SQRT2 * 1.18, z = (sz * ARM) / Math.SQRT2 * 1.18; hubs.push([x, z]);
    const len = Math.hypot(x, z), arm = new THREE.CylinderGeometry(0.075, 0.11, len, 10); arm.rotateX(Math.PI / 2); arm.rotateY(Math.atan2(x, z)); arm.translate(x / 2, Y + 0.03, z / 2);
    parts.push(paint(arm, alloy), cyl(0.16, 0.19, 0.26, x, Y + 0.08, z, dark, 14), cyl(0.07, 0.07, 0.1, x, Y + 0.25, z, 0xc9ced6, 10), cyl(0.1, 0.1, 0.05, x, Y - 0.08, z, sz > 0 ? 0xffffff : color, 10));
  }
  const body = new THREE.Mesh(mergeGeometries(parts)!, paintMat); inner.add(body);
  const rotors: THREE.Mesh[] = [];
  const rm = new THREE.MeshBasicMaterial({ color: 0xdfe8f2, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
  const blade = new THREE.SphereGeometry(1, 12, 6); blade.scale(0.72, 0.075, 0.012);
  const bm = new THREE.MeshBasicMaterial({ color: 0x23262c });
  for (const [x, z] of hubs) {
    const r = new THREE.Mesh(new THREE.CircleGeometry(0.76, 28), rm); r.rotation.x = -Math.PI / 2; r.position.set(x, Y + 0.31, z); inner.add(r);
    r.add(new THREE.Mesh(blade, bm)); rotors.push(r);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshBasicMaterial({ color: 0x35ff8d })); beacon.position.set(0, Y + 0.47, 0.12); inner.add(beacon);
  const coneGeo = new THREE.ConeGeometry(1, 1, 40, 1, true); coneGeo.translate(0, -0.5, 0);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0x58d6ff, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  root.add(cone);
  const foot = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: 0x7fe4ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })); foot.rotation.x = -Math.PI / 2;
  return { root, rotors, cone, foot, beacon };
}

export interface GateModel {
  root: THREE.Group; arm: THREE.Group; backup: THREE.Group; lamp: THREE.Mesh; laser: THREE.Mesh; frame: THREE.Group; pad: THREE.Group; padGlow: THREE.Mesh; open: number;
}
/** x-ray look: drawn over the ground so the audience can see what is buried. */
export function buriedPad(width = 15, length = 24) {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, length), new THREE.MeshBasicMaterial({ color: 0x28c7ff, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false }));
  glow.position.y = -2.2; glow.renderOrder = 8; g.add(glow);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 1.2, length)), new THREE.LineBasicMaterial({ color: 0x68dcff, transparent: true, opacity: 0.95, depthTest: false }));
  edges.position.y = -2.4; edges.renderOrder = 9; g.add(edges);
  for (const sx of [-0.32, 0.32]) for (const sz of [-0.36, 0.36]) {
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1, 10), new THREE.MeshBasicMaterial({ color: 0xb7f1ff, transparent: true, opacity: 0.85, depthTest: false })); cell.position.set(sx * width, -2.9, sz * length); cell.renderOrder = 9; g.add(cell);
  }
  return { group: g, glow };
}
export function gateModel(kind: 'entry' | 'exit' | 'route' | 'zone'): GateModel {
  const root = new THREE.Group(), main = kind === 'entry' || kind === 'exit';
  const post = main ? 0xe8e4da : 0xd8d4ca;
  const stat = [box(1.2, 5, 1.2, -11, 2.5, 13, 0x40444b), box(1.5, 1, 1.5, -11, 5.2, 13, 0xf0b429), box(1, 3.6, 1, 11, 1.8, 13, 0x40444b)];
  if (main) stat.push(box(7, 6, 9, -17.5, 3, 6, post), box(8, 0.7, 10, -17.5, 6.4, 6, kind === 'exit' ? 0x9c3b2e : 0x2c5f8a), box(0.2, 2.2, 5, -13.9, 3.6, 6, 0x1b2c3d));
  root.add(merged(stat));
  const arm = new THREE.Group(); arm.position.set(-11, 5, 13.9); root.add(arm);
  const stripes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) stripes.push(box(2.15, 0.75, 0.45, 1.1 + i * 2.15, 0, 0, i % 2 ? 0xf4f4f0 : 0xd7332a));
  arm.add(merged(stripes));
  const backup = new THREE.Group(); backup.position.set(0, 0, 18); const b: THREE.BufferGeometry[] = [];
  for (let i = -4; i <= 4; i++) b.push(cyl(0.7, 0.7, 4.4, i * 2.3, 2.2, 0, i % 2 ? 0xf0b429 : 0x222428, 8));
  backup.add(merged(b)); backup.visible = false; backup.position.y = -4.5; root.add(backup);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 10), new THREE.MeshBasicMaterial({ color: 0x777777 })); lamp.position.set(-11, 6.6, 13); root.add(lamp);
  const frame = new THREE.Group(); root.add(frame);
  frame.add(merged([box(0.7, 13, 0.7, -10, 6.5, 0, 0xaab2bd), box(0.7, 13, 0.7, 10, 6.5, 0, 0xaab2bd), box(20.7, 0.7, 0.7, 0, 13, 0, 0xaab2bd), box(1.8, 1.1, 1.4, -5, 12.2, 0, 0x22252a), box(1.8, 1.1, 1.4, 5, 12.2, 0, 0x22252a), box(1.2, 0.9, 1.6, -10, 8, 0.4, 0x14161a), box(1.2, 0.9, 1.6, 10, 8, 0.4, 0x14161a)]));
  const laser = new THREE.Mesh(new THREE.PlaneGeometry(19, 12), new THREE.MeshBasicMaterial({ color: 0xff3b57, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  laser.position.y = 6.2; laser.visible = false; frame.add(laser);
  const pad = buriedPad(); root.add(pad.group);
  return { root, arm, backup, lamp, laser, frame, pad: pad.group, padGlow: pad.glow, open: 0 };
}

export function checkpointModel() {
  const root = new THREE.Group();
  root.add(merged([cyl(0.35, 0.5, 11, 12.5, 5.5, 0, 0x9aa2ad, 8), box(1.5, 2.2, 1, 12.5, 8.4, 0, 0xe8e4da), box(2.6, 0.2, 1.8, 12.5, 11.4, 0, 0x27507a, -0.35), cyl(0.12, 0.12, 2.4, 12.5, 12.6, 0, 0x222428, 6)]));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0x59d2ff })); tip.position.set(12.5, 14, 0); root.add(tip);
  const rings = [0, 1, 2].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: 0x59d2ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.y = 1.5; root.add(r); return r; });
  return { root, rings, tip };
}

export function towerModel(range: number) {
  const root = new THREE.Group(), parts: THREE.BufferGeometry[] = [], H = 34;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const g = new THREE.CylinderGeometry(0.28, 0.4, H + 0.6, 5); g.rotateZ((x * 2.6) / H); g.rotateX((-z * 2.6) / H); g.translate(x * 2.9, H / 2, z * 2.9); parts.push(paint(g, 0xc3c8d0)); }
  for (let y = 5; y < H; y += 5.5) { const w = 8 - (y / H) * 5; parts.push(box(w, 0.3, 0.3, 0, y, w / 2, 0xd6452f), box(w, 0.3, 0.3, 0, y, -w / 2, 0xd6452f), box(0.3, 0.3, w, w / 2, y, 0, 0xd6452f), box(0.3, 0.3, w, -w / 2, y, 0, 0xd6452f)); }
  parts.push(box(4.4, 0.5, 4.4, 0, H, 0, 0x4a4f57));
  root.add(merged(parts));
  const head = new THREE.Group(); head.position.y = H + 2; root.add(head);
  head.add(merged([box(3, 2.4, 2.6, 0, 0, 0, 0xf2f2ee), cyl(0.8, 0.8, 0.5, 0, 0, 1.5, 0x101216, 14, 'z')]));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0x35ff8d })); lamp.position.y = 2; head.add(lamp);
  const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial({ color: 0x7cffd8, transparent: true, opacity: 0.55 }));
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * 6.2832) * range, 0, Math.sin((i / 96) * 6.2832) * range))), new THREE.LineBasicMaterial({ color: 0x63f0c8, transparent: true, opacity: 0.35 }));
  return { root, head, beam, ring, lamp, height: H + 2, range };
}

export function controlRoom() {
  const g = new THREE.Group();
  const parts = [box(34, 9, 20, 0, 4.5, 0, 0xe9e5da), box(35, 0.8, 21, 0, 0.4, 0, 0x6f6a62), box(36, 1, 22, 0, 9.4, 0, 0x2c5f8a), box(34.6, 0.5, 20.6, 0, 8.6, 0, 0xcfcabd),
    cyl(0.3, 0.45, 20, 14, 19, -6, 0xb4bac3, 8), box(4, 0.3, 0.3, 14, 26, -6, 0xd6452f), box(3, 0.3, 0.3, 14, 22, -6, 0xd6452f), cyl(3.4, 0.4, 1, -10, 11.2, 0, 0xf0f0ea, 24),
    box(4.4, 5.4, 0.4, -12.5, 2.9, 10.15, 0x3a4753), box(6, 0.4, 3, -12.5, 5.9, 11.2, 0x2c5f8a), box(8, 0.35, 2.4, -12.5, 0.3, 11.4, 0x9a968c)];
  for (let i = 0; i < 7; i++) { const x = -6 + i * 3.5; parts.push(box(2.9, 3.4, 0.3, x, 4.9, 10.12, 0x17324a), box(3.15, 0.25, 0.5, x, 3.1, 10.2, 0xb9b4a8), box(0.14, 3.4, 0.34, x, 4.9, 10.2, 0x8fa4b8)); }
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(box(0.3, 3, 3, side * 17.1, 4.9, -6 + i * 4, 0x17324a));
  for (const [x, z] of [[2, -4], [7, 3], [-2, 5]]) parts.push(box(2.6, 1.3, 2, x, 10.5, z, 0x9aa1a8));
  g.add(merged(parts));
  return g;
}
export function weighbridge() {
  const g = new THREE.Group();
  g.add(merged([box(16, 0.7, 30, 0, 0.35, 0, 0x7e848c), box(0.8, 1.4, 30, 8.4, 0.7, 0, 0xf0b429), box(0.8, 1.4, 30, -8.4, 0.7, 0, 0xf0b429), box(10, 7, 12, 19, 3.5, 0, 0xe9e5da), box(11, 0.8, 13, 19, 7.3, 0, 0x2f7a4b), box(0.3, 2.6, 8, 14, 3.8, 0, 0x17324a)]));
  return g;
}
export function plantShed() {
  const g = new THREE.Group();
  const parts = [box(46, 16, 30, 0, 8, 0, 0x8d98a3), box(47, 1, 31, 0, 0.5, 0, 0x55504a), box(48, 1.4, 32, 0, 16.6, 0, 0x5d6670), box(6, 26, 6, 18, 13, -16, 0x737d88), box(4, 3, 44, -6, 15, 30, 0x4c545d, -0.34), cyl(2.4, 2.4, 22, -22, 11, -18, 0xa8b1ba, 20)];
  // pressed steel sheeting, roller doors and high windows
  for (let x = -21.5; x <= 21.5; x += 2.15) parts.push(box(0.35, 14.6, 0.35, x, 8.4, 15.1, 0x7b8691), box(0.35, 14.6, 0.35, x, 8.4, -15.1, 0x7b8691));
  for (const x of [-13, 4]) { parts.push(box(8, 8, 0.5, x, 4.9, 15.3, 0x3f474f)); for (let y = 1.8; y < 8.6; y += 1.1) parts.push(box(8, 0.18, 0.6, x, y, 15.35, 0x5a636c)); }
  for (let i = 0; i < 9; i++) parts.push(box(3, 1.8, 0.5, -18 + i * 4.5, 12.6, 15.35, 0x1d3347));
  for (let y = 4; y < 22; y += 4.4) parts.push(cyl(2.55, 2.55, 0.35, -22, y, -18, 0x6d757d, 20));
  g.add(merged(parts));
  return g;
}
export function oreMaterial() { return oreMat; }
