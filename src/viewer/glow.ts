// Additive glow sprites for every lamp, LED and cabin light of every car, in a
// single THREE.Points draw call. Each sprite follows an object (a lamp mesh,
// a light bar, the frunk lid), so it moves with closures; its brightness and
// color are set each frame. A lamp's sprite fades as the view turns away from
// the direction the lamp faces, so headlights don't shine through the car.

import * as THREE from 'three';

export interface GlowEntry {
  /** What the sprite rides on; `local` is in this object's space. */
  object: THREE.Object3D;
  local: THREE.Vector3;
  /** Facing direction in `object`'s space; undefined = shines all around. */
  normal?: THREE.Vector3;
  /** Sprite diameter at full brightness, meters. */
  size: number;
  /** Linear color times brightness, set every frame. */
  color: THREE.Color;
}

const VERTEX = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute vec4 facing;
  uniform float scale;
  uniform float maxSize;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float f = 1.0;
    if (facing.w > 0.5) {
      vec3 toCam = normalize(cameraPosition - position);
      f = smoothstep(-0.15, 0.55, dot(toCam, facing.xyz));
    }
    vColor = color * f;
    float lum = max(vColor.r, max(vColor.g, vColor.b));
    // Brighter lamps throw a slightly bigger halo.
    float s = size * (0.75 + 0.25 * min(lum, 2.0));
    gl_PointSize = lum < 0.003 ? 0.0 : min(maxSize, s * scale / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float halo = pow(1.0 - r, 2.2);
    float core = 1.0 - smoothstep(0.0, 0.32, r);
    gl_FragColor = vec4(vColor * (halo * 0.5 + core * 1.1), 1.0);
  }
`;

export class GlowLayer {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private entries: GlowEntry[] = [];
  private capacity = 0;
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly nm = new THREE.Matrix3();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { scale: { value: 500 }, maxSize: { value: 256 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setEntries(entries: GlowEntry[]): void {
    this.entries = entries;
    if (entries.length > this.capacity) {
      this.capacity = Math.ceil(entries.length * 1.25);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('facing', new THREE.BufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
      this.points.geometry.dispose();
      this.points.geometry = g;
    }
    this.points.geometry.setDrawRange(0, entries.length);
  }

  /** Viewport height in pixels and the camera, for world-size sprites. */
  setView(heightPx: number, camera: THREE.PerspectiveCamera, maxPointSize: number): void {
    this.material.uniforms.scale!.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.material.uniforms.maxSize!.value = maxPointSize;
  }

  /** Call after the scene's world matrices are up to date. */
  update(): void {
    if (!this.entries.length) return;
    const g = this.points.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    const size = g.attributes.size as THREE.BufferAttribute;
    const facing = g.attributes.facing as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    const S = size.array as Float32Array;
    const F = facing.array as Float32Array;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      const c = e.color;
      C[i * 3] = c.r;
      C[i * 3 + 1] = c.g;
      C[i * 3 + 2] = c.b;
      S[i] = e.size;
      if (c.r + c.g + c.b < 0.002) continue; // dark: position doesn't matter
      this.v.copy(e.local).applyMatrix4(e.object.matrixWorld);
      P[i * 3] = this.v.x;
      P[i * 3 + 1] = this.v.y;
      P[i * 3 + 2] = this.v.z;
      if (e.normal) {
        this.nm.getNormalMatrix(e.object.matrixWorld);
        this.n.copy(e.normal).applyMatrix3(this.nm).normalize();
        F[i * 4] = this.n.x;
        F[i * 4 + 1] = this.n.y;
        F[i * 4 + 2] = this.n.z;
        F[i * 4 + 3] = 1;
      } else {
        F[i * 4 + 3] = 0;
      }
    }
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = facing.needsUpdate = true;
  }
}
