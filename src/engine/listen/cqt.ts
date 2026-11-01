// librosa.feature.chroma_cqt(y, sr=22050, hop_length=512): a constant-Q transform with 36 bins per octave
// over 7 octaves from C1 (Hann filters, L1-normalised, sparsified at 1 %), computed octave by octave on a
// signal halved in rate after each octave, as librosa does, then folded onto the 12 pitch classes and
// max-normalised per frame. librosa decimates with soxr's HQ resampler; this uses a short Kaiser-windowed
// half-band FIR, which moves the chroma by about 1e-4.

import { hann, HOP, SR, TINY32 } from './dsp';
import { ComplexFft, realFft } from './fft';

const C1 = 32.70319566257483;

function besselI0(x: number): number {
  let s = 1, t = 1;
  for (let k = 1; k < 30; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
  }
  return s;
}

const DEC_TAPS = (() => {
  const M = 16, n = 2 * M + 1, beta = 8, fc = 0.25, h = new Float64Array(n);
  let s = 0;
  for (let i = -M; i <= M; i++) {
    const r = (2 * (i + M)) / (n - 1) - 1;
    const w = besselI0(beta * Math.sqrt(1 - r * r)) / besselI0(beta);
    h[i + M] = (i === 0 ? 2 * fc : Math.sin(Math.PI * 2 * fc * i) / (Math.PI * i)) * w;
    s += h[i + M];
  }
  for (let i = 0; i < n; i++) h[i] /= s;
  return h;
})();

/** 2:1 decimation with a zero-phase FIR, scaled by sqrt(2) as librosa's resample(scale=True). A half-band
 * filter's taps at even offsets are zero (but the centre), so only the odd pairs are summed. */
function decimate2(y: Float32Array): Float32Array {
  const M = (DEC_TAPS.length - 1) / 2, n = Math.ceil(y.length / 2), out = new Float32Array(n), len = y.length;
  const h0 = DEC_TAPS[M] * Math.SQRT2, odd: number[] = [], hs: number[] = [];
  for (let m = 1; m <= M; m += 2) {
    odd.push(m);
    hs.push(DEC_TAPS[M + m] * Math.SQRT2);
  }
  const at = (i: number) => (i >= 0 && i < len ? y[i] : 0);
  for (let j = 0; j < n; j++) {
    const c = 2 * j;
    let s = h0 * y[c];
    if (c - M >= 0 && c + M < len) {
      for (let q = 0; q < odd.length; q++) s += hs[q] * (y[c - odd[q]] + y[c + odd[q]]);
    } else {
      for (let q = 0; q < odd.length; q++) s += hs[q] * (at(c - odd[q]) + at(c + odd[q]));
    }
    out[j] = s;
  }
  return out;
}

interface SparseFilter {
  idx: Int32Array;
  re: Float64Array;
  im: Float64Array;
}

/** One octave's filters in the frequency domain (librosa's __vqt_filter_fft), sparsified so each keeps
 * 99 % of its magnitude. */
function octaveBasis(freqs: number[], sr: number, Q: number,
  gain: number): { rows: SparseFilter[]; nfft: number } {
  const lengths = freqs.map((f) => (Q * sr) / f);
  const nfft = 2 ** Math.ceil(Math.log2(Math.max(...lengths)));
  const fft = new ComplexFft(nfft), nb = nfft / 2 + 1, g = Math.sqrt(gain), rows: SparseFilter[] = [];
  const re = new Float64Array(nfft), im = new Float64Array(nfft), mags = new Float64Array(nb);
  for (let k = 0; k < freqs.length; k++) {
    const ilen = lengths[k], n0 = Math.floor(-ilen / 2), n1 = Math.floor(ilen / 2), L = n1 - n0, w = hann(L);
    let wsum = 0;
    for (let j = 0; j < L; j++) wsum += w[j];
    re.fill(0);
    im.fill(0);
    const lead = Math.floor((nfft - L) / 2);
    for (let j = 0; j < L; j++) {
      const ph = (2 * Math.PI * freqs[k] * (n0 + j)) / sr, a = ((w[j] / wsum) * ilen) / nfft;
      re[lead + j] = Math.cos(ph) * a;
      im[lead + j] = Math.sin(ph) * a;
    }
    fft.transform(re, im);
    let tot = 0;
    for (let f = 0; f < nb; f++) tot += (mags[f] = Math.hypot(re[f], im[f]));
    const sorted = Float64Array.from(mags).sort();
    let cum = 0, thr = sorted[0];
    for (let j = 0; j < nb; j++) {
      cum += sorted[j] / tot;
      if (cum >= 0.01) {
        thr = sorted[j];
        break;
      }
    }
    const idx: number[] = [], fr: number[] = [], fi: number[] = [];
    for (let f = 0; f < nb; f++) {
      if (mags[f] >= thr) {
        idx.push(f);
        fr.push(re[f] * g);
        fi.push(im[f] * g);
      }
    }
    rows.push({ idx: Int32Array.from(idx), re: Float64Array.from(fr), im: Float64Array.from(fi) });
  }
  return { rows, nfft };
}

const BPO = 36, N_OCT = 7;     // bins per octave, octaves

/** Chroma (12 x T, row-major, T = 1 + len(y) // 512) at the given tuning (fractions of a bin): a third of the
 * analysis's time, so audio.ts works it out once for the form map and the visualizer both. */
export function chromaCqt(y: Float32Array, tuning: number): Float32Array {
  const bpo = BPO, nOct = N_OCT;
  const nBins = nOct * bpo, fmin = C1 * 2 ** (tuning / bpo);
  const freqs = Array.from({ length: nBins }, (_, k) => fmin * 2 ** (k / bpo));
  const r2 = 2 ** (2 / bpo), Q = 1 / ((r2 - 1) / (r2 + 1));
  const T = 1 + Math.floor(y.length / HOP);   // the top octave's frames; every lower octave has as many or more
  const acc = new Float64Array(12 * T);
  let my = y, mySr = SR, myHop = HOP;
  for (let i = 0; i < nOct; i++) {
    const lo = nBins - bpo * (i + 1);
    const { rows, nfft } = octaveBasis(freqs.slice(lo, lo + bpo), mySr, Q, SR / mySr);
    const fft = realFft(nfft), half = nfft / 2, nb = half + 1;
    const buf = new Float64Array(nfft), re = new Float64Array(nb), im = new Float64Array(nb);
    const scale = rows.map((_, k) => 1 / Math.sqrt((Q * SR) / freqs[lo + k]));
    const pc = rows.map((_, k) => Math.floor(((lo + k + 1) % bpo) / (bpo / 12)));
    for (let t = 0; t < T; t++) {
      const s0 = t * myHop - half;
      for (let n = 0; n < nfft; n++) {
        const j = s0 + n;
        buf[n] = j >= 0 && j < my.length ? my[j] : 0;
      }
      fft.forward(buf, re, im);
      for (let k = 0; k < bpo; k++) {
        const r = rows[k];
        let a = 0, b = 0;
        for (let q = 0; q < r.idx.length; q++) {
          const f = r.idx[q];
          a += r.re[q] * re[f] - r.im[q] * im[f];
          b += r.re[q] * im[f] + r.im[q] * re[f];
        }
        acc[pc[k] * T + t] += Math.sqrt(a * a + b * b) * scale[k];
      }
    }
    if (myHop % 2 === 0) {
      myHop /= 2;
      mySr /= 2;
      my = decimate2(my);
    }
  }
  const chroma = new Float32Array(12 * T);
  for (let t = 0; t < T; t++) {
    let mx = 0;
    for (let c = 0; c < 12; c++) mx = Math.max(mx, acc[c * T + t]);
    const d = mx < TINY32 ? 1 : mx;
    for (let c = 0; c < 12; c++) chroma[c * T + t] = acc[c * T + t] / d;
  }
  return chroma;
}
