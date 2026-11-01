// A lighting is shaped as it is written: the beat's headlights are left to it frame by frame while it rings
// them, and nothing is cut to a flash too short to read.

import { describe, expect, it } from 'vitest';
import { Car } from './car';
import * as C from './channels';

const STEP = 0.02, N = 200;

/** A Model Y whose beat rings its inner beams over frames [a, b). */
function ringing(a: number, b: number): Car {
  const beat = new Uint8Array(N).fill(1, a, b);
  return new Car({ kind: 'modely', juniper: false }, 'test', 0, { nFrames: N, step: STEP, beat });
}

const column = (c: Car, ch: number) => Array.from({ length: N }, (_, f) => c.get(f, ch));

describe('Car.light', () => {
  it('leaves the inner beams to the beat while it rings them, and lights them again after', () => {
    const c = ringing(50, 80);
    c.light(c.heads(), 30 * STEP + 0.02, 120 * STEP + 0.02);
    const inner = column(c, C.L_INNER_MAIN), outer = column(c, C.L_OUTER_MAIN);
    for (let f = 30; f < 120; f++) expect(outer[f], `outer at ${f}`).toBe(C.ON);
    for (let f = 50; f < 80; f++) expect(inner[f], `inner at ${f}`).toBe(0);
    for (const f of [30, 49, 80, 119]) expect(inner[f], `inner at ${f}`).toBe(C.ON);
  });

  it('leaves out what the beat would cut to under 100 ms', () => {
    const c = ringing(50, 80);
    c.light(c.inner(), 47 * STEP + 0.02, 83 * STEP + 0.02);
    expect(column(c, C.L_INNER_MAIN).every((v) => v === 0)).toBe(true);
  });

  it('lights the beat itself and the whole stage over it', () => {
    const c = ringing(50, 80);
    c.lightOver(c.inner(), 50 * STEP + 0.02, 60 * STEP + 0.02);
    expect(column(c, C.L_INNER_MAIN).slice(50, 60).every((v) => v === C.ON)).toBe(true);
  });
});
