// The beats follow the performer: a tempo that doubles keeps the tracker's beats, and where the tracker
// slips into half time the beats the music still plays come back.

import { describe, expect, it } from 'vitest';
import { analyze } from './audio';
import { SR } from './dsp';

/** A thump at each time: a low tone dropping in pitch, as a kick or a timpani stroke. */
function thumps(times: number[], secs: number): Float32Array {
  const y = new Float32Array(Math.round(secs * SR));
  for (const t of times) {
    let phase = 0;
    for (let i = 0, s0 = Math.round(t * SR); i < 0.2 * SR && s0 + i < y.length; i++) {
      const u = i / SR;
      phase += (2 * Math.PI * (60 + 80 * Math.exp(-u / 0.03))) / SR;
      y[s0 + i] += 0.8 * Math.sin(phase) * Math.exp(-u / 0.06);
    }
  }
  return y;
}

/** Beats speeding up smoothly from 100 to 200 bpm over `secs`. */
function accelerando(secs: number): number[] {
  const out: number[] = [];
  for (let t = 0.5; t < secs - 0.5;) {
    out.push(t);
    t += 60 / (100 + (100 * t) / secs);
  }
  return out;
}

const listen = (y: Float32Array, beats: number[]) =>
  analyze(y, { stepMs: 20, notes: [], neuralBeats: { beats, downbeats: beats.filter((_, k) => k % 4 === 0) } });

describe('the beat map', () => {
  const played = accelerando(60), y = thumps(played, 60);

  it('keeps the tracker\'s beats through an accelerando', () => {
    expect(listen(y, played).beats).toEqual(played);
  });

  it('puts back the beats of a stretch the tracker heard in half time', () => {
    const halved = played.filter((t, k) => !(t > 30 && t < 45 && k % 2 === 1));
    const beats = listen(y, halved).beats;
    expect(beats.length).toBe(played.length);
    for (const [k, t] of beats.entries()) expect(Math.abs(t - played[k])).toBeLessThan(0.02);
  });
});
