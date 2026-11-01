// The gallery shows every move of the catalogue, and each one lights the lineup.

import { describe, expect, it } from 'vitest';
import * as CAT from '@/engine/catalog';
import { fixture } from '@/engine/fixtures';
import { gallerySong, playMove, prepare } from '@/engine/gallery';

describe('the move gallery', () => {
  const prepared = { groove: prepare(fixture('groove')), chorale: prepare(fixture('chorale')) };
  for (const move of Object.keys(CAT.MOVES) as CAT.MoveName[]) {
    it(`${move} lights every car of a five-car lineup`, () => {
      const cars = playMove(prepared[gallerySong(move)], move, 'SXCLB', 'drive');
      for (const c of cars) expect(c.frames.some((v) => v > 0)).toBe(true);
    });
  }
});
