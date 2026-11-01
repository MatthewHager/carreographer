// Where the cars stand: a parking lot at night after rain. The lineup is backed into one row of stalls,
// square to a planted island behind it, facing the driving aisle and the crowd. The lot repeats along x
// (island, stalls, aisle, stalls) with lamp poles in the islands. The four poles round the lineup light it for
// real, enough to read the cars' shapes and finishes and no more; the farther lamps' pools, the puddles and
// the stall lines are painted by the asphalt's shader (real lights there would cost an iPad too much).
//
// Metres; x forward (toward the crowd), y up, z the vehicle's right.

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

const ISLAND = 2;
const STALL_LENGTH = 5.8;
export const STALL_WIDTH = 2.7;
const AISLE = 7;
/** One repeat of the lot: an island, a row of stalls, the aisle, the next row. */
const BAY = ISLAND + 2 * STALL_LENGTH + AISLE;
/** The curb of the island behind the lineup: the cars back up to it. */
export const REAR_CURB = -3.4;
/** The middle of the k-th island toward the crowd (0 the lineup's, behind it; 1 across the aisle). */
const islandX = (k: number) => REAR_CURB - ISLAND / 2 + k * BAY;
const CURB = 0.15;
const POLE = 8;
/** The poles' places across the lot (z); the first two flank the lineup. */
const POLE_Z = [-13.5, 13.5, -40.5, 40.5];
const LAMP = new THREE.Color('#ffefd9');           // a lot's LED lamps: a warm white
// The lamps that light the lineup for real: the islands behind and ahead of it, each side. Each is an LED
// panel (three.js nits, metres a side): its reflection in paint and glass a soft square, never a pinpoint like
// one of the show's lamps.
const LIGHTING: [number, number][] = [0, 1].flatMap((k) => POLE_Z.slice(0, 2).map((z): [number, number] => [islandX(k), z]));
const PANEL_NITS = 150, PANEL = 1.4;
/** The next lamps out, whose pools the asphalt paints. */
const PAINTED: [number, number][] = [2, -1].flatMap((k) => POLE_Z.slice(0, 2).map((z): [number, number] => [islandX(k), z]));

const n3 = (v: number) => v.toFixed(3);
const ASPHALT_GLSL = /* glsl */ `
  uniform vec2 lotPools[${PAINTED.length}];
  uniform float lotLineShift;
  varying vec3 vLot;
  float lotRand(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }
  float lotNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), s = f * f * (3.0 - 2.0 * f);
    float a = lotRand(i), b = lotRand(i + vec2(1.0, 0.0)), c = lotRand(i + vec2(0.0, 1.0)), d = lotRand(i + 1.0);
    return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
  }
  // 1 in standing water, 0 on damp asphalt: broad soft shapes, with a little ragged edge
  float lotWater(vec2 p) {
    p = p * 0.32 + vec2(3.7, 1.3);
    float n = 0.62 * lotNoise(p) + 0.28 * lotNoise(p * 2.1 + 7.3) + 0.1 * lotNoise(p * 4.3 + 2.9);
    return smoothstep(0.56, 0.66, n);
  }
  // 1 on a stall line: the lines run along x between stalls, in both rows of every bay
  float lotLine(vec2 p) {
    float u = mod(p.x - (${n3(REAR_CURB - ISLAND)}), ${n3(BAY)});
    float inRow = step(${n3(ISLAND)}, u) * step(u, ${n3(ISLAND + STALL_LENGTH)}) + step(${n3(ISLAND + STALL_LENGTH + AISLE)}, u);
    float w = (p.y - ${n3(STALL_WIDTH / 2)} - lotLineShift) / ${n3(STALL_WIDTH)};
    float off = abs(w - floor(w + 0.5)) * ${n3(STALL_WIDTH)};
    // worn paint
    return (1.0 - smoothstep(0.05, 0.07, off)) * inRow * (0.55 + 0.45 * smoothstep(0.2, 0.6, lotNoise(p * 7.0)));
  }
`;

export interface Lot {
  /** The lamp poles, each placed at its foot (the view hides one that would stand in front of the cars). */
  poles: THREE.Object3D[];
  /** Lines the stalls up with a lineup of `n` cars centred on z = 0: an even lineup's middle falls on a line
   * otherwise. */
  stallsFor(n: number): void;
  dispose(): void;
}

export function buildLot(scene: THREE.Scene): Lot {
  const group = new THREE.Group();
  group.name = 'lot';
  scene.add(group);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const lineShift = { value: 0 };

  // the asphalt takes no sky reflection and little highlight: broad glare from the fill washed the lot out
  const asphalt = keep(new THREE.MeshPhysicalMaterial({
    color: '#25282d', roughness: 0.6, metalness: 0, envMapIntensity: 0, specularIntensity: 0.12,
  }));
  asphalt.onBeforeCompile = (shader) => {
    shader.uniforms.lotPools = { value: PAINTED.map(([x, z]) => new THREE.Vector2(x, z)) };
    shader.uniforms.lotLineShift = lineShift;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLot;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLot = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ASPHALT_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float water = lotWater(vLot.xz);
        diffuseColor.rgb *= mix(0.55, 1.25, lotNoise(vLot.xz * 38.0) * 0.6 + lotNoise(vLot.xz * 4.0) * 0.4);
        diffuseColor.rgb *= mix(1.0, 0.45, water);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55), lotLine(vLot.xz) * 0.85);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.08, water);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lamps = 0.0;
        for (int k = 0; k < ${PAINTED.length}; k++) {
          vec2 d = vLot.xz - lotPools[k];
          lamps += exp(-dot(d, d) / 70.0);
        }
        totalEmissiveRadiance += vec3(1.0, 0.86, 0.66) * diffuseColor.rgb * lamps * 0.9;`);
  };
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(120, 120)), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  group.add(ground);

  // the islands: a concrete curb round dark mulch, and the poles
  const concrete = keep(new THREE.MeshStandardMaterial({ color: '#3a3c40', roughness: 0.6 }));
  const mulch = keep(new THREE.MeshStandardMaterial({ color: '#121410', roughness: 0.95, envMapIntensity: 0.2 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.5, metalness: 0.4 }));
  const lit = keep(new THREE.MeshStandardMaterial({ color: '#000', emissive: LAMP, emissiveIntensity: 2.2 }));
  const shapes = {
    curb: keep(new THREE.BoxGeometry(ISLAND, CURB, 120)),
    bed: keep(new THREE.BoxGeometry(ISLAND - 0.3, 0.01, 120)),
    foot: keep(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12)),
    post: keep(new THREE.CylinderGeometry(0.07, 0.1, POLE, 10)),
    head: keep(new THREE.BoxGeometry(0.7, 0.12, 0.7)),
  };
  const at = (mesh: THREE.Mesh, x: number, y: number, z: number) => (mesh.position.set(x, y, z), mesh);
  const poles: THREE.Object3D[] = [];
  for (let k = -1; k <= 3; k++) {
    const x = islandX(k);
    group.add(at(new THREE.Mesh(shapes.curb, concrete), x, CURB / 2, 0), at(new THREE.Mesh(shapes.bed, mulch), x, CURB + 0.005, 0));
    for (const z of POLE_Z) {
      const pole = new THREE.Group().add(
        at(new THREE.Mesh(shapes.foot, concrete), 0, CURB + 0.25, 0),
        at(new THREE.Mesh(shapes.post, steel), 0, CURB + POLE / 2, 0),
        at(new THREE.Mesh(shapes.head, lit), 0, CURB + POLE, 0),
      );
      pole.position.set(x, 0, z);
      poles.push(pole);
      group.add(pole);
    }
  }

  RectAreaLightUniformsLib.init();
  for (const [x, z] of LIGHTING) {
    const panel = new THREE.RectAreaLight(LAMP, PANEL_NITS, PANEL, PANEL);
    panel.position.set(x, CURB + POLE - 0.1, z);
    // tipped toward the lineup, so its light reaches the cars as well as its island
    panel.lookAt(x * 0.35, 0, z * 0.35);
    group.add(panel);
  }

  return {
    poles,
    stallsFor: (n) => void (lineShift.value = n % 2 ? 0 : STALL_WIDTH / 2),
    dispose: () => {
      for (const d of disposables) d.dispose();
      scene.remove(group);
    },
  };
}

/**
 * What the cars' finishes reflect: the night sky over a lit lot, the lamp heads bright and warm overhead, and
 * the wet asphalt under them catching their light. Stainless and chrome mirror it; paint shows it through its
 * clear coat.
 */
export function lotEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const R = 50;
  const dome = new THREE.SphereGeometry(R, 48, 24);
  const pos = dome.getAttribute('position');
  const zenith = new THREE.Color('#121722'), horizon = new THREE.Color('#68717e'), ground = new THREE.Color('#3a3733');
  const colour = new THREE.Color();
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const up = pos.getY(i) / R;
    if (up >= 0) colour.lerpColors(horizon, zenith, Math.sqrt(up));
    else colour.lerpColors(horizon, ground, Math.min(1, -up * 6));
    colour.toArray(colours, i * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const head = new THREE.MeshBasicMaterial({ color: LAMP.clone().multiplyScalar(2) });
  const heads: [number, number, number][] = [
    ...LIGHTING.map(([x, z]): [number, number, number] => [x, z, 1]),
    ...PAINTED.map(([x, z]): [number, number, number] => [x, z, 0.6]),
    [-30, 35, 0.5], [35, -30, 0.5],
  ];
  for (const [x, z, s] of heads) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4 * s, 0.25 * s, 1.4 * s), head);
    box.position.set(x, CURB + POLE, z);
    env.add(box);
  }
  const wet = new THREE.MeshBasicMaterial({ color: LAMP.clone().multiplyScalar(0.35) });
  for (const [x, z] of LIGHTING) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(7, 24), wet);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x * 0.6, 0.01, z * 0.6);
    env.add(pool);
  }
  return env;
}
