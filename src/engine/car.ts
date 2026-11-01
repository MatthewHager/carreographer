// One car's show: a frame per 20 ms, 200 channels per frame, and the lamp groups the moves speak.
//
// All sides in the choreography are the CROWD's left/right (facing the cars' fronts). Tesla's "Left"
// channels are the vehicle's left (driver's side), which is on the crowd's right, so every group
// method flips, and the front bar's pixels are written crowd-left to crowd-right (Tesla numbers the
// LEDs from the vehicle's left).
//
// The 2025+ Model Y ("Juniper") came out after Tesla's last light show documentation (Dec 2024). Two
// on-car tests in Oct 2026 (teslamotors/light-show issue #183, and github.com/Nghtmare7509/
// tesla-lightshow-juniper, every channel tested alone) agree on what it has: the headlights, the lower
// white lamps and the amber turns as before; channel 4 (7/8) lights the front bar's outer end on its side;
// channel 6 (11/12, either) the bar's whole centre; the side repeaters (21/22) are on its front fenders.
// Its signature, channel 5, fogs, aux park, side markers and channels 47-174 do nothing (the bar is not 60
// LEDs). The choreography speaks the Model Y's lamps, and such a car writes them where it has them
// (JUNIPER), as it writes, so every lighting is shaped on the lamp the crowd sees.

import * as C from './channels';
import { CALM, DRIVE, GROOVE, PEAK } from './level';
import { u8 } from './np';
import { lineupCars, type Vehicle } from './vehicles';

export const LIGHT_LEAD_S = 0.02;   // lights fire one frame before the sound so they read as on the beat
const MIN_ON = 5, MIN_OFF = 3;   // frames: a lamp lit under 100 ms doesn't read, nor one dark under 60 ms
const FADE = 25, PIXEL_FADE = 15;   // frames: a lamp fades out of a silence on the shortest ramp, a bar quicker

export type Side = 'L' | 'R' | null | undefined;
type Chs = number | readonly number[];

const list = (chs: Chs): readonly number[] => (typeof chs === 'number' ? [chs] : chs);

const INNER = [C.L_INNER_MAIN, C.R_INNER_MAIN], OUTER = [C.L_OUTER_MAIN, C.R_OUTER_MAIN];
const CENTRE = [C.L_CH6, C.R_CH6], REPEATERS = [C.L_SIDE_REPEATER, C.R_SIDE_REPEATER];
/** A Model Y lamp -> the 2025+ Model Y lamps that show it: a signature is its side's end of the bar and the
 * centre (a side's accents read as end and centre, both sides as the whole bar), channel 5 that end alone,
 * the markers the fender repeaters. It has no fogs, so the kick leaves its bar to the moves. */
const JUNIPER: Record<number, number[]> = {
  [C.L_SIGNATURE]: [C.L_CH4, ...CENTRE], [C.R_SIGNATURE]: [C.R_CH4, ...CENTRE],
  [C.L_CH5]: [C.L_CH4], [C.R_CH5]: [C.R_CH4], [C.L_FRONT_FOG]: [], [C.R_FRONT_FOG]: [],
  [C.L_SIDE_MARKER]: REPEATERS, [C.R_SIDE_MARKER]: REPEATERS, [C.L_AUX_PARK]: REPEATERS,
  [C.R_AUX_PARK]: REPEATERS,
};

export class Car {
  readonly frames: Uint8Array;
  readonly closureCounts = new Map<number, number>();

  readonly kind: Vehicle['kind'];
  /** A 2025+ Model Y: the Model Y's lamps go where it has them (JUNIPER). */
  readonly juniper: boolean;
  /** A Model X: falcon doors (motors.ts). */
  readonly falcon: boolean;
  readonly nFrames: number;
  readonly step: number;
  /** Per frame, how long the music has been silent there (0 while it sounds): silence is dark. */
  readonly hush: Uint8Array | null;
  /** Per frame, the headlights the beat rings there (pulse.ownership: 1 the inner beams, 2 the outer, 3
   * both): theirs alone, and the whole-stage moments', so the moves light around them (light). */
  readonly beat: Uint8Array | null;

  constructor(
    vehicle: Pick<Vehicle, 'kind' | 'juniper' | 'falcon'>,
    readonly name: string,
    /** Place in the line, 0 on the crowd's left. A lineup's cars are always in this order. */
    readonly x: number,
    grid: { nFrames: number; step: number; hush?: Uint8Array | null; beat?: Uint8Array | null },
  ) {
    this.kind = vehicle.kind;
    this.juniper = vehicle.juniper;
    this.falcon = !!vehicle.falcon;
    ({ nFrames: this.nFrames, step: this.step } = grid);
    this.hush = grid.hush ?? null;
    this.beat = grid.beat ?? null;
    this.frames = new Uint8Array(this.nFrames * C.N_CHANNELS);
  }

  get isCt() {
    return this.kind === 'cybertruck';
  }

  static veh(side: Side): Side {
    return side === 'L' ? 'R' : side === 'R' ? 'L' : side;
  }

  get(f: number, ch: number): number {
    return this.frames[f * C.N_CHANNELS + ch];
  }

  put(f: number, ch: number, v: number) {
    this.frames[f * C.N_CHANNELS + ch] = v;
  }

  fr(t: number): number {
    return Math.min(Math.max(Math.round((t - LIGHT_LEAD_S) / this.step), 0), this.nFrames);
  }

  /** The channels that show `chs` on this car (JUNIPER on a 2025+ Model Y). */
  out(chs: Chs): readonly number[] {
    const cs = list(chs);
    return this.juniper ? [...new Set(cs.flatMap((ch) => JUNIPER[ch] ?? [ch]))] : cs;
  }

  /** The lamps lit from t0 to t1, shaped so the lighting reads: lit at least MIN_ON frames, joined to another
   * lighting under MIN_OFF frames away (so short a dark is a flicker, not a pause), and never lit in a
   * silence: one still lit as the music stops fades out on Tesla's shortest ramp. The headlights are left to
   * the beat while it rings them (`beat`), and a lighting cut there to under MIN_ON frames is left out. */
  light(chs: Chs, t0: number, t1: number, value = C.ON) {
    this.write(chs, t0, t1, value, this.beat);
  }

  /** As light, over the beat's headlights: the beat itself, and the whole stage at once. */
  lightOver(chs: Chs, t0: number, t1: number, value = C.ON) {
    this.write(chs, t0, t1, value, null);
  }

  private write(chs: Chs, t0: number, t1: number, value: number, beat: Uint8Array | null) {
    const a = this.fr(t0), on = value >= 128, n = this.nFrames, cs = this.out(chs);
    let b = this.fr(t1);
    if (b <= a || !cs.length) return;
    if (on) b = Math.min(n, Math.max(b, a + MIN_ON));
    const F = this.frames, N = C.N_CHANNELS, q = this.hush;
    for (const ch of cs) {
      const bit = !beat ? 0 : INNER.includes(ch) ? 1 : OUTER.includes(ch) ? 2 : 0;
      const free = (f: number) => !(bit && beat![f] & bit);
      let from = a, to = b;
      for (let g = a - 1; on && g >= Math.max(0, a - MIN_OFF); g--) {
        if (F[g * N + ch] >= 128) [from, g] = [g + 1, -1];
      }
      for (let g = b; on && g < Math.min(n, b + MIN_OFF); g++) if (F[g * N + ch] >= 128) [to, g] = [g, n];
      for (let f = from; f < to;) {
        let g = f;
        while (g < to && free(g)) g++;
        if (!on || g - f >= MIN_ON || g - f === to - from) {
          for (let k = f; k < g; k++) {
            const v = q?.[k] && on ? (q[k] <= FADE ? C.OFF_500 : 0) : value;
            if (F[k * N + ch] < v) F[k * N + ch] = v;
          }
        }
        for (f = g; f < to && !free(f);) f++;
      }
    }
  }

  /** The lamps dark from t0 to t1 (a pull-back, a strobe's off): a lighting cut there to a stub under MIN_ON
   * frames either side goes dark with it, so a cut never leaves a flash too short to read. */
  dark(chs: Chs, t0: number, t1: number) {
    const a = this.fr(t0), b = this.fr(t1), F = this.frames, N = C.N_CHANNELS, n = this.nFrames;
    if (b <= a) return;
    for (const ch of this.out(chs)) {
      let lo = a, hi = b;
      while (lo > 0 && a - lo < MIN_ON && F[(lo - 1) * N + ch] >= 128) lo--;
      if (a - lo >= MIN_ON) lo = a;
      while (hi < n && hi - b < MIN_ON && F[hi * N + ch] >= 128) hi++;
      if (hi - b >= MIN_ON) hi = b;
      for (let f = lo; f < hi; f++) F[f * N + ch] = 0;
    }
  }

  /** How much of a bar's or a cabin's light shows at frame f: it fades out quickly into a silence. */
  private shows(f: number): number {
    const q = this.hush?.[f] ?? 0;
    return q ? Math.max(0, 1 - (q - 1) / PIXEL_FADE) : 1;
  }

  /** Channels held at `value` from t0 to t1 as they are: a closure's command, the ending's ramps. */
  set(chs: Chs, t0: number, t1: number, value: number) {
    const a = this.fr(t0), b = this.fr(t1);
    for (const ch of this.out(chs)) for (let f = a; f < b; f++) this.frames[f * C.N_CHANNELS + ch] = value;
  }

  /** values: one row per frame from t0, one 0..1 value per channel in `chs` (crowd order for the bar). */
  pixels(chs: readonly number[], t0: number, values: ArrayLike<ArrayLike<number>>) {
    const a = this.fr(t0);
    const b = Math.min(this.nFrames, a + values.length);
    if (b <= a) return;
    const flip = chs.length === C.FRONT_BAR.length && chs.every((c, i) => c === C.FRONT_BAR[i]);
    const n = chs.length, F = this.frames, N = C.N_CHANNELS;
    for (let f = a; f < b; f++) {
      const row = values[f - a], shows = this.shows(f);
      for (let k = 0; k < n; k++) {
        const v = u8(Math.min(Math.max(row[flip ? n - 1 - k : k] * 255, 0), 255) * shows);
        const at = f * N + chs[k];
        if (F[at] < v) F[at] = v;
      }
    }
  }

  rgb(t0: number, t1: number, color: readonly number[], scale = 1.0) {
    const a = this.fr(t0), b = this.fr(t1);
    for (let f = a; f < b; f++) {
      const shows = this.shows(f);
      for (const base of C.ALL_RGB) {
        for (let i = 0; i < 3; i++) {
          const v = Math.trunc(Math.trunc(color[i] * scale) * shows), at = f * C.N_CHANNELS + base + i;
          if (this.frames[at] < v) this.frames[at] = v;
        }
      }
    }
  }

  closure(ch: number, t0: number, t1: number, cmd: number): boolean {
    if (cmd === C.CLOSURE_OPEN || cmd === C.CLOSURE_CLOSE || cmd === C.CLOSURE_DANCE) {
      const n = this.closureCounts.get(ch) ?? 0;
      if (n >= C.CLOSURE_LIMITS[ch]) return false;
      this.closureCounts.set(ch, n + 1);
    }
    this.set(ch, t0, t1, cmd);
    return true;
  }

  // --- Light groups ---
  private pick(side: Side, L: number[], R: number[]): number[] {
    const s = Car.veh(side);
    return s === 'L' ? L : s === 'R' ? R : [...L, ...R];
  }

  heads(side?: Side) {
    return this.pick(side, [C.L_OUTER_MAIN, C.L_INNER_MAIN], [C.R_OUTER_MAIN, C.R_INNER_MAIN]);
  }

  inner(side?: Side) {
    return this.pick(side, [C.L_INNER_MAIN], [C.R_INNER_MAIN]);
  }

  outer(side?: Side) {
    return this.pick(side, [C.L_OUTER_MAIN], [C.R_OUTER_MAIN]);
  }

  /** Model Y signature strip (ramping). Cybertruck: front side marker (ramping). */
  sig(side?: Side) {
    return this.isCt
      ? this.pick(side, [C.L_SIDE_MARKER], [C.R_SIDE_MARKER])
      : this.pick(side, [C.L_SIGNATURE], [C.R_SIGNATURE]);
  }

  /** Model Y channels 4-6 (one combined output per side, ramping); on a 2025+ Model Y 4-5, its bar's end on
   * that side (channel 6 is the bar's centre). Cybertruck: front turn. */
  drl(side?: Side) {
    return this.isCt
      ? this.pick(side, [C.L_FRONT_TURN], [C.R_FRONT_TURN])
      : this.pick(side, this.drlVeh('L'), this.drlVeh('R'));
  }

  /** Distinct front lamps left to right as the crowd sees them (8 on a Model Y). */
  lamps() {
    return [this.sig('L'), this.drl('L'), this.outer('L'), this.inner('L'),
      this.inner('R'), this.outer('R'), this.drl('R'), this.sig('R')];
  }

  /** Model Y signature + channels 4-6 (on a 2025+ Model Y its bar's end on that side and the centre).
   * Cybertruck: front side markers. */
  accents(side?: Side) {
    return this.isCt
      ? this.pick(side, [C.L_SIDE_MARKER], [C.R_SIDE_MARKER])
      : this.pick(side, [C.L_SIGNATURE, ...this.drlVeh('L')], [C.R_SIGNATURE, ...this.drlVeh('R')]);
  }

  /** What one hit lights of the car's half `side` at level s: a single lamp at a hush, then the signature and
   * DRL, from a groove the inner headlight too, from drive the outer one as well (but those the beat rings:
   * light). A truck's half is its side marker and headlights (its bar is drawn separately). A 2025+ Model
   * Y's is its bar's end and centre, but in drive (every beat) only the end, so the busy figures keep its
   * two halves apart. */
  half(side: Side, s: number): number[] {
    const out = this.juniper ? (s >= DRIVE && s < PEAK ? this.drl(side) : this.accents(side))
      : this.isCt || s < CALM ? this.sig(side) : this.accents(side);
    if (s >= GROOVE) out.push(...this.inner(side));
    if (s >= DRIVE) out.push(...this.outer(side));
    return out;
  }

  /** Both halves, and a front light bar's whole width. */
  whole(s: number): number[] {
    return [...this.half('L', s), ...this.half('R', s), ...this.bar()];
  }

  /** A 2025+ Model Y's front light bar, its whole width (a truck's bar is pixels: Car.pixels). */
  bar(): number[] {
    return this.juniper ? this.sig() : [];
  }

  /** The lamps that show a place w across the car (0 its crowd-left end, 1 its right), each lit on its own:
   * the inner beam on that side, and on a 2025+ Model Y the third of its bar there. */
  at(w: number): number[][] {
    const beam = this.inner(w < 0.5 ? 'L' : 'R'), third = Math.min(2, Math.floor(w * 3));
    return this.juniper ? [beam, [this.drl('L'), CENTRE, this.drl('R')][third]] : [beam];
  }

  /** The front lamps that breathe with flowing music, a layer at a time (bed.ts): from the smallest that reads
   * to every headlight. */
  layers(): number[][] {
    if (this.isCt) return [this.frunk(), this.sig(), [], this.outer(), this.heads()];
    if (this.juniper) return [this.drl(), this.markers(), CENTRE, this.outer(), this.heads()];
    return [this.sig(), this.drl(), this.fogs(), this.outer(), this.heads()];
  }

  private drlVeh(vside: 'L' | 'R') {
    if (this.juniper) return vside === 'L' ? [C.L_CH4, C.L_CH5] : [C.R_CH4, C.R_CH5];
    return vside === 'L' ? [C.L_CH4, C.L_CH5, C.L_CH6] : [C.R_CH4, C.R_CH5, C.R_CH6];
  }

  turns(side?: Side) {
    return this.isCt
      ? this.pick(side, [C.L_FRONT_TURN], [C.R_FRONT_TURN])
      : this.pick(side, [C.L_FRONT_TURN, C.L_REAR_TURN], [C.R_FRONT_TURN, C.R_REAR_TURN]);
  }

  markers() {
    if (this.isCt) return [C.L_SIDE_MARKER, C.R_SIDE_MARKER, C.L_SIDE_REPEATER, C.R_SIDE_REPEATER];
    return [C.L_SIDE_MARKER, C.R_SIDE_MARKER, C.L_AUX_PARK, C.R_AUX_PARK];   // one output on Model Y
  }

  fogs() {
    return [C.L_FRONT_FOG, C.R_FRONT_FOG];
  }

  /** A Cybertruck's frunk light, low in the nose (a Model Y's aux park lamps are among its markers). */
  frunk() {
    return this.isCt ? [C.L_AUX_PARK] : [];
  }

  /** The red tail lights. A Cybertruck's channels there are white reverse lights: its tail is the rear bar. */
  tails() {
    return this.isCt ? [] : [C.L_TAIL, C.R_TAIL];
  }

  /** The rear turn signals (a Cybertruck has none of its own: its front turn channels light the corners). */
  rearTurns() {
    return this.isCt ? [] : [C.L_REAR_TURN, C.R_REAR_TURN];
  }

  rear() {
    const chs = [C.BRAKE, C.L_TAIL, C.R_TAIL, C.LICENSE_PLATE];
    return [...chs, ...(this.isCt ? [C.L_SIDE_REPEATER, C.R_SIDE_REPEATER] : [C.REAR_FOG])];
  }

  everything() {
    return [...this.heads(), ...this.accents(), ...this.turns(), ...this.markers(), ...this.fogs(),
      ...this.rear()];
  }
}

/** One Car per letter, crowd-left to right (vehicles.ts), dark wherever `hush` says the music is silent, its
 * headlights the beat's wherever `beat` says it rings. */
export function makeLineup(layout: string, nFrames: number, step: number, hush: Uint8Array | null,
  beat: Uint8Array | null = null): Car[] {
  return lineupCars(layout).map(([name, v], i) => new Car(v, name, i, { nFrames, step, hush, beat }));
}

/** The centrepiece: the Cybertruck nearest the middle of the line, or null without one. */
export function centreTruck(cars: Car[]): Car | null {
  const trucks = cars.filter((c) => c.isCt);
  if (!trucks.length) return null;
  const mid = (cars.length - 1) / 2;
  let best: Car | null = null, bd = Infinity;
  for (const c of trucks) {
    const d = Math.abs(c.x - mid);
    if (d < bd) [best, bd] = [c, d];
  }
  return best;
}
