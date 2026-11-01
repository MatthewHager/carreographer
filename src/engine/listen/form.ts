// The form map: the shape of the whole piece, read before any phrase is choreographed.
//
//   sections   boundaries from chroma + timbre averaged every half second (agglomerative clustering)
//   letters    repeated material gets the same letter (A, B, A', ...) by chroma/timbre similarity

import type { Section } from '../analysis';
import { agglomerative, framesToTime, mfcc, normalizeColumns, sync, type Spectrum } from './dsp';
import { clip, mean } from '../np';

const GRID = 22;     // spectrum frames: about half a second

/** The form map: the song's sections, from its timbre and chroma averaged beat by beat (`beats`, spectrum
 * frames), and every half second where the beats leave a gap of a second or more (a roll, a rubato
 * passage, music with no beat), so music without a beat is mapped as finely as a groove. */
export function analyzeForm(duration: number, s: Spectrum, chroma: Float32Array, beats: number[]): Section[] {
  const T = s.T;
  const mf = mfcc(s.mel128, T);
  const gridFrames: number[] = [];
  for (const f of [...beats, T]) {
    const from = gridFrames.length ? gridFrames[gridFrames.length - 1] : 0;
    for (let g = from + GRID; f - g >= GRID; g += GRID) gridFrames.push(g);
    if (f < T && f > from) gridFrames.push(f);
  }
  const Cs = sync(chroma, 12, T, gridFrames, 'median');
  const Ms = sync(mf, 13, T, gridFrames, 'mean');
  const nc = Cs.nc, Cn = normalizeColumns(Cs.data, 12, nc), Mn = normalizeColumns(Ms.data, 13, nc);
  const X = new Float32Array(25 * nc);
  X.set(Cn);
  for (let i = 0; i < 13 * nc; i++) X[12 * nc + i] = 0.5 * Mn[i];
  let k = clip(Math.round(duration / 22.0), 3, 14);
  k = Math.min(k, nc - 1);
  const raw = agglomerative(X, 25, nc, k);
  const bt = gridFrames.map((f) => framesToTime(f));
  const bounds = [...new Set([0, ...raw])].sort((a, b) => a - b);
  const colMean = (b: number, e: number) => {
    const n = Math.max(0, Math.min(e, nc) - b);
    return Float64Array.from({ length: 25 }, (_, r) => (n ? mean(X, r * nc + b, r * nc + b + n) : NaN));
  };
  const spans: [number, number, Float64Array][] = [];
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    const e = i + 1 < bounds.length ? bounds[i + 1] : bt.length;
    const t0 = i ? bt[Math.min(b, bt.length - 1)] : 0.0;
    const t1 = e < bt.length ? bt[Math.min(e, bt.length - 1)] : duration;
    if (t1 - t0 >= 4.0 || !spans.length) spans.push([t0, t1, colMean(b, Math.max(e, b + 1))]);
    else spans[spans.length - 1][1] = t1;   // too short: absorb into the previous
  }
  spans[spans.length - 1][1] = duration;

  // Letters: sections whose feature profile and length match get the same letter.
  const letters: string[] = [], feats: [Float64Array, number][] = [];
  const dot = (a: Float64Array, b: Float64Array) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  };
  for (const [t0, t1, f] of spans) {
    let letter: string | null = null;
    for (let L = 0; L < feats.length; L++) {
      const [g, length] = feats[L];
      const cos = dot(f, g) / Math.max(Math.sqrt(dot(f, f)) * Math.sqrt(dot(g, g)), 1e-9);
      const ratio = (t1 - t0) / Math.max(length, 1e-9);
      if (cos >= 0.93 && ratio >= 0.6 && ratio <= 1.6) {
        letter = String.fromCharCode(65 + L);
        break;
      }
    }
    if (letter === null) {
      feats.push([f, t1 - t0]);
      letter = String.fromCharCode(65 + feats.length - 1);
    }
    letters.push(letter);
  }

  const sections: Section[] = spans.map(([t0, t1], i) => ({ t0, t1, letter: letters[i], index: i, nth: 0 }));
  const first = new Map<string, Section>();
  for (const s of sections) {
    const f = first.get(s.letter);
    if (f) {
      s.nth = sections.slice(0, s.index).filter((q) => q.letter === s.letter).length;
    } else first.set(s.letter, s);
  }
  return sections;
}
