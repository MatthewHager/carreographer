// A finished show: one frame array per car, plus the song it plays to.

import { N_CHANNELS, STEP_MS } from '@/engine/channels';
import type { SchemeId } from '@/engine/schemes';
import { type AppModelId, VEHICLES } from '@/engine/vehicles';

export interface ShowCar {
  name: string;          // Car2_Cybertruck_Center: the folder its USB drive needs
  letter: string;        // lineup letter (engine/vehicles.ts)
  frames: Uint8Array;    // nFrames x 200 channels, frame-major
}

export interface Show {
  title: string;
  lineup: string;
  scheme: SchemeId;
  nFrames: number;
  cars: ShowCar[];
  audio: Blob;           // the song as a 44.1 kHz WAV: what plays in the preview and goes on the drives
}

export const STEP_S = STEP_MS / 1000;

/** The Tesla app model the 3D view draws a lineup letter with. */
export function modelFor(letter: string): AppModelId {
  return VEHICLES[letter].body;
}

/** A file name Tesla's USB reader is happy with. */
export const fileName = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'lightshow';

/**
 * One car's show file, naming the song it plays to (`name`.wav next to it): FSEQ 2.0 as the car reads it,
 * uncompressed. A 32-byte header (little-endian: "PSEQ", where the frames start, version 2.0, the header's
 * length, the channels a frame, the frames, the milliseconds a frame, then an id), notes of the form
 * length, two-letter code, text and a zero byte, and the frames from the next multiple of four bytes. The id
 * is a hash of the frames: the same show gives the same file.
 */
export function showFile(frames: Uint8Array, nFrames: number, name: string): Uint8Array<ArrayBuffer> {
  let id = 0xcbf29ce484222325n;                       // FNV-1a
  for (let i = 0; i < frames.length; i += 64) id = ((id ^ BigInt(frames[i])) * 0x100000001b3n) & 0xffffffffffffffffn;
  const notes = [`mf${name}.wav`, 'spCarreographer'].map((n) => new TextEncoder().encode(`${n}\0`));
  const head = notes.reduce((at, n) => at + 2 + n.length, 32);
  const start = Math.ceil(head / 4) * 4;
  const file = new Uint8Array(start + frames.length);
  const v = new DataView(file.buffer);
  file.set(new TextEncoder().encode('PSEQ'));
  v.setUint16(4, start, true);
  v.setUint8(7, 2);
  v.setUint16(8, 32, true);
  v.setUint32(10, N_CHANNELS, true);
  v.setUint32(14, nFrames, true);
  v.setUint8(18, STEP_MS);
  v.setBigUint64(24, id, true);
  let at = 32;
  for (const n of notes) {
    v.setUint16(at, n.length + 2, true);
    file.set(n, at + 2);
    at += n.length + 2;
  }
  file.set(frames, start);
  return file;
}
