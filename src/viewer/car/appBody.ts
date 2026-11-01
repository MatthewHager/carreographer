// Tesla's own car models from the Tesla app, with Tesla's own closure
// animations (frunk, liftgate, doors, windows, mirrors, charge port).
//
// They're the only car models the viewer draws. They're Tesla's, so they're not in the repository: the
// site serves them from a release (app/models.ts).
//
// The app keeps each kind of lamp in one mesh (all the DRLs, all the brake
// lights...), so lamps are split here by where each triangle sits: per side,
// inner/outer, and the Cybertruck's light bars LED by LED. Closures play the
// app's animation clips at the closure's position (0 closed, 1 open).

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as C from '@/engine/channels';
import type { AppModelId } from '@/engine/vehicles';

export type { AppModelId };

/** What a lamp throws on the ground: the main beams, the reverse lights, the tails' red glow (rig.ts). */
export type PoolKind = 'head' | 'reverse' | 'tail';

/** A car's model as the show uses it, in the car's frame (x forward, y up, z the vehicle's right): what lights,
 * on which channels, and what moves. */
export interface Body {
  root: THREE.Group;
  /** A lamp lights at the brightest of its channels. */
  lamps: { mesh: THREE.Mesh; channels: number[]; color: THREE.Color; gain: number }[];
  /** A bar of LEDs along the mesh's z, `from` to `to`, LED i on channel `leds[i]`. */
  bars: { mesh: THREE.Mesh; leds: number[]; from: number; to: number; color: THREE.Color }[];
  /** A closure's part, set to how far open it is (0-1), whether it's dancing, and the song's time. */
  moves: { channel: number; to: (open: number, dancing: boolean, timeS: number) => void }[];
  /** A pool of light on the ground from a lamp at `from`, aimed toward `to` where it has an aim. */
  pools: { channels: number[]; kind: PoolKind; from: THREE.Vector3; to?: THREE.Vector3 }[];
  /** Small lights a move sets itself (the charge port's): where, how big (m), and the colour times brightness. */
  sparks: { parent: THREE.Object3D; at: THREE.Vector3; size: number; color: THREE.Color }[];
  halfLength: number;
  height: number;
  halfWidth: number;
  /** This car's own copies of the model's paint (none on the Cybertruck: stainless). */
  paints: THREE.MeshStandardMaterial[];
}

/** Lamp colours lit, and their lenses dark. */
const COLORS = {
  white: new THREE.Color('#fff4e0'),
  amber: new THREE.Color('#ffa21a'),
  red: new THREE.Color('#ff1a1a'),
  lensFront: new THREE.Color('#25282d'),
  lensRear: new THREE.Color('#3a0a0a'),
  lensAmber: new THREE.Color('#3a2408'),
};

/** The file each model comes out of the Tesla app as (tesla-model-extractor). */
export const FILES: Record<AppModelId, string> = {
  s_palladium: 'S_Palladium.glb',
  model3_high: '3_High.glb',
  poppyseed: 'Poppyseed.glb',
  x_palladium: 'X_Palladium.glb',
  y_high: 'Y_High.glb',
  bayberry: 'Bayberry.glb',
  bayberry_e41: 'BayberryE41.glb',
  bayberry_e80: 'BayberryE80.glb',
  cybertruck: 'Cybertruck.glb',
};

/** A model from its .glb bytes. */
export function parseAppModel(bytes: ArrayBuffer): Promise<GLTF> {
  return new GLTFLoader().parseAsync(bytes, '');
}

type Side = 'left' | 'right';
/** The spread of a lamp mesh across the car: its z range, and the median |z| of each side. */
interface Spread {
  minZ: number;
  maxZ: number;
  midAbs: Record<Side, number>;
}
/** Where a lamp triangle sits, in the car's frame: x forward, y up, z to the vehicle's right. */
type Classify = (c: THREE.Vector3, spread: Spread) => number[] | undefined;

interface LampRule {
  node: string;
  ids: Classify;
  color: THREE.Color;
  lens: THREE.Color;
  gain?: number;
  /** Move the lit lamp this far out along its surface (m): for lamps the app sets inside a housing. */
  proud?: number;
  /**
   * Only the node's meshes with this material: where the app draws a lamp as its light source plus
   * glow cards across the whole lens (the Model Y Standard's headlights), the light source.
   */
  material?: RegExp;
}
interface BarRule {
  node: string;
  leds: number[];
  color: THREE.Color;
}
interface ModelRules {
  lamps: LampRule[];
  bars: BarRule[];
  /** Each closure's channel and the app's clip that moves it. */
  closures: [number, string][];
  /** The charge port's LED: a node to put it on. */
  portLed?: string;
  /** A charge port door with no clip in the app: hinge this node by hand. */
  portDoor?: string;
  /**
   * Mirrors the app doesn't animate (the 2025+ Model Y): the pieces inside this box (car frame,
   * metres; |z| from the centre line) are cut out of these meshes and folded back about their base.
   */
  foldMirrors?: { nodes: RegExp; x: [number, number]; y: [number, number]; absZ: number; deg: number };
  /** The headlight beams start at these lamp nodes. */
  beamFrom: string[];
  /** Options the app hides until they're chosen, shown here (the Cybertruck's tonneau cover, shut). */
  show?: RegExp;
  /** A finish for a named material where the app's own reads wrong outside its studio: the
   * Cybertruck's stainless, which the app draws as a clear-coated mirror. */
  finish?: { material: string; color: string; metalness: number; roughness: number };
}

const W = COLORS.white;
const A = COLORS.amber;
const R = COLORS.red;
const sideOf = (c: THREE.Vector3): Side => (c.z < 0 ? 'left' : 'right');
/** The channel of a left-right pair (Tesla numbers each pair left, then right) on the triangle's side. */
const on = (c: THREE.Vector3, left: number) => (c.z < 0 ? left : left + 1);
const each = (left: number): Classify => (c) => [on(c, left)];
const fixed = (...channels: number[]): Classify => () => channels;
/** Per side: the outer half of the lamp (by area) is `outer`, the inner half `inner`. */
const innerOuter = (outer: number, inner: number): Classify => (c, r) =>
  [on(c, Math.abs(c.z) > r.midAbs[sideOf(c)] ? outer : inner)];
const mainBeams = innerOuter(C.L_OUTER_MAIN, C.L_INNER_MAIN);
/** Tesla's Model 3/Y "signature + channels 4-6": one light per side on these cars. */
const drl3Y = (c: THREE.Vector3) => [C.L_SIGNATURE, C.L_CH4, C.L_CH5, C.L_CH6].map((l) => on(c, l));
/** The lamp in the front bumper (aux park), which the Model S lights with the side marker, per side. */
const auxPark = (c: THREE.Vector3) => [on(c, C.L_AUX_PARK), on(c, C.L_SIDE_MARKER)];
/** A Model 3 or Y lights its aux park lamps and side markers all together (Tesla's README). */
const AUX_3Y = [C.L_AUX_PARK, C.R_AUX_PARK, C.L_SIDE_MARKER, C.R_SIDE_MARKER];
/** A turn signal mesh with the front lamp ahead of `x` and the fender repeater behind it. */
const turnSplit = (x: number): Classify => (c) => [on(c, c.x > x ? C.L_FRONT_TURN : C.L_SIDE_REPEATER)];
/** The 2025+ Model Y's front bar: each end on its side's channel 4, the middle on channel 6 (either side). */
const frontBar: Classify = (c, r) =>
  Math.abs(c.z) < 0.5 * Math.max(-r.minZ, r.maxZ) ? [C.L_CH6, C.R_CH6] : [on(c, C.L_CH4)];

/**
 * The Model X headlight, one mesh in the app: above a line rising toward the outside, channels 6, 5
 * and 4 from inner to outer; below it the inner and outer main beams; the bumper lamp below that.
 */
const xHeadlight: Classify = (c) => {
  if (c.y < 0.6) return auxPark(c);
  const a = Math.abs(c.z);
  const t = THREE.MathUtils.clamp((a - 0.5) / 0.4, 0, 1);
  if (c.y > 0.772 + 0.08 * t) return [on(c, t > 0.66 ? C.L_CH4 : t > 0.33 ? C.L_CH5 : C.L_CH6)];
  return [on(c, a > 0.7 ? C.L_OUTER_MAIN : C.L_INNER_MAIN)];
};

const WINDOWS: [number, string][] = [
  [C.L_FRONT_WINDOW, 'LFWindowAnimation'], [C.R_FRONT_WINDOW, 'RFWindowAnimation'],
  [C.L_REAR_WINDOW, 'LRWindowAnimation'], [C.R_REAR_WINDOW, 'RRWindowAnimation'],
];
const MIRRORS: [number, string][] = [[C.L_MIRROR, 'LFDoorMirrorAnimation'], [C.R_MIRROR, 'RFDoorMirrorAnimation']];
const LIFTGATE: [number, string] = [C.LIFTGATE, 'TrunkAnimation'];
const PORT: [number, string] = [C.CHARGE_PORT, 'ChargeportAnimation'];

const RULES: Record<AppModelId, ModelRules> = {
  // 2025+ Model Y. On-car tests (docs/HOW_IT_WORKS.md): the front bar is three sections (each end on
  // its side's channel 4, the centre on channel 6), the "Brake" channel lights the rear bar and the
  // "Tail" channels the brake lamps; the fender repeaters work.
  bayberry: {
    lamps: [
      { node: 'Headlights_On', ids: mainBeams, color: W, lens: COLORS.lensFront },
      { node: 'DRL', ids: frontBar, color: W, lens: COLORS.lensFront },
      { node: 'Left_Turn_Signal_On', ids: turnSplit(1.9), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal_On', ids: turnSplit(1.9), color: A, lens: COLORS.lensAmber },
      { node: 'Back_Left_Turn_Signal_On', ids: fixed(C.L_REAR_TURN), color: A, lens: COLORS.lensAmber },
      { node: 'Back_Right_Turn_Signal_On', ids: fixed(C.R_REAR_TURN), color: A, lens: COLORS.lensAmber },
      // The tail lamps, and the high centre brake light at the top of the liftgate.
      { node: 'Brake_Lights_On', ids: (c) => (c.y > 1.3 ? [C.BRAKE] : [on(c, C.L_TAIL)]), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Parking_Lights_On', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear, gain: 8, proud: 0.015 },
      { node: 'Reverse Light On', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront },
      { node: 'Fog_Light_On', ids: fixed(C.REAR_FOG), color: R, lens: COLORS.lensRear },
    ],
    bars: [],
    closures: [LIFTGATE, PORT, ...WINDOWS],
    portLed: 'Charge_Port_Cover',
    // The mirror cap is its own mesh; the housing and glass are part of the door's meshes.
    foldMirrors: { nodes: /^(Skullcap_[LR]F_Paint|Front_(Left|Right)_Door)/, x: [0.56, 0.88], y: [0.98, 1.25], absZ: 0.945, deg: 62 },
    beamFrom: ['Headlights_On'],
  },
  // 2020-24 Model Y: one DRL/signature lamp per side (channels 4-6 OR'd into it).
  y_high: {
    lamps: [
      { node: 'Headlights', ids: (c, r) => (c.x > 1.5 ? mainBeams(c, r) : undefined), color: W, lens: COLORS.lensFront },
      { node: 'DRL', ids: drl3Y, color: W, lens: COLORS.lensFront },
      { node: 'Fog_Lights_Front', ids: each(C.L_FRONT_FOG), color: W, lens: COLORS.lensFront },
      // The front corner amber is the turn signal and the side marker (one lamp on the car).
      { node: 'Left_Turn_Signal', ids: (c) => (c.x > 1.5 ? [C.L_FRONT_TURN, ...AUX_3Y] : [c.x < -1.5 ? C.L_REAR_TURN : C.L_SIDE_REPEATER]), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal', ids: (c) => (c.x > 1.5 ? [C.R_FRONT_TURN, ...AUX_3Y] : [c.x < -1.5 ? C.R_REAR_TURN : C.R_SIDE_REPEATER]), color: A, lens: COLORS.lensAmber },
      // North American cars signal from the red tail lamps.
      { node: 'Brake_Lights_Left', ids: fixed(C.L_TAIL, C.BRAKE, C.L_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Right', ids: fixed(C.R_TAIL, C.BRAKE, C.R_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Center', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear },
      { node: 'Reverse_Lights', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront },
    ],
    bars: [],
    closures: [LIFTGATE, PORT, ...MIRRORS, ...WINDOWS],
    portLed: 'Charge_Cap',
    beamFrom: ['Headlights'],
  },
  // Cybertruck (Tesla's README, "Cybertruck Light Remapping"): the liftgate channel is the frunk,
  // Tail is the reverse lights, Reverse is the bed lights, side repeaters are the rear side markers.
  cybertruck: {
    lamps: [
      { node: 'Headlights2', ids: mainBeams, color: W, lens: COLORS.lensFront },
      // The app draws the corner lamp twice (turn signal, side light); one mesh lights for both.
      { node: 'Left_Turn_Signal_Front2', ids: fixed(C.L_FRONT_TURN, C.L_SIDE_MARKER), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal_Front2', ids: fixed(C.R_FRONT_TURN, C.R_SIDE_MARKER), color: A, lens: COLORS.lensAmber },
      { node: 'Park_Lights2', ids: (c) => (c.x < 0 ? [on(c, C.L_SIDE_REPEATER)] : undefined), color: R, lens: COLORS.lensRear },
      { node: 'Brake_Lights_Trunk2', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear, gain: 4 },
      { node: 'Brake_Lights_Left2', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear, gain: 4 },
      { node: 'Brake_Lights_Right2', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear, gain: 4 },
      { node: 'Reverse_Lights2', ids: each(C.L_TAIL), color: W, lens: COLORS.lensFront },
      { node: 'Bed_Light2', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront, gain: 2 },
    ],
    bars: [
      { node: 'DRL2', leds: C.FRONT_BAR, color: W },
      { node: 'Headlights_Trunk2', leds: C.REAR_BAR, color: R },
    ],
    closures: [[C.LIFTGATE, 'HoodAnimation'], ...MIRRORS, ...WINDOWS],
    portLed: 'Chargeport_Light2',
    portDoor: 'Charge_Cap_Spatial',
    beamFrom: ['Headlights2'],
    show: /^Tonneau$/,
    // brushed stainless: no clear coat, the brush marks spreading every reflection into a soft sheen and
    // scattering a little light, so the truck reads grey from any side, not only where it mirrors a lamp
    finish: { material: 'PaintMix', color: '#c4c7cb', metalness: 0.8, roughness: 0.42 },
  },
  // Model S 2021+ (Tesla's README, "Model S"): the ring around the headlight is the signature on
  // reflector headlights and channels 4-6 on projector ones, so it lights for all four; the bumper lamp
  // is the fog (its outer square) and the aux park strip, which the Model S lights with the side marker.
  s_palladium: {
    lamps: [
      { node: 'Headlights_Front', ids: (c, r) => (c.y < 0.5 ? auxPark(c) : mainBeams(c, r)), color: W, lens: COLORS.lensFront },
      { node: 'DRL', ids: drl3Y, color: W, lens: COLORS.lensFront },
      { node: 'Foglights_Front', ids: each(C.L_FRONT_FOG), color: W, lens: COLORS.lensFront },
      { node: 'Left_Turn_Signal', ids: turnSplit(1.6), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal', ids: turnSplit(1.6), color: A, lens: COLORS.lensAmber },
      // The tail lamps run from the body onto the liftgate; North American cars signal from the red lamps.
      { node: 'Headlights_Rear', ids: each(C.L_TAIL), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'headlights_Trunk', ids: each(C.L_TAIL), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Left', ids: fixed(C.BRAKE, C.L_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Right', ids: fixed(C.BRAKE, C.R_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brakelight_Trunk', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear },
      { node: 'Reverse_Light', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront },
      // The rear fog is only on cars outside North America: the app's global variant.
      { node: 'Foglights_Global', ids: fixed(C.REAR_FOG), color: R, lens: COLORS.lensRear },
    ],
    bars: [],
    closures: [LIFTGATE, PORT, ...MIRRORS, ...WINDOWS],
    portLed: 'Charge_Cap',
    beamFrom: ['Headlights_Front'],
  },
  // Model X 2021+ (README, "Model X"): the strip under the headlight is the signature; inside the
  // headlight channels 6, 5 and 4 run along the top (inner to outer) above the inner and outer main
  // beams. The bumper lamp is the fog (outer square), the aux park strip with the side marker, and
  // the front turn signal. Doors: the falcon doors' and front doors' own clips.
  x_palladium: {
    lamps: [
      { node: 'Headlights_Front', ids: xHeadlight, color: W, lens: COLORS.lensFront },
      { node: 'DRL', ids: each(C.L_SIGNATURE), color: W, lens: COLORS.lensFront },
      { node: 'Fog_Lights', ids: each(C.L_FRONT_FOG), color: W, lens: COLORS.lensFront },
      { node: 'Left_Turn_Signal_Front', ids: turnSplit(1.6), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal_Front', ids: turnSplit(1.6), color: A, lens: COLORS.lensAmber },
      { node: 'Left_Turn_Signal_Rear', ids: fixed(C.L_REAR_TURN), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal_Rear', ids: fixed(C.R_REAR_TURN), color: A, lens: COLORS.lensAmber },
      { node: 'Headlights_Rear', ids: each(C.L_TAIL), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Headlights_Trunk', ids: each(C.L_TAIL), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Spoiler', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear },
      { node: 'Reverse_Light', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront },
    ],
    bars: [],
    closures: [
      LIFTGATE, PORT,
      [C.L_FALCON, 'LRDoorAnimationComplete'], [C.R_FALCON, 'RRDoorAnimationComplete'],
      [C.L_FRONT_DOOR, 'LFDoorAnimation'], [C.R_FRONT_DOOR, 'RFDoorAnimation'],
      ...MIRRORS, ...WINDOWS,
    ],
    portLed: 'Charge_Cap',
    beamFrom: ['Headlights_Front'],
  },
  // Model 3 2017-23: the Model 3/Y layout (README), as on the 2020-24 Model Y. The lower part of the
  // headlight mesh is the aux park strip in the bumper; its rear part is the tail lamps.
  model3_high: {
    lamps: [
      { node: 'Headlights', ids: (c, r) => (c.x < -1.5 ? undefined : c.y < 0.55 ? AUX_3Y : mainBeams(c, r)), color: W, lens: COLORS.lensFront },
      { node: 'Headlights', ids: (c) => (c.x < -1.5 ? [on(c, C.L_TAIL)] : undefined), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'DRL', ids: drl3Y, color: W, lens: COLORS.lensFront },
      { node: 'Fog_Lights_Front', ids: each(C.L_FRONT_FOG), color: W, lens: COLORS.lensFront },
      { node: 'Left_Turn_Signal', ids: (c) => (c.x > 1.5 ? [C.L_FRONT_TURN, ...AUX_3Y] : [C.L_SIDE_REPEATER]), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal', ids: (c) => (c.x > 1.5 ? [C.R_FRONT_TURN, ...AUX_3Y] : [C.R_SIDE_REPEATER]), color: A, lens: COLORS.lensAmber },
      { node: 'Brake_Lights_Left', ids: fixed(C.BRAKE, C.L_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Right', ids: fixed(C.BRAKE, C.R_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Center', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear },
      { node: 'Reverse_Lights', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront },
    ],
    bars: [],
    closures: [LIFTGATE, PORT, ...MIRRORS, ...WINDOWS],
    portLed: 'Chargeport_1',
    beamFrom: ['Headlights'],
  },
  // Model 3 2024+: the Model 3/Y channels on the slim headlight (the DRL strip under it). The app has
  // no front fog or aux park lamp for it; those channels stay dark.
  poppyseed: {
    lamps: [
      { node: 'Headlights', ids: mainBeams, color: W, lens: COLORS.lensFront },
      { node: 'DRL', ids: drl3Y, color: W, lens: COLORS.lensFront },
      { node: 'Left_Turn_Signal_Front', ids: turnSplit(1.5), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal_Front', ids: turnSplit(1.5), color: A, lens: COLORS.lensAmber },
      { node: 'Brake_Lights_Left', ids: fixed(C.L_TAIL, C.BRAKE), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Right', ids: fixed(C.R_TAIL, C.BRAKE), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Left_Turn_Signal_Rear', ids: fixed(C.L_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Right_Turn_Signal_Rear', ids: fixed(C.R_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_Center', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear },
      { node: 'Reverse_Light', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront },
    ],
    bars: [],
    closures: [LIFTGATE, PORT, ...MIRRORS, ...WINDOWS],
    portLed: 'Chargeport1',
    beamFrom: ['Headlights'],
  },
  // Model Y 2025+ Standard: no light bar; the Model 3/Y channels in one-piece headlights. The app
  // draws each headlight lamp as its light source plus glow cards over the whole lens: the sources
  // light here, the DRL strip for the signature and channels 4-6, the projector for the main beams.
  bayberry_e41: {
    lamps: [
      { node: 'DRL_Left', material: /^Light_uv0$/, ids: drl3Y, color: W, lens: COLORS.lensFront },
      { node: 'DRL_Right', material: /^Light_uv0$/, ids: drl3Y, color: W, lens: COLORS.lensFront },
      { node: 'HighBeam_Left', material: /^Light_uv0$/, ids: mainBeams, color: W, lens: COLORS.lensFront },
      { node: 'HighBeam_Right', material: /^Light_uv0$/, ids: mainBeams, color: W, lens: COLORS.lensFront },
      { node: 'Left_Turn_Signal', material: /^Light$/, ids: turnSplit(1.5), color: A, lens: COLORS.lensAmber, gain: 2 },
      { node: 'Right_Turn_Signal_On', material: /^Light$/, ids: turnSplit(1.5), color: A, lens: COLORS.lensAmber, gain: 2 },
      { node: 'Brake_Light', ids: each(C.L_TAIL), color: R, lens: COLORS.lensRear, gain: 3 },
      // North American cars brake and signal from the red lamps above the tails.
      { node: 'Left_Turn_Signal_US', ids: fixed(C.BRAKE, C.L_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Right_Turn_Signal_US', ids: fixed(C.BRAKE, C.R_REAR_TURN), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Brake_Lights_CHMSL_On', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear },
      { node: 'Reverse_US', ids: fixed(C.REVERSE), color: W, lens: COLORS.lensFront },
      { node: 'Rear_Fog', ids: fixed(C.REAR_FOG), color: R, lens: COLORS.lensRear },
    ],
    bars: [],
    closures: [LIFTGATE, PORT, ...WINDOWS],
    portLed: 'Chargeport',
    foldMirrors: { nodes: /^Front_(Left|Right)_Door/, x: [0.56, 0.88], y: [0.98, 1.25], absZ: 0.945, deg: 62 },
    beamFrom: ['HighBeam_Left', 'HighBeam_Right'],
  },
  // Model Y L: the 2025+ Model Y's front bar and rear lamps (the same lamp map). The app has only
  // the fender repeaters of its turn signals and no reverse lamp: those channels stay dark.
  bayberry_e80: {
    lamps: [
      { node: 'Headlights_On', ids: mainBeams, color: W, lens: COLORS.lensFront },
      { node: 'DRL', ids: frontBar, color: W, lens: COLORS.lensFront },
      { node: 'Left_Turn_Signal_On', ids: turnSplit(1.9), color: A, lens: COLORS.lensAmber },
      { node: 'Right_Turn_Signal_On', ids: turnSplit(1.9), color: A, lens: COLORS.lensAmber },
      { node: 'Back_Left_Turn_Signal_On', ids: fixed(C.L_REAR_TURN), color: A, lens: COLORS.lensAmber },
      { node: 'Back_Right_Turn_Signal_On', ids: fixed(C.R_REAR_TURN), color: A, lens: COLORS.lensAmber },
      { node: 'Brake_Lights_On', ids: (c) => (c.y > 1.15 ? [C.BRAKE] : [on(c, C.L_TAIL)]), color: R, lens: COLORS.lensRear, gain: 3 },
      { node: 'Parking_Lights_On', ids: fixed(C.BRAKE), color: R, lens: COLORS.lensRear, gain: 8, proud: 0.015 },
      { node: 'Fog_Light_On', ids: fixed(C.REAR_FOG), color: R, lens: COLORS.lensRear },
    ],
    bars: [],
    closures: [LIFTGATE, PORT, ...WINDOWS],
    portLed: 'Charge_Port_Cover',
    foldMirrors: { nodes: /^Front_(Left|Right)_Door/, x: [0.56, 0.88], y: [0.98, 1.25], absZ: 0.945, deg: 62 },
    beamFrom: ['Headlights_On'],
  },
};

/** Nodes that only make sense in the app (projected light, ground shadows, beams, hotspots). */
const APP_ONLY = /Projection|Beam|Ground|Floor|Shadow|Marker|Defrost|Badge|_GLOBAL|Door_LED|Headlights_Side/i;

/** A car of model `id`, from the app's file: its own copy, turned to face +x, with its lamps split by channel. */
export function buildAppBody(gltf: GLTF, id: AppModelId): Body {
  const rules = RULES[id];
  const car = new THREE.Group();
  const b: Omit<Body, 'halfLength' | 'height' | 'halfWidth' | 'paints'> =
    { root: car, lamps: [], bars: [], moves: [], pools: [], sparks: [] };
  const root = gltf.scene.clone(true);
  // The app's cars face -z with their left at -x; ours face +x with their left at -z.
  const wrap = new THREE.Group();
  wrap.rotation.y = -Math.PI / 2;
  wrap.add(root);
  car.add(wrap);
  // The car's paint: the materials the extractor marks with the app's paint (not the Cybertruck's
  // stainless), this car's own copies so each car of a model can wear its own.
  const paints = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const own = (m: THREE.Material) => {
    if (!(m instanceof THREE.MeshStandardMaterial) || (m.userData as { paint?: string }).paint === undefined) return m;
    if (!paints.has(m)) paints.set(m, m.clone());
    return paints.get(m)!;
  };
  const finish = rules.finish;
  root.traverse((o) => {
    if (finish && o instanceof THREE.Mesh) {
      for (const m of [o.material].flat()) {
        if (!(m instanceof THREE.MeshPhysicalMaterial) || m.name !== finish.material || m.userData.finished) continue;
        m.userData.finished = true;     // the material is shared by every car of the model
        m.color.set(finish.color);
        m.metalness = finish.metalness;
        m.roughness = finish.roughness;
        m.clearcoat = 0;
      }
    }
    if (o instanceof THREE.Mesh) for (const m of [o.material].flat()) clearCoat(m as THREE.Material);
    const hidden = (o.userData as { visible?: boolean }).visible === false && !rules.show?.test(o.name);
    if (hidden || APP_ONLY.test(o.name)) o.visible = false;
    if (o instanceof THREE.Mesh) {
      o.frustumCulled = false;
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    }
  });
  car.updateMatrixWorld(true);
  const toCar = new THREE.Matrix4().copy(car.matrixWorld).invert();
  // A node's meshes: the node itself, or the primitives three.js splits it into (`name_1`...).
  const named = (raw: string) => {
    const name = THREE.PropertyBinding.sanitizeNodeName(raw); // as three.js names nodes: "Reverse Light On" -> "Reverse_Light_On"
    const re = new RegExp(`^${escapeRe(name)}(_\\d+)?$`);
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && (re.test(o.name) || o.parent?.name === name)) out.push(o);
    });
    return out;
  };

  // Lamps: each source mesh is split into one mesh per set of channels, in the car's frame,
  // parented where the source was (so lamps on the liftgate or frunk lid move with it).
  for (const rule of rules.lamps) {
    for (const src of named(rule.node)) {
      if (rule.material && !rule.material.test((src.material as THREE.Material).name)) continue;
      const tris = carTriangles(src, toCar);
      const range = zRange(tris);
      const buckets = new Map<string, number[]>();
      for (const t of tris) {
        const channels = rule.ids(t.c, range);
        if (!channels) continue;
        const key = channels.join('+');
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(...t.p);
      }
      for (const [key, positions] of buckets) {
        const mesh = carFrameMesh(src, positions, car, lensMaterial(rule.lens), rule.proud);
        b.lamps.push({ mesh, channels: key.split('+').map(Number), color: rule.color, gain: rule.gain ?? 5 });
      }
      src.visible = false;
    }
  }
  for (const bar of rules.bars) {
    for (const src of named(bar.node)) {
      const tris = carTriangles(src, toCar);
      const { minZ, maxZ } = zRange(tris);
      const mesh = carFrameMesh(src, tris.flatMap((t) => t.p), car, lensMaterial(COLORS.lensFront));
      b.bars.push({ mesh, leds: bar.leds, from: minZ, to: maxZ, color: bar.color });
      src.visible = false;
    }
  }

  // Closures: the app's clips, scrubbed to the closure's position.
  const mixer = new THREE.AnimationMixer(root);
  for (const [channel, clipName] of rules.closures) {
    const clip = gltf.animations.find((c) => c.name === clipName);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    b.moves.push({ channel, to: (p) => {
      action.time = THREE.MathUtils.clamp(p, 0, 1) * clip.duration;
      mixer.update(0);
    } });
  }
  if (rules.foldMirrors) foldMirrors(b, root, toCar, rules.foldMirrors);
  if (rules.portDoor) {
    const door = root.getObjectByName(rules.portDoor);
    if (door) {
      const base = door.rotation.y;
      b.moves.push({ channel: C.CHARGE_PORT, to: (p) => (door.rotation.y = base - p * THREE.MathUtils.degToRad(100)) });
    }
  }
  // the charge port's light: green while it's open, through the colours while it dances
  const ledAt = rules.portLed ? named(rules.portLed)[0] : undefined;
  if (ledAt) {
    const at = new THREE.Box3().setFromObject(ledAt).applyMatrix4(toCar).getCenter(new THREE.Vector3());
    at.z += Math.sign(at.z || -1) * 0.02;
    const led = { parent: car, at, size: 0.12, color: new THREE.Color(0, 0, 0) };
    b.sparks.push(led);
    b.moves.push({ channel: C.CHARGE_PORT, to: (p, dancing, t) => {
      if (dancing) led.color.setHSL((t * 0.6) % 1, 1, 0.55);
      else led.color.set('#3cff6a');
      led.color.multiplyScalar(p > 0.05 ? 1.2 : 0);
    } });
  }

  // Light the street: headlight beams, the tail lights' red glow and the reverse lights.
  const body = new THREE.Box3();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.visible) body.union(new THREE.Box3().setFromObject(o).applyMatrix4(toCar));
  });
  const head = rules.beamFrom.flatMap(named).map((m) => new THREE.Box3().setFromObject(m).applyMatrix4(toCar));
  if (head.length) {
    // a pool ahead of each side's headlights
    const h = head.reduce((a, c) => a.union(c));
    const x = h.max.x + 0.15, y = (h.min.y + h.max.y) / 2, z = h.max.z * 0.8;
    for (const side of [0, 1]) {
      const s = side ? 1 : -1;
      b.pools.push({ channels: [C.L_OUTER_MAIN + side, C.L_INNER_MAIN + side], kind: 'head',
        from: new THREE.Vector3(x, y, s * z), to: new THREE.Vector3(x + 12, 0, s * (z + 0.9)) });
    }
  }
  b.pools.push({ channels: [C.BRAKE, C.L_TAIL, C.R_TAIL], kind: 'tail', from: new THREE.Vector3(body.min.x - 0.35, 0.7, 0) });
  b.pools.push({ channels: [C.REVERSE], kind: 'reverse', from: new THREE.Vector3(body.min.x - 0.1, 0.9, 0),
    to: new THREE.Vector3(body.min.x - 4.5, 0, 0) });
  // The licence plate light: the plate itself glows (it moves with a liftgate it's mounted on);
  // without a plate mesh, a lit panel where the app marks the plate.
  const plates = [...named('Plate_US'), ...named('Plate_US2')].filter((m) => m.material instanceof THREE.MeshStandardMaterial);
  for (const plate of plates) {
    plate.material = (plate.material as THREE.MeshStandardMaterial).clone();
    b.lamps.push({ mesh: plate, channels: [C.LICENSE_PLATE], color: W, gain: 0.6 });
  }
  /** A small box lamp of its own, `size` and `at` in the car's frame. */
  const panel = (channel: number, lens: THREE.Color, size: [number, number, number], at: [number, number, number], gain: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color: lens, roughness: 0.2, metalness: 0.1 }));
    mesh.position.set(...at);
    car.add(mesh);
    b.lamps.push({ mesh, channels: [channel], color: W, gain });
  };
  const marker = plates.length ? undefined : root.getObjectByName('Plate_Marker');
  if (marker) {
    const at = marker.getWorldPosition(new THREE.Vector3()).applyMatrix4(toCar);
    if (at.x < 0) panel(C.LICENSE_PLATE, new THREE.Color('#9a9a9a'), [0.01, 0.13, 0.3], [at.x - 0.012, at.y, at.z], 0.6);
  }
  // The Cybertruck's aux park channel is the light inside the frunk: seen when the frunk is open.
  if (id === 'cybertruck') panel(C.L_AUX_PARK, COLORS.lensFront, [0.4, 0.01, 0.08], [body.max.x - 0.55, 0.95, 0], 3);

  return {
    ...b,
    halfLength: Math.max(-body.min.x, body.max.x),
    height: body.max.y,
    halfWidth: Math.max(-body.min.z, body.max.z),
    paints: [...paints.values()],
  };
}

/**
 * Cuts the mirror out of the meshes it's modelled in and hinges it at its base on the door: closed
 * (folded) it swings back along the body, as Tesla's mirrors do. Each piece keeps its material.
 */
function foldMirrors(b: Pick<Body, 'root' | 'moves'>, root: THREE.Object3D, toCar: THREE.Matrix4, spec: NonNullable<ModelRules['foldMirrors']>): void {
  const sources: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.visible && (spec.nodes.test(o.name) || spec.nodes.test(o.parent?.name ?? ''))) sources.push(o);
  });
  for (const side of ['left', 'right'] as Side[]) {
    const s = side === 'left' ? -1 : 1;
    const pieces: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[] = [];
    let base = new THREE.Vector3();
    let baseN = 0;
    let innermost = Infinity;
    for (const src of sources) {
      const m = new THREE.Matrix4().multiplyMatrices(toCar, src.matrixWorld);
      const geo = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry;
      const pos = geo.getAttribute('position');
      const inside: boolean[] = [];
      const v = new THREE.Vector3();
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const c = new THREE.Vector3();
        for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, i + k).applyMatrix4(m));
        c.divideScalar(3);
        const hit = c.z * s > spec.absZ && c.x >= spec.x[0] && c.x <= spec.x[1] && c.y >= spec.y[0] && c.y <= spec.y[1];
        inside.push(hit);
        if (hit) {
          innermost = Math.min(innermost, Math.abs(c.z));
          if (Math.abs(c.z) < spec.absZ + 0.03) {
            base.add(c);
            baseN++;
          }
        }
      }
      if (!inside.some(Boolean)) continue;
      pieces.push({ geometry: bakeTriangles(geo, m, inside, true), material: src.material });
      src.geometry = bakeTriangles(geo, new THREE.Matrix4(), inside, false); // the door without it
    }
    if (!pieces.length) continue;
    // The hinge: where the mirror's stalk meets the door.
    base = baseN ? base.divideScalar(baseN) : new THREE.Vector3((spec.x[0] + spec.x[1]) / 2, (spec.y[0] + spec.y[1]) / 2, s * innermost);
    base.z = s * innermost;
    const pivot = new THREE.Group();
    pivot.position.copy(base);
    b.root.add(pivot);
    for (const piece of pieces) {
      piece.geometry.translate(-base.x, -base.y, -base.z);
      const mesh = new THREE.Mesh(piece.geometry, piece.material);
      mesh.frustumCulled = false;
      pivot.add(mesh);
    }
    // Unfolded at 1 (the closure's rest); folding swings the glass back toward the rear.
    const fold = THREE.MathUtils.degToRad(spec.deg);
    b.moves.push({ channel: side === 'left' ? C.L_MIRROR : C.R_MIRROR,
      to: (p) => (pivot.rotation.y = (side === 'right' ? -1 : 1) * (1 - THREE.MathUtils.clamp(p, 0, 1)) * fold) });
  }
}

/**
 * The triangles of a non-indexed geometry where `keep[i]` is `want`, with every attribute; positions
 * and normals moved by `m` (identity keeps the source's own space).
 */
function bakeTriangles(geo: THREE.BufferGeometry, m: THREE.Matrix4, keep: boolean[], want: boolean): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const data: number[] = [];
    for (let t = 0; t < keep.length; t++) {
      if (keep[t] !== want) continue;
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        if (name === 'position') data.push(...v.fromBufferAttribute(a, i).applyMatrix4(m).toArray());
        else if (name === 'normal') data.push(...v.fromBufferAttribute(a, i).applyMatrix3(normalMatrix).normalize().toArray());
        else for (let c = 0; c < a.itemSize; c++) data.push(a.getComponent(i, c));
      }
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(data, a.itemSize, a.normalized));
  }
  return out;
}

interface CarTri {
  c: THREE.Vector3;
  p: number[];
}

/** A mesh's triangles in the car's frame, each with its centroid. */
function carTriangles(mesh: THREE.Mesh, toCar: THREE.Matrix4): CarTri[] {
  const m = new THREE.Matrix4().multiplyMatrices(toCar, mesh.matrixWorld);
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = geo.getAttribute('position');
  const out: CarTri[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const p: number[] = [];
    const c = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, i + k).applyMatrix4(m);
      p.push(v.x, v.y, v.z);
      c.add(v);
    }
    out.push({ c: c.divideScalar(3), p });
  }
  return out;
}

function zRange(tris: CarTri[]): Spread {
  let minZ = Infinity;
  let maxZ = -Infinity;
  const abs: Record<Side, number[]> = { left: [], right: [] };
  for (const t of tris) {
    minZ = Math.min(minZ, t.c.z);
    maxZ = Math.max(maxZ, t.c.z);
    abs[sideOf(t.c)].push(Math.abs(t.c.z));
  }
  const median = (v: number[]) => (v.length ? v.sort((a, b) => a - b)[Math.floor(v.length / 2)]! : 0);
  return { minZ, maxZ, midAbs: { left: median(abs.left), right: median(abs.right) } };
}

/**
 * A mesh from car-frame positions, placed under `src`'s parent with a fixed transform from the
 * parent's resting pose, so it follows the parent when a closure animation moves it.
 */
function carFrameMesh(src: THREE.Mesh, positions: number[], car: THREE.Object3D, material: THREE.Material, proud = 0): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  if (proud) {
    // Out toward the viewer: along each face's normal, flipped to point away from the car's middle.
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      if (n.dot(p.clone().setY(0)) < 0) n.negate();
      pos.setXYZ(i, p.x + n.x * proud, p.y + n.y * proud, p.z + n.z * proud);
    }
  }
  const mesh = new THREE.Mesh(geo, material);
  // Under the source's nearest shown ancestor: the app hides its "lamp on" nodes, and a lamp on a
  // liftgate or frunk lid still has to move with it.
  let parent: THREE.Object3D = src.parent ?? car;
  while (!parent.visible && parent.parent) parent = parent.parent;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(parent.matrixWorld).invert().multiply(car.matrixWorld);
  mesh.frustumCulled = false;
  parent.add(mesh);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/**
 * The app's clear coat and glass are perfect mirrors; real ones spread a reflection a little. And its windows
 * are layers of see-through glass (the inside, the tint, the reflection) drawn back to front by each mesh's
 * centre: a layer that also hid what came after it would hide the others, one view the outer glass, the next
 * the inner, so the glass seemed to vanish or sink as the camera turned. Glass never hides glass, and always
 * shows over the black glass it lies on.
 */
function clearCoat(m: THREE.Material): void {
  if (!(m instanceof THREE.MeshStandardMaterial)) return;
  if (m instanceof THREE.MeshPhysicalMaterial && m.clearcoat > 0) m.clearcoatRoughness = Math.max(m.clearcoatRoughness, GLOSS);
  if (m.transparent) m.roughness = Math.max(m.roughness, GLOSS);
  if (m.transparent && /glass/i.test(m.name)) {
    m.depthWrite = false;
    // the glass layers lie on the body's own black glass: drawn a hair nearer, they always show over it
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -4;
    // the app's glass mirrors its studio sky; ours reflects the night over the lot, so the glass reads as a
    // surface, and tinted glass is near-black from outside at night, never a view into the cabin
    m.envMapIntensity = GLASS_REFLECTS;
    if (/tint/i.test(m.name)) m.opacity = Math.max(m.opacity, TINT_OPACITY);
  }
}
const GLASS_REFLECTS = 2.5, TINT_OPACITY = 0.97;
const GLOSS = 0.12;

function lensMaterial(lens: THREE.Color): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: lens,
    roughness: 0.25,
    metalness: 0.1,
    side: THREE.DoubleSide, // the app mirrors one side's lamps (negative scale), which flips their faces
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  clearCoat(m);
  return m;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
