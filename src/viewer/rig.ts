// One car of the lineup: Tesla's model of it (car/appBody.ts), lit and moved by its show. Each frame it
// takes the car's playback (playback.ts) and sets every lamp, LED, ground pool, closure and cabin light.

import * as THREE from 'three';
import { CENTER_DISPLAY, CENTER_FRONT_RGB, LEFT_FRONT_RGB, LEFT_REAR_RGB, MIRRORS, RIGHT_FRONT_RGB, RIGHT_REAR_RGB }
  from '@/engine/channels';
import { buildAppBody, type AppModelId, type Body, type PoolKind } from './car/appBody';
import type { GlowEntry } from './glow';
import { paintColor, type Paint } from './paints';
import { HARDWARE, playback, type Playback } from './playback';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** What each kind of pool throws on the ground: its colour, length and width (m), and opacity at full. The
 * cars' lamps light nothing for real: an iPad can't afford it. */
const POOLS: Record<PoolKind, { color: string; length: number; width: number; opacity: number }> = {
  head: { color: '#fff3dc', length: 6.5, width: 3.2, opacity: 0.3 },
  reverse: { color: '#ffffff', length: 3.5, width: 2.8, opacity: 0.25 },
  tail: { color: '#ff2020', length: 2.6, width: 3.0, opacity: 0.19 },
};

/** The centre screen of every app model: "Display" on the 2025+ Model Y, "Screen_Front" on the others. */
const SCREEN = /^(Screen_Front|Display)\d*$/;
/** The accent strip where a model has one ("LED" on the Cybertruck, "LED_Strip" on the 2024+ Model 3): the
 * dashboard and each door card, Tesla's five accent segments. */
const STRIP = /^(LED|LED_Strip)$/;
const SEGMENTS: [RegExp, number][] = [[/^Dashboard/, CENTER_FRONT_RGB], [/^Doorcard_LF/, LEFT_FRONT_RGB],
  [/^Doorcard_RF/, RIGHT_FRONT_RGB], [/^Doorcard_LR/, LEFT_REAR_RGB], [/^Doorcard_RR/, RIGHT_REAR_RGB]];
/** Where the screen's light falls inside: "it visibly lights up the entire interior, even when the show is
 * viewed from outside" (Tesla's README). The seats and carpet, not the trim, whose name some models share with
 * outside cladding. */
const LIT_INSIDE = /^(Interior|InteriorSeats|Seats|[A-Za-z_]*_Seats|Carpet|Carpet_Black|Upper_Trim)$/;
const SCREEN_GAIN = 3, STRIP_GAIN = 4, INSIDE_GAIN = 0.45;
/** A lamp's halo for its brightness, and an LED's. */
const HALO = 0.4, LED_HALO = 0.7;

interface LitLamp { material: THREE.MeshStandardMaterial; channels: number[]; color: THREE.Color; gain: number;
  halos: { glow: GlowEntry; gain: number }[] }
interface LitBar { leds: number[]; levels: THREE.DataTexture; color: THREE.Color; halos: (GlowEntry | undefined)[] }
interface LitPool { channels: number[]; mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; opacity: number }

export class CarRig {
  readonly group = new THREE.Group();
  readonly glowEntries: GlowEntry[] = [];
  readonly bounds: Pick<Body, 'halfLength' | 'halfWidth' | 'height'>;
  private readonly body: Body;
  private readonly lamps: LitLamp[] = [];
  private readonly bars: LitBar[] = [];
  private readonly pools: LitPool[] = [];
  private readonly sparks: { spark: Body['sparks'][number]; glow: GlowEntry }[] = [];
  private readonly own: { color: THREE.Color; metalness: number; roughness: number }[];
  private readonly cabin = { screens: [] as THREE.MeshStandardMaterial[], inside: [] as THREE.MeshStandardMaterial[],
    strips: [] as { material: THREE.MeshStandardMaterial; rgb: number }[] };
  private show: Playback | undefined;
  private frame = 0;

  constructor(
    readonly name: string,
    private readonly model: { id: AppModelId; gltf: GLTF },
  ) {
    this.body = buildAppBody(model.gltf, model.id);
    this.bounds = this.body;
    this.group.add(this.body.root);
    this.body.root.updateMatrixWorld(true);
    this.own = this.body.paints.map((m) => ({ color: m.color.clone(), metalness: m.metalness, roughness: m.roughness }));
    for (const lamp of this.body.lamps) this.addLamp(lamp);
    for (const bar of this.body.bars) this.addBar(bar);
    for (const pool of this.body.pools) this.addPool(pool);
    for (const spark of this.body.sparks) {
      const glow: GlowEntry = { object: spark.parent, local: spark.at, size: spark.size, color: new THREE.Color(0, 0, 0) };
      this.sparks.push({ spark, glow });
      this.glowEntries.push(glow);
    }
    this.wireCabin();
    this.draw(0);
  }

  /** Paints the car in one of the app's paints, or back in the model's own (null). The Cybertruck has none. */
  setPaint(paint: Paint | null): void {
    this.body.paints.forEach((m, i) => {
      const own = this.own[i]!;
      m.color.copy(paint ? paintColor(paint) : own.color);
      m.metalness = paint ? paint.metallic : own.metalness;
      m.roughness = paint ? paint.roughness : own.roughness;
    });
  }

  /** This car's show file's frames, or none (the car stands dark). */
  setShow(frames: Uint8Array | undefined, nFrames = 0): void {
    this.show = frames ? playback(frames, nFrames, HARDWARE[this.model.id]) : undefined;
    this.frame = 0;
    this.draw(0);
  }

  /** Shows a frame of the show (held at its ends), at `timeS` into the song. */
  setFrame(frame: number, timeS: number): void {
    this.frame = Math.max(0, Math.min((this.show?.nFrames ?? 1) - 1, frame));
    this.draw(timeS);
  }

  private level(ch: number): number {
    return this.show?.light[ch]?.[this.frame] ?? 0;
  }

  private brightest(channels: number[]): number {
    return channels.reduce((most, ch) => Math.max(most, this.level(ch)), 0);
  }

  private draw(timeS: number): void {
    for (const lamp of this.lamps) {
      const l = this.brightest(lamp.channels);
      lamp.material.emissive.copy(lamp.color);
      lamp.material.emissiveIntensity = l * lamp.gain;
      for (const h of lamp.halos) h.glow.color.copy(lamp.color).multiplyScalar(l * h.gain);
    }
    for (const bar of this.bars) {
      const data = bar.levels.image.data as Uint8Array;
      bar.leds.forEach((ch, i) => {
        const l = this.level(ch);
        data[i] = Math.round(l * 255);
        bar.halos[i]?.color.copy(bar.color).multiplyScalar(l * LED_HALO);
      });
      bar.levels.needsUpdate = true;
    }
    for (const pool of this.pools) {
      const l = this.brightest(pool.channels);
      pool.material.opacity = l * pool.opacity;
      pool.mesh.visible = l > 0.005;
    }
    for (const move of this.body.moves) {
      const t = this.show?.travel.get(move.channel);
      move.to(t?.open[this.frame] ?? (MIRRORS.includes(move.channel) ? 1 : 0), !!t?.dancing[this.frame], timeS);
    }
    for (const { spark, glow } of this.sparks) glow.color.copy(spark.color);
    const rgb = (first: number) => [this.level(first), this.level(first + 1), this.level(first + 2)] as const;
    const screen = rgb(CENTER_DISPLAY);
    for (const m of this.cabin.screens) m.emissive.setRGB(...screen);
    for (const m of this.cabin.inside) m.emissive.setRGB(...screen);
    for (const s of this.cabin.strips) s.material.emissive.setRGB(...rgb(s.rgb));
  }

  /** A lamp, and its halos: one for each stretch of about 14 cm along it, so a long tail lamp glows along its
   * length. A halo faces where its stretch of lamp faces, unless the lamp faces every way (a box). */
  private addLamp(lamp: Body['lamps'][number]): void {
    const lit: LitLamp = { material: lamp.mesh.material as THREE.MeshStandardMaterial, channels: lamp.channels,
      color: lamp.color, gain: lamp.gain, halos: [] };
    const scale = lamp.mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    const gain = HALO * Math.min(1.4, Math.sqrt(lamp.gain / 4));
    for (const s of stretches(triangles(lamp.mesh.geometry), 0.14 / scale, 10)) {
      const local = s.centre.clone();
      if (s.facing) local.addScaledVector(s.facing, 0.03 / scale);
      const size = THREE.MathUtils.clamp(Math.sqrt(s.area) * scale * 2.4, 0.14, 0.5);
      const glow: GlowEntry = { object: lamp.mesh, local, normal: s.facing, size, color: new THREE.Color(0, 0, 0) };
      lit.halos.push({ glow, gain });
      this.glowEntries.push(glow);
    }
    this.lamps.push(lit);
  }

  /** A bar of LEDs behind a diffuser, from `from` to `to` along the mesh's z: the bar's light is the LEDs'
   * levels drawn along it from a one-row texture, which blends each with its neighbours as a diffuser does. */
  private addBar(bar: Body['bars'][number]): void {
    const n = bar.leds.length;
    const levels = new THREE.DataTexture(new Uint8Array(n), n, 1, THREE.RedFormat, THREE.UnsignedByteType);
    levels.magFilter = levels.minFilter = THREE.LinearFilter;
    levels.unpackAlignment = 1;
    levels.needsUpdate = true;
    const material = bar.mesh.material as THREE.MeshStandardMaterial;
    material.emissive.copy(bar.color);
    material.emissiveIntensity = 3;
    material.customProgramCacheKey = () => 'led-bar';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.barLevels = { value: levels };
      shader.uniforms.barSpan = { value: new THREE.Vector2(bar.from, bar.to) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vAlong;\nuniform vec2 barSpan;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvAlong = (position.z - barSpan.x) / (barSpan.y - barSpan.x);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlong;\nuniform sampler2D barLevels;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= texture2D(barLevels, vec2(vAlong, 0.5)).r;');
    };
    material.needsUpdate = true;

    // a halo per LED, where the LED's slot of the bar has lens to sit on
    const scale = bar.mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    const slots = Array.from({ length: n }, () => ({ at: new THREE.Vector3(), facing: new THREE.Vector3(), area: 0 }));
    for (const t of triangles(bar.mesh.geometry)) {
      const u = (t.centre.z - bar.from) / (bar.to - bar.from);
      const slot = slots[THREE.MathUtils.clamp(Math.floor(u * n), 0, n - 1)]!;
      slot.at.addScaledVector(t.centre, t.area);
      slot.facing.addScaledVector(t.normal, t.area);
      slot.area += t.area;
    }
    // wide enough that neighbouring LEDs' halos run together
    const size = THREE.MathUtils.clamp((Math.abs(bar.to - bar.from) / n) * scale * 4, 0.08, 0.22);
    const halos = slots.map((s) => {
      if (!s.area) return undefined;
      const local = s.at.divideScalar(s.area);
      const normal = s.facing.lengthSq() > 1e-12 ? s.facing.normalize() : undefined;
      if (normal) local.addScaledVector(normal, 0.02 / scale);
      const glow: GlowEntry = { object: bar.mesh, local, normal, size, color: new THREE.Color(0, 0, 0) };
      this.glowEntries.push(glow);
      return glow;
    });
    this.bars.push({ leds: bar.leds, levels, color: bar.color, halos });
  }

  /** A pool of light on the ground ahead of a lamp at `from`, toward `to` (or round it, with no aim). */
  private addPool(pool: Body['pools'][number]): void {
    const { color, length, width, opacity } = POOLS[pool.kind];
    const at = pool.from.clone().setY(0);
    let turn = 0;
    if (pool.to) {
      const aim = pool.to.clone().sub(pool.from).setY(0).normalize();
      turn = Math.atan2(-aim.z, aim.x);
      at.addScaledVector(aim, length / 2 + 0.1);
    }
    const material = new THREE.MeshBasicMaterial({ map: poolTexture(), color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, width), material);
    mesh.rotation.set(-Math.PI / 2, 0, turn);
    mesh.position.set(at.x, 0.015, at.z);
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.body.root.add(mesh);
    this.pools.push({ channels: pool.channels, mesh, material, opacity });
  }

  /** The cabin's lights: the centre screen's face in the display's colour (its back stays as the model has it,
   * like a monitor's), that light falling faintly on the seats and carpet, and each piece of an accent strip in
   * its segment's colour. Each gets its own copy of its material. */
  private wireCabin(): void {
    const root = this.body.root;
    // the cars face +x, so a screen turned to the driver faces -x
    const toDriver = new THREE.Vector3(-1, 0, 0).transformDirection(root.matrixWorld);
    const copy = (m: THREE.Material, gain: number) => {
      const c = m instanceof THREE.MeshStandardMaterial ? m.clone() : new THREE.MeshStandardMaterial();
      c.emissive.setRGB(0, 0, 0);
      c.emissiveMap = null;
      c.emissiveIntensity = gain;
      return c;
    };
    const under = (o: THREE.Object3D, re: RegExp) => {
      for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (re.test(p.name)) return true;
      return false;
    };
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return;
      const isScreen = under(o, SCREEN);
      const segment = SEGMENTS.find(([re]) => under(o, re))?.[1];
      const wire = (m: THREE.Material): THREE.Material => {
        if (isScreen) {
          const c = copy(m, SCREEN_GAIN);
          faceOnly(c, toDriver);
          this.cabin.screens.push(c);
          return c;
        }
        if (segment !== undefined && STRIP.test(m.name)) {
          const c = copy(m, STRIP_GAIN);
          this.cabin.strips.push({ material: c, rgb: segment });
          return c;
        }
        if (LIT_INSIDE.test(m.name)) {
          const c = copy(m, INSIDE_GAIN);
          this.cabin.inside.push(c);
          return c;
        }
        return m;
      };
      o.material = Array.isArray(o.material) ? o.material.map(wire) : wire(o.material);
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const m of [o.material].flat()) (m as THREE.Material).dispose();
    });
    for (const bar of this.bars) bar.levels.dispose();
  }
}

/** Lights only the faces turned toward `dir` (world space): a screen's face, not its back. */
function faceOnly(m: THREE.MeshStandardMaterial, dir: THREE.Vector3): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.faceDir = { value: dir };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;')
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvWorldNormal = mat3(modelMatrix) * objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;\nuniform vec3 faceDir;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nif (dot(normalize(vWorldNormal), faceDir) < 0.2) totalEmissiveRadiance = vec3(0.0);');
  };
}

interface Triangle { centre: THREE.Vector3; normal: THREE.Vector3; area: number }

/** A geometry's triangles: centre, unit normal (the vertex normals' where it has them) and area. */
function triangles(g: THREE.BufferGeometry): Triangle[] {
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const ix = (k: number) => (g.index ? g.index.getX(k) : k);
  const n = g.index ? g.index.count : pos.count;
  const out: Triangle[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k + 2 < n; k += 3) {
    const [i, j, l] = [ix(k), ix(k + 1), ix(k + 2)];
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, j);
    c.fromBufferAttribute(pos, l);
    const centre = a.clone().add(b).add(c).divideScalar(3);
    const cross = b.sub(a).cross(c.sub(a));
    const area = cross.length() / 2;
    if (!(area > 0)) continue;
    let normal = cross.clone().normalize();
    if (nrm) {
      const sum = new THREE.Vector3().fromBufferAttribute(nrm, i)
        .add(a.fromBufferAttribute(nrm, j)).add(b.fromBufferAttribute(nrm, l));
      if (sum.lengthSq() > 1e-12) normal = sum.normalize();
    }
    out.push({ centre, normal, area });
  }
  return out;
}

interface Stretch { centre: THREE.Vector3; facing?: THREE.Vector3; area: number }

/** A lamp cut into stretches about `step` long along its longest side (at most `most` of them), each with its
 * area-weighted centre and, where its faces agree, the way it faces. Slivers are dropped. */
function stretches(tris: Triangle[], step: number, most: number): Stretch[] {
  if (!tris.length) return [];
  const box = new THREE.Box3();
  for (const t of tris) box.expandByPoint(t.centre);
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const n = THREE.MathUtils.clamp(Math.ceil(size[axis] / step), 1, most);
  const bins = Array.from({ length: n }, () => ({ at: new THREE.Vector3(), facing: new THREE.Vector3(), area: 0 }));
  for (const t of tris) {
    const u = size[axis] > 0 ? (t.centre[axis] - box.min[axis]) / size[axis] : 0;
    const bin = bins[Math.min(n - 1, Math.floor(u * n))]!;
    bin.at.addScaledVector(t.centre, t.area);
    bin.facing.addScaledVector(t.normal, t.area);
    bin.area += t.area;
  }
  const biggest = Math.max(...bins.map((b) => b.area));
  return bins.filter((b) => b.area >= biggest * 0.04).map((b) => ({
    centre: b.at.divideScalar(b.area),
    // a box's faces cancel out: it shines every way
    facing: b.facing.length() > b.area * 0.35 ? b.facing.normalize() : undefined,
    area: b.area,
  }));
}

let pool: THREE.Texture | undefined;
/** A soft oval of light, brightest a third of the way from the lamp (the texture's left) and gone well inside
 * its edges. */
function poolTexture(): THREE.Texture {
  if (pool) return pool;
  const w = 128, h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w - 1 / 3, v = (y + 0.5) / h - 0.5;
      const d = Math.hypot(u / (u < 0 ? 1 / 3 : 2 / 3), v * 2);
      const k = (y * w + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = d < 1 ? Math.round(255 * Math.cos((d * Math.PI) / 2) ** 3) : 0;
    }
  }
  g.putImageData(img, 0, 0);
  pool = new THREE.CanvasTexture(canvas);
  pool.colorSpace = THREE.SRGBColorSpace;
  return pool;
}
