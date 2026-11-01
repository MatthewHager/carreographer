// The 3D stage: the lot at night (car/lot.ts), the lineup in its stalls, the cars' halos (glow.ts), a camera to
// orbit or fly between presets, and bloom on what the cars light. Made for an iPad as much as a desktop: the
// pixel ratio is capped, the cars' lamps light nothing for real, and a device that can't keep up loses the bloom.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { buildLot, lotEnvironment, REAR_CURB, STALL_WIDTH, type Lot } from './car/lot';
import { GlowLayer } from './glow';
import type { CarRig } from './rig';

export interface CameraPreset {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
}

/** The crowd stands at +x, looking back at the cars' fronts. */
export const CAMERA_PRESETS: CameraPreset[] = [
  { name: '3/4', position: [10.5, 4.2, 9.5], target: [0, 0.8, 0] },
  { name: 'Front', position: [15.5, 2.1, 0], target: [0, 0.9, 0] },
  { name: 'Rear', position: [-14.5, 3.4, 0], target: [0, 0.9, 0] },
  { name: 'Top', position: [0.01, 21, 0], target: [0, 0, 0] },
];

/** The part of the canvas the page leaves uncovered, in CSS pixels from its top left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.5);
/** How far a car's rear stands off the curb it backed up to (m). */
const CURB_GAP = 0.4;
/** Only what is brighter than this blooms. */
const BLOOM_FROM = 0.95;
const FLY_MS = 800;
/** Below this frame rate, once the show has played a few seconds, the bloom goes. */
const SLOWEST_FPS = 28;

/**
 * A lot lamp mirrored in paint, glass or stainless is as bright as the lamp, and would bloom like one of the
 * show's lights. So everything a surface gets from the scene's lights and its environment, together, is held
 * just under the bloom: a crisp white gloss still. The show's own lights are emission, halos and pools, never
 * scene lights, so they still glow. Patched once into three.js's shaders, for every material.
 */
function holdReflectionsUnderBloom(): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  if (chunks.lights_fragment_end!.includes('underBloom')) return;
  chunks.lights_fragment_end += `
    {
      // underBloom (viewer.ts)
      vec3 got = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse
        + reflectedLight.directSpecular + reflectedLight.indirectSpecular;
      #ifdef USE_CLEARCOAT
        got += (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
      #endif
      float underBloom = min(1.0, ${(BLOOM_FROM - 0.15).toFixed(2)} / max(1e-5, max(got.r, max(got.g, got.b))));
      reflectedLight.directDiffuse *= underBloom;
      reflectedLight.indirectDiffuse *= underBloom;
      reflectedLight.directSpecular *= underBloom;
      reflectedLight.indirectSpecular *= underBloom;
      #ifdef USE_CLEARCOAT
        clearcoatSpecularDirect *= underBloom;
        clearcoatSpecularIndirect *= underBloom;
      #endif
    }
  `;
}

export class Viewer {
  /** Called every frame before drawing: the page moves the show along here. */
  onTick: (() => void) | undefined;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 250);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.05, BLOOM_FROM);
  private readonly glow = new GlowLayer();
  private readonly lot: Lot;
  private readonly lineup = new THREE.Group();
  private cars: CarRig[] = [];
  private width = 0;
  private height = 0;
  private clear: Rect | undefined;
  private preset = CAMERA_PRESETS[0]!;
  /** Half the lineup's width, m. */
  private reach = 5.2;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; lookFrom: THREE.Vector3; lookTo: THREE.Vector3; at: number }
    | undefined;
  private bloomOn = true;
  private timing: { frames: number; seconds: number } | 'done' | undefined;
  private last = performance.now();
  private raf = 0;
  /** ?labels=1 names each car and its sides, to check the crowd's left and right. */
  private readonly labels = new URLSearchParams(location.search).get('labels') === '1';

  constructor(private readonly container: HTMLElement) {
    holdReflectionsUnderBloom();
    const r = this.renderer;
    r.setPixelRatio(PIXEL_RATIO);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(r.domElement);

    const night = new THREE.Color('#05070a');
    this.scene.background = night;
    this.scene.fog = new THREE.Fog(night, 28, 70);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(lotEnvironment(), 0.02).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();
    // a soft sky and a high moon under the lot's lamps: the cars' shapes read, their lights still stand out
    const moon = new THREE.DirectionalLight('#c9d4ff', 0.5);
    moon.position.set(-4, 8, 5);
    this.scene.add(new THREE.HemisphereLight('#8a96ad', '#1e1e1e', 0.8), moon);
    this.lot = buildLot(this.scene);
    this.scene.add(this.lineup, this.glow.points);

    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, minDistance: 2.5, maxDistance: 45, maxPolarAngle: Math.PI * 0.495 });
    this.controls.addEventListener('start', () => (this.flight = undefined));
    this.camera.position.set(...this.preset.position);
    this.controls.target.set(...this.preset.target);

    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.fitCanvas();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.draw();
    };
    tick();
  }

  get hasCars(): boolean {
    return this.cars.length > 0;
  }

  get carCount(): number {
    return this.cars.length;
  }

  /** The lineup, crowd's left to right: each car backed square into its own stall, just off the curb. The
   * crowd is at +x, so their left is +z. */
  setCars(cars: CarRig[]): void {
    for (const c of this.cars) c.dispose();
    this.cars = cars;
    const n = cars.length;
    this.lot.stallsFor(n);
    const z = (i: number) => ((n - 1) / 2 - i) * STALL_WIDTH;
    this.reach = Math.max(3, z(0) + Math.max(0, ...cars.map((c) => c.bounds.halfWidth)) + 1.35);
    cars.forEach((car, i) => {
      car.group.position.set(REAR_CURB + CURB_GAP + car.bounds.halfLength, 0, z(i));
      car.group.add(contactShadow(car));
      if (this.labels) label(car);
      this.lineup.add(car.group);
    });
    this.lineup.updateMatrixWorld(true);
    this.glow.setEntries(cars.flatMap((c) => c.glowEntries));
  }

  /** Centres and fits the cars in the part of the canvas the page leaves uncovered. */
  setClear(rect: Rect): void {
    const c = this.clear;
    if (c && Math.abs(c.x - rect.x) + Math.abs(c.y - rect.y) + Math.abs(c.w - rect.w) + Math.abs(c.h - rect.h) < 2) return;
    this.clear = rect;
    this.fitCanvas();
    this.flyTo(this.preset);
  }

  /** Flies to a preset, by name or the caller's own (the review's films have their own). */
  flyTo(preset: string | CameraPreset, instant = false): void {
    const p = typeof preset === 'string' ? CAMERA_PRESETS.find((c) => c.name === preset) : preset;
    if (!p) return;
    this.preset = p;
    const look = new THREE.Vector3(...p.target), to = this.backedOff(p);
    if (instant) {
      this.flight = undefined;
      this.camera.position.copy(to);
      this.controls.target.copy(look);
    } else {
      this.flight = { from: this.camera.position.clone(), to, lookFrom: this.controls.target.clone(), lookTo: look,
        at: performance.now() };
    }
  }

  /** A preset's camera, backed off along its line of sight until the whole lineup (about 7 m deep) fits the
   * uncovered part of the view: further on a phone, or for five cars. */
  private backedOff(p: CameraPreset): THREE.Vector3 {
    const look = new THREE.Vector3(...p.target);
    const back = new THREE.Vector3(...p.position).sub(look);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), h = Math.max(1, this.height);
    const view = this.clear ?? { w: this.width, h: this.height };
    const across = Math.atan((tan * Math.max(1, view.w)) / h), up = Math.atan((tan * Math.max(1, view.h)) / h);
    const need = this.reach / Math.tan(Math.min(across, up * 1.6)) + 2.5;
    return look.add(back.length() < need ? back.setLength(need) : back);
  }

  /** Starts timing the frames once the show plays: a device that can't keep up loses the bloom. */
  armPerfCheck(): void {
    this.timing ??= { frames: 0, seconds: 0 };
  }

  private draw(): void {
    if (this.container.clientWidth !== this.width || this.container.clientHeight !== this.height) this.fitCanvas();
    const now = performance.now(), dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.time(dt);
    this.onTick?.();
    // a pole between the camera and the cars would stand in front of them (a long lineup on a phone)
    const toCars = this.camera.position.distanceTo(this.controls.target);
    for (const pole of this.lot.poles) pole.visible = pole.position.distanceTo(this.camera.position) > toCars;
    if (this.flight) {
      const t = Math.min(1, (now - this.flight.at) / FLY_MS), ease = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, ease);
      this.controls.target.lerpVectors(this.flight.lookFrom, this.flight.lookTo, ease);
      if (t === 1) this.flight = undefined;
    }
    this.controls.update(dt);
    this.scene.updateMatrixWorld();
    this.glow.update();
    if (this.bloomOn) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Times three seconds of frames, after the first second (shaders compiling, textures uploading). */
  private time(dt: number): void {
    const t = this.timing;
    if (!t || t === 'done') return;
    if (++t.frames <= 60) return;
    t.seconds += dt;
    if (t.frames < 240) return;
    if (t.seconds / (t.frames - 60) > 1 / SLOWEST_FPS) this.bloomOn = false;
    this.timing = 'done';
  }

  private fitCanvas(): void {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    const w = Math.max(1, this.width), h = Math.max(1, this.height);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(PIXEL_RATIO);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);           // at CSS pixels: its first mip is half that
    this.camera.aspect = w / h;
    // the view's centre in the middle of the uncovered part
    const c = this.clear;
    if (c) this.camera.setViewOffset(w, h, w / 2 - (c.x + c.w / 2), h / 2 - (c.y + c.h / 2), w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const gl = this.renderer.getContext();
    const sizes = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as ArrayLike<number> | null;
    this.glow.setView(h * PIXEL_RATIO, this.camera, sizes ? Math.min(256, Number(sizes[1])) : 64);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const c of this.cars) c.dispose();
    this.lot.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

let shadow: THREE.Texture | undefined;
/** A soft dark oval under a car, where its body keeps the light off the ground. */
function contactShadow(car: CarRig): THREE.Mesh {
  if (!shadow) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.scale(1, 0.5);
    const fade = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    fade.addColorStop(0, 'rgba(0,0,0,0.75)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 256, 256);
    shadow = new THREE.CanvasTexture(canvas);
    shadow.colorSpace = THREE.SRGBColorSpace;
  }
  const { halfLength, halfWidth } = car.bounds;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(halfLength * 2.3, halfWidth * 2.4),
    new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006;
  return mesh;
}

/** Over a car: its name as its USB drive has it, and the vehicle's own left and right (Tesla's L and R
 * channels), which are the crowd's right and left. */
function label(car: CarRig): void {
  const tag = (text: string, colour: string, at: [number, number, number], width: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = colour;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = 64;
    do g.font = `bold ${px--}px sans-serif`; while (g.measureText(text).width > 490 && px > 24);
    g.fillText(text, 256, 64);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    sprite.position.set(...at);
    sprite.scale.set(width, width / 4, 1);
    sprite.renderOrder = 20;
    car.group.add(sprite);
  };
  const { halfLength, halfWidth, height } = car.bounds;
  // "Car2_ModelY_CenterLeft" -> "2 · Model Y · center left"
  const m = /^Car(\d+)_([A-Za-z]+)_([A-Za-z]+)$/.exec(car.name);
  const words = (w: string) => w.replace(/([a-z])([A-Z])/g, '$1 $2');
  tag(m ? `${m[1]} · ${words(m[2]!)} · ${words(m[3]!).toLowerCase()}` : car.name, '#ffffff', [halfLength * 0.2, height + 0.9, 0], 2.2);
  tag('VEH LEFT', '#ff6a6a', [halfLength + 0.3, 0.9, -halfWidth * 0.9], 1.2);
  tag('VEH RIGHT', '#6ab4ff', [halfLength + 0.3, 0.9, halfWidth * 0.9], 1.2);
}
