// Beats and downbeats with Beat This! (CPJKU; Foscarin, Schlueter & Widmer 2024), the final0 checkpoint
// exported to ONNX with fp16 weights. The same steps as beat_this.inference.File2Beats(dbn=False):
// torchaudio's log-mel spectrogram, 1500-frame chunks with 6-frame borders (keep_first), and the
// "minimal" postprocessor.

import { hann } from './dsp';
import { realFft } from './fft';
import { runPieces, type Backend, type Piece } from './infer';
import { SR } from './resample';

const N_FFT = 1024, HOP = 441, N_MELS = 128, F_MIN = 30, F_MAX = 11000, FPS = 50;
const CHUNK = 1500, BORDER = 6;

const MODEL = {
  url: `${import.meta.env.BASE_URL}models/beat_this-final0-fp16w.onnx`,
  input: 'spect',
  outputs: ['beat', 'downbeat'],
};

export interface Beats {
  beats: number[];       // seconds
  downbeats: number[];   // seconds, each one of the beats
}

interface BeatOptions {
  onProgress?: (fraction: number) => void;
  backend?: Backend;
  model?: ArrayBuffer;   // the .onnx file's bytes, instead of fetching it
}

/** Beats and downbeats of mono 22050 Hz audio. */
export async function trackBeats(y: Float32Array, opts: BeatOptions = {}): Promise<Beats> {
  const { data: spect, T } = logMel(y);
  opts.onProgress?.(0.05);
  const starts = chunkStarts(T);
  const pieces: Piece[] = starts.map((s) => chunkAt(spect, T, s));
  const outs = await runPieces(MODEL, pieces, {
    backend: opts.backend, bytes: opts.model, onProgress: (f) => opts.onProgress?.(0.05 + 0.95 * f),
  });
  const { beat, down } = aggregate(starts, outs.map((o) => [o.beat, o.downbeat]), T);
  return postprocess(beat, down);
}

// ---------- the front end: torchaudio's MelSpectrogram as beat_this.preprocessing sets it up ----------

const hzToMel = (f: number) => (f >= 1000 ? 15 + Math.log(f / 1000) / (Math.log(6.4) / 27) : (3 * f) / 200);
const melToHz = (m: number) => (m >= 15 ? 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)) : (200 * m) / 3);

/** melscale_fbanks(513, 30, 11000, 128, 22050, norm=None, mel_scale="slaney"), sparse: each band's
 * first bin and weights. */
function melBands(): { start: number; w: Float32Array }[] {
  const nFreqs = N_FFT / 2 + 1, top = Math.floor(SR / 2);
  const mMin = hzToMel(F_MIN), mMax = hzToMel(F_MAX);
  const pts = Float64Array.from({ length: N_MELS + 2 },
    (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (N_MELS + 1)));
  const bands = [];
  for (let m = 0; m < N_MELS; m++) {
    const lo = pts[m], mid = pts[m + 1], hi = pts[m + 2], w: number[] = [];
    let start = -1;
    for (let k = 0; k < nFreqs; k++) {
      const f = (top * k) / (nFreqs - 1);
      const v = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)));
      if (v > 0) {
        if (start < 0) start = k;
        w.push(v);
      } else if (start >= 0) break;
    }
    bands.push({ start: Math.max(start, 0), w: Float32Array.from(w) });   // torch keeps them in float32
  }
  return bands;
}

/** log1p(1000 * mel(|STFT|)): centred frames with reflect padding, a periodic Hann window, magnitudes
 * scaled by 1 / sqrt(n_fft) (normalized="frame_length"). T frames x 128 mels, row-major. */
function logMel(x: Float32Array): { data: Float32Array; T: number } {
  const n = x.length, pad = N_FFT / 2, T = 1 + Math.floor(n / HOP);
  const win = hann(N_FFT);
  // torch.stft's reflect padding (the edge sample isn't repeated)
  const at = (i: number) => x[i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i];
  const fft = realFft(N_FFT), bands = melBands(), norm = 1 / Math.sqrt(N_FFT);
  const nBins = N_FFT / 2 + 1, frame = new Float64Array(N_FFT);
  const re = new Float64Array(nBins), im = new Float64Array(nBins), mag = new Float64Array(nBins);
  const out = new Float32Array(T * N_MELS);
  for (let t = 0; t < T; t++) {
    const s = t * HOP - pad;
    if (s >= 0 && s + N_FFT <= n) for (let i = 0; i < N_FFT; i++) frame[i] = x[s + i] * win[i];
    else for (let i = 0; i < N_FFT; i++) frame[i] = at(s + i) * win[i];
    fft.forward(frame, re, im);
    for (let k = 0; k < nBins; k++) mag[k] = Math.hypot(re[k], im[k]) * norm;
    for (let m = 0; m < N_MELS; m++) {
      const { start, w } = bands[m];
      let acc = 0;
      for (let j = 0; j < w.length; j++) acc += mag[start + j] * w[j];
      out[t * N_MELS + m] = Math.log1p(1000 * acc);
    }
  }
  return { data: out, T };
}

// ---------- chunking: beat_this.inference.split_piece / aggregate_prediction ----------

/** Chunk start frames (the first is negative: the piece is zero-padded by the border). */
function chunkStarts(T: number): number[] {
  const starts = [];
  for (let s = -BORDER; s < T - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  if (T > CHUNK - 2 * BORDER) starts[starts.length - 1] = T - (CHUNK - BORDER);   // avoid_short_end
  return starts;
}

function chunkAt(spect: Float32Array, T: number, s: number): Piece {
  const lo = Math.max(s, 0), hi = Math.min(s + CHUNK, T);
  const left = Math.max(0, -s), right = Math.max(0, Math.min(BORDER, s + CHUNK - T));
  const len = left + (hi - lo) + right, data = new Float32Array(len * N_MELS);
  data.set(spect.subarray(lo * N_MELS, hi * N_MELS), left * N_MELS);
  return { data, dims: [1, len, N_MELS] };
}

/** keep_first: where chunks overlap, the earlier chunk's prediction wins. */
function aggregate(starts: number[], preds: Float32Array[][], T: number) {
  const beat = new Float32Array(T).fill(-1000), down = new Float32Array(T).fill(-1000);
  for (let i = starts.length - 1; i >= 0; i--) {
    const s = starts[i], [b, d] = preds[i];
    for (let j = BORDER; j < b.length - BORDER; j++) {
      const f = s + j;
      if (f >= 0 && f < T) {
        beat[f] = b[j];
        down[f] = d[j];
      }
    }
  }
  return { beat, down };
}

// ---------- beat_this.model.postprocessor.Postprocessor(type="minimal") ----------

/** Frames that are the maximum of a 7-frame window with a logit above 0 (probability 0.5); runs of
 * adjacent peaks become their running mean (deduplicate_peaks, width 1). */
function peaks(logits: Float32Array): number[] {
  const T = logits.length, idx: number[] = [];
  for (let t = 0; t < T; t++) {
    const v = logits[t];
    if (!(v > 0)) continue;
    let mx = -Infinity;
    for (let k = Math.max(0, t - 3); k <= Math.min(T - 1, t + 3); k++) if (logits[k] > mx) mx = logits[k];
    if (v === mx) idx.push(t);
  }
  const out: number[] = [];
  if (!idx.length) return out;
  let p = idx[0], c = 1;
  for (let i = 1; i < idx.length; i++) {
    const p2 = idx[i];
    if (p2 - p <= 1) {
      c += 1;
      p += (p2 - p) / c;
    } else {
      out.push(p);
      p = p2;
      c = 1;
    }
  }
  out.push(p);
  return out;
}

/** Beats and downbeats in seconds, each downbeat moved to its nearest beat. */
function postprocess(beatLogits: Float32Array, downLogits: Float32Array): Beats {
  const beats = peaks(beatLogits).map((f) => f / FPS);
  let downs = peaks(downLogits).map((f) => f / FPS);
  if (beats.length) {
    downs = downs.map((d) => {
      let best = 0;
      for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - d) < Math.abs(beats[best] - d)) best = i;
      return beats[best];
    });
  }
  return { beats, downbeats: [...new Set(downs)].sort((a, b) => a - b) };
}
