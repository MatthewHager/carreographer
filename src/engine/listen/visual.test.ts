import { describe, expect, it } from 'vitest';
import type { Analysis } from '../analysis';
import { analyze } from './audio';
import { SR } from './dsp';

// Synthetic signals at 22050 Hz, made with a fixed-seed generator so every run hears the same noise.

function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

const BPM = 120, BEAT = 60 / BPM;

/** Adds a drum hit at `t` seconds: a kick (a pitch-dropping thump), a snare (a crack of noise over its
 * body's tone) or a hat (a tick of noise above about 6 kHz). */
function hit(y: Float32Array, t: number, kind: 'kick' | 'snare' | 'hat', rnd: () => number) {
  const s0 = Math.round(t * SR), n = Math.round(1.0 * SR);
  const d = [0, 0, 0, 0];   // the last noise samples, for the hat's fourth difference
  let phase = 0, lp = 0, lp2 = 0;
  for (let i = 0; i < n && s0 + i < y.length; i++) {
    const u = i / SR, attack = Math.min(1, u / 0.002);
    let v: number;
    if (kind === 'kick') {
      phase += (2 * Math.PI * (50 + 70 * Math.exp(-u / 0.03))) / SR;
      v = 0.9 * Math.sin(phase) * Math.exp(-u / 0.12);
    } else if (kind === 'snare') {
      const w = rnd();
      lp += 0.04 * (w - lp);   // noise less its lows (two one-pole low-passes taken away, ~140 Hz)
      lp2 += 0.04 * (w - lp - lp2);
      v = 0.4 * (w - lp - lp2) * Math.exp(-u / 0.08)
        + 0.3 * Math.sin(2 * Math.PI * 190 * u) * Math.exp(-u / 0.05);
    } else {
      const w = rnd();
      v = 0.15 * (w - 4 * d[0] + 6 * d[1] - 4 * d[2] + d[3]) * Math.exp(-u / 0.03);
      d.unshift(w);
      d.pop();
    }
    y[s0 + i] += attack * v;
  }
}

const gridOf = (n: number, from = BEAT) => Array.from({ length: n }, (_, k) => from + k * BEAT);

/** `secs` of drums at 120 bpm over a soft bed of low noise (a band never plays into silence), from the
 * second beat: on beat k, `pattern(k)` says which drums hit; a hat may also tick on the eighth after. */
function drums(secs: number, pattern: (k: number) => ('kick' | 'snare' | 'hat' | 'and')[]): Float32Array {
  const y = new Float32Array(Math.round(secs * SR)), rnd = noise(7);
  let lp = 0;
  for (let i = 0; i < y.length; i++) y[i] = 0.02 * (lp += 0.1 * (rnd() - lp));
  gridOf(Math.floor(secs / BEAT) - 1).forEach((t, k) => {
    for (const p of pattern(k)) hit(y, p === 'and' ? t + BEAT / 2 : t, p === 'and' ? 'hat' : p, rnd);
  });
  return y;
}

/** Kick on 1 and 3, snare on 2 and 4, hats on every eighth note. */
const rock = (k: number) => [k % 2 ? 'snare' as const : 'kick' as const, 'hat' as const, 'and' as const];

function listen(y: Float32Array, beats: number[] | null = null): Analysis {
  const neuralBeats = beats ? { beats, downbeats: beats.filter((_, k) => k % 4 === 0) } : null;
  return analyze(y, { stepMs: 20, notes: [], neuralBeats });
}

/** The share of `want` times with a hit within `tol` s, and the share of hits near none of them (the
 * bed's own start aside). */
function matches(hits: number[][], want: number[], tol = 0.03): { found: number; stray: number } {
  const near = (t: number, xs: number[]) => xs.some((x) => Math.abs(x - t) <= tol);
  const times = hits.map((h) => h[0]).filter((t) => t > 0.25);
  return {
    found: want.filter((t) => near(t, times)).length / want.length,
    stray: times.filter((t) => !near(t, want)).length / Math.max(1, times.length),
  };
}

const meanOf = (x: ArrayLike<number>, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i];
  return s / (b - a);
};

describe('the drum kit, piece by piece', () => {
  const secs = 16, beats = gridOf(secs / BEAT - 1);
  const an = listen(drums(secs, rock), beats);
  const every = (from: number, n: number) => beats.filter((_, k) => k >= from && (k - from) % n === 0);
  const mid = [Math.round(2 / an.step), Math.round((secs - 2) / an.step)] as const;

  it('hears a kick on every beat of a click track, and nothing else', () => {
    const clicks = listen(drums(secs, () => ['kick']), beats);
    const m = matches(clicks.kick, beats);
    expect(m.found).toBeGreaterThanOrEqual(0.95);
    expect(m.stray).toBe(0);
    expect(clicks.snare.length + clicks.hats.length).toBe(0);
  });

  it('follows each piece of a rock beat on its own', () => {
    const kick = matches(an.kick, every(0, 2)), snare = matches(an.snare, every(1, 2));
    const hats = matches(an.hats, [...beats, ...beats.map((b) => b + BEAT / 2)]);
    for (const m of [kick, snare, hats]) {
      expect(m.found).toBeGreaterThanOrEqual(0.9);
      expect(m.stray).toBeLessThanOrEqual(0.05);
    }
  });

  it('says a drum kit is playing, and the beat is clear', () => {
    expect(meanOf(an.kit, ...mid)).toBeGreaterThan(0.8);
    expect(meanOf(an.beatConfidence, ...mid)).toBeGreaterThan(0.8);
  });

  it('doubts beats that miss the accents', () => {
    const off = listen(drums(secs, rock), beats.map((b) => b + BEAT / 4));
    expect(meanOf(off.beatConfidence, ...mid)).toBeLessThan(0.3);
  });

  it('hears less of a kit in a hat alone', () => {
    const hats = listen(drums(secs, () => ['hat']), beats);
    expect(meanOf(hats.kit, ...mid)).toBeLessThan(0.6);
  });
});

describe('harmony', () => {
  /** A sustained chord of the given midi notes, each with a few harmonics. */
  function chord(midis: number[], secs: number): Float32Array {
    const y = new Float32Array(Math.round(secs * SR));
    for (const m of midis) {
      const f = 440 * 2 ** ((m - 69) / 12);
      for (let h = 1; h <= 3; h++) {
        for (let i = 0; i < y.length; i++) y[i] += (0.2 / h) * Math.sin((2 * Math.PI * f * h * i) / SR);
      }
    }
    return y;
  }

  it('colours a C major chord C, E and G', () => {
    const an = listen(chord([60, 64, 67], 6));
    for (let i = Math.round(1 / an.step); i < Math.round(5 / an.step); i += 10) {
      const row = Array.from(an.chroma.subarray(i * 12, i * 12 + 12));
      const top = row.map((v, c) => [v, c]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);
      expect(top.sort((a, b) => a - b)).toEqual([0, 4, 7]);
      expect([0, 4, 7]).toContain(an.pitchClass[i]);
      expect(an.pitchClassStrength[i]).toBeGreaterThan(0.5);
    }
  });

  it('changes the harmony\'s colour on the beat', () => {
    // C major for ten beats, then F# major (no note in common) for ten
    const y = new Float32Array(10 * SR), cut = Math.round(5.25 * SR);
    y.set(chord([60, 64, 67], 10).subarray(0, cut));
    y.set(chord([66, 70, 73], 10).subarray(0, y.length - cut), cut);
    const beats = gridOf(19, 0.25), an = listen(y, beats);
    expect(an.beats).toEqual(beats);
    for (const [k, t] of beats.slice(0, -1).entries()) {
      const each = new Set(an.pitchClass.subarray(Math.round(t / an.step), Math.round((t + BEAT) / an.step)));
      expect(each.size).toBe(1);
      expect(k < 10 ? [0, 4, 7] : [6, 10, 1]).toContain([...each][0]);
    }
  });

  it('holds the colour of a near tie where there are no beats', () => {
    // C and G (louder, so the chroma ties them) taking turns at a few percent ahead, three times a second
    const y = new Float32Array(6 * SR);
    for (const [f, gain, sign] of [[261.63, 1, 1], [392.0, 1.22, -1]]) {
      for (let i = 0; i < y.length; i++) {
        const u = i / SR;
        y[i] += 0.2 * gain * (1 + sign * 0.03 * Math.sin(3 * Math.PI * u)) * Math.sin(2 * Math.PI * f * u);
      }
    }
    const an = listen(y, Array.from({ length: 16 }, (_, k) => 3 * k));   // too far apart to read it over
    expect(an.beats[1] - an.beats[0]).toBe(3);
    const pc = an.pitchClass.subarray(Math.round(1 / an.step), Math.round(5 / an.step));
    expect(new Set(pc).size).toBe(1);
    expect([0, 7]).toContain(pc[0]);
  });
});

describe('novelty, bands and brightness', () => {
  it('peaks where silence turns to noise', () => {
    const y = new Float32Array(8 * SR), rnd = noise(3);
    for (let i = 4 * SR; i < y.length; i++) y[i] = 0.3 * rnd();
    const an = listen(y);
    const peak = an.noveltyPeaks.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(Math.abs(peak[0] - 4)).toBeLessThanOrEqual(0.1);
    expect(peak[1]).toBe(1);
    expect(meanOf(an.novelty, Math.round(5.5 / an.step), Math.round(7 / an.step))).toBeLessThan(0.2);
  });

  it('puts a low hum in the low band and a hiss in the high band, and hears the hiss as brighter', () => {
    const y = new Float32Array(8 * SR), rnd = noise(5);
    let prev = 0;
    for (let i = 0; i < 4 * SR; i++) y[i] = 0.5 * Math.sin((2 * Math.PI * 60 * i) / SR);
    for (let i = 4 * SR; i < y.length; i++) {
      const w = rnd();
      y[i] = 0.3 * (w - prev);
      prev = w;
    }
    const an = listen(y);
    const hum = [Math.round(1 / an.step), Math.round(3 / an.step)] as const;
    const hiss = [Math.round(5 / an.step), Math.round(7 / an.step)] as const;
    expect(meanOf(an.bands.low, ...hum)).toBeGreaterThan(0.8);
    expect(meanOf(an.bands.high, ...hum)).toBeLessThan(0.2);
    expect(meanOf(an.bands.high, ...hiss)).toBeGreaterThan(0.8);
    expect(meanOf(an.bands.low, ...hiss)).toBeLessThan(0.3);
    expect(meanOf(an.brightness, ...hiss)).toBeGreaterThan(meanOf(an.brightness, ...hum) + 0.5);
  });
});

it('gives the same measurements every time', () => {
  const y = drums(8, rock), beats = gridOf(15);
  const a = listen(y, beats), b = listen(y.slice(), beats);
  for (const k of ['brightness', 'chroma', 'pitchClass', 'novelty', 'kit', 'beatConfidence'] as const) {
    expect(Array.from(a[k])).toEqual(Array.from(b[k]));
  }
  expect(a.bands).toEqual(b.bands);
  expect([a.kick, a.snare, a.hats, a.noveltyPeaks]).toEqual([b.kick, b.snare, b.hats, b.noveltyPeaks]);
});

it('shows nothing in silence', () => {
  const an = listen(new Float32Array(6 * SR));
  for (const c of [...Object.values(an.bands), an.pitchClassStrength, an.novelty, an.kit, an.beatConfidence]) {
    expect(Math.max(...c)).toBe(0);
  }
  expect([an.kick, an.snare, an.hats, an.noveltyPeaks]).toEqual([[], [], [], []]);
});
