// Music analysis on the show's frame grid: what the choreography reacts to.
//   hits      the strongest accents in the whole piece
//   beats / downbeats, tempo-following (the neural tracker's, where its grid keeps a pulse)
//   events    the transcribed notes grouped into key presses and chords (texture.ts)
//   sections  the form map (form.ts)
//   and what a music visualizer shows: loudness, band levels, the drum kit piece by piece, brightness,
//   chroma, novelty, how much a kit is playing and how clear the beat is (visual.ts)
// Everything comes from the full mix: there is no source separation.

import type { Analysis } from '../analysis';
import type { Beats } from './beats';
import { chromaCqt } from './cqt';
import { analyzeForm } from './form';
import { diff, mean, median, quantile } from '../np';
import { groupEvents, labelPhrases, pitchScale } from './texture';
import { framesToTime, HOP, onsetDetect, onsetStrength, powerToDb, spectrum, SR } from './dsp';
import { visuals } from './visual';


interface AnalyzeOptions {
  stepMs: number;
  /** basic-pitch notes: rows of (start s, end s, midi pitch, amplitude 0..1), sorted by start */
  notes: number[][];
  /** the neural beat tracker's grid (beat-this); none only in tests of other measures */
  neuralBeats?: Beats | null;
}

const BREAK = 2.5;        // a gap this many times the usual one is a break in the music, not a beat

const HALF = [1.75, 2.3];    // a gap this many times the steady one is a beat dropped (twice, give or take)
const IN_STEP = 0.15;         // gaps within this share of each other keep the same pace

/** The beats with the tracker's half-time slips mended: where a run of beat gaps (at least two, each IN_STEP
 * of the one before) is twice the steady gaps just before it (HALF) and the music still hits halfway between
 * (the onset curve `env` there at least half as strong as on the beats), the halfway beats go back in. */
function mendHalves(b: number[], env: Float32Array): number[] {
  const at = (t: number) => {
    const i = Math.round(t / (HOP / SR));
    let m = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) m = Math.max(m, env[k]);
    return m;
  };
  const g = diff(b), out: number[] = [b[0]], brk = BREAK * median(g);
  let ref = median(Array.from(g).slice(0, 8));
  for (let i = 0; i < g.length; i++) {
    const r = g[i] / ref;
    if (r > HALF[0] && r < HALF[1] && g[i] < brk) {
      let j = i + 1;      // the slow beats run on while each gap is in step with the one before
      while (j < g.length && Math.abs(g[j] / g[j - 1] - 1) < IN_STEP) j++;
      const mids = [];
      for (let k = i; k < j; k++) mids.push((b[k] + b[k + 1]) / 2);
      const onBeats = median(b.slice(i, j + 1).map(at)), between = median(mids.map(at));
      if (j - i >= 2 && between >= 0.5 * onBeats) {
        for (let k = i; k < j; k++) out.push(mids[k - i], b[k + 1]);
        i = j - 1;
        continue;
      }
    }
    out.push(b[i + 1]);
    if (g[i] < brk && Math.abs(r - 1) < IN_STEP) ref = 0.75 * ref + 0.25 * g[i];   // follows the tempo
  }
  return out;
}

/** The analysis of `y` (mono, 22050 Hz samples) on a grid of `stepMs` frames. */
export function analyze(y: Float32Array, opts: AnalyzeOptions): Analysis {
  const sr = SR;
  const duration = y.length / sr;
  const step = opts.stepMs / 1000.0;
  const nFrames = Math.ceil(duration / step);

  const spec = spectrum(y);
  const T = spec.T;
  const melDb = powerToDb(spec.mel96, 'max');

  // --- Beats: the neural tracker's grid, its half-time slips mended. It reads swing, shuffles, fills and a
  // performer's tempo far better than onset autocorrelation; where it guesses (music with no beat to follow),
  // feel.ts hears that its grid wanders and the show flows there instead of hitting.
  const fullEnv = onsetStrength(melDb, T, 0, 96);
  const heard = opts.neuralBeats;
  const beats = heard && heard.beats.length >= 4 ? mendHalves(heard.beats, fullEnv) : heard?.beats.slice() ?? [];
  const downbeats = heard?.downbeats.slice() ?? [];
  const tempo = beats.length > 1 ? 60.0 / median(diff(beats)) : 120.0;
  const beatFrames = beats.map((t) => Math.min(Math.round(t / (HOP / SR)), fullEnv.length - 1));

  // --- Global accents: strongest onsets anywhere, >= 0.5 s apart ---
  const frames = onsetDetect(fullEnv);
  const hits: number[] = [];
  if (frames.length) {
    const s = frames.map((f) => fullEnv[f]);
    const cut = quantile(s, 0.93);
    let last = -1.0;
    frames.forEach((f, i) => {
      if (s[i] < cut) return;
      const t = framesToTime(f);
      if (t - last >= 0.5) {
        hits.push(t);
        last = t;
      }
    });
  }

  // how much harder the music hits on the beats than on average (the strongest attack within ±2 frames: the
  // tracker's beat can sit a frame off the onset's peak)
  const onBeats = beatFrames.map((f) => Math.max(...fullEnv.subarray(Math.max(0, f - 2), f + 3)));
  const beatScore = onBeats.length ? mean(onBeats) / Math.max(mean(fullEnv), 1e-9) : 1;

  // --- Form map: sections and repeats ---
  const chroma = chromaCqt(y, spec.tuning);
  const sections = analyzeForm(duration, spec, chroma, beatFrames);

  const events = labelPhrases(groupEvents(opts.notes));
  const [pitchLo, pitchHi] = pitchScale(events);

  return {
    duration, nFrames, step, tempo, beats, downbeats, hits, events, pitchLo, pitchHi, beatScore, sections,
    heardBeats: opts.neuralBeats?.beats.slice() ?? null,
    pulseEnv: Array.from(fullEnv), pulseHop: HOP / SR,
    ...visuals(spec, chroma, fullEnv, beats, nFrames, step),
  };
}
