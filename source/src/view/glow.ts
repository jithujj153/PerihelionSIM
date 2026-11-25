/* Lamps and beacons with a soft halo. A halo is one small sprite, so it costs far less than
   a full-screen bloom pass and runs well on a laptop's built-in graphics. */
import * as THREE from 'three';

let tex: THREE.CanvasTexture | null = null;
function haloTexture() {
  if (tex) return tex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,.95)'); r.addColorStop(0.22, 'rgba(255,255,255,.4)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/** Set a lamp's colour and give it a halo `size` times its own radius (0 switches the halo off). */
export function lamp(mesh: THREE.Mesh, color: number, size = 6) {
  (mesh.material as THREE.MeshBasicMaterial).color.set(color);
  let halo = mesh.userData.halo as THREE.Sprite | undefined;
  if (!halo) {
    if (!size) return;
    halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    mesh.geometry.computeBoundingSphere(); halo.userData.r = mesh.geometry.boundingSphere!.radius;
    mesh.userData.halo = halo; mesh.add(halo);
  }
  halo.visible = size > 0;
  if (size) { halo.material.color.set(color); halo.scale.setScalar(halo.userData.r * size); }
}
