// How big the show is at each moment: one level, 0..1 per frame, that every layer reads. It follows the
// music's loudness, so a pianissimo is sparse and soft and a fortissimo fills every car, and it saves its
// top for the song's peak, as a lighting designer keeps the full look for the biggest chorus.
//
//   loudness   half of it: the mix's level in dB (an.loudness: the song's loud end 1, 40 dB below it 0),
//              rising at once and falling over a second and a half, so a hit lands at full size and a fade
//              lingers; to the power 1.5, so the steps are wider at the loud end, where music builds
//   rank       two fifths: how loud the music is here against the rest of the song (its loudness over three
//              seconds, ranked): a pop song's verse is only a few decibels under its chorus, but it is
//              the quieter part of the song, and the show should say so
//   activity   a tenth: the notes and drum hits a second, as a rank within the song
//   the top    step 4 only in the peak: the loudest twenty seconds from a little before the middle of the
//              song on (PEAK_FROM) and the nearly as loud music either side (reserveTop); everywhere else the
//              level stops just under it
//
// Five steps (STEP_NAMES), each with a pace (moves.paced) and a size; each starts at its threshold (CALM,
// GROOVE, DRIVE, PEAK: STEPS[k] is where step k + 1 starts):
//   0  hush     single soft lamps, no pulse, no motors
//   1  calm     a lamp or two a note, soft fades, a pulse on the downbeats where the beat is clear
//   2  groove   half cars, the pulse on 1 and 3, the drums, the motors start to move
//   3  drive    every beat, half cars with headlights, the rear lit, the motors spend the most
//   4  peak     everything: whole cars, every lamp on the downbeat, the off-beats too, the lids dancing

import type { Analysis } from './analysis';
import { clip, quantile, searchsorted } from './np';

const STEPS = [0.2, 0.4, 0.6, 0.8];
/** Where each step starts: the level from which the show is calm, in a groove, driving, at the peak. */
export const [CALM, GROOVE, DRIVE, PEAK] = STEPS;
export const STEP_NAMES = ['hush', 'calm', 'groove', 'drive', 'peak'];
const RISE_S = 0.15, FALL_S = 1.5;

/** Per frame: notes and drum hits a second, over the two seconds around. */
function activity(an: Analysis): Float32Array {
  const n = an.nFrames, hits = new Float32Array(n);
  const add = (t: number) => {
    const f = Math.round(t / an.step);
    if (f >= 0 && f < n) hits[f] += 1;
  };
  for (const t of an.events.t) add(t);
  for (const list of [an.kick, an.snare, an.hats]) for (const [t, s] of list) if (s >= 0.25) add(t);
  const half = Math.round(1 / an.step), out = new Float32Array(n), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + hits[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    out[i] = (cs[b] - cs[a]) / ((b - a) * an.step);
  }
  return out;
}

/** Each value's rank among `pool` (sorted), 0..1. */
function rankIn(pool: Float64Array, v: number): number {
  return pool.length > 1 ? searchsorted(pool, v) / (pool.length - 1) : 0.5;
}

/** The level curve: see the module notes. */
export function levelCurve(an: Analysis): Float32Array {
  const n = an.nFrames, x = an.loudness;
  const up = 1 - Math.exp(-an.step / RISE_S), down = 1 - Math.exp(-an.step / FALL_S);
  const loud = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) loud[i] = y += (x[i] - y) * (x[i] > y ? up : down);
  const half = Math.round(1.5 / an.step), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  const slow = Float64Array.from({ length: n }, (_, i) => {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    return (cs[b] - cs[a]) / (b - a);
  });
  const heard = slow.filter((v) => v > 0.05).sort();
  const act = activity(an), lo = quantile(act, 0.1), hi = Math.max(quantile(act, 0.95), lo + 1e-6);
  const out = loud.map((v, i) => clip(0.5 * v ** 1.5 + 0.4 * rankIn(heard, slow[i])
    + 0.1 * clip((act[i] - lo) / (hi - lo), 0, 1), 0, 1));
  return reserveTop(an, out);
}

const PEAK_S = 20;          // the peak is found as the loudest stretch this long ...
const PEAK_FROM = 0.45;     // ... starting this far into the song (a climax can start just before halfway)

/** The top step is the peak's alone: the loudest PEAK_S starting from PEAK_FROM of the song (by the mean
 * level), stretched both ways while the music stays nearly as loud, and any later stretch as loud (an outro
 * that repeats the last chorus). Everywhere else the level stops just under the top; a peak that falls short
 * of the top is lifted to it. */
function reserveTop(an: Analysis, out: Float32Array): Float32Array {
  const n = out.length, w = Math.min(n, Math.round(PEAK_S / an.step)), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + out[i];
  const mean = (a: number, b: number) => (cs[b] - cs[a]) / Math.max(1, b - a);
  let best = Math.min(Math.trunc(PEAK_FROM * n), n - w);
  for (let a = best; a + w <= n; a++) if (mean(a, a + w) > mean(best, best + w)) best = a;
  const top = mean(best, best + w), r = Math.round(2 / an.step);
  const near = (i: number) => mean(Math.max(0, i - r), Math.min(n, i + r + 1));      // over four seconds
  let a = best, b = best + w;
  while (a > 0 && near(a - 1) >= 0.9 * top) a--;
  while (b < n && near(b) >= 0.9 * top) b++;
  const peak = new Uint8Array(n).fill(1, a, b);
  for (let i = b; i < n; i++) if (near(i) >= 0.95 * top) peak[i] = 1;
  const lift = Math.max(0, PEAK + 0.06 - top);
  for (let i = 0; i < n; i++) {
    out[i] = peak[i] ? Math.min(1, out[i] + lift * clip((out[i] - 0.4) / 0.4, 0, 1))
      : Math.min(out[i], PEAK - 0.01);
  }
  return out;
}

/** [start, end] of the audible music: the first and last moments louder than 30 dB under its loud end. */
export function musicSpan(an: Analysis): [number, number] {
  let first = -1, last = -1;
  for (let i = 0; i < an.loudness.length; i++) {
    if (an.loudness[i] > 0.25) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return [0.0, an.duration];
  return [first * an.step, (last + 1) * an.step];
}

const SILENT = 0.06, SILENT_S = 0.4;     // the loudness (an.loudness) of silence, and how long it must last

/** Per frame, how many frames the music has been silent for (0 while it sounds, at most 255), wherever it
 * stops for SILENT_S or more: silence is dark (Car.light). A frame's grace either side, as the lights lead
 * the sound by one. */
export function silence(an: Analysis): Uint8Array {
  const x = an.loudness, n = an.nFrames, out = new Uint8Array(n), need = Math.round(SILENT_S / an.step);
  for (let a = 0; a < n;) {
    let b = a;
    while (b < n && x[b] < SILENT) b++;
    if (b - a >= need) for (let f = a + 2; f < b - 1; f++) out[f] = Math.min(255, f - a - 1);
    a = Math.max(b, a + 1);
  }
  return out;
}

/** The level at t, 0..1 (choreograph sets an.level). */
export function levelAt(an: Analysis, t: number): number {
  const lv = an.level!;
  return lv[clip(Math.trunc(t / an.step), 0, lv.length - 1)];
}

/** The level's step, 0 (hush) to 4 (the peak). */
export function stepOf(level: number): number {
  let k = 0;
  while (k < STEPS.length && level >= STEPS[k]) k++;
  return k;
}

/** The mean level over [t0, t1). */
export function levelOver(an: Analysis, t0: number, t1: number): number {
  const lv = an.level!;
  const a = clip(Math.trunc(t0 / an.step), 0, lv.length - 1);
  const b = clip(Math.trunc(t1 / an.step), a + 1, lv.length);
  let m = 0;
  for (let i = a; i < b; i++) m += lv[i];
  return m / (b - a);
}
