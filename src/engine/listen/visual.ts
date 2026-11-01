// What a music visualizer measures, on the show's frame grid, so the lights can look like the music:
//   loudness          the whole mix's level in dB, the song's loud end at 1
//   bands             the energy in four bands, with a level meter's instant rise and gentle fall
//   kick/snare/hats   the drum kit piece by piece: transients across each one's band
//   brightness        the spectral centroid: dull to bright
//   chroma            the harmony's pitch classes, the strongest one and how clearly it leads
//   novelty           how much the sound is changing, and the moments it changes most
//   kit               how much a drum kit is playing
//   beatConfidence    how clearly the beats land on the music's accents
// All read off the spectrum and the chroma audio.ts already took (for the form map too), so they cost little:
// about 50 ms for a 2.5-minute song in Node. Every curve is 0..1 over the song, but kit and beatConfidence,
// which mean the same in every song.

import type { Analysis, Bands } from '../analysis';
import { clip, quantile } from '../np';
import { HOP, melFrequencies, onsetStrength, peakPick, powerToDb, SR, type Spectrum } from './dsp';

const FPS = SR / HOP;                                       // STFT frames per second
const MEL = melFrequencies(130, 0, SR / 2).subarray(1, 129);  // mel128's band centres

/** The mel128 rows whose centres are in [lo, hi) Hz. */
function rows(lo: number, hi: number): [number, number] {
  let a = 0;
  while (a < MEL.length && MEL[a] < lo) a++;
  let b = a;
  while (b < MEL.length && MEL[b] < hi) b++;
  return [a, b];
}

/** A curve on the STFT's frames, read at the grid's frame times. */
function onGrid(x: ArrayLike<number>, nFrames: number, step: number): Float32Array {
  const out = new Float32Array(nFrames), last = x.length - 1;
  for (let i = 0; i < nFrames; i++) {
    const p = i * step * FPS, j = Math.floor(p);
    out[i] = j >= last ? x[last] : x[j] + (x[j + 1] - x[j]) * (p - j);
  }
  return out;
}

const SILENT = -100;   // dB: no sound at all (bandDb's floor)

/** The power in rows [r0, r1) of the mel128 spectrogram, in dB, frame by frame. */
function bandDb(mel: Float32Array, T: number, r0: number, r1: number): Float32Array {
  const out = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    let p = 0;
    for (let r = r0; r < r1; r++) p += mel[r * T + t];
    out[t] = Math.max(10 * Math.log10(p), SILENT);
  }
  return out;
}

/** dB levels onto 0..1: the song's loud end (its 99th percentile) at 1, and 40 dB below it, or the
 * song's quietest stretch if that is closer (but at least 12 dB down), at 0. So a compressed song swings
 * the whole range too, and a steady one stays up. Silence is 0. */
function level(db: Float32Array, range = 40): Float32Array {
  const hi = quantile(db, 0.99), lo = Math.min(Math.max(quantile(db, 0.02), hi - range), hi - 12);
  return db.map((v) => (v <= SILENT ? 0 : clip((v - lo) / (hi - lo), 0, 1)));
}

/** A level meter: rises at once, falls with time constant `release` seconds. */
function meter(x: Float32Array, step: number, release = 0.12): Float32Array {
  const k = Math.exp(-step / release), out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) out[i] = y = x[i] >= y ? x[i] : x[i] + (y - x[i]) * k;
  return out;
}

/** Each value over the song's `q` quantile, at most 1. */
function scaled(x: Float32Array, q = 0.99): Float32Array {
  const top = Math.max(quantile(x, q), 1e-9);
  return x.map((v) => Math.min(v / top, 1));
}

function boxSmooth(x: ArrayLike<number>, half: number): Float32Array {
  const n = x.length, out = new Float32Array(n), c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    out[i] = (c[b] - c[a]) / (b - a);
  }
  return out;
}

// ---------- the drum kit, piece by piece ----------

interface Voice {
  parts: [number, number, 'mean' | 'median'][];   // Hz bands that must all jump at once, and how each is read
  delta: number;                                   // dB of flux above the local average
}

// A kick is the low end jumping. A snare and a hi-hat are noise, which lifts a whole band at once where a
// sung or played note lifts only its harmonics: the median flux across the band. A snare lifts its body
// and its wires together, above the 1.5-4 kHz where a kick's beater clicks.
const VOICES: Record<'kick' | 'snare' | 'hats', Voice> = {
  kick: { parts: [[30, 110, 'mean']], delta: 4 },
  snare: { parts: [[400, 1300, 'median'], [4000, 7000, 'median']], delta: 2.5 },
  hats: { parts: [[8000, SR, 'median']], delta: 2.5 },
};

const LAG = 1.15;   // frames the flux's peak trails the attack by (measured on synthetic hits)

/** When the hit at peak frame `f` of a flux curve is heard: the peak placed between frames by the parabola
 * through it and its neighbours, less the flux's lag. */
function peakTime(env: Float32Array, f: number): number {
  const a = env[Math.max(f - 1, 0)], b = env[f], c = env[Math.min(f + 1, env.length - 1)];
  const den = a - 2 * b + c, d = den < 0 ? clip((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
  return Math.max(0, (f + d - LAG) / FPS);
}

/** [time, strength 0..1] of a voice's hits. A hit's strength is how far its bands' level jumps (the least
 * of them), which doesn't depend on where the hit falls between two frames as the flux's peak does. */
function voiceOnsets(mel: Float32Array, db: Float32Array, T: number, v: Voice): number[][] {
  const envs = v.parts.map(([lo, hi, aggregate]) =>
    onsetStrength(db, T, ...rows(lo, hi), { lag: 1, aggregate }));
  const env = envs[0].map((x, t) => envs.reduce((m, e) => Math.min(m, e[t]), x));
  const frames = peakPick(env, 1, 2, 4, 5, v.delta, 2).filter((f) => env[f] > 0);
  if (!frames.length) return [];
  const levels = v.parts.map(([lo, hi]) => bandDb(mel, T, ...rows(lo, hi)));
  // the flux at f is the rise into spectrum frame f - 2 (onsetStrength's centring)
  const jump = (f: number) => Math.max(0, Math.min(...levels.map((l) => {
    let after = -Infinity, before = Infinity;
    for (let u = Math.max(0, f - 2); u <= Math.min(T - 1, f + 1); u++) after = Math.max(after, l[u]);
    for (let u = Math.max(0, f - 6); u <= Math.max(0, f - 3); u++) before = Math.min(before, l[u]);
    return after - before;
  })));
  const s = frames.map(jump), top = Math.max(quantile(s, 0.95), 1e-9);
  return frames.map((f, i) => [peakTime(env, f), Math.min(s[i] / top, 1)]);
}

/** Where a kick and a snare are heard together, the weaker one is likely the other's spill (a snare's
 * lows, a kick's knock) unless it is at least `keep` as strong: the two lists without the spills. */
function apart(kick: number[][], snare: number[][], keep = 0.6, tol = 0.03): [number[][], number[][]] {
  const spill = (x: number[], others: number[][]) =>
    others.some((o) => Math.abs(o[0] - x[0]) <= tol && x[1] < keep * o[1]);
  return [kick.filter((k) => !spill(k, snare)), snare.filter((s) => !spill(s, kick))];
}

// ---------- per beat ----------

/** Per frame, from one value per beat: each beat's value held to halfway to its neighbours, 0 where
 * the beats are more than `gap` seconds apart (no beat there). */
function perBeat(beats: number[], vals: ArrayLike<number>, nFrames: number, step: number, gap = 2.5)
  : Float32Array {
  const out = new Float32Array(nFrames);
  for (let k = 0; k < beats.length; k++) {
    const t = beats[k], before = beats[k - 1] ?? -Infinity, after = beats[k + 1] ?? Infinity;
    const from = t - before <= gap ? (before + t) / 2 : t, to = after - t <= gap ? (t + after) / 2 : t;
    const end = Math.min(nFrames, Math.round(to / step) + 1);
    for (let i = Math.max(0, Math.round(from / step)); i < end; i++) out[i] = vals[k];
  }
  return out;
}

/** Whether a hit of `hits` (sorted by time) lies within `tol` seconds of t. */
function near(hits: number[][], t: number, tol: number): boolean {
  let lo = 0, hi = hits.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (hits[m][0] < t - tol) lo = m + 1;
    else hi = m;
  }
  return lo < hits.length && hits[lo][0] <= t + tol;
}

// ---------- the measurements ----------

type Grid = (x: ArrayLike<number>) => Float32Array;   // a curve on the spectrum's frames, read on the grid

/** Four bands' levels on the grid, each a level meter. */
function bandsOf(mel: Float32Array, T: number, g: Grid, step: number): Bands {
  const band = (lo: number, hi: number) => meter(g(level(bandDb(mel, T, ...rows(lo, hi)))), step);
  return { low: band(0, 150), lowMid: band(150, 600), highMid: band(600, 4000), high: band(4000, SR) };
}

/** Per spectrum frame, dull to bright: the power-weighted mean pitch of the mel bands (log frequency),
 * between the song's dullest and brightest 2 %. Silence keeps the brightness before it. */
function brightnessOf(mel: Float32Array, T: number, loud: Float32Array): Float32Array {
  const cent = new Float32Array(T);
  let held = 0;
  for (let t = 0; t < T; t++) {
    let p = 0, pf = 0;
    for (let r = 0; r < MEL.length; r++) {
      const v = mel[r * T + t];
      p += v;
      pf += v * MEL[r];
    }
    if (loud[t] > 0 && p > 0) held = Math.log2(pf / p);
    cent[t] = held;
  }
  const lo = quantile(cent, 0.02), hi = quantile(cent, 0.98);
  return boxSmooth(cent.map((v) => clip((v - lo) / Math.max(hi - lo, 1e-9), 0, 1)), 2);
}

/** The chroma on the grid, smoothed over a fifth of a second; and the harmony's strongest pitch class over
 * each beat (or each frame where there is no beat, held through near ties), so its colour changes on the
 * beat, with how clearly it leads: 1 for a lone note, about 0.8 for a triad, near 0 for noise, a drum or
 * silence (`loud`). */
function harmony(cq: Float32Array, T: number, loud: Float32Array, beats: number[], nFrames: number,
  step: number, g: Grid): Pick<Visuals, 'chroma' | 'pitchClass' | 'pitchClassStrength'> {
  const half = Math.round(0.1 * FPS);
  const pcs = Array.from({ length: 12 }, (_, c) => g(boxSmooth(cq.subarray(c * T, (c + 1) * T), half)));
  const chroma = new Float32Array(12 * nFrames);
  for (let i = 0; i < nFrames; i++) {
    let mx = 0;
    for (let c = 0; c < 12; c++) mx = Math.max(mx, pcs[c][i]);
    if (mx > 0) for (let c = 0; c < 12; c++) chroma[i * 12 + c] = pcs[c][i] / mx;
  }
  // the spans the pitch class is read over: beat to beat, else single frames
  const spans: [number, number][] = [];
  let at = 0;
  const single = (to: number) => {
    while (at < to) spans.push([at, ++at]);
  };
  for (let k = 0; k + 1 < beats.length; k++) {
    const a = Math.min(nFrames, Math.round(beats[k] / step));
    const b = Math.min(nFrames, Math.round(beats[k + 1] / step));
    if (beats[k + 1] - beats[k] > 2.5 || b <= Math.max(a, at)) continue;
    single(a);
    spans.push([at, b]);
    at = b;
  }
  single(nFrames);
  const pitchClass = new Uint8Array(nFrames), clarity = new Float32Array(nFrames), sum = new Float64Array(12);
  let held = 0;
  for (const [a, b] of spans) {
    sum.fill(0);
    let lv = 0;
    for (let i = a; i < b; i++) {
      for (let c = 0; c < 12; c++) sum[c] += chroma[i * 12 + c];
      lv += loud[i];
    }
    let mx = 0, tot = 0, arg = 0;
    for (let c = 0; c < 12; c++) {
      tot += sum[c];
      if (sum[c] > mx) [mx, arg] = [sum[c], c];
    }
    // frame by frame, a near tie doesn't flicker the colour: it changes once another class leads by 10 %
    if (b - a === 1 && sum[held] >= 0.9 * mx) arg = held;
    held = arg;
    pitchClass.fill(arg, a, b);
    const leads = clip(((1 - tot / mx / 12) * 12) / 11, 0, 1);
    if (mx > 0) clarity.fill(leads * Math.min(1, (2 * lv) / (b - a)), a, b);
  }
  return { chroma, pitchClass, pitchClassStrength: scaled(clarity) };
}

/** How different the second after each frame sounds from the second before (the mean change of 32 bands'
 * dB levels, a band 60 dB under the song's peak counting as silent), on the grid; and its peaks, at least
 * a second apart and standing out from the 3 s around. */
function noveltyOf(db: Float32Array, T: number, g: Grid, step: number)
  : Pick<Visuals, 'novelty' | 'noveltyPeaks'> {
  const B = 32, W = Math.round(FPS), cs = new Float64Array((T + 1) * B);
  for (let t = 0; t < T; t++) {
    for (let b = 0; b < B; b++) {
      let s = 0;
      for (let r = 4 * b; r < 4 * b + 4; r++) s += Math.max(db[r * T + t], -60);
      cs[(t + 1) * B + b] = cs[t * B + b] + s / 4;
    }
  }
  const nov = new Float32Array(T);
  for (let t = 1; t < T; t++) {
    const n = Math.min(W, t, T - t);
    if (n < W / 4) continue;   // too near either end to compare
    let d = 0;
    for (let b = 0; b < B; b++) {
      const before = cs[t * B + b] - cs[(t - n) * B + b], after = cs[(t + n) * B + b] - cs[t * B + b];
      d += Math.abs(after - before) / n;
    }
    nov[t] = d / B;
  }
  const novelty = scaled(g(nov)), sec = Math.round(1 / step);
  const peaks = peakPick(novelty, sec, sec, 3 * sec, 3 * sec, 0.2, sec);
  return { novelty, noveltyPeaks: peaks.map((i) => [i * step, novelty[i]]) };
}

const BEAT_CLEAR = 2.0;   // beats on accents this many times the average count as fully clear

/** Per grid frame, how clearly the beats land on the music's accents: around each beat (it and four on
 * either side), the onset curve's peak within two frames of the beats over its average such peak, from
 * 1 (beats land anywhere) to BEAT_CLEAR. 0 where there are no beats. */
function beatConfidenceOf(env: Float32Array, beats: number[], nFrames: number, step: number): Float32Array {
  const T = env.length, pooled = new Float32Array(T), cum = new Float64Array(T + 1);
  for (let t = 0; t < T; t++) {
    let m = 0;
    for (let u = Math.max(0, t - 2); u <= Math.min(T - 1, t + 2); u++) m = Math.max(m, env[u]);
    pooled[t] = m;
    cum[t + 1] = cum[t] + m;
  }
  const bf = beats.map((b) => Math.min(T - 1, Math.round(b * FPS)));
  const clear = bf.map((_, k) => {
    const a = Math.max(0, k - 4), b = Math.min(bf.length - 1, k + 4);
    let s = 0;
    for (let j = a; j <= b; j++) s += pooled[bf[j]];
    const base = (cum[bf[b] + 1] - cum[bf[a]]) / (bf[b] + 1 - bf[a]);
    return base > 0 ? clip((s / (b - a + 1) / base - 1) / (BEAT_CLEAR - 1), 0, 1) : 0;
  });
  return perBeat(beats, clear, nFrames, step);
}

/** Per grid frame, how much a drum kit is playing: over the two bars around each beat, the share of beats
 * with a kick and with a snare (each doubled, since a kit plays them on every other beat), and with a hat
 * on the beat or the eighth after, averaged. */
function kitOf(beats: number[], kick: number[][], snare: number[][], hats: number[][], nFrames: number,
  step: number): Float32Array {
  const TOL = 0.05;
  const share = (on: (b: number, k: number) => boolean) =>
    boxSmooth(beats.map((b, k) => (on(b, k) ? 1 : 0)), 4);
  const K = share((b) => near(kick, b, TOL)), S = share((b) => near(snare, b, TOL));
  const H = share((b, k) => near(hats, b, TOL) || near(hats, (b + (beats[k + 1] ?? b)) / 2, TOL));
  const kit = K.map((v, k) => (Math.min(1, 2 * v) + Math.min(1, 2 * S[k]) + H[k]) / 3);
  return perBeat(beats, kit, nFrames, step);
}

type Visuals = Pick<Analysis, 'loudness' | 'bands' | 'kick' | 'snare' | 'hats' | 'brightness' | 'chroma' | 'pitchClass'
  | 'pitchClassStrength' | 'novelty' | 'noveltyPeaks' | 'kit' | 'beatConfidence'>;

/** The visualizer's measurements of `y`, from its spectrum `spec`, the onset curve `env` (the mean flux of
 * the 96-band mel, one value per spectrum frame) and the beats, on a grid of `nFrames` frames of `step` s. */
export function visuals(spec: Spectrum, chroma: Float32Array, env: Float32Array, beats: number[], nFrames: number,
  step: number): Visuals {
  const T = spec.T, mel = spec.mel128, db = powerToDb(mel, 'max');
  const g: Grid = (x) => onGrid(x, nFrames, step);
  const loud = level(bandDb(mel, T, 0, MEL.length));
  const [kick, snare] = apart(voiceOnsets(mel, db, T, VOICES.kick), voiceOnsets(mel, db, T, VOICES.snare));
  const hats = voiceOnsets(mel, db, T, VOICES.hats);
  return {
    loudness: g(loud),
    bands: bandsOf(mel, T, g, step),
    kick, snare, hats,
    brightness: g(brightnessOf(mel, T, loud)),
    ...harmony(chroma, T, g(loud), beats, nFrames, step, g),
    ...noveltyOf(db, T, g, step),
    kit: kitOf(beats, kick, snare, hats, nFrames, step),
    beatConfidence: beatConfidenceOf(env, beats, nFrames, step),
  };
}
