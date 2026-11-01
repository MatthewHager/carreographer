// Continuous quantization: a beat map that follows the performer, not a metronome.
//
// The beat tracker gives a reasonable grid for band songs, but organ and orchestral recordings speed
// up, hold back and breathe, and its beats drift off what is actually played. Here each tracked beat
// is pulled onto the strongest played onset near it (a note, a chord, a bass attack), beats with
// nothing played near them are re-spaced between their anchored neighbours so the tempo changes
// smoothly, and the result is the grid every move quantizes to (snap, eighthAt).

import type { Analysis } from './analysis';
import { arange, argmax, argsort, clip, diff, mean, median, searchsorted } from './np';

/** The piece's nominal beat, in seconds (never slower than 40 BPM). */
export const beatLen = (an: Analysis) => 60.0 / Math.max(an.tempo, 40);

/** Four of those beats. */
export const barLen = (an: Analysis) => 4 * beatLen(an);

/** The length of the tracked beat around t. */
export function beatAt(an: Analysis, t: number): number {
  const b = an.beats, nominal = beatLen(an);
  if (b.length < 2) return nominal;
  const i = clip(searchsorted(b, t, 'right'), 1, b.length - 1);
  return Math.min(b[i] - b[i - 1], 1.5 * nominal);       // across a fermata: a normal beat
}

/** `t` on the nearest tracked beat within `reach` s, else as it is: a motor starting or a lid stopping is an
 * accent, and lands with the music. */
export function onBeat(an: Analysis, t: number, reach = 0.35): number {
  let best = t;
  for (const b of an.beats) if (Math.abs(b - t) <= reach && Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}

// keyed on the beat list, which TEMPO.apply replaces: a grid of the tracker's beats is never read after
const positions = new WeakMap<number[], Int32Array>();

/** Every tracked beat's place in its bar (0 the downbeat), counted from the downbeat before it. */
export function barPositions(an: Analysis): Int32Array {
  let pos = positions.get(an.beats);
  if (pos) return pos;
  const b = an.beats, downs = new Set<number>();
  for (const x of an.downbeats) {
    const k = clip(searchsorted(b, x - 0.01), 0, Math.max(0, b.length - 1));
    if (b.length && Math.abs(b[k] - x) < 0.05) downs.add(k);
  }
  pos = new Int32Array(b.length);
  let last: number | null = null;
  for (let i = 0; i < b.length; i++) {
    if (downs.has(i)) last = i;
    pos[i] = last !== null ? (i - last) % 4 : i % 4;
  }
  positions.set(an.beats, pos);
  return pos;
}

const subGrids = new WeakMap<number[], Map<number, Float64Array>>();

/** Every 1/div beat of the tracked beats (sixteenths for div 4), following the music's own spacing. */
function subGrid(an: Analysis, div = 4): Float64Array {
  let cache = subGrids.get(an.beats);
  if (!cache) subGrids.set(an.beats, (cache = new Map()));
  let g = cache.get(div);
  if (g === undefined) {
    const b: ArrayLike<number> = an.beats.length >= 2 ? an.beats : arange(0, an.duration, beatLen(an));
    const gaps = diff(b), out = new Float64Array(b.length * div);
    for (let i = 0; i < b.length; i++) {
      const gap = gaps[Math.min(i, gaps.length - 1)];
      for (let j = 0; j < div; j++) out[i * div + j] = b[i] + (gap * j) / div;
    }
    cache.set(div, (g = out));
  }
  return g;
}

/** `t` on the nearest sixteenth (1/div beat) of the performer-following beat map, and from there on a note
 * played within an eighth of it (at most 40 ms): the grid bends with the tempo, the light lands on the
 * attack. */
export function snap(an: Analysis, t: number, div = 4): number {
  const q = nearest(subGrid(an, div), t), et = an.events.t;
  if (et.length > 1) {
    const tol = Math.min(0.04, beatAt(an, q) / (2 * div));
    const near = nearest(et, q);
    if (Math.abs(near - q) <= tol) return near;
  }
  return q;
}

/** The eighth of the beat map nearest t: a beat, or halfway between two. */
export const eighthAt = (an: Analysis, t: number) => nearest(subGrid(an, 2), t);

/** The value of `a` (sorted, two or more) nearest t. */
function nearest(a: ArrayLike<number>, t: number): number {
  const i = clip(searchsorted(a, t), 1, a.length - 1);
  return t - a[i - 1] <= a[i] - t ? a[i - 1] : a[i];
}

/** [times, strengths] of the played attacks: transcribed note events (chords count more) and the
 * kicks (a kick drum, a timpani stroke, a bass note's attack). */
function onsets(an: Analysis): [number[], number[]] {
  const ev = an.events;
  let t = [...ev.t];
  let w = ev.amp.map((a, i) => a * (1 + 0.5 * (ev.kind[i] >= 2 ? 1 : 0)));
  if (an.kick.length) {
    t = t.concat(an.kick.map((r) => r[0]));
    w = w.concat(an.kick.map((r) => r[1]));
  }
  const order = argsort(t);
  t = order.map((i) => t[i]);
  w = order.map((i) => w[i]);
  if (w.length) {
    const m = median(w) + 1e-9;
    w = w.map((x) => x / m);
  }
  return [t, w];
}

/** The least-squares line through (x, y): [slope, intercept]. */
function fitLine(x: number[], y: number[]): [number, number] {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) * (x[i] - mx);
  }
  const k = sxy / sxx;
  return [k, my - k * mx];
}

/** Beat times that follow what is played. Two passes:
 *  1. anchor: each tracked beat moves to the strongest played onset within `reach` x the local beat
 *     (only attacks at least `minStrength` x the median count);
 *  2. flow: a straight line is fitted through the anchors of the `span` beats either side, which is
 *     the local tempo. A beat keeps its anchor - the exact played time - when the anchor is within
 *     `agree` x the local beat of that line; otherwise (an off-beat note was grabbed, or nothing was
 *     played) it sits on the line. The tempo then glides through rubato and only ever lands on real
 *     attacks or on the smooth flow between them.
 */
function follow(an: Analysis, reach = 0.16, minStrength = 0.6, span = 3, agree = 0.06): number[] {
  const b0 = an.beats;
  const nb = b0.length;
  if (nb < 4) return [...b0];
  let [t, w] = onsets(an);
  const keep = w.map((x) => x >= minStrength);
  t = t.filter((_, i) => keep[i]);
  w = w.filter((_, i) => keep[i]);
  const gaps = b0.slice(1).map((x, i) => x - b0[i]);
  const local = [gaps[0], ...gaps.slice(1).map((g, i) => 0.5 * (gaps[i] + g)), gaps[gaps.length - 1]];
  const anchor = [...b0];
  const has = new Array<boolean>(nb).fill(false);
  for (let i = 0; i < nb; i++) {
    const lo = searchsorted(t, b0[i] - reach * local[i]);
    const hi = searchsorted(t, b0[i] + reach * local[i]);
    if (hi > lo) {
      let best = lo, bestScore = -Infinity;
      for (let c = lo; c < hi; c++) {
        const score = w[c] - Math.abs(t[c] - b0[i]) / (reach * local[i]);
        if (score > bestScore) [bestScore, best] = [score, c];
      }
      anchor[i] = t[best];
      has[i] = true;
    }
  }
  const out = [...b0];
  for (let i = 0; i < nb; i++) {
    const lo = Math.max(0, i - span), hi = Math.min(nb, i + span + 1);
    // don't fit across a fermata / silence: stop at gaps over twice the local beat
    let seg: number[] = [];
    for (let k = lo; k < hi; k++) seg.push(k);
    for (let k = 0; k < hi - 1 - lo; k++) {
      if (!(gaps[lo + k] > 2 * local[i])) continue;
      if (lo + k < i) seg = seg.filter((s) => s > lo + k);
      else seg = seg.filter((s) => s <= lo + k);
    }
    const pts = seg.filter((s) => has[s]);
    let line: number;
    if (pts.length >= 3) {
      const [k, c] = fitLine(pts, pts.map((p) => anchor[p]));
      line = k * i + c;
    } else {
      line = b0[i];
    }
    out[i] = has[i] && Math.abs(anchor[i] - line) <= agree * local[i] ? anchor[i] : line;
  }
  // A tracked beat already sitting on a played attack (within 30 ms) is left exactly where it is:
  // only the beats that drifted are moved, so a steady band track keeps its steady grid.
  if (t.length >= 2) {
    for (let i = 0; i < nb; i++) {
      const on = clip(searchsorted(t, b0[i]), 1, Math.max(1, t.length - 1));
      const dist = Math.min(Math.abs(b0[i] - t[on - 1]), Math.abs(t[on] - b0[i]));
      if (dist <= 0.03) out[i] = b0[i];
    }
  }
  for (let i = 1; i < nb; i++) {                       // strictly increasing
    if (out[i] <= out[i - 1] + 0.3 * local[i]) out[i] = out[i - 1] + 0.3 * local[i];
  }
  return out;
}

function maxEnv(env: number[], a: number, b: number): number {
  let m = -Infinity;
  for (let k = a; k < b; k++) if (env[k] > m) m = env[k];
  return m;
}

/** Shift any run of beats that sits anti-phase (or a quarter off) with the music's pulse.
 *
 * For each window of `window` beats the pulse envelope (drums when separated) is sampled at the
 * beats shifted by 0, +/-1/4 and 1/2 of the local beat; if a shift scores `gain` x better than the
 * beats as tracked, those beats move. Neighbouring windows vote, so a single loud fill doesn't flip
 * a section. */
function phaseLock(an: Analysis, window = 8, gain = 1.3): void {
  const env = an.pulseEnv;
  const b = an.beats;
  if (b.length < 2 * window) return;
  const hop = an.pulseHop;
  const w = Math.max(1, Math.round(0.03 / hop));
  const score = (times: number[]) => times.map((x) => {
    const i = clip(Math.round(x / hop), 0, env.length - 1);
    return maxEnv(env, Math.max(0, i - w), i + w + 1);
  });
  const gaps = b.slice(1).map((x, i) => x - b[i]);
  const gap = [...gaps, gaps[gaps.length - 1]];
  const shifts = [0.0, 0.5, 0.25, -0.25];
  const perBeat = shifts.map((s) => score(b.map((x, i) => x + s * gap[i])));     // shifts x beats
  const choice = new Array<number>(b.length).fill(0);
  const half = Math.floor(window / 2);
  for (let a = 0; a < b.length; a += half) {
    const s0 = Math.max(0, a - half), s1 = Math.min(b.length, a + window + half);
    const sc = perBeat.map((row) => mean(row, s0, s1));
    const k = argmax(sc);
    if (k !== 0 && sc[k] > gain * sc[0]) for (let i = a; i < Math.min(b.length, a + half); i++) choice[i] = shifts[k];
  }
  const out = b.map((x, i) => x + choice[i] * gap[i]);
  const order = argsort(out);
  an.beats = order.map((i) => out[i]);
  if (choice.some((c) => c !== 0)) {
    an.downbeats = an.downbeats
      .map((d) => out[clip(searchsorted(b, d - 1e-6), 0, b.length - 1)])
      .sort((x, y) => x - y);
  }
}

/** Each beat moved onto the peak of the music's attack curve (the drums when separated) within
 * `reach` seconds, refined between analysis frames by fitting a parabola through the peak - the
 * tracker works on 23 ms frames and can sit a whole frame after the hit (Thriller did). Beats with no
 * peak nearby stay where they are. */
function snapToPulse(an: Analysis, reach = 0.045): void {
  const env = an.pulseEnv;
  const b = an.beats;
  if (b.length < 4) return;
  const hop = an.pulseHop;
  const w = Math.max(1, Math.round(reach / hop));
  const out = [...b];
  b.forEach((t, k) => {
    const i = Math.round(t / hop);
    const lo = Math.max(1, i - w), hi = Math.min(env.length - 1, i + w + 1);
    if (hi - lo < 2) return;
    const seg = env.slice(lo, hi);
    const j = lo + argmax(seg);
    if (j <= 0 || j >= env.length - 1 || env[j] <= median(seg) * 1.5) return;   // no real attack near this beat
    const [y0, y1, y2] = [env[j - 1], env[j], env[j + 1]];
    const den = y0 - 2 * y1 + y2;
    const d = den < 0 ? (0.5 * (y0 - y2)) / den : 0.0;
    out[k] = (j + clip(d, -0.5, 0.5)) * hop;
  });
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1]);
  if (out.some((x, k) => x !== b[k])) {
    const idx = [...new Set(an.downbeats.map((d) => clip(searchsorted(b, d - 1e-6), 0, b.length - 1)))]
      .sort((x, y) => x - y);
    an.beats = out;
    an.downbeats = idx.map((i) => out[i]);
  }
}

/** Replace an.beats / an.downbeats with the performer-following map (downbeats keep their beat
 * indices). */
export function apply(an: Analysis): void {
  phaseLock(an);
  snapToPulse(an);
  const old = an.beats;
  if (old.length < 4) return;
  const nu = follow(an);
  const idx = [...new Set(an.downbeats.map((d) => clip(searchsorted(old, d - 1e-6), 0, old.length - 1)))]
    .sort((x, y) => x - y);
  an.beats = nu;
  an.downbeats = idx.map((i) => nu[i]);
}
