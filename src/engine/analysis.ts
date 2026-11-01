// What the listening side (listen/audio.ts) hands the choreographer: the song's beats, notes, loudness
// and form, with per-frame curves on the show's 20 ms grid.

import type { MoveName } from './catalog';

/** Transcribed note events (a key press or a chord), one entry per onset group (texture.ts). */
export interface Events {
  t: number[];
  dur: number[];
  low: number[];        // midi
  high: number[];
  top: number[];        // melodic pitch
  amp: number[];
  kind: number[];       // 0 single note, 1 dyad, 2 chord, 3 big chord
  trill: number[];      // 1 inside a rapid two-note alternation
  arrival: number[];    // 1 on a strong chord that lands after a run or a rest
  phrase: string[];     // the texture of the passage each event is in (texture.labelPhrases)
}

/** A stretch of the form map (form.ts). */
export interface Section {
  t0: number;
  t1: number;
  letter: string;       // sections with the same letter are the same material
  index: number;
  nth: number;          // how many times the letter was heard before
}

/** A phrase: the unit a move plays over (phrases.ts), events [a, b). The choreographer adds its level
 * (level.ts) and the move it plays. */
export interface Phrase {
  a: number;
  b: number;
  t0: number;
  t1: number;
  gesture: string;
  up: number;           // share of rising steps in the melody
  lo: number;           // the melody's lowest and highest pitch, but for strays (its 10th and 90th percentiles)
  hi: number;
  level?: number;
  move?: MoveName;
}

/** The energy in four bands, per frame 0..1: a level meter's, rising at once and falling over about 0.1 s. */
export interface Bands {
  low: Float32Array;      // below 150 Hz: kick and bass, the thump
  lowMid: Float32Array;   // 150-600 Hz: the body of chords, voices and drums
  highMid: Float32Array;  // 600 Hz-4 kHz: the voice, leads, the snare's crack
  high: Float32Array;     // above 4 kHz: cymbals, hats, breath and sparkle
}

export interface Analysis {
  duration: number;
  nFrames: number;
  step: number;
  tempo: number;
  beats: number[];
  downbeats: number[];
  hits: number[];        // the strongest accents, at least 0.5 s apart
  events: Events;
  pitchLo: number;       // the song's melodic range, mapped across the stage
  pitchHi: number;
  beatScore: number;     // the onset curve on the beats over its mean (2 and up: a beat to follow)
  heardBeats: number[] | null;   // the neural tracker's beats as it heard them (feel.ts), if it ran
  sections: Section[];
  pulseEnv: number[];    // the onset strength curve, one value per pulseHop seconds
  pulseHop: number;
  // What a music visualizer shows (listen/visual.ts). Curves have one value per frame (nFrames), 0..1 over
  // the song, except kit and beatConfidence, which mean the same in every song (a song without drums stays
  // low); hit lists are rows of time, strength 0..1, in time order.
  loudness: Float32Array;       // the whole mix's level in dB: its loud end (99th percentile) 1, 40 dB below
                                // it (or its quietest stretch, at least 12 dB down) 0
  bands: Bands;
  kick: number[][];             // kick hits: the low end jumping (a bass drum, timpani, a bass note's attack)
  snare: number[][];            // snare hits: a body and noise up to 7 kHz at once (snare, claps, a crash)
  hats: number[][];             // hi-hat and cymbal ticks: noise above 8 kHz
  brightness: Float32Array;     // dull to bright (the spectral centroid): a colour temperature
  chroma: Float32Array;         // nFrames x 12, frame-major from C: each pitch class's share, the loudest 1
  pitchClass: Uint8Array;       // the harmony's strongest pitch class over each beat (0 C .. 11 B): a colour
                                // that changes on the beat
  pitchClassStrength: Float32Array;   // how clearly it leads (0 in noise, drums or silence)
  novelty: Float32Array;        // how much the sound changes from the second before to the second after
  noveltyPeaks: number[][];     // the moments it changes most (an entry, a drop, a new texture), 1 s apart
  kit: Float32Array;            // how much a drum kit is playing: the drum-kit layer vs. gentle percussion
  beatConfidence: Float32Array; // how clearly the beats land on accents: beat lights vs. flowing (0: no beat)
  // set while choreographing
  phrases?: Phrase[];
  level?: Float32Array;  // per frame 0..1: how big the show is (level.ts)
}
