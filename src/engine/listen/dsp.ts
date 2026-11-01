// The parts of librosa 0.11 the analysis uses (sr 22050, hop 512, n_fft 2048), each named after the librosa
// function it follows. Matrices are row-major (rows x T) typed arrays.

import { mean, median } from '../np';
import { realFft } from './fft';
import { SR } from './resample';

export { SR };
export const HOP = 512;
const N_FFT = 2048;

export const TINY32 = 1.1754943508222875e-38;   // np.finfo(np.float32).tiny

/** scipy.signal.get_window('hann', n): the periodic Hann window. */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** librosa.frames_to_time. */
export function framesToTime(f: number): number {
  return (f * HOP) / SR;
}

// ---------- mel ----------

const hzToMel = (f: number) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27));
const melToHz = (m: number) => (m < 15 ? (200 / 3) * m : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)));

/** librosa.mel_frequencies (Slaney scale). */
export function melFrequencies(n: number, fmin: number, fmax: number): Float64Array {
  const a = hzToMel(fmin), b = hzToMel(fmax), out = new Float64Array(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = melToHz(i === n - 1 ? b : a + i * step);
  return out;
}

interface SparseRow {
  start: number;
  w: Float32Array;
}

/** librosa.filters.mel (Slaney scale and norm), one sparse row per band. */
function melBasis(nMels: number, fmax: number, sr = SR, nFft = N_FFT): SparseRow[] {
  const nb = 1 + nFft / 2, melF = melFrequencies(nMels + 2, 0, fmax), rows: SparseRow[] = [];
  const val = 1 / (nFft * (1 / sr));
  for (let i = 0; i < nMels; i++) {
    const fd0 = melF[i + 1] - melF[i], fd1 = melF[i + 2] - melF[i + 1], enorm = 2 / (melF[i + 2] - melF[i]);
    let start = -1;
    const w: number[] = [];
    for (let k = 0; k < nb; k++) {
      const f = k * val;
      const v = Math.max(0, Math.min(-(melF[i] - f) / fd0, (melF[i + 2] - f) / fd1)) * enorm;
      if (v > 0) {
        if (start < 0) start = k;
        w.push(v);
      } else if (start >= 0) break;
    }
    rows.push({ start: Math.max(start, 0), w: Float32Array.from(w) });
  }
  return rows;
}

// ---------- one pass over the STFT ----------

export interface Spectrum {
  T: number;
  mel96: Float32Array;           // (96 x T) power, fmax 8000 (the onsets in audio.ts)
  mel128: Float32Array;          // (128 x T) power, fmax sr/2 (librosa's default: mfcc, the visualizer's bands)
  tuning: number;                // estimate_tuning(bins_per_octave=36), as chroma_cqt estimates it
}

/** Everything audio.ts and form.ts read off the n_fft 2048 / hop 512 STFT (centered, zero padded), in one
 * pass. */
export function spectrum(y: Float32Array): Spectrum {
  const nFft = N_FFT, hop = HOP, half = nFft / 2, nb = half + 1;
  const T = 1 + Math.floor(y.length / hop);
  const win = hann(nFft), fft = realFft(nFft);
  const m96 = melBasis(96, 8000), m128 = melBasis(128, SR / 2);
  const mel96 = new Float32Array(96 * T), mel128 = new Float32Array(128 * T);
  const buf = new Float64Array(nFft), re = new Float64Array(nb), im = new Float64Array(nb);
  const P = new Float64Array(nb), S = new Float64Array(nb);
  const pitches: number[] = [], mags: number[] = [];
  const bands: [SparseRow[], Float32Array][] = [[m96, mel96], [m128, mel128]];
  for (let t = 0; t < T; t++) {
    const s0 = t * hop - half;
    for (let n = 0; n < nFft; n++) {
      const i = s0 + n;
      buf[n] = i >= 0 && i < y.length ? y[i] * win[n] : 0;
    }
    fft.forward(buf, re, im);
    for (let k = 0; k < nb; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      S[k] = m;
      P[k] = m * m;
    }
    piptrack(S, pitches, mags);
    for (const [basis, dst] of bands) {
      for (let b = 0; b < basis.length; b++) {
        const { start, w } = basis[b];
        let s = 0;
        for (let j = 0; j < w.length; j++) s += w[j] * P[start + j];
        dst[b * T + t] = s;
      }
    }
  }
  return { T, mel96, mel128, tuning: pitchTuning(pitches, mags, 36) };
}

/** librosa.piptrack on one magnitude frame (fmin 150, fmax 4000, threshold 0.1): appends the picked
 * peaks' (pitch, magnitude). */
function piptrack(S: Float64Array, outP: number[], outM: number[]) {
  const nb = S.length, nFft = (nb - 1) * 2;
  let mx = 0;
  for (let k = 0; k < nb; k++) if (S[k] > mx) mx = S[k];
  const ref = 0.1 * mx;
  const masked = (k: number) => (S[k] > ref ? S[k] : 0);
  for (let k = 1; k < nb - 1; k++) {
    const f = (k * SR) / nFft;
    if (!(f >= 150 && f < 4000)) continue;
    const cur = masked(k);
    if (!(cur > masked(k - 1) && cur >= masked(k + 1))) continue;
    const a = S[k + 1] + S[k - 1] - 2 * S[k], b = (S[k + 1] - S[k - 1]) / 2;
    const shift = Math.abs(b) >= Math.abs(a) ? 0 : -b / a;
    const pitch = ((k + shift) * SR) / nFft;
    if (pitch > 0) {
      outP.push(pitch);
      outM.push(S[k] + 0.5 * b * shift);
    }
  }
}

/** The tail of librosa.estimate_tuning: keep the pitches at or above the median magnitude, and histogram
 * their deviation from the equal-tempered grid (resolution 0.01 of a bin). */
function pitchTuning(P: number[], M: number[], bpo: number): number {
  if (!P.length) return 0;
  const thr = median(M);
  const counts = new Int32Array(100);
  const edges = Array.from({ length: 101 }, (_, i) => -0.5 + i * 0.01);
  let any = false;
  for (let i = 0; i < P.length; i++) {
    if (!(M[i] >= thr)) continue;
    any = true;
    let r = bpo * Math.log2(P[i] / (440 / 16));
    r -= Math.floor(r);
    if (r >= 0.5) r -= 1;
    // np.histogram's uniform-bin rule
    let b = Math.trunc((r + 0.5) * 100);
    if (b === 100) b--;
    if (r < edges[b]) b--;
    else if (r >= edges[b + 1] && b !== 99) b++;
    counts[b]++;
  }
  if (!any) return 0;
  let bi = 0;
  for (let i = 1; i < 100; i++) if (counts[i] > counts[bi]) bi = i;
  return edges[bi];
}

/** librosa.power_to_db (amin 1e-10, top_db 80). `ref`: 'max' or a number. */
export function powerToDb(S: Float32Array, ref: 'max' | number): Float32Array {
  let mx = 0;
  if (ref === 'max') for (let i = 0; i < S.length; i++) if (S[i] > mx) mx = S[i];
  const off = 10 * Math.log10(Math.max(1e-10, ref === 'max' ? mx : Math.abs(ref)));
  const out = new Float32Array(S.length);
  let top = -Infinity;
  for (let i = 0; i < S.length; i++) {
    const v = 10 * Math.log10(Math.max(1e-10, S[i])) - off;
    out[i] = v;
    if (v > top) top = v;
  }
  const lo = top - 80;
  for (let i = 0; i < out.length; i++) if (out[i] < lo) out[i] = lo;
  return out;
}

// ---------- onsets ----------

/** librosa.onset.onset_strength(S=rows [r0, r1) of a dB matrix), centered: the spectral flux at `lag`,
 * averaged (or the median) over the bands, delayed by lag + 2 frames. */
export function onsetStrength(S: Float32Array, T: number, r0: number, r1: number,
  { lag = 1, aggregate = 'mean' }: { lag?: number; aggregate?: 'mean' | 'median' } = {}): Float32Array {
  const pad = lag + Math.floor(N_FFT / (2 * HOP)), env = new Float32Array(T), n = r1 - r0;
  const tmp = new Float64Array(n);
  for (let t = pad; t < T; t++) {
    const j = t - pad;
    if (j + lag >= T) break;
    if (aggregate === 'mean') {
      let s = 0;
      for (let r = r0; r < r1; r++) s += Math.max(0, S[r * T + j + lag] - S[r * T + j]);
      env[t] = s / n;
    } else {
      for (let r = r0; r < r1; r++) tmp[r - r0] = Math.max(0, S[r * T + j + lag] - S[r * T + j]);
      env[t] = median(tmp);
    }
  }
  return env;
}

/** librosa.util.peak_pick. */
export function peakPick(x: ArrayLike<number>, preMax: number, postMax: number, preAvg: number, postAvg: number,
  delta: number, wait: number): number[] {
  const N = x.length, peaks: number[] = [];
  const mx = (a: number, b: number) => {
    let m = -Infinity;
    for (let i = a; i < b; i++) if (x[i] > m) m = x[i];
    return m;
  };
  const avg = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += x[i];
    return s / (b - a);
  };
  let n = 1;
  if (x[0] >= mx(0, Math.min(postMax, N)) && x[0] >= avg(0, Math.min(postAvg, N)) + delta) {
    peaks.push(0);
    n = wait + 1;
  }
  while (n < N) {
    if (x[n] !== mx(Math.max(0, n - preMax), Math.min(n + postMax, N))) {
      n++;
      continue;
    }
    if (!(x[n] >= avg(Math.max(0, n - preAvg), Math.min(n + postAvg, N)) + delta)) {
      n++;
      continue;
    }
    peaks.push(n);
    n += wait + 1;
  }
  return peaks;
}

/** librosa.onset.onset_detect(onset_envelope=env): frames of the picked onsets. */
export function onsetDetect(env: Float32Array,
  { delta = 0.07, wait }: { delta?: number; wait?: number } = {}): number[] {
  let mn = Infinity;
  for (const v of env) if (v < mn) mn = v;
  const e = new Float32Array(env.length);
  let mx = 0;
  for (let i = 0; i < e.length; i++) {
    e[i] = env[i] - mn;
    if (e[i] > mx) mx = e[i];
  }
  const d = mx + TINY32;
  let any = false;
  for (let i = 0; i < e.length; i++) {
    e[i] /= d;
    if (e[i]) any = true;
  }
  if (!any) return [];
  const fl = (s: number) => Math.floor((s * SR) / HOP);
  return peakPick(e, fl(0.03), fl(0.0) + 1, fl(0.1), fl(0.1) + 1, delta, wait ?? fl(0.03));
}

// ---------- form: mfcc, sync, normalize, agglomerative ----------

/** librosa.feature.mfcc(y, n_mfcc=13) from the 128-band mel power: the orthonormal DCT-II of its dB. */
export function mfcc(mel128: Float32Array, T: number, nMfcc = 13): Float32Array {
  const db = powerToDb(mel128, 1.0), nIn = 128, out = new Float32Array(nMfcc * T);
  const basis: Float64Array[] = [];
  for (let k = 0; k < nMfcc; k++) {
    const b = new Float64Array(nIn), sc = k === 0 ? Math.sqrt(1 / nIn) : Math.sqrt(2 / nIn);
    for (let n = 0; n < nIn; n++) b[n] = sc * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * nIn));
    basis.push(b);
  }
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < nMfcc; k++) {
      const b = basis[k];
      let s = 0;
      for (let n = 0; n < nIn; n++) s += b[n] * db[n * T + t];
      out[k * T + t] = s;
    }
  }
  return out;
}

/** librosa.util.sync(M, beats, aggregate): one column per span between beats (and the ends). */
export function sync(M: Float32Array, rows: number, T: number, beats: readonly number[],
  aggregate: 'mean' | 'median'): { data: Float32Array; nc: number } {
  const edges = [...new Set([0, T, ...beats.map((b) => Math.min(Math.max(b, 0), T))])].sort((a, b) => a - b);
  const nc = edges.length - 1, out = new Float32Array(rows * nc);
  for (let c = 0; c < nc; c++) {
    const a = edges[c], b = edges[c + 1], tmp = new Float32Array(b - a);
    for (let r = 0; r < rows; r++) {
      for (let t = a; t < b; t++) tmp[t - a] = M[r * T + t];
      out[r * nc + c] = aggregate === 'mean' ? mean(tmp) : median(tmp);
    }
  }
  return { data: out, nc };
}

/** librosa.util.normalize(X, norm=inf, axis=0) of a (rows x nc) float32 matrix. */
export function normalizeColumns(X: Float32Array, rows: number, nc: number): Float32Array {
  const o = new Float32Array(X.length);
  for (let c = 0; c < nc; c++) {
    let m = 0;
    for (let r = 0; r < rows; r++) m = Math.max(m, Math.abs(X[r * nc + c]));
    if (m < TINY32) m = 1;
    for (let r = 0; r < rows; r++) o[r * nc + c] = X[r * nc + c] / m;
  }
  return o;
}

/** librosa.segment.agglomerative(X, k): Ward clustering constrained to neighbouring columns (as
 * sklearn's AgglomerativeClustering with a chain connectivity), as the first column of each segment. */
export function agglomerative(X: Float32Array, rows: number, nc: number, k: number): number[] {
  interface Seg { start: number; n: number; sum: Float64Array }
  const segs: Seg[] = [];
  for (let c = 0; c < nc; c++) {
    const s = new Float64Array(rows);
    for (let r = 0; r < rows; r++) s[r] = X[r * nc + c];
    segs.push({ start: c, n: 1, sum: s });
  }
  const cost = (a: Seg, b: Seg) => {
    const n = (a.n * b.n) / (a.n + b.n);
    let pa = 0;
    for (let r = 0; r < rows; r++) pa += (a.sum[r] / a.n - b.sum[r] / b.n) ** 2;
    return pa * n;
  };
  const costs: number[] = [];
  for (let i = 0; i < segs.length - 1; i++) costs.push(cost(segs[i], segs[i + 1]));
  while (segs.length > k) {
    let bi = 0;
    for (let i = 1; i < costs.length; i++) if (costs[i] < costs[bi]) bi = i;
    const a = segs[bi], b = segs[bi + 1], s = new Float64Array(rows);
    for (let r = 0; r < rows; r++) s[r] = a.sum[r] + b.sum[r];
    segs.splice(bi, 2, { start: a.start, n: a.n + b.n, sum: s });
    costs.splice(bi, 1);
    if (bi > 0) costs[bi - 1] = cost(segs[bi - 1], segs[bi]);
    if (bi < segs.length - 1) costs[bi] = cost(segs[bi], segs[bi + 1]);
  }
  return segs.map((s) => s.start);
}
