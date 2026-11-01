// The move gallery: one move on its own, over a whole song made in code (fixtures/songs.ts), at one level,
// so anyone can see what each move looks like on their lineup and how it grows from calm to the peak.

import type { Analysis, Phrase } from './analysis';
import type { Car } from './car';
import { makeLineup } from './car';
import * as CAT from './catalog';
import { makeShow } from './choreo';
import { CALM, DRIVE, GROOVE, PEAK, silence } from './level';
import { MOVES } from './moves';

/** The levels the gallery plays a move at: the middle of each step (level.ts). */
export const GALLERY_LEVELS = {
  calm: (CALM + GROOVE) / 2,
  groove: (GROOVE + DRIVE) / 2,
  drive: (DRIVE + PEAK) / 2,
  peak: (PEAK + 1) / 2,
} as const;
export type GalleryLevel = keyof typeof GALLERY_LEVELS;

/** The song a move is shown over: the chorale for the moves made for music with no beat, the drum-kit groove
 * for the rest. */
export function gallerySong(move: CAT.MoveName): 'groove' | 'chorale' {
  return CAT.HELD_MOVES.includes(move) || CAT.FLOW_MOVES.includes(move) ? 'chorale' : 'groove';
}

/** A song's analysis made ready for the moves (beats on what's played, phrases, level), once per song. */
export function prepare(heard: Analysis): Analysis {
  return makeShow(heard, 'Y').an;
}

/** The cars of `layout` playing `move` through the whole of a prepared song, held at `level`. */
export function playMove(prepared: Analysis, move: CAT.MoveName, layout: string, level: GalleryLevel): Car[] {
  const an = structuredClone(prepared), s = GALLERY_LEVELS[level];
  an.level = new Float32Array(an.nFrames).fill(s);
  for (const ph of an.phrases ?? []) ph.level = s;
  const cars = makeLineup(layout, an.nFrames, an.step, silence(an));
  const all: Phrase = {
    a: 0, b: an.events.t.length, t0: 0, t1: an.duration, gesture: 'figuration', up: 0.5,
    lo: an.pitchLo, hi: an.pitchHi, level: s,
  };
  MOVES[move](cars, an, all);
  return cars;
}
