/* Close-up surface detail for ground, roads and ore, made in code (no image files).
   What the surface is decides how it looks: green ground is leaf litter, bare ground carries
   pebbles, steep cut faces show rock layers. Colour and relief come from the same fields. */
import * as THREE from 'three';

let tex: THREE.DataTexture | null = null;
/** A tiling noise sheet. r = broad patches, g = fine grain, b = clumps. */
export function detailTexture() {
  if (tex) return tex;
  const N = 256, data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number, s: number) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // value noise that wraps at the edge of the sheet
  const wrap = (x: number, y: number, cells: number, s: number) => {
    const fx = (x / N) * cells, fy = (y / N) * cells, xi = Math.floor(fx), yi = Math.floor(fy), u = fx - xi, v = fy - yi, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const at = (i: number, j: number) => hash((xi + i) % cells, (yi + j) % cells, s);
    return (at(0, 0) * (1 - su) + at(1, 0) * su) * (1 - sv) + (at(0, 1) * (1 - su) + at(1, 1) * su) * sv;
  };
  const fbm = (x: number, y: number, cells: number, s: number) => (wrap(x, y, cells, s) * 4 + wrap(x, y, cells * 2, s + 1) * 2 + wrap(x, y, cells * 4, s + 2)) / 7;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(((v - 0.5) * 1.55 + 0.5) * 255)));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = (y * N + x) * 4;
    data[k] = clamp(fbm(x, y, 4, 3)); data[k + 1] = clamp(fbm(x, y, 40, 17)); data[k + 2] = clamp(fbm(x, y, 13, 31)); data[k + 3] = 255;
  }
  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

/** Adds the detail to a Lambert material. bump = height of the relief in metres. */
export function groundDetail<T extends THREE.MeshLambertMaterial>(mat: T, bump = 1, strength = 1): T {
  mat.onBeforeCompile = (s) => {
    s.uniforms.detailMap = { value: detailTexture() }; s.uniforms.detailBump = { value: bump }; s.uniforms.detailAmt = { value: strength };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos; varying vec3 vGroundNor;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vGroundNor = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap; uniform float detailBump; uniform float detailAmt; varying vec3 vGroundPos; varying vec3 vGroundNor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 gp = vGroundPos.xz;
  float steep = smoothstep(0.1, 0.42, 1.0 - abs(normalize(vGroundNor).y));
  float broad = texture2D(detailMap, gp / 191.0).r;
  float clump = texture2D(detailMap, gp / 43.0).b;
  float grain = texture2D(detailMap, gp / 31.0).g;
  float close = texture2D(detailMap, mat2(0.8, -0.6, 0.6, 0.8) * gp / 11.0).g;
  float leafy = clamp((diffuseColor.g - diffuseColor.r) * 16.0, 0.0, 1.0);
  float shade = 1.0 + ((broad - 0.5) * 0.24 + (clump - 0.5) * mix(0.18, 0.55, leafy) + (grain - 0.5) * mix(0.14, 0.34, leafy) + (close - 0.5) * mix(0.09, 0.2, leafy)) * detailAmt;
  // layers of rock on cut faces
  float layer = texture2D(detailMap, vec2((gp.x + gp.y) / 310.0, vGroundPos.y / 11.0)).b;
  shade *= 1.0 + (layer - 0.5) * 0.95 * steep * (1.0 - leafy);
  diffuseColor.rgb *= max(shade, 0.25);
  // dry patches in the green, loose stones on bare ground
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.55, 1.18, 0.72), leafy * smoothstep(0.55, 0.86, broad * 0.6 + clump * 0.4) * 0.7 * detailAmt);
  float stones = smoothstep(0.78, 0.94, close) * (1.0 - leafy) * (1.0 - steep);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.012, stones * 0.45 * detailAmt);
  float relief = (clump * mix(0.45, 1.1, leafy) + grain * 0.1 + layer * steep * 1.1) * detailBump;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  vec3 rx = dFdx(-vViewPosition), ry = dFdy(-vViewPosition);
  vec3 r1 = cross(ry, normal), r2 = cross(normal, rx);
  float det = dot(rx, r1);
  vec3 grad = sign(det) * (dFdx(relief) * r1 + dFdy(relief) * r2);
  normal = normalize(abs(det) * normal - grad);`);
  };
  mat.customProgramCacheKey = () => 'ground-detail';
  return mat;
}
