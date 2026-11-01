// The move catalogue agrees with the moves, and MOVES.md (at the repository root) is the catalogue as
// it stands. When MOVES.md is stale this fails; `UPDATE_MOVES=1 npx vitest run catalog` rewrites it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEAT_MOVES, FOR_GESTURE, markdown, MOVES, NOTE_MOVES } from './catalog';
import * as M from './moves';

/** The top of this checkout: the nearest folder up that holds .git. */
const top = (dir: string): string =>
  (existsSync(join(dir, '.git')) || dirname(dir) === dir ? dir : top(dirname(dir)));

describe('the move catalogue', () => {
  it('lists exactly the moves there are', () => {
    expect(Object.keys(MOVES).sort()).toEqual(Object.keys(M.MOVES).sort());
    const chosen = [...NOTE_MOVES, ...BEAT_MOVES, ...Object.values(FOR_GESTURE)];
    for (const m of chosen) expect(MOVES).toHaveProperty(m);
  });

  it('is what MOVES.md says', () => {
    const file = join(top(import.meta.dirname), 'MOVES.md');
    if (process.env.UPDATE_MOVES) writeFileSync(file, markdown());
    const stale = 'MOVES.md is stale: UPDATE_MOVES=1 npx vitest run catalog';
    expect(readFileSync(file, 'utf8'), stale).toBe(markdown());
  });
});
