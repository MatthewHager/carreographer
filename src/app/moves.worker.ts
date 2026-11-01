// Off the page's thread: the move gallery's shows (engine/gallery.ts). Each song made in code is listened to
// once, then every move, lineup and level is drawn from it in a few milliseconds.

import type { Analysis } from '@/engine/analysis';
import type { MoveName } from '@/engine/catalog';
import { fixture } from '@/engine/fixtures';
import { SONGS } from '@/engine/fixtures/songs';
import { type GalleryLevel, gallerySong, playMove, prepare } from '@/engine/gallery';

export interface MoveRequest {
  id: number;            // echoed in the reply, so the page shows only the move it asked for last
  move: MoveName;
  lineup: string;
  level: GalleryLevel;
}

export type MoveReply =
  | {
    kind: 'done'; id: number; song: string; nFrames: number; cars: { name: string; frames: Uint8Array }[];
    samples?: Float32Array;
  }
  | { kind: 'error'; id: number; message: string };

const prepared = new Map<string, Analysis>();
const sent = new Set<string>();

self.onmessage = (e: MessageEvent<MoveRequest>) => {
  const post = (r: MoveReply, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(r, transfer);
  try {
    const { id, move, lineup, level } = e.data, song = gallerySong(move);
    if (!prepared.has(song)) prepared.set(song, prepare(fixture(song)));
    const cars = playMove(prepared.get(song)!, move, lineup, level);
    // the song's samples go with its first show only: the page keeps them
    const samples = sent.has(song) ? undefined : SONGS[song]();
    sent.add(song);
    post({
      kind: 'done', id, song, nFrames: prepared.get(song)!.nFrames, samples,
      cars: cars.map((c) => ({ name: c.name, frames: c.frames })),
    }, [...cars.map((c) => c.frames.buffer), ...(samples ? [samples.buffer] : [])]);
  } catch (err) {
    post({ kind: 'error', id: e.data.id, message: String(err) });
  }
};
