// What the listening models hear in the test songs (songs.ts), kept so the tests don't need the models.
// `UPDATE_FIXTURES=1 npx vitest run fixtures` makes the songs again, runs beat-this and basic-pitch on them
// as the app does (ONNX Runtime's WASM backend) and rewrites the JSON; it needs the models in public/models
// (CONTRIBUTING.md says how to get them).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { trackBeats } from '../listen/beats';
import { transcribe } from '../listen/notes';
import { SONGS } from './songs';

const MODELS = join(import.meta.dirname, '..', '..', '..', 'public', 'models');

function model(file: string): ArrayBuffer {
  const b = readFileSync(join(MODELS, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** Times to the millisecond and levels to a thousandth keep the files small. */
const rounded = (_: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

describe.skipIf(!process.env.UPDATE_FIXTURES)('the test songs, listened to', () => {
  for (const [name, make] of Object.entries(SONGS)) {
    it(name, async () => {
      const y = make();
      const beats = await trackBeats(y, { backend: 'wasm', model: model('beat_this-final0-fp16w.onnx') });
      const notes = await transcribe(y, { backend: 'wasm', model: model('basic_pitch-nmp.onnx') });
      writeFileSync(join(import.meta.dirname, `${name}.json`), JSON.stringify({ beats, notes }, rounded) + '\n');
    }, 300_000);
  }
});
