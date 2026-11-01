// Polyphonic note transcription with Spotify's basic-pitch (nmp.onnx, the ICASSP 2022 model). The
// windowing and the note decoding follow the basic_pitch package (inference.predict,
// note_creation.output_to_notes_polyphonic), so the same samples give the same notes. The decoding is a
// typed-array port that takes well under a second, where the npm package's takes minutes (its melodia
// trick rescans every frame for the maximum after each note).

import { runPieces, type Backend, type Piece } from './infer';
import { SR } from './resample';

const FFT_HOP = 256;
const WINDOW = SR * 2 - FFT_HOP;                // 43844 samples per model window
const N_OVERLAP = 30;                           // frames shared by neighbouring windows
const OVERLAP = N_OVERLAP * FFT_HOP;
const HOP = WINDOW - OVERLAP;
const FPS = Math.floor(SR / FFT_HOP);           // 86, as basic_pitch rounds it
const ANNOT_FRAMES = FPS * 2;                   // output frames per window
const NB = 88, MIDI_OFFSET = 21;

// the settings the shows are tuned to: onset_threshold 0.5, frame_threshold 0.3, minimum_note_length
// 58 ms, 40-4200 Hz
const ONSET_THRESH = 0.5, FRAME_THRESH = 0.3, ENERGY_TOL = 11;
const MIN_NOTE_FRAMES = Math.round((58 / 1000) * (SR / FFT_HOP));   // 5
const MIN_FREQ = 40, MAX_FREQ = 4200;

const MODEL = {
  url: `${import.meta.env.BASE_URL}models/basic_pitch-nmp.onnx`,
  input: 'serving_default_input_2:0',
  outputs: ['StatefulPartitionedCall:1', 'StatefulPartitionedCall:2'],   // note (frames), onset
};

interface NoteOptions {
  onProgress?: (fraction: number) => void;
  backend?: Backend;
  model?: ArrayBuffer;   // the .onnx file's bytes, instead of fetching it
}

/** Notes in mono 22050 Hz audio: rows of [start_s, end_s, midi_pitch, amplitude 0..1], sorted. */
export async function transcribe(y: Float32Array, opts: NoteOptions = {}): Promise<number[][]> {
  // half an overlap of silence first, then windows a hop apart (the last zero-padded)
  const padded = new Float32Array(OVERLAP / 2 + y.length);
  padded.set(y, OVERLAP / 2);
  const pieces: Piece[] = [];
  for (let i = 0; i < padded.length; i += HOP) {
    const w = new Float32Array(WINDOW);
    w.set(padded.subarray(i, i + WINDOW));
    pieces.push({ data: w, dims: [1, WINDOW, 1] });
  }
  const outs = await runPieces(MODEL, pieces,
    { backend: opts.backend, bytes: opts.model, onProgress: opts.onProgress });

  // unwrap_output: drop half the overlap at each end of every window, keep the song's own length
  const T = Math.floor(y.length * (FPS / SR));
  const frames = new Float32Array(T * NB), onsets = new Float32Array(T * NB);
  const trim = N_OVERLAP / 2;
  let t = 0;
  for (const o of outs) {
    const f = o[MODEL.outputs[0]], on = o[MODEL.outputs[1]], n = f.length / NB;
    for (let j = trim; j < n - trim && t < T; j++, t++) {
      frames.set(f.subarray(j * NB, (j + 1) * NB), t * NB);
      onsets.set(on.subarray(j * NB, (j + 1) * NB), t * NB);
    }
  }
  return notesFromActivations(frames, onsets, T);
}

const hzToMidi = (hz: number) => 12 * Math.log2(hz / 440) + 69;

/** basic_pitch's model_frames_to_time: frame times, less a small offset per window. */
function frameTime(f: number): number {
  const offset = (FFT_HOP / SR) * (ANNOT_FRAMES - WINDOW / FFT_HOP) + 0.0018;
  return (f * FFT_HOP) / SR - offset * Math.floor(f / ANNOT_FRAMES);
}

/** output_to_notes_polyphonic (infer_onsets and the melodia trick on), then frames to seconds.
 * frames and onsets are T x 88, row-major; they are not modified. */
function notesFromActivations(framesIn: Float32Array, onsetsIn: Float32Array, T: number): number[][] {
  const frames = framesIn.slice(), onsets = onsetsIn.slice();

  // constrain_frequency
  const hiIdx = Math.round(hzToMidi(MAX_FREQ) - MIDI_OFFSET);
  const loIdx = Math.round(hzToMidi(MIN_FREQ) - MIDI_OFFSET);
  for (let t = 0; t < T; t++) {
    frames.fill(0, t * NB + hiIdx, (t + 1) * NB);
    onsets.fill(0, t * NB + hiIdx, (t + 1) * NB);
    frames.fill(0, t * NB, t * NB + loIdx);
    onsets.fill(0, t * NB, t * NB + loIdx);
  }

  // get_infered_onsets: big rises in the frame activations count as onsets too
  const diff = new Float64Array(T * NB);
  let onsetMax = 0, diffMax = 0;
  for (let i = 0; i < onsets.length; i++) if (onsets[i] > onsetMax) onsetMax = onsets[i];
  for (let t = 2; t < T; t++) {
    for (let c = 0; c < NB; c++) {
      const v = frames[t * NB + c];
      const d = Math.max(Math.min(v - frames[(t - 1) * NB + c], v - frames[(t - 2) * NB + c]), 0);
      diff[t * NB + c] = d;
      if (d > diffMax) diffMax = d;
    }
  }
  const onset = new Float64Array(T * NB);
  for (let i = 0; i < onset.length; i++) onset[i] = Math.max(onsets[i], (onsetMax * diff[i]) / diffMax);

  // onsets: strict local maxima in time (scipy's argrelmax, so never the first or last frame) at or
  // above the threshold, taken latest first
  const starts: number[] = [], pitches: number[] = [];
  for (let t = T - 2; t >= 1; t--) {
    for (let c = NB - 1; c >= 0; c--) {
      const v = onset[t * NB + c];
      if (v >= ONSET_THRESH && v > onset[(t - 1) * NB + c] && v > onset[(t + 1) * NB + c]) {
        starts.push(t);
        pitches.push(c);
      }
    }
  }

  const rem = frames.slice(), events: [number, number, number, number][] = [];
  const mean = (a: number, b: number, c: number) => {
    let s = 0;
    for (let j = a; j < b; j++) s += frames[j * NB + c];
    return s / (b - a);
  };
  const clear = (i: number, c: number) => {
    rem[i * NB + c] = 0;
    if (c < NB - 1) rem[i * NB + c + 1] = 0;
    if (c > 0) rem[i * NB + c - 1] = 0;
  };
  for (let n = 0; n < starts.length; n++) {
    const s0 = starts[n], c = pitches[n];
    if (s0 >= T - 1) continue;
    let i = s0 + 1, k = 0;
    while (i < T - 1 && k < ENERGY_TOL) {
      k = rem[i * NB + c] < FRAME_THRESH ? k + 1 : 0;
      i++;
    }
    i -= k;
    if (i - s0 <= MIN_NOTE_FRAMES) continue;
    for (let j = s0; j < i; j++) clear(j, c);
    events.push([s0, i, c + MIDI_OFFSET, mean(s0, i, c)]);
  }

  // The melodia trick: notes grown from the strongest energy left, until none is above the threshold.
  // Energy only ever drops to 0, so basic_pitch's repeated argmax visits the cells above the threshold in
  // descending order (ties: the first in row-major order), skipping those already cleared.
  const cand: number[] = [];
  for (let i = 0; i < rem.length; i++) if (rem[i] > FRAME_THRESH) cand.push(i);
  cand.sort((a, b) => rem[b] - rem[a] || a - b);
  for (const idx of cand) {
    if (rem[idx] === 0) continue;
    const mid = Math.floor(idx / NB), c = idx % NB;
    rem[idx] = 0;
    let i = mid + 1, k = 0;
    while (i < T - 1 && k < ENERGY_TOL) {
      k = rem[i * NB + c] < FRAME_THRESH ? k + 1 : 0;
      clear(i, c);
      i++;
    }
    const end = i - 1 - k;
    i = mid - 1;
    k = 0;
    while (i > 0 && k < ENERGY_TOL) {
      k = rem[i * NB + c] < FRAME_THRESH ? k + 1 : 0;
      clear(i, c);
      i--;
    }
    const start = i + 1 + k;
    if (end - start <= MIN_NOTE_FRAMES) continue;
    events.push([start, end, c + MIDI_OFFSET, mean(start, end, c)]);
  }

  return events
    .map(([s, e, p, a]) => [frameTime(s), frameTime(e), p, a])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
}
