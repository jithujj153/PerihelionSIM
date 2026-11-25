/* Forest and loose rock. Everything is instanced, and each patch of land swaps
   between a detailed and a simple shape depending on how close the camera is. */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PICKUP_ZONE, PILES, QUARRIES } from '../engine/layout';
import { inPoly, Rng } from '../engine/util';
import { detailTexture } from './surface';
import { disturbed, height, noise, roadInfo, X0, X1, Z0, Z1 } from './terrain';

const CELL = 520;

/** Darker underneath, lighter on top: the shade a real canopy casts on itself. */
function shadeByHeight(g: THREE.BufferGeometry, low: number, high: number) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  let y0 = 1e9, y1 = -1e9; for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  for (let i = 0; i < p.count; i++) { const k = low + (high - low) * Math.pow((p.getY(i) - y0) / (y1 - y0 || 1), 0.8); c.set([k, k, k], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}
/** A ball with an uneven surface. */
function blob(radius: number, detail: number, rough: number, seed: number, sx = 1, sy = 1) {
  const raw = new THREE.IcosahedronGeometry(radius, detail); raw.deleteAttribute('uv'); raw.deleteAttribute('normal');
  const g = mergeVertices(raw), p = g.attributes.position, r = new Rng(seed);
  for (let i = 0; i < p.count; i++) { const k = 1 + r.range(-rough, rough); p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sx); }
  g.computeVertexNormals(); return g;
}
function broadleaf() {
  const parts = ([[0, 8.6, 0, 3.9], [2.7, 6.9, 0.8, 2.8], [-2.4, 7.2, 1.3, 2.9], [0.2, 8, -2.4, 3]] as const)
    .map(([x, y, z, r], i) => { const g = blob(r, 1, 0.24, 40 + i, 1, 0.86); g.translate(x, y, z); return g; });
  return shadeByHeight(mergeGeometries(parts)!, 0.5, 1.2);
}
function conifer() {
  const r = new Rng(8);
  const parts = ([[4.3, 6.2, 5.4], [3.4, 5.4, 8.4], [2.4, 4.8, 11.2], [1.4, 3.6, 13.6]] as const).map(([w, h, y]) => {
    const g = new THREE.ConeGeometry(w, h, 11, 1, true); g.deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) { const k = r.range(0.72, 1.14); p.setXYZ(i, p.getX(i) * k, p.getY(i) + r.range(-0.5, 0.4), p.getZ(i) * k); }
    g.computeVertexNormals(); g.translate(0, y, 0); return g;
  });
  return shadeByHeight(mergeGeometries(parts)!, 0.5, 1.15);
}

/** Speckles foliage so a canopy reads as leaves rather than a smooth ball. */
function foliage<T extends THREE.MeshLambertMaterial>(mat: T): T {
  mat.onBeforeCompile = (s) => {
    s.uniforms.detailMap = { value: detailTexture() };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLeafPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLeafPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap; varying vec3 vLeafPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  float leaf = texture2D(detailMap, vec2(vLeafPos.x + vLeafPos.y * 0.7, vLeafPos.z - vLeafPos.y * 0.7) / 19.0).g;
  float bunch = texture2D(detailMap, vec2(vLeafPos.x - vLeafPos.y, vLeafPos.z + vLeafPos.y) / 21.0).b;
  diffuseColor.rgb *= 0.55 + leaf * 0.56 + bunch * 0.36;`);
  };
  mat.customProgramCacheKey = () => 'foliage';
  return mat;
}

interface Spot { x: number; z: number; s: number; kind: number; tint: number }
const open = (x: number, z: number, margin: number) => {
  if (disturbed(x, z) > 0.15) return false;
  const road = roadInfo(x, z); if (road.d < road.w + margin) return false;
  for (const p of PILES) if (Math.hypot(x - p.pos.x, z - p.pos.z) < p.radius + margin * 2) return false;
  return true;
};
function cells<T extends { x: number; z: number }>(spots: T[]) {
  const m = new Map<string, T[]>();
  for (const s of spots) { const k = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`; const l = m.get(k); if (l) l.push(s); else m.set(k, [s]); }
  return [...m.values()];
}
interface Patch { x: number; z: number; near: THREE.Object3D[]; far: THREE.Object3D[]; reach: number }

export function buildVegetation(trees: number, rocks: number) {
  const group = new THREE.Group(), patches: Patch[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler(), at = new THREE.Vector3(), size = new THREE.Vector3();
  const patchFor = (list: { x: number; z: number }[], reach: number) => {
    const x = (Math.floor(list[0].x / CELL) + 0.5) * CELL, z = (Math.floor(list[0].z / CELL) + 0.5) * CELL;
    const p: Patch = { x, z, near: [], far: [], reach }; patches.push(p); return p;
  };
  const finish = (mesh: THREE.InstancedMesh) => { mesh.computeBoundingSphere(); group.add(mesh); return mesh; };

  // ---- trees
  const r = new Rng(99), spots: Spot[] = [];
  let guard = 0;
  while (spots.length < trees && guard++ < trees * 6) {
    // denser where the cameras go
    const near = r.next() < 0.62;
    const x = near ? r.range(-1850, 2500) : r.range(X0, X1), z = near ? r.range(-1500, 2000) : r.range(Z0, Z1);
    if (noise(x / 140 + 2, z / 140) < 0.3 || !open(x, z, 15)) continue;
    spots.push({ x, z, s: r.range(0.5, 1.15), kind: r.next() < 0.74 ? 0 : 1, tint: r.next() });
  }
  const simpleA = new THREE.IcosahedronGeometry(5.2, 0); simpleA.deleteAttribute('uv'); simpleA.scale(1.05, 1, 1.05); simpleA.translate(0, 7.8, 0); shadeByHeight(simpleA, 0.5, 1.15);
  const simpleB = new THREE.ConeGeometry(3.8, 12, 6); simpleB.deleteAttribute('uv'); simpleB.translate(0, 8.4, 0); shadeByHeight(simpleB, 0.55, 1.12);
  const shapes = [[broadleaf(), simpleA], [conifer(), simpleB]];
  const trunk = new THREE.CylinderGeometry(0.32, 0.8, 6.4, 7); trunk.translate(0, 3.2, 0);
  const leaf = foliage(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })), bark = new THREE.MeshLambertMaterial({ color: 0x4e382a });
  for (const list of cells(spots)) {
    const patch = patchFor(list, 620);
    const trunks = new THREE.InstancedMesh(trunk, bark, list.length);
    const kinds = shapes.map((pair, k) => { const n = list.filter((s) => s.kind === k).length; return pair.map((g) => new THREE.InstancedMesh(g, leaf, Math.max(1, n))); });
    const idx = [0, 0];
    list.forEach((s, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.tint * 6.28);
      m.compose(at.set(s.x, height(s.x, s.z) - 0.6, s.z), q, size.set(s.s, s.s * (0.82 + s.tint * 0.42), s.s));
      trunks.setMatrixAt(i, m);
      const dry = noise(s.x / 260 + 9, s.z / 260);
      c.setHSL(0.215 + s.tint * 0.085 - dry * 0.025, 0.4 + s.tint * 0.16, 0.17 + s.tint * 0.1 + (s.kind ? -0.025 : 0));
      for (const mesh of kinds[s.kind]) { mesh.setMatrixAt(idx[s.kind], m); mesh.setColorAt(idx[s.kind], c); }
      idx[s.kind]++;
    });
    kinds.forEach(([hi, lo], k) => { if (!idx[k]) return; hi.castShadow = lo.castShadow = true; hi.receiveShadow = true; patch.near.push(finish(hi)); patch.far.push(finish(lo)); });
    patch.near.push(finish(trunks));
  }

  // ---- loose rock on quarry benches, road shoulders and bare ground
  if (rocks) {
    const stones: Spot[] = []; guard = 0;
    while (stones.length < rocks && guard++ < rocks * 14) {
      const inQuarry = r.next() < 0.55, box = QUARRIES[Math.floor(r.next() * QUARRIES.length)];
      const x = inQuarry ? r.range(box.x0 - 40, box.x1 + 40) : r.range(-500, 1600), z = inQuarry ? r.range(box.z0 - 40, box.z1 + 40) : r.range(-600, 500);
      const road = roadInfo(x, z); if (road.d < road.w + 2.5 || disturbed(x, z) < 0.5) continue;
      // stockpiles and the loading yard stay clear
      if (!inQuarry && inPoly({ x, z }, PICKUP_ZONE)) continue;
      if (PILES.some((p) => Math.hypot(x - p.pos.x, z - p.pos.z) < p.radius + 6)) continue;
      const small = inQuarry ? 1 : 0.36, big = inQuarry && r.next() < 0.04 ? 2.2 : 1;
      stones.push({ x, z, s: r.range(0.35, 1.5) * small * big, kind: inQuarry ? 1 : 0, tint: r.next() });
    }
    const stone = blob(1, 0, 0.42, 5, 1, 0.7);
    const rockMat = new THREE.MeshLambertMaterial({ flatShading: true });
    for (const list of cells(stones)) {
      const mesh = new THREE.InstancedMesh(stone, rockMat, list.length);
      list.forEach((s, i) => {
        q.setFromEuler(e.set(s.tint * 0.9, s.tint * 17, s.tint * 0.5));
        m.compose(at.set(s.x, height(s.x, s.z) + s.s * 0.15, s.z), q, size.set(s.s, s.s, s.s));
        mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.setHSL(0.025 + s.tint * 0.04, s.kind ? 0.34 : 0.3, 0.17 + s.tint * 0.16));
      });
      mesh.receiveShadow = true; patchFor(list, 700).near.push(finish(mesh));
    }
  }
  group.userData.patches = patches;
  return group;
}

/** Choose the detail level of every patch from the camera position. */
export function updateVegetation(group: THREE.Group, cam: THREE.Vector3, scale: number) {
  for (const p of group.userData.patches as Patch[]) {
    const close = Math.hypot(p.x - cam.x, p.z - cam.z, Math.max(0, cam.y - 60)) < p.reach * scale;
    for (const o of p.near) o.visible = close;
    for (const o of p.far) o.visible = !close;
  }
}
export function disposeVegetation(group: THREE.Group) {
  const seen = new Set<{ dispose(): void }>();
  group.traverse((o) => { const m = o as THREE.InstancedMesh; if (!m.isInstancedMesh) return; seen.add(m.geometry); seen.add(m.material as THREE.Material); m.dispose(); });
  seen.forEach((x) => x.dispose());
}
