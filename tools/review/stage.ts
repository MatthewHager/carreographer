// What each car of a show does, as the crowd would see it: the preview's own playback (viewer/playback.ts:
// Tesla's ramps, the lamps the car really has, closure travel), turned into rows of brightness per lamp, the
// crowd's left first.

import * as C from '@/engine/channels';
import { VEHICLES, type AppModelId } from '@/engine/vehicles';
import { HARDWARE, playback, type Playback } from '@/viewer/playback';
import type { Rgb } from './image';

export interface Row {
  label: string;
  kind: 'lamp' | 'closure' | 'pixels' | 'rgb';
  color: Rgb;
  /** One series (a single lamp), two (crowd's left, then right), or a bar's pixels (crowd's left first). */
  series: Float32Array[];
  dancing?: Uint8Array[];
  rgb?: Uint8Array;           // kind 'rgb': three bytes per frame
}

export interface CarView {
  name: string;
  letter: string;
  rows: Row[];
  /** The lamps that count for flashes and "lit": every lamp series, and a bar as its mean. */
  lamps: Float32Array[];
}

const WHITE: Rgb = [235, 240, 255], AMBER: Rgb = [255, 165, 30], WARM: Rgb = [255, 228, 160], RED: Rgb = [255, 45, 40];
const MOTOR: Rgb = [60, 200, 255];

/** A row of lamps: its label, colour, and per side (the vehicle's left, then right; one for a lamp in the
 * middle) the channels that light it, at their brightest. */
type LampRow = [label: string, color: Rgb, sides: number[][]];
const pair = (label: string, color: Rgb, left: number, ...more: number[]): LampRow =>
  [label, color, [[left, ...more], [left + 1, ...more.map((m) => m + 1)]]];
const one = (label: string, color: Rgb, ...channels: number[]): LampRow => [label, color, [channels]];

/** The rows each model's lamps make, front then rear, as the car wires them. */
function lampRows(model: AppModelId): { front: LampRow[]; rear: LampRow[] } {
  if (model === 'cybertruck') {
    return {
      front: [pair('outer main beam', WHITE, C.L_OUTER_MAIN), pair('inner main beam', WHITE, C.L_INNER_MAIN),
        pair('front turn', AMBER, C.L_FRONT_TURN), pair('side marker', AMBER, C.L_SIDE_MARKER),
        one('frunk light', WHITE, C.L_AUX_PARK)],
      rear: [one('brake', RED, C.BRAKE), pair('reverse light', WHITE, C.L_TAIL),
        pair('rear side marker', AMBER, C.L_SIDE_REPEATER), one('bed lights', WHITE, C.REVERSE),
        one('licence plate', WHITE, C.LICENSE_PLATE)],
    };
  }
  const has = new Set(HARDWARE[model].lamps);
  const lightBar = !has.has(C.L_SIGNATURE);
  const threeY = !lightBar && model !== 's_palladium' && model !== 'x_palladium';
  const front: LampRow[] = [pair('outer main beam', WHITE, C.L_OUTER_MAIN), pair('inner main beam', WHITE, C.L_INNER_MAIN)];
  if (lightBar) front.push(pair('bar end', WHITE, C.L_CH4), one('bar middle', WHITE, C.L_CH6, C.R_CH6));
  // a Model 3 or Y has one lamp per side for the signature and channels 4 to 6
  else if (threeY) front.push(pair('signature, 4-6', WHITE, C.L_SIGNATURE, C.L_CH4, C.L_CH5, C.L_CH6));
  else front.push(pair('signature', WHITE, C.L_SIGNATURE), pair('channel 4', WHITE, C.L_CH4),
    pair('channel 5', WHITE, C.L_CH5), pair('channel 6', WHITE, C.L_CH6));
  front.push(pair('front turn', AMBER, C.L_FRONT_TURN));
  if (!lightBar) {
    front.push(pair('front fog', WARM, C.L_FRONT_FOG));
    // the Model S lights aux park with the side marker on its side; a Model 3 or Y all four together
    if (threeY) front.push(one('aux park, side markers', WARM, C.L_AUX_PARK, C.R_AUX_PARK, C.L_SIDE_MARKER, C.R_SIDE_MARKER));
    else if (model === 's_palladium') front.push(pair('aux park, side marker', WARM, C.L_AUX_PARK, C.L_SIDE_MARKER));
    else front.push(pair('aux park', WARM, C.L_AUX_PARK), pair('side marker', AMBER, C.L_SIDE_MARKER));
  }
  front.push(pair('side repeater', AMBER, C.L_SIDE_REPEATER));
  const rear: LampRow[] = [pair('rear turn', AMBER, C.L_REAR_TURN), one(lightBar ? 'rear bar (brake)' : 'brake', RED, C.BRAKE),
    pair('tail', RED, C.L_TAIL), one('reverse', WHITE, C.REVERSE), one('rear fog', RED, C.REAR_FOG),
    one('licence plate', WHITE, C.LICENSE_PLATE)];
  return { front, rear };
}

const CLOSURES: [string, number, number?][] = [
  ['falcon door', C.L_FALCON, C.R_FALCON], ['front door', C.L_FRONT_DOOR, C.R_FRONT_DOOR],
  ['mirror', C.L_MIRROR, C.R_MIRROR], ['front window', C.L_FRONT_WINDOW, C.R_FRONT_WINDOW],
  ['rear window', C.L_REAR_WINDOW, C.R_REAR_WINDOW], ['liftgate', C.LIFTGATE],
  ['front door handle', 41, 43], ['rear door handle', 42, 44], ['charge port', C.CHARGE_PORT],
];

/** The brightest of `channels` a frame (those the car has), or nothing if it has none of them. */
function brightest(play: Playback, channels: number[]): Float32Array | undefined {
  const lit = channels.map((ch) => play.light[ch]).filter((s): s is Float32Array => !!s);
  if (!lit.length) return undefined;
  if (lit.length === 1) return lit[0];
  const out = new Float32Array(play.nFrames);
  for (const s of lit) for (let f = 0; f < out.length; f++) out[f] = Math.max(out[f], s[f]);
  return out;
}

/** Mean of a bar's pixels per frame. */
function barMean(pixels: Float32Array[]): Float32Array {
  const out = new Float32Array(pixels[0].length);
  for (const p of pixels) for (let f = 0; f < out.length; f++) out[f] += p[f] / pixels.length;
  return out;
}

/** One car's rows, from its show file's frames. */
export function carView(name: string, letter: string, frames: Uint8Array, nFrames: number): CarView {
  const model = VEHICLES[letter].body, hw = HARDWARE[model];
  const play = playback(frames, nFrames, hw);
  const lampRow = ([label, color, sides]: LampRow): Row | undefined => {
    // two sides: the crowd's left (the vehicle's right) first
    const series = (sides.length === 2 ? [sides[1], sides[0]] : sides).map((chs) => brightest(play, chs));
    return series.every(Boolean) ? { label, kind: 'lamp', color, series: series as Float32Array[] } : undefined;
  };
  const { front, rear } = lampRows(model);
  const rows: Row[] = front.map(lampRow).filter((r): r is Row => !!r);
  const lamps: Float32Array[] = rows.flatMap((r) => r.series);
  // a bar's LEDs are numbered from the vehicle's left: the crowd's left first is the other end
  const bar = (leds: number[]) => leds.map((ch) => play.light[ch]!).reverse();
  if (play.light[C.FRONT_BAR[0]]) {
    const px = bar(C.FRONT_BAR);
    rows.push({ label: 'front bar (crowd L top)', kind: 'pixels', color: [255, 255, 255], series: px });
    lamps.push(barMean(px));
    if (play.light[C.OFFROAD_BAR[0]]) rows.push({ label: 'offroad bar', kind: 'pixels', color: [255, 255, 255], series: bar(C.OFFROAD_BAR) });
  }
  const back = rear.map(lampRow).filter((r): r is Row => !!r);
  rows.push(...back);
  lamps.push(...back.flatMap((r) => r.series));
  if (play.light[C.REAR_BAR[0]]) {
    // seen from behind, the vehicle's left on top, in 13 groups of 4 LEDs
    const px = bar(C.REAR_BAR).reverse();
    const groups = Array.from({ length: 13 }, (_, i) => {
      const out = new Float32Array(nFrames);
      for (const p of px.slice(i * 4, i * 4 + 4)) for (let f = 0; f < nFrames; f++) out[f] = Math.max(out[f], p[f]);
      return out;
    });
    rows.push({ label: 'rear bar', kind: 'pixels', color: [255, 45, 40], series: groups });
  }
  for (const [label, left, right] of CLOSURES) {
    const tracks = (right === undefined ? [left] : [right, left]).map((ch) => play.travel.get(ch));
    if (!tracks.every(Boolean)) continue;
    rows.push({ label, kind: 'closure', color: MOTOR, series: tracks.map((t) => t!.open),
      dancing: tracks.map((t) => t!.dancing) });
  }
  const rgbs = hw.lamps.filter((ch) => ch >= C.CENTER_DISPLAY);
  if (rgbs.length) {
    const rgb = new Uint8Array(nFrames * 3);
    for (const ch of rgbs) {
      const k = (ch - C.CENTER_DISPLAY) % 3, s = play.light[ch]!;
      for (let f = 0; f < nFrames; f++) rgb[f * 3 + k] = Math.max(rgb[f * 3 + k], Math.round(s[f] * 255));
    }
    rows.push({ label: 'interior', kind: 'rgb', color: [255, 255, 255], series: [], rgb });
  }
  return { name, letter, rows, lamps };
}
