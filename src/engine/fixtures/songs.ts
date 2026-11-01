// Three short songs made in code, so the tests listen to real music without any recording:
//   groove   a 120 bpm drum-kit groove: kick, snare and hi-hats over bass and chords, a verse and then a
//            louder chorus with a lead line
//   chorale  slow sustained chords with no beat, of uneven lengths, swelling and fading
//   build    an orchestral crescendo: strings swell from almost nothing over a timpani roll, then the
//            timpani and low brass march on the beat (no drum kit) to a last chord
// Mono at 22050 Hz, the listening's input. The same samples every time: the noise is seeded.

export const SR = 22050;

const TAU = 2 * Math.PI;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** White noise in -1..1 from a fixed seed (xorshift32). */
function noise(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s / 2147483648 - 1;
  }
  return out;
}

interface Tone {
  amp: number;
  harmonics?: number;     // partials 1..n, the k-th at 1 / k^tilt
  tilt?: number;
  odd?: boolean;          // odd partials only (a reedy, square-ish tone)
  attack?: number;        // seconds, a raised-cosine rise
  release?: number;       // seconds after the note's end
  decay?: number;         // an exponential fade with this time constant (struck tones), else sustained
  vibrato?: number;       // depth as a fraction of the pitch, at 5 Hz
}

/** One pitched note added into `y`: from t0 for dur seconds, then its release. */
function note(y: Float32Array, t0: number, dur: number, midi: number, o: Tone) {
  const { amp, harmonics = 6, tilt = 1, odd = false, attack = 0.01, release = 0.08, decay, vibrato = 0 } = o;
  const f = hz(midi);
  const i0 = Math.round(t0 * SR), n = Math.round((dur + release) * SR);
  let phase = 0;
  for (let i = 0; i < n && i0 + i < y.length; i++) {
    const t = i / SR;
    let env = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    if (decay) env *= Math.exp(-t / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    phase += (TAU * f * (1 + vibrato * Math.sin(TAU * 5 * t))) / SR;
    let s = 0;
    for (let k = 1; k <= harmonics; k += odd ? 2 : 1) {
      if (k * f < SR / 2) s += Math.sin(k * phase) / k ** tilt;
    }
    y[i0 + i] += amp * env * s;
  }
}

function kick(y: Float32Array, t0: number, amp: number) {
  const i0 = Math.round(t0 * SR);
  let phase = 0;
  for (let i = 0; i < 0.35 * SR && i0 + i < y.length; i++) {
    const t = i / SR;
    phase += (TAU * (48 + 90 * Math.exp(-t / 0.035))) / SR;
    y[i0 + i] += amp * Math.exp(-t / 0.18) * Math.sin(phase);
  }
}

function snare(y: Float32Array, t0: number, amp: number, n: Float32Array) {
  const i0 = Math.round(t0 * SR);
  for (let i = 1; i < 0.3 * SR && i0 + i < y.length; i++) {
    const t = i / SR;
    const hiss = n[(i0 + i) % n.length] - n[(i0 + i - 1) % n.length];
    y[i0 + i] += amp * (0.5 * hiss * Math.exp(-t / 0.1) + 0.5 * Math.sin(TAU * 185 * t) * Math.exp(-t / 0.06));
  }
}

/** A hi-hat: high-passed noise, closed (short) or open. */
function hat(y: Float32Array, t0: number, amp: number, n: Float32Array, open = false) {
  const i0 = Math.round(t0 * SR), tau = open ? 0.18 : 0.03;
  for (let i = 1; i < 6 * tau * SR && i0 + i < y.length; i++) {
    const hiss = n[(i0 + i) % n.length] - n[(i0 + i - 1) % n.length];
    y[i0 + i] += amp * hiss * Math.exp(-i / SR / tau);
  }
}

/** A timpani stroke: a low drum note, struck. */
function timpani(y: Float32Array, t0: number, midi: number, amp: number) {
  note(y, t0, 1.2, midi, { amp, harmonics: 4, tilt: 1.2, attack: 0.003, decay: 0.5, release: 0.3 });
}

function normalize(y: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of y) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < y.length; i++) y[i] *= peak / m;
  return y;
}

/** 20 bars at 120 bpm: 8 bars of verse, 8 of a louder chorus with a lead line, 4 more of verse, a last hit. */
export function groove(): Float32Array {
  const beat = 0.5, bars = 20;
  const y = new Float32Array(Math.round((bars * 4 * beat + 2) * SR));
  const n = noise(SR, 7);
  const roots = [45, 41, 48, 43];                                   // A F C G
  const chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
  const lead = [69, 72, 74, 76, 74, 72, 69, 67];
  for (let bar = 0; bar < bars; bar++) {
    const chorus = bar >= 8 && bar < 16, lift = chorus ? 1.4 : 1;
    const t = bar * 4 * beat, k = bar % 4;
    for (let e = 0; e < 8; e++) {                                   // eighths
      const te = t + (e * beat) / 2;
      if (e === 0 || e === 3 || e === 4) kick(y, te, 0.9 * lift);
      if (e === 2 || e === 6) snare(y, te, 0.6 * lift, n);
      hat(y, te, (e % 2 ? 0.12 : 0.2) * lift, n, chorus && e === 7);
      if (e === 0 || e === 3 || e === 4 || e === 6) {
        const root = roots[k] + (e === 6 ? 12 : 0);
        note(y, te, beat * 0.45, root, { amp: 0.25 * lift, harmonics: 4, decay: 0.3 });
      }
      if (chorus) {
        note(y, te, beat * 0.45, lead[(e + bar) % 8], { amp: 0.09, harmonics: 7, odd: true, release: 0.05 });
      }
    }
    for (const at of [0, 1.5]) {
      const piano = { amp: 0.07 * lift, harmonics: 6, tilt: 1.5, decay: 0.8 };
      for (const m of chords[k]) note(y, t + at * beat, beat * 1.4, m, piano);
    }
  }
  const end = bars * 4 * beat;
  kick(y, end, 1.2);
  hat(y, end, 0.3, n, true);
  for (const m of [45, 57, 60, 64]) note(y, end, 1.0, m, { amp: 0.12, harmonics: 6, tilt: 1.5, decay: 0.6 });
  return normalize(y);
}

/** Nine chords of uneven length with slow attacks, overlapping as they change, the melody on top gliding
 * between two notes in each; the whole swells to the middle and fades. No beat. */
export function chorale(): Float32Array {
  const chords: [number, number[], number[]][] = [   // seconds, the lower voices, the melody
    [4.2, [36, 52, 55], [64, 67]], [3.6, [45, 52, 57], [72, 71]], [4.8, [41, 53, 57], [69, 72]],
    [3.1, [43, 50, 55], [71, 74]], [4.4, [40, 52, 55], [67, 71]], [3.9, [45, 52, 60], [72, 69]],
    [5.2, [38, 53, 57], [65, 69]], [4.5, [43, 50, 59], [67, 62]], [6.3, [36, 52, 55], [64, 60]],
  ];
  const total = chords.reduce((s, c) => s + c[0], 0);
  const y = new Float32Array(Math.round((total + 2) * SR));
  let t = 0;
  for (const [dur, low, top] of chords) {
    const level = 0.25 + 0.75 * Math.sin((Math.PI * (t + dur / 2)) / total);   // the swell
    const voice = { harmonics: 8, tilt: 1.2, attack: 0.7, release: 0.9, vibrato: 0.002 };
    for (const m of low) note(y, t, dur, m, { ...voice, amp: 0.1 * level });
    note(y, t, dur / 2, top[0], { ...voice, amp: 0.12 * level, vibrato: 0.004 });
    note(y, t + dur / 2, dur / 2, top[1], { ...voice, amp: 0.12 * level, vibrato: 0.004 });
    t += dur;
  }
  return normalize(y);
}

/** Strings swell from almost nothing over a timpani roll for 32 s, then a march at 100 bpm (timpani on every
 * beat, low brass on 1 and 3, the strings held) that starts softer and grows for 60 beats to a last chord. */
export function build(): Float32Array {
  const swell = 32, beat = 0.6, nBeats = 60;
  const end = swell + nBeats * beat;
  const y = new Float32Array(Math.round((end + 3) * SR));
  // D minor, B flat, G minor, A
  const harmony: number[][] = [[50, 57, 62, 65], [46, 53, 58, 62], [43, 55, 58, 62], [45, 52, 57, 61]];
  const strings = { harmonics: 8, tilt: 1.1, attack: 1.5, release: 1.2, vibrato: 0.003 };
  const level = (t: number) => 0.03 + 0.97 * (Math.min(t, swell) / swell) ** 2;
  for (let k = 0; k * 8 < swell; k++) {
    for (const m of harmony[k]) note(y, k * 8, 8, m, { ...strings, amp: 0.1 * level(k * 8 + 8) });
  }
  const r = noise(400, 3);                                           // the roll's uneven strokes
  for (let t = 0.5, i = 0; t < swell; t += 0.075 + 0.03 * r[i++ % r.length]) {
    timpani(y, t, 38, 0.06 * level(t));
  }
  for (const m of harmony[0]) note(y, swell, nBeats * beat, m, { ...strings, attack: 0.3, amp: 0.05 });
  for (let b = 0; b < nBeats; b++) {
    const t = swell + b * beat, grow = 0.4 + 0.6 * (b / nBeats) ** 2;
    timpani(y, t, b % 2 ? 33 : 38, 0.5 * grow);
    if (b % 2 === 0) {
      for (const m of [38, 50, 53, 57]) {
        note(y, t, beat * 0.8, m, { amp: 0.12 * grow, harmonics: 10, tilt: 0.8, attack: 0.03, decay: 0.5 });
      }
    }
  }
  timpani(y, end, 38, 0.8);
  const brass = { amp: 0.15, harmonics: 10, tilt: 0.8, attack: 0.03, decay: 1.2 };
  for (const m of [38, 50, 57, 62, 65, 69]) note(y, end, 2.0, m, brass);
  return normalize(y);
}

export const SONGS = { groove, chorale, build };
