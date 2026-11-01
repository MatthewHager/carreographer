// The same song and lineup always give the same show, byte for byte, whatever was made before it, and a
// colour scheme only recolours the cabins; the show hears from the music alone where to flow and where a
// rhythm section plays; and each figure's family of moves follows the music, the peak never getting a move
// that lights only a car or two.

import { describe, expect, it } from 'vitest';
import type { Analysis } from './analysis';
import { BEAT_MOVES, FLOW_MOVES, type MoveName, SPARSE_MOVES } from './catalog';
import { ALL_RGB, N_CHANNELS } from './channels';
import { chooseMove, choreograph, family, makeShow } from './choreo';
import { feel } from './feel';
import { FIXTURES, fixture } from './fixtures';

const show = (song: (typeof FIXTURES)[number], lineup: string) =>
  choreograph(fixture(song), lineup).map((c) => c.frames);

describe('the same input gives the same show', () => {
  for (const song of FIXTURES) {
    it(song, () => {
      const first = show(song, 'YCY');
      show(FIXTURES[(FIXTURES.indexOf(song) + 1) % FIXTURES.length], 'CYC');   // anything in between
      expect(show(song, 'YCY')).toEqual(first);
    });
  }

  it('a colour scheme changes the cabin lights and nothing else', () => {
    const an = fixture('groove'), party = choreograph(an, 'YCY'), halloween = choreograph(an, 'YCY', 'halloween');
    const cabins = new Set(ALL_RGB.flatMap((base) => [base, base + 1, base + 2]));
    let differ = 0;
    party.forEach((c, k) => c.frames.forEach((v, i) => {
      if (v === halloween[k].frames[i]) return;
      expect(cabins.has(i % N_CHANNELS)).toBe(true);
      differ++;
    }));
    expect(differ).toBeGreaterThan(0);
  });

  it('choreographing one analysis again, for another lineup and back, gives the same bytes', () => {
    const an = fixture('groove'), first = choreograph(an, 'YCY').map((c) => c.frames);
    choreograph(an, 'SXC');
    expect(choreograph(an, 'YCY').map((c) => c.frames)).toEqual(first);
  });
});

describe('the music says where to flow and where the drums play', () => {
  it('a chorale with no beat flows from start to end', () => {
    expect(feel(fixture('chorale')).every((f) => f.flow && !f.kit)).toBe(true);
  });

  it('a drum-kit groove has the beat and the kit all the way', () => {
    expect(feel(fixture('groove')).every((f) => !f.flow && f.kit)).toBe(true);
  });

  it('an orchestral build flows over its roll, then marches on the beat without a kit', () => {
    const an = fixture('build'), sections = feel(an);
    expect(sections.some((f) => f.kit)).toBe(false);
    expect(sections.find((f) => f.t0 <= 10 && 10 < f.t1)?.flow).toBe(true);        // the roll
    expect(sections.find((f) => f.t0 <= 50 && 50 < f.t1)?.flow).toBe(false);       // the march
  });

  it('every phrase of a flowing song plays a flowing move, and none of a groove', () => {
    const chorale = makeShow(fixture('chorale'), 'YCY').an, groove = makeShow(fixture('groove'), 'YCY').an;
    expect(chorale.phrases!.every((ph) => FLOW_MOVES.includes(ph.move!))).toBe(true);
    expect(groove.phrases!.some((ph) => FLOW_MOVES.includes(ph.move!))).toBe(false);
  });
});

const STEP = 0.02, N = 1000;     // 20 s

/** A made-up stretch of music, 120 bpm: its level, how many notes a second (or held notes as [start,
 * length]), whether a drum kit plays, whether the tracker's beats keep time and whether the music strikes
 * them. */
function stretch(o: { level: number; notes?: number; held?: [number, number][]; kit?: boolean;
  steady?: boolean; struck?: boolean }): Analysis {
  const { level, notes = 0, held = [], kit = false, steady = true, struck = true } = o;
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5 + (steady ? 0 : 0.15 * Math.sin(i * 2.3)));
  const env = new Float32Array(N).fill(1);
  if (struck) for (const b of beats) env[Math.round(b / STEP)] = 10;
  const t = [...Array.from({ length: notes * 20 }, (_, i) => i / notes), ...held.map(([a]) => a)];
  return {
    step: STEP, nFrames: N, duration: N * STEP, beats, downbeats: beats.filter((_, i) => i % 4 === 0),
    sections: [{ t0: 0, t1: N * STEP, letter: 'A' }], pulseEnv: env, pulseHop: STEP,
    kit: new Float32Array(N).fill(kit ? 1 : 0), level: new Float32Array(N).fill(level),
    events: { t, dur: [...t.slice(0, notes * 20).map(() => 0.2), ...held.map(([, d]) => d)],
      top: t.map(() => 60) },
    pitchLo: 48, pitchHi: 72, tempo: 120,
  } as unknown as Analysis;
}

describe('a figure plays the family of moves the music asks for', () => {
  it('drive with a drum kit moves the whole stage on the beat', () => {
    expect(family(stretch({ level: 0.7, notes: 6, kit: true }), 2, 18, 3)).toBe('beat');
  });

  it('a groove without a kit follows notes enough to follow, and the beat under sparse ones', () => {
    expect(family(stretch({ level: 0.5, notes: 6 }), 2, 18, 2)).toBe('note');
    expect(family(stretch({ level: 0.5, notes: 1 }), 2, 18, 2)).toBe('beat');
  });

  it('a chord held where nothing strikes the beat swells', () => {
    const an = stretch({ level: 0.5, held: [[1, 18], [1, 18], [1, 18]], struck: false });
    expect(family(an, 2, 18, 2)).toBe('held');
  });

  it('music with no steady beat, and none struck, flows', () => {
    const an = stretch({ level: 0.5, notes: 3, steady: false, struck: false });
    expect(family(an, 2, 18, 2)).toBe('flow');
  });

  it('no figure at the peak plays a sparse move, however little used or replayed', () => {
    const an = stretch({ level: 0.9, notes: 3, kit: true });
    for (const sparse of SPARSE_MOVES) {
      const used = new Map(BEAT_MOVES.map((m): [MoveName, number] => [m, m === sparse ? 0 : 5]));
      expect(SPARSE_MOVES).not.toContain(chooseMove(an, 'beat', 2, 18, undefined, null, used));
      expect(SPARSE_MOVES).not.toContain(chooseMove(an, 'beat', 2, 18, sparse, null, used));
    }
  });
});
