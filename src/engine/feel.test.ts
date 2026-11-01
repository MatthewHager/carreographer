// The music's own decisions, on made-up stretches: where a chord is held (the swell), and how often a figure
// on the beat hits at each level.

import { describe, expect, it } from 'vitest';
import type { Analysis } from './analysis';
import { held } from './feel';
import { CALM, DRIVE, GROOVE, PEAK } from './level';
import { paced } from './moves';

const STEP = 0.02, N = 1000;     // 20 s

/** A made-up analysis: notes as [start, length], and the level all the way through. */
function song(notes: [number, number][], level = 0.5): Analysis {
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);    // 120 bpm, four to a bar
  return {
    step: STEP, nFrames: N, duration: N * STEP, beats, downbeats: beats.filter((_, i) => i % 4 === 0),
    events: { t: notes.map(([t]) => t), dur: notes.map(([, d]) => d) },
    level: new Float32Array(N).fill(level),
  } as unknown as Analysis;
}

describe('a held chord', () => {
  it('is two or more notes sounding on through most of the stretch', () => {
    expect(held(song([[1, 8], [1, 8], [1, 8]]), 2, 8)).toBe(true);
  });

  it('is not one long note alone', () => {
    expect(held(song([[1, 8]]), 2, 8)).toBe(false);
  });

  it('is not a run of short notes, however many', () => {
    const run = Array.from({ length: 60 }, (_, i): [number, number] => [1 + i * 0.12, 0.2]);
    expect(held(song(run), 2, 8)).toBe(false);
  });

  it('is not a chord that stops a third of the way in', () => {
    expect(held(song([[1, 2.5], [1, 2.5]]), 2, 8)).toBe(false);
  });
});

describe('a figure on the beat', () => {
  const beats = song([]).beats.slice(0, 16);
  const every = (level: number) => {
    const kept = paced(song([], level), beats);
    return kept.length ? beats.length / kept.length : Infinity;
  };

  it('hits the downbeat when calm, 1 and 3 in a groove, every beat from drive up', () => {
    expect(every(CALM + 0.05)).toBe(4);
    expect(every(GROOVE + 0.05)).toBe(2);
    expect(every(DRIVE + 0.05)).toBe(1);
    expect(every(PEAK + 0.05)).toBe(1);
  });

  it('counts its beats in the bar, so it keeps the 1 and the 3 even when it starts on the 2', () => {
    expect(paced(song([], CALM + 0.05), beats)).toEqual([0, 2, 4, 6]);
    expect(paced(song([], GROOVE + 0.05), beats.slice(1))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
