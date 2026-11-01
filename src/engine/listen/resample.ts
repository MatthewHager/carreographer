// Our own resampler. Browsers resample while decoding, each its own way, and that moved beats; so the
// app decodes at the file's rate and comes down to 22050 Hz here, as librosa.load(sr=22050) does:
// channels averaged, then resampled.
// A Kaiser-windowed sinc, zero-phase (timing is unchanged), lowpass at 0.97 of the output Nyquist.

export const SR = 22050;

/** The modified Bessel function I0, for the Kaiser window. */
function i0(x: number): number {
  let s = 1, t = 1;
  for (let k = 1; k < 40; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
    if (t < 1e-12 * s) break;
  }
  return s;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const MAX_PHASES = 4096;
const ZERO_CROSSINGS = 20, BETA = 9;     // the Kaiser-windowed sinc's half-length and window shape

/** x resampled from srIn to srOut Hz. The filter's taps are tabulated per phase: one phase for
 * 44.1 kHz to 22050 Hz, 147 for 48 kHz; odd or fractional rates round to 4096 phases. */
function resample(x: Float32Array, srIn: number, srOut: number) {
  const zeroCrossings = ZERO_CROSSINGS, beta = BETA;
  if (srIn === srOut) return x.slice();
  const r = srIn / srOut;
  const fc = (0.97 * 0.5) / Math.max(r, 1);         // cutoff, cycles per input sample
  const hw = Math.ceil(zeroCrossings / (2 * fc));   // half-width in input samples
  const g = Number.isInteger(srIn) && Number.isInteger(srOut) ? gcd(srIn, srOut) : 0;
  // output n sits at input position n * L / M
  const exact = g > 0 && srOut / g <= MAX_PHASES;
  const L = exact ? srIn / g : r * MAX_PHASES, M = exact ? srOut / g : MAX_PHASES;
  const nOut = exact ? Math.floor((x.length * M + L - 1) / L) : Math.ceil(x.length / r);

  const nTaps = 2 * hw + 2, i0b = i0(beta), taps = new Float64Array(M * nTaps);
  for (let p = 0; p < M; p++) {
    for (let j = 0; j < nTaps; j++) {
      const d = j - hw - p / M, a = d / hw;
      if (a <= -1 || a >= 1) continue;
      const u = 2 * fc * d;
      taps[p * nTaps + j] = 2 * fc * (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u))
        * (i0(beta * Math.sqrt(1 - a * a)) / i0b);
    }
  }

  const out = new Float32Array(nOut), last = x.length - 1;
  for (let n = 0; n < nOut; n++) {
    const pos = n * L;
    let base = Math.floor(pos / M), p = exact ? pos - base * M : Math.round(pos - base * M);
    if (p === M) { base++; p = 0; }
    const t0 = p * nTaps - (base - hw), a = Math.max(0, base - hw), b = Math.min(last, base + hw + 1);
    let s = 0;
    for (let k = a; k <= b; k++) s += x[k] * taps[t0 + k];
    out[n] = s;
  }
  return out;
}

/** The channels averaged, as librosa.to_mono does. */
export function mixdown(channels: readonly Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0, mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i];
  if (channels.length > 1) for (let i = 0; i < n; i++) mono[i] /= channels.length;
  return mono;
}

/** Mono 22050 Hz from decoded channels (an AudioBuffer's getChannelData), averaged then resampled. */
export function monoAt22050(channels: readonly Float32Array[], sr: number): Float32Array {
  const mono = mixdown(channels);
  return sr === SR ? mono : resample(mono, sr, SR);
}
