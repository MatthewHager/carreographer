// What a car does with its show file, frame by frame: how bright each of its lamps is and how far open each
// closure, as the car itself plays it. The preview draws from this, and so does the review tool.
//
// The rules are Tesla's (github.com/teslamotors/light-show, its README): the first fourteen channels fade
// over the ramp their byte asks for, the next sixteen switch on and off, then the closures' commands, then
// the Cybertruck's bars and the cabin's colours at any level. Each car has only some channels, and plays a
// few differently: HARDWARE.

import * as C from '@/engine/channels';
import { FALCON_CLOSE_S, FALCON_OPEN_S, LIFTGATE_CLOSE_S, LIFTGATE_OPEN_S, MIRROR_S, PORT_S, WINDOW_S }
  from '@/engine/motors';
import type { AppModelId } from '@/engine/vehicles';

export interface Playback {
  nFrames: number;
  /** Each light channel the car has, 0 to 1 a frame (a bar's LED, a cabin colour's red, green or blue too). */
  light: (Float32Array | undefined)[];
  /** Each closure the car has: how far open a frame (0 shut, 1 open, its dance included), and when it dances. */
  travel: Map<number, { open: Float32Array; dancing: Uint8Array }>;
}

/** A car's channels, and where it plays one differently from the rule. */
export interface Hardware {
  lamps: number[];
  closures: number[];
  /** Fading channels it only switches (the Model S and X's signature and front turn signals). */
  switched?: number[];
  /** Switched channels it fades (the Cybertruck's side markers). */
  fading?: number[];
  /** Switched channels it dims to any level (the Cybertruck's brake lights, its rear bar's other half). */
  dimmed?: number[];
  /** Channels 5 and 6 fade over channel 4's ramp, side by side (every car's but the Cybertruck's). */
  rampFromCh4: boolean;
  /** Travel times that differ from the others' (open, close, s): the Cybertruck's frunk. */
  seconds?: Record<number, [number, number]>;
}

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const FRONT = span(C.L_OUTER_MAIN, C.R_SIDE_REPEATER);
const REAR = span(C.L_REAR_TURN, C.LICENSE_PLATE);
const DISPLAY = span(C.CENTER_DISPLAY, C.CENTER_DISPLAY + 2);
const ACCENTS = span(C.RIGHT_REAR_RGB, C.LEFT_REAR_RGB + 2);
const DOOR_HANDLES = span(41, 44);
const SHARED_CLOSURES = [...C.MIRRORS, ...C.WINDOWS, C.LIFTGATE, C.CHARGE_PORT];
const SX_SWITCHED = [C.L_SIGNATURE, C.R_SIGNATURE, C.L_FRONT_TURN, C.R_FRONT_TURN];

const CLASSIC: Hardware = { lamps: [...FRONT, ...REAR, ...DISPLAY], closures: SHARED_CLOSURES, rampFromCh4: true };

// The light-bar Model Y, as owners found it on their cars (docs/HOW_IT_WORKS.md): channel 4 lights each end of
// the front bar and channel 6 its middle, and the signature, channel 5, the fogs, aux park, side markers and
// rear fog do nothing.
const LIGHT_BAR_Y: Hardware = {
  lamps: [
    C.L_OUTER_MAIN, C.R_OUTER_MAIN, C.L_INNER_MAIN, C.R_INNER_MAIN, C.L_CH4, C.R_CH4, C.L_CH6, C.R_CH6,
    C.L_FRONT_TURN, C.R_FRONT_TURN, C.L_SIDE_REPEATER, C.R_SIDE_REPEATER,
    ...REAR.filter((ch) => ch !== C.REAR_FOG), ...DISPLAY, ...ACCENTS,
  ],
  closures: SHARED_CLOSURES,
  rampFromCh4: true,
};

export const HARDWARE: Record<AppModelId, Hardware> = {
  s_palladium: { ...CLASSIC, closures: [...SHARED_CLOSURES, ...DOOR_HANDLES], switched: SX_SWITCHED },
  x_palladium: { ...CLASSIC, closures: [...SHARED_CLOSURES, C.L_FALCON, C.R_FALCON, C.L_FRONT_DOOR, C.R_FRONT_DOOR],
    switched: SX_SWITCHED },
  model3_high: CLASSIC,
  poppyseed: { ...CLASSIC, lamps: [...CLASSIC.lamps, ...ACCENTS] },
  y_high: CLASSIC,
  bayberry: LIGHT_BAR_Y,
  bayberry_e80: LIGHT_BAR_Y,
  bayberry_e41: CLASSIC,
  // Tesla's README, "Cybertruck Light Remapping": aux park is the frunk light, the tails the reverse lights,
  // reverse the bed lights, the side repeaters the rear side markers; the liftgate is the frunk.
  cybertruck: {
    lamps: [
      C.L_OUTER_MAIN, C.R_OUTER_MAIN, C.L_INNER_MAIN, C.R_INNER_MAIN, C.L_FRONT_TURN, C.R_FRONT_TURN,
      C.L_AUX_PARK, C.L_SIDE_MARKER, C.R_SIDE_MARKER, C.L_SIDE_REPEATER, C.R_SIDE_REPEATER,
      C.BRAKE, C.L_TAIL, C.R_TAIL, C.REVERSE, C.LICENSE_PLATE,
      ...C.FRONT_BAR, ...C.REAR_BAR, ...C.OFFROAD_BAR, ...DISPLAY, ...ACCENTS,
    ],
    closures: SHARED_CLOSURES,
    fading: [C.L_SIDE_MARKER, C.R_SIDE_MARKER],
    dimmed: [C.BRAKE],
    rampFromCh4: false,
    seconds: { [C.LIFTGATE]: [LIFTGATE_OPEN_S.cybertruck!, LIFTGATE_CLOSE_S] },
  },
};

/** Each closure's travel (open s, close s) and whether it dances. Mirrors and doors don't; the charge port's
 * dance flashes its light instead of moving the door. */
const MOTORS = new Map<number, [number, number, boolean]>([
  ...[C.L_FALCON, C.R_FALCON].map((ch): [number, [number, number, boolean]] => [ch, [FALCON_OPEN_S, FALCON_CLOSE_S, true]]),
  ...[C.L_FRONT_DOOR, C.R_FRONT_DOOR].map((ch): [number, [number, number, boolean]] => [ch, [22, 3, false]]),
  ...C.MIRRORS.map((ch): [number, [number, number, boolean]] => [ch, [MIRROR_S, MIRROR_S, false]]),
  ...C.WINDOWS.map((ch): [number, [number, number, boolean]] => [ch, [WINDOW_S, WINDOW_S, true]]),
  ...DOOR_HANDLES.map((ch): [number, [number, number, boolean]] => [ch, [2, 2, false]]),
  [C.LIFTGATE, [LIFTGATE_OPEN_S.modely!, LIFTGATE_CLOSE_S, true]],
  [C.CHARGE_PORT, [PORT_S, PORT_S, true]],
]);

/** A fading channel's eight values, off then on, and the ramp each asks for (ms; 0 at once). */
const RAMPS: [byte: number, on: boolean, ms: number][] = [
  [0, false, 0], [C.OFF_500, false, 500], [C.OFF_1000, false, 1000], [C.OFF_2000, false, 2000],
  [C.ON_500, true, 500], [C.ON_1000, true, 1000], [C.ON_2000, true, 2000], [C.ON, true, 0],
];

/** The value a byte asks for: the nearest of the eight (the lower one on a tie). */
function ramp(byte: number): [on: boolean, ms: number] {
  let k = 0;
  while (k < RAMPS.length - 1 && byte > (RAMPS[k]![0] + RAMPS[k + 1]![0]) / 2) k++;
  return [RAMPS[k]![1], RAMPS[k]![2]];
}

/** A closure byte's command: Tesla's are 0, 63, 127, 191 and 255; a byte between counts as the nearest. */
const COMMANDS = ['idle', 'open', 'dance', 'close', 'stop'] as const;
const command = (byte: number) => COMMANDS[Math.min(4, (byte + 32) >> 6)]!;

/** How long one swing of a dance takes (Tesla doesn't say), and how far from where it started it goes. */
const SWING_S = { window: 2, other: 4 };
const SWING = 0.35;

/** `frames` (nFrames x N_CHANNELS bytes, STEP_MS apart) as a car with `hw` plays them. */
export function playback(frames: Uint8Array, nFrames: number, hw: Hardware): Playback {
  const byte = (f: number, ch: number) => frames[f * C.N_CHANNELS + ch]!;
  const light: (Float32Array | undefined)[] = new Array(C.N_CHANNELS);
  for (const ch of hw.lamps) {
    const out = new Float32Array(nFrames);
    const fades = hw.fading?.includes(ch) || (ch <= C.R_FRONT_TURN && !hw.switched?.includes(ch));
    if (hw.dimmed?.includes(ch) || ch >= C.FRONT_BAR[0]!) {
      for (let f = 0; f < nFrames; f++) out[f] = byte(f, ch) / 255;
    } else if (!fades) {
      for (let f = 0; f < nFrames; f++) out[f] = byte(f, ch) > 127 ? 1 : 0;
    } else {
      // channels 5 and 6 switch on their own byte but over channel 4's ramp, on the same side
      const pace = hw.rampFromCh4 && ch >= C.L_CH5 && ch <= C.R_CH6 ? C.L_CH4 + (ch % 2) : ch;
      let level = 0;
      for (let f = 0; f < nFrames; f++) {
        const on = ramp(byte(f, ch))[0], ms = ramp(byte(f, pace))[1];
        const step = ms ? C.STEP_MS / ms : 1;
        level = on ? Math.min(1, level + step) : Math.max(0, level - step);
        out[f] = level;
      }
    }
    light[ch] = out;
  }
  const travel = new Map(hw.closures.map((ch) => [ch, closure(ch, nFrames, (f) => byte(f, ch), hw.seconds?.[ch])]));
  return { nFrames, light, travel };
}

function closure(ch: number, nFrames: number, byte: (f: number) => number, seconds?: [number, number]) {
  const [openS, closeS, dances] = MOTORS.get(ch)!;
  const [up, down] = (seconds ?? [openS, closeS]).map((s) => C.STEP_MS / 1000 / s) as [number, number];
  const window = C.WINDOWS.includes(ch), swings = ch !== C.CHARGE_PORT;
  const swingS = window ? SWING_S.window : SWING_S.other;
  const open = new Float32Array(nFrames), dancing = new Uint8Array(nFrames);
  // mirrors start unfolded (Tesla's own shows begin by folding them), the rest shut
  let at = C.MIRRORS.includes(ch) ? 1 : 0, heading = 0, since = -1;
  for (let f = 0; f < nFrames; f++) {
    const cmd = command(byte(f));
    // idle lets a closure on its way finish; stop holds it where it is
    if (cmd === 'open') heading = 1;
    else if (cmd === 'close') heading = -1;
    else if (cmd === 'stop') heading = 0;
    at = Math.min(1, Math.max(0, at + (heading > 0 ? up : heading < 0 ? -down : 0)));
    if ((heading > 0 && at === 1) || (heading < 0 && at === 0)) heading = 0;
    // a window dances wherever it is, anything else only once fully open
    if (cmd === 'dance' && dances && (window || at >= 0.999)) {
      if (since < 0) since = f;
      const t = ((f - since) * C.STEP_MS) / 1000;
      const swing = swings ? SWING * Math.sin((Math.PI * t) / swingS) ** 2 : 0;
      // a lowered window dances back up a little, so a dance always shows
      open[f] = window && at > 0.5 ? at - swing : window ? at + swing : at - swing;
      dancing[f] = 1;
    } else {
      since = -1;
      open[f] = at;
    }
  }
  return { open, dancing };
}
