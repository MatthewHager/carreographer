// The base look under the moves: what is lit steadily, growing with the level (level.ts), so the whole
// stage carries the song's arc while the moves, the beat and the drums play on top.
//
//   rear       the tail lights from groove up, the number plates, rear fogs and a truck's bed lights from
//              drive up; a truck's rear bar (its tail light) pumps with the bass, brighter as the level rises
//   front bar  a truck's front bar glows under the comets wherever the music plays, brighter with the level
//              (and, where the music flows, with its breath), breathing with the voice and the lead (the
//              600 Hz-4 kHz band), so the centrepiece is there even in a pianissimo
//   cabins     the interiors take the harmony's colour, bar by bar (the pitch class leading the bar, round
//              the circle of fifths, so related keys sit near each other), else the sound's own (purple when
//              dull, amber when bright), in the show's colour scheme (schemes.ts: the whole spectrum, or an
//              occasion's own colours, the dull and bright ones its second and first), brighter as the level rises (and, where the music flows, as it
//              breathes); a white flash on each big accent from a groove up, and on each downbeat from
//              drive up, where there is a beat
//   breath     where the music flows (feel.ts) the front lamps the moves leave free come in by the breath:
//              one layer at a time as a phrase swells, all leaving together as it ends (below)

import type { Analysis } from './analysis';
import * as C from './channels';
import type { Car } from './car';
import { flowsAt } from './feel';
import { CALM, DRIVE, GROOVE, levelAt, musicSpan, PEAK } from './level';
import { clip, runs } from './np';
import type { Scheme } from './schemes';

const DWELL_S = 4.0;          // a lamp of the bed stays at least this long once it changes
const METER = 0.7;            // the rear bar's level meter at the top, so a kick's flash still stands out
const GLOW = 0.15, GLOW_UP = 0.5;   // a truck's front bar: lit this much even in a pianissimo, this much more
                                    // at the top (by the level to the power 1.5, as the level's own steps)
const VOICE = 0.4;            // ... and up to this share of it follows the voice and the lead
const DULL = [110, 0, 200], BRIGHT = [255, 140, 20];
const CABIN_LOW = 0.35;       // the cabins at the quietest: the screen lights the whole interior, so the colour
                              // reads from outside even in a pianissimo, and grows with the level from there
const COLOUR_SURE = 0.5;             // an occasion's cabins take the harmony's colour once it is this clear

/** Per frame, whether the level is at `at` or above where the music beats, held for DWELL_S so a lamp never
 * flickers. */
function above(an: Analysis, at: number): boolean[] {
  const lv = an.level!, dwell = Math.round(DWELL_S / an.step), out: boolean[] = [];
  let on = false, since = -dwell;
  for (let f = 0; f < lv.length; f++) {
    const want: boolean = on ? lv[f] >= at - 0.08 : lv[f] >= at;
    if (want !== on && f - since >= dwell) [on, since] = [want, f];
    out.push(on && !flowsAt(an, f * an.step));
  }
  return out;
}

export function apply(cars: Car[], an: Analysis, scheme: Scheme): void {
  const lv = an.level!, step = an.step;
  const lit: [number, (c: Car) => number[]][] = [
    [GROOVE, (c) => c.tails()],
    [DRIVE, (c) => [C.LICENSE_PLATE, c.isCt ? C.REVERSE : C.REAR_FOG]],
  ];
  for (const [at, chs] of lit) {
    for (const [a, b] of runs(above(an, at))) for (const c of cars) c.light(chs(c), a * step, b * step);
  }
  const B = breath(an);
  const { low, highMid } = an.bands;
  for (const c of cars.filter((q) => q.isCt)) {
    const front: Float64Array[] = [], rear: Float64Array[] = [];
    for (let f = 0; f < an.nFrames; f++) {
      const flows = !Number.isNaN(B[f]), x = flows ? (lv[f] + B[f]) / 2 : lv[f];
      const glow = (GLOW + GLOW_UP * x ** 1.5) * (1 - VOICE + VOICE * highMid[f]);
      front.push(new Float64Array(C.FRONT_BAR.length).fill(glow));
      const meter = flows ? 0 : clip((lv[f] - CALM) / (1 - CALM), 0, 1) * METER * (0.3 + 0.7 * low[f]);
      rear.push(new Float64Array(C.REAR_BAR.length).fill(meter));
    }
    c.pixels(C.FRONT_BAR, 0, front);
    c.pixels(C.REAR_BAR, 0, rear);
  }
  cabins(cars, an, B, scheme);
  breathe(cars, an, B);
}

/** A colour for pitch class `pc` (0 C .. 11 B): its place on the circle of fifths as a hue. */
function hueOf(pc: number): readonly number[] {
  const h = (((pc * 7) % 12) / 12) * 6, x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x]
    : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [r * 255, g * 255, b * 255];
}

/** The spans the cabins hold one colour over: bar to bar (downbeat to downbeat), or two seconds at a time
 * where there are no downbeats. */
function bars(an: Analysis): [number, number][] {
  const d = an.downbeats.filter((x, i, all) => i === 0 || x - all[i - 1] > 0.5);
  const edges = [0];
  for (const x of d) {
    while (x - edges[edges.length - 1] > 4) edges.push(edges[edges.length - 1] + 2);
    if (x - edges[edges.length - 1] > 0.5) edges.push(x);
  }
  while (an.duration - edges[edges.length - 1] > 2) edges.push(edges[edges.length - 1] + 2);
  edges.push(an.duration);
  return edges.slice(1).map((e, i) => [edges[i], e]);
}

/** The interiors (see the module notes). */
function cabins(cars: Car[], an: Analysis, B: Float64Array, scheme: Scheme): void {
  const lv = an.level!, step = an.step, votes = new Float64Array(12), own = scheme.colours;
  const [dull, bright] = own ? [own[1], own[0]] : [DULL, BRIGHT];
  // an occasion's colours share the circle of fifths, so related keys still keep a colour
  const colourOf = own ? (pc: number) => own[Math.trunc((((pc * 7) % 12) * own.length) / 12)] : hueOf;
  for (const [t0, t1] of bars(an)) {
    const a = Math.trunc(t0 / step), b = Math.min(an.nFrames, Math.trunc(t1 / step));
    votes.fill(0);
    for (let f = a; f < b; f++) votes[an.pitchClass[f]] += an.pitchClassStrength[f];
    let pc = 0;
    for (let k = 1; k < 12; k++) if (votes[k] > votes[pc]) pc = k;
    const sure = clip(votes[pc] / Math.max(1, b - a), 0, 1);
    for (let f = a; f < b; f += 5) {
      const s = lv[f], base = dull.map((d, i) => d + (bright[i] - d) * an.brightness[f]);
      // the spectrum blends the harmony into the sound's own colour by how sure it is; an occasion's colours
      // would blend into ones it doesn't have, so it takes one or the other
      const colour = own ? (sure >= COLOUR_SURE ? colourOf(pc) : base)
        : colourOf(pc).map((h, i) => h * sure + base[i] * (1 - sure));
      const scale = CABIN_LOW + (1 - CABIN_LOW) * (Number.isNaN(B[f]) ? s : (B[f] + s) / 2);
      for (const c of cars) c.rgb(f * step, Math.min(f + 5, b) * step, colour, scale);
    }
  }
  for (const d of an.downbeats) {
    if (levelAt(an, d) >= DRIVE && !flowsAt(an, d)) for (const c of cars) c.rgb(d, d + 0.1, [255, 255, 255], 0.8);
  }
  for (const h of an.hits) {
    if (levelAt(an, h) >= GROOVE && !flowsAt(an, h)) for (const c of cars) c.rgb(h, h + 0.12, [255, 255, 255]);
  }
}

// ---- The breath ---------------------------------------------------------------------------------
// Music that flows gives no beat to hit, so the stage breathes with it instead. The breath is mostly the
// swell of each phrase (rising from its start, falling into its end) and partly its loudness against the
// PHRASE_AROUND_S either side; between phrases (a laugh, a drum, a held sound) the loudness alone. Lamps join in
// layers as it rises and leave together as it falls; how many layers a phrase can reach grows with the
// level (one when calm, four well into drive, at the peak a fifth: every headlight, the whole stage open
// for the climax). The lamps that can ramp do so over 2 s; the fogs, markers and tails switch. Car lamps
// can't hold a dim level, so the breath is how many are lit:
//                Model Y       2025+ Model Y            Cybertruck
//     1          signatures    the bar's outer ends     the frunk light
//     2          DRLs          the fender repeaters     side markers         and the tails (a truck's rear bar)
//     3          fogs          the bar's centre         -
//     4          outer beams   outer beams              outer beams
//     5          headlights    headlights               headlights

const RES = 0.25;            // seconds per step of the layers
const HYST = 0.2;            // a layer goes out this far (in layers) below its way in
const MIN_DWELL = 0.75;      // seconds a layer stays once it changes
const PHRASE_AROUND_S = 6;          // a phrase's loudness is measured against this much either side
const LOUD_S = 0.3;          // ... over this much around each moment
const SWELL = 0.6;           // the breath's share that is the phrase's swell (the rest is its loudness)
const SHAPE = 1.2;           // the swell a little narrower than a sine's hump, so it rises off the start
const FULL = DRIVE + 0.1;    // the level from which a phrase can reach every layer
const LATE = 1.6;            // a quiet phrase fills its layers late (its breath to this power), a loud one
                             // at once (to this less one)
const TAIL_BAR = 0.6;        // a truck's rear bar at the tails' layer: red, not a flash

/** Per frame, the breath 0..1 where the music flows, NaN where it doesn't (see above). */
function breath(an: Analysis): Float64Array {
  const n = an.nFrames, x = an.loudness, w = Math.round(LOUD_S / an.step), cs = new Float64Array(n + 1);
  const [start, end] = musicSpan(an);
  const flows = (f: number) => f * an.step >= start && f * an.step < end && flowsAt(an, f * an.step);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  const loud = (i: number) => (cs[Math.min(n, i + w + 1)] - cs[Math.max(0, i - w)])
    / (Math.min(n, i + w + 1) - Math.max(0, i - w));
  const swell = new Float64Array(n).fill(NaN);
  for (const ph of an.phrases ?? []) {
    const a = Math.trunc(ph.t0 / an.step), b = Math.min(n, Math.trunc(ph.t1 / an.step));
    for (let f = a; f < b; f++) swell[f] = Math.sin((Math.PI * (f - a)) / Math.max(1, b - a)) ** SHAPE;
  }
  const out = new Float64Array(n).fill(NaN), reach = Math.round(PHRASE_AROUND_S / an.step), stride = 5;
  for (let i = 0; i < n; i += stride) {
    if (!flows(i)) continue;
    let lo = Infinity, hi = -Infinity;
    for (let j = Math.max(0, i - reach); j < Math.min(n, i + reach); j += stride) {
      if (flows(j)) [lo, hi] = [Math.min(lo, loud(j)), Math.max(hi, loud(j))];
    }
    for (let f = i; f < Math.min(n, i + stride); f++) {
      const rel = clip((loud(f) - lo) / Math.max(hi - lo, 0.1), 0, 1);
      out[f] = Number.isNaN(swell[f]) ? rel : SWELL * swell[f] + (1 - SWELL) * rel;
    }
  }
  return out;
}

/** The front lamps breathing where the music flows: per RES step, as many of the layers the level allows
 * as the breath fills, coming in one at a time and going out together, none changing within MIN_DWELL. The
 * louder the song is there, the sooner each phrase fills its layers. */
function breathe(cars: Car[], an: Analysis, B: Float64Array): void {
  const stride = Math.max(1, Math.round(RES / an.step)), res = stride * an.step, lv = an.level!;
  const steps = Math.ceil(an.nFrames / stride);
  let cur = 0, since = -1e9;
  const lay = Int8Array.from({ length: steps }, (_, i) => {
    const v = B[i * stride], s = lv[i * stride];
    if (Number.isNaN(v)) return (cur = 0) - 1;
    const loud = clip((s - CALM) / (FULL - CALM), 0, 1);
    const cap = 1 + 3 * loud + (s >= PEAK ? 1 : 0), fill = v ** (LATE - loud) * (cap + 1);
    let want = cur;
    while (want < Math.floor(cap) && fill >= want + 1) want += 1;
    while (want > 0 && (fill < want - HYST || want > cap)) want -= 1;
    if (want !== cur && i * res - since >= MIN_DWELL) [cur, since] = [want > cur ? cur + 1 : want, i * res];
    return cur;
  });
  for (let k = 1; k <= 5; k++) {
    for (const [a, b] of runs(Array.from(lay, (v) => v >= k))) {
      for (const c of cars) {
        const chs = [...c.layers()[k - 1], ...(k === 2 ? c.tails() : [])];
        c.light(chs, a * res, b * res, C.ON_2000);
        c.light(chs, b * res, b * res + 2, C.OFF_2000);
        if (k === 2 && c.isCt) {
          const n = c.fr(b * res + 2) - c.fr(a * res), hold = c.fr(b * res) - c.fr(a * res);
          const up = Math.round(2 / c.step);
          const at = (f: number) => Math.min(1, f / up, f < hold ? 1 : 1 - (f - hold) / up);
          c.pixels(C.REAR_BAR, a * res, Array.from({ length: n },
            (_, f) => new Float64Array(C.REAR_BAR.length).fill(TAIL_BAR * at(f))));
        }
      }
    }
  }
}
