// How the music moves, heard from the music alone: no labels, no settings.
//
//   flow        no steady beat to follow, so the lights glide with the melody and breathe with the phrases
//               instead of hitting. Both signs of a beat must be missing: the neural tracker's beats don't
//               keep time (fewer than STEADY of their gaps within STEADY_TOL of the gaps around them, so a
//               performer speeding up still keeps time) and the music doesn't hit on them (clarity under
//               FLOW_CLARITY, or beats slower than SLOWEST_S apart: chord changes, not a pulse): a band's
//               groove can be syncopated, an orchestra's tutti hits everywhere but
//               its tracker hears a firm pulse. A section under ISLAND_S between two that agree goes their
//               way, so the style doesn't flip for a few bars.
//   kit         a rhythm section plays: the listening's kit measure at least KIT over the section
//   followable  a stretch has a beat the lights can follow: steady or clear, its beats covering it, and the
//               music striking at least half of them (not a held chord the tracker carried on through)
//   held        a stretch is a held chord: VOICES notes sounding on through most of it
//
// Flow is measured on the beats as the listening tracked them, before tempo.ts moves them onto what is
// played: where the neural tracker hears no pulse its beats wander, while the fallback draws an even grid.

import type { Analysis, Phrase } from './analysis';
import { clip, mean, median, searchsorted } from './np';
import { beatLen } from './tempo';

const FLOW_CLARITY = 2.2;
const SLOWEST_S = 1.5;     // beats further apart than this (40 bpm) are chord changes, not a pulse to follow
const STEADY = 0.75, STEADY_TOL = 0.05;
const ISLAND_S = 20;
const KIT = 0.6;
const STRUCK = 1.3;

/** One section of the song and how it moves. */
export interface Feel {
  t0: number;
  t1: number;
  letter: string;       // the form map's letter: the same material is the same letter
  flow: boolean;
  kit: boolean;
  steady: boolean;
}

/**
 * How clearly the music beats here: the onset curve's strength on the beats over its mean (1 = no beat
 * to speak of; a steady band groove is 3 and up), over [t0, t1].
 */
function clarity(an: Analysis, t0: number, t1: number): number {
  const env = an.pulseEnv, hop = an.pulseHop;
  const b = an.beats.filter((x) => x >= t0 && x < t1);
  if (!env?.length || b.length < 3) return 1.0;
  const i0 = Math.min(Math.trunc(t0 / hop), env.length);
  const i1 = Math.min(Math.max(i0 + 1, Math.trunc(t1 / hop)), env.length);
  const w = Math.max(1, Math.round(0.03 / hop));
  const peaks = b.map((x) => {
    const i = clip(Math.round(x / hop), 0, env.length - 1);
    let m = -Infinity;
    for (let k = Math.max(0, i - w); k < Math.min(env.length, i + w + 1); k++) m = Math.max(m, env[k]);
    return m;
  });
  return mean(peaks) / (mean(env, i0, i1) + 1e-9);
}

/** The share of the beats' gaps within `tol` of the gaps around them (the median of the eight nearest), or
 * within a frame of the tracker's (20 ms) at a fast tempo: a performer speeding up still keeps time. */
function steadiness(beats: number[], tol: number): number {
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  if (gaps.length < 4) return 0;
  return gaps.filter((g, i) => {
    const m = median(gaps.slice(Math.max(0, i - 4), i + 5));
    return Math.abs(g - m) < Math.max(tol * m, 0.025);
  }).length / gaps.length;
}

/** The listening's kit measure (an.kit) over [t0, t1]: how much a drum kit plays there. */
function kitOver(an: Analysis, t0: number, t1: number): number {
  const a = Math.trunc(t0 / an.step), b = Math.min(an.kit.length, Math.max(a + 1, Math.trunc(t1 / an.step)));
  return mean(an.kit, a, b);
}

const read = new WeakMap<Analysis, Feel[]>();

/** Every section's feel, measured once per analysis (choreograph asks first, before tempo.ts moves the
 * beats). Given the phrases, each change of feel moves to the nearest phrase start, so the lights never
 * change style in the middle of a phrase. */
export function feel(an: Analysis, phrases?: Phrase[]): Feel[] {
  let out = read.get(an);
  if (out && !phrases) return out;
  const spans = an.sections?.length ? an.sections : [{ t0: 0, t1: an.duration, letter: 'A' }];
  out = spans.map(({ t0, t1, letter }) => {
    const beats = an.beats.filter((b) => b >= t0 && b < t1);
    const heard = an.heardBeats ? an.heardBeats.filter((b) => b >= t0 && b < t1) : beats;
    const steady = steadiness(heard, STEADY_TOL) >= STEADY;
    const pulse = beats.length >= 3 && median(beats.slice(1).map((b, i) => b - beats[i])) <= SLOWEST_S;
    const flow = !steady && (!pulse || clarity(an, t0, t1) < FLOW_CLARITY);
    return { t0, t1, letter, flow, kit: false, steady };
  });
  // a short stretch between two that agree goes their way: the style doesn't flip for a few bars (judged on
  // the stretches as heard, so one flip doesn't lead to the next)
  const heardFlow = out.map((f) => f.flow);
  out.forEach((f, i, all) => {
    if (i > 0 && i + 1 < all.length && f.t1 - f.t0 < ISLAND_S && heardFlow[i - 1] === heardFlow[i + 1]) {
      f.flow = heardFlow[i - 1];
    }
    f.kit = !f.flow && kitOver(an, f.t0, f.t1) >= KIT;
  });
  if (phrases?.length) {
    const starts = phrases.map((ph) => ph.t0);
    for (let i = 1; i < out.length; i++) {
      const b = out[i].t0;
      const s = starts.reduce((best, t) => (Math.abs(t - b) < Math.abs(best - b) ? t : best));
      out[i - 1].t1 = out[i].t0 = Math.max(s, out[i - 1].t0);
    }
    out = out.filter((f) => f.t1 > f.t0);
  }
  read.set(an, out);
  return out;
}

function at(an: Analysis, t: number): Feel {
  const all = feel(an);
  return all.find((f) => f.t0 <= t && t < f.t1) ?? all[all.length - 1];
}

/** Whether the music at t has no steady beat to follow, so the lights flow. */
export const flowsAt = (an: Analysis, t: number) => at(an, t).flow;

/** Whether a rhythm section plays at t. */
export const kitAt = (an: Analysis, t: number) => at(an, t).kit;

/** Whether the beat tracker keeps steady time at t. */
export const steadyAt = (an: Analysis, t: number) => at(an, t).steady;

/** Whether the music strikes on the beat at t: the onset curve within 30 ms of it at least STRUCK times its
 * mean over the two seconds around. A beat the tracker carried on through a held chord or a free passage
 * gets no hit. */
function struck(an: Analysis, t: number): boolean {
  const env = an.pulseEnv, hop = an.pulseHop;
  const i = Math.round(t / hop), w = Math.max(1, Math.round(0.03 / hop)), r = Math.round(2 / hop);
  let peak = 0, sum = 0, n = 0;
  for (let k = Math.max(0, i - w); k <= Math.min(env.length - 1, i + w); k++) peak = Math.max(peak, env[k]);
  for (let k = Math.max(0, i - r); k <= Math.min(env.length - 1, i + r); k++, n++) sum += env[k];
  return n > 0 && peak >= STRUCK * (sum / n);
}

const struckMemo = new WeakMap<number[], Uint8Array>();     // keyed on the beat list (see tempo.ts)

/** Per tracked beat, whether the music strikes it (struck). */
export function struckBeats(an: Analysis): Uint8Array {
  let out = struckMemo.get(an.beats);
  if (!out) struckMemo.set(an.beats, (out = Uint8Array.from(an.beats, (t) => (struck(an, t) ? 1 : 0))));
  return out;
}

/** The share of the beats in [t0, t1) that the music strikes: where it is under a half, the music doesn't
 * play on the beat (a held chord, a free passage) and the beat figures and the pulse have nothing to hit. */
export function struckShare(an: Analysis, t0: number, t1: number): number {
  const a = searchsorted(an.beats, t0), b = searchsorted(an.beats, t1), on = struckBeats(an);
  let n = 0;
  for (let i = a; i < b; i++) n += on[i];
  return b > a ? n / (b - a) : 0;
}

/** Whether a run of the song has a beat the lights can follow: the tracker keeps time there or the music
 * hits on its beats (as for flow), its beats cover the run (at least half the beats its tempo would give:
 * a tracker that stopped hearing a pulse leaves none), and the music strikes at least half of them (not a
 * held chord the tracker carried on through). */
export function followable(an: Analysis, t0: number, t1: number): boolean {
  const n = searchsorted(an.beats, t1) - searchsorted(an.beats, t0);
  const beats = steadyAt(an, (t0 + t1) / 2) || clarity(an, t0, t1) >= FLOW_CLARITY;
  return beats && n >= (0.5 * (t1 - t0)) / beatLen(an) && struckShare(an, t0, t1) >= 0.5;
}

const HELD_S = 0.5;      // a note sounding this long after its attack is held, not played
const VOICES = 2;        // ... and this many held at once are a chord (or a pedal under a held note)
const HELD_SHARE = 0.6;  // a run is held where they sound for this much of it

const heldMemo = new WeakMap<Analysis, Int32Array>();

/** Per frame, how many notes are held there (sounding HELD_S or more after their attack). */
function heldVoices(an: Analysis): Int32Array {
  let out = heldMemo.get(an);
  if (out) return out;
  const ev = an.events, n = an.nFrames, d = new Int32Array(n + 1);
  for (let i = 0; i < ev.t.length; i++) {
    const a = Math.round((ev.t[i] + HELD_S) / an.step), b = Math.round((ev.t[i] + ev.dur[i]) / an.step);
    if (b <= a || a >= n) continue;
    d[a]++;
    d[Math.min(n, b)]--;
  }
  out = new Int32Array(n);
  for (let f = 0, c = 0; f < n; f++) out[f] = c += d[f];
  heldMemo.set(an, out);
  return out;
}

/** Whether a run of the song is a held chord: VOICES or more notes held through most of it (HELD_SHARE),
 * as under the Toccata's sustained chords, where nothing new is struck for the lights to hit. */
export function held(an: Analysis, t0: number, t1: number): boolean {
  const v = heldVoices(an), a = clip(Math.trunc(t0 / an.step), 0, an.nFrames - 1);
  const b = clip(Math.trunc(t1 / an.step), a + 1, an.nFrames);
  let n = 0;
  for (let f = a; f < b; f++) if (v[f] >= VOICES) n++;
  return n >= HELD_SHARE * (b - a);
}
