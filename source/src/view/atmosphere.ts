/* Sky and haze share one description: the same sun direction and the same horizon colour,
   so distant ground melts into the sky instead of ending in a flat grey band. */
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.5, 0.62, 0.28).normalize();
const sun = `vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)})`;

/* Every material with fog uses these chunks, so this must run before the first frame is drawn. */
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogDist = length( vFogRay );
  // thin air light that thickens with distance and pools in the low ground
  float low = 1.0 - smoothstep( 20.0, 320.0, cameraPosition.y + vFogRay.y );
  float airLight = ( 1.0 - exp( - max( fogDist - 220.0, 0.0 ) / 5200.0 ) ) * ( 0.22 + 0.2 * low );
  fogFactor = clamp( fogFactor + airLight * ( 1.0 - fogFactor ), 0.0, 1.0 );
  // warmer toward the sun, cooler away from it
  float toSun = pow( max( dot( vFogRay / max( fogDist, 0.001 ), ${sun} ), 0.0 ), 5.0 );
  vec3 haze = fogColor * mix( vec3( 0.95, 0.99, 1.04 ), vec3( 1.2, 1.07, 0.9 ), toSun );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, fogFactor );
#endif`;

export function skyMaterial() {
  const uniforms = {
    top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: SUN_DIR.clone() }, glare: { value: 1 },
    cover: { value: 0.4 }, cloudLight: { value: 1 }, time: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float glare; uniform float cover; uniform float cloudLight; uniform float time;
varying vec3 vDir;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.07 + vec2(11.3, 7.1); a *= 0.52; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0), s = max(dot(d, sunDir), 0.0);
  vec3 c = mix(horizon, top, pow(h, 0.5));
  c = mix(c, horizon * vec3(1.16, 1.05, 0.9), pow(s, 5.0) * (1.0 - h) * 0.75);
  c += vec3(1.0, 0.86, 0.6) * (pow(s, 12.0) * 0.14 + pow(s, 140.0) * 0.5) * glare;
  if (cover > 0.001 && d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.13) * 1.25 + vec2(time * 0.006, time * 0.002);
    float n = fbm(uv), a = smoothstep(0.86 - cover * 0.62, 1.04 - cover * 0.5, n) * smoothstep(0.015, 0.2, d.y);
    // a second sample toward the sun gives each cloud a lit and a shaded side
    float lit = clamp(0.55 + (n - fbm(uv + sunDir.xz * 0.22)) * 2.6, 0.0, 1.0);
    vec3 cc = mix(horizon * 0.82, vec3(1.08, 1.05, 1.0), lit) * cloudLight;
    c = mix(c, cc, a * 0.9);
  }
  c += vec3(1.0, 0.92, 0.74) * smoothstep(0.99975, 0.99992, s) * 14.0 * glare;
  c += (h21(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
  });
  return { material, uniforms };
}
