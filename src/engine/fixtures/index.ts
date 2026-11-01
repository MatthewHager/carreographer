// The songs made in code (songs.ts), for the tests and the move gallery. What the two listening models heard
// in each is kept as a fixture (fixtures.test.ts), so neither needs the models: the song is made again and
// the rest of the listening (analyze()) runs here. A fresh copy each time, so no test sees what another
// changed.

import type { Analysis } from '../analysis';
import { STEP_MS } from '../channels';
import { analyze } from '../listen/audio';
import { SONGS } from './songs';

export interface Heard {
  beats: { beats: number[]; downbeats: number[] };
  notes: number[][];
}

const files = import.meta.glob<Heard>('./*.json', { eager: true, import: 'default' });

export const FIXTURES = ['groove', 'chorale', 'build'] as const;

const analysed = new Map<string, Analysis>();

export function fixture(name: (typeof FIXTURES)[number]): Analysis {
  if (!analysed.has(name)) {
    const { beats, notes } = files[`./${name}.json`]!;
    analysed.set(name, analyze(SONGS[name](), { stepMs: STEP_MS, notes, neuralBeats: beats }));
  }
  return structuredClone(analysed.get(name)!);
}
