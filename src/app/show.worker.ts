// Off the page's thread: turning a song into a show (listening, then choreography).

import type { Analysis } from '@/engine/analysis';
import { STEP_MS } from '@/engine/channels';
import { choreograph } from '@/engine/choreo';
import { analyze } from '@/engine/listen/audio';
import { trackBeats } from '@/engine/listen/beats';
import { lastBackend } from '@/engine/listen/infer';
import { transcribe } from '@/engine/listen/notes';
import { monoAt22050 } from '@/engine/listen/resample';
import type { SchemeId } from '@/engine/schemes';

export interface Request {
  channels: Float32Array[];
  sampleRate: number;
  lineup: string;
  scheme: SchemeId;
}

export type Reply =
  | { kind: 'progress'; step: string; fraction?: number }
  | { kind: 'done'; nFrames: number; cars: { name: string; frames: Uint8Array }[]; backend?: string }
  | { kind: 'error'; message: string };

const post = (r: Reply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);
const progress = (step: string, fraction?: number) => post({ kind: 'progress', step, fraction });

async function listen(req: Request): Promise<Analysis> {
  progress('Listening');
  const y = monoAt22050(req.channels, req.sampleRate);
  progress('Finding the beat', 0);
  const beats = await trackBeats(y, { onProgress: (f) => progress('Finding the beat', f) });
  progress('Hearing the notes', 0);
  const notes = await transcribe(y, { onProgress: (f) => progress('Hearing the notes', f) });
  progress('Reading the music');
  return analyze(y, { stepMs: STEP_MS, notes, neuralBeats: beats });
}

self.onmessage = async (e: MessageEvent<Request>) => {
  try {
    const req = e.data;
    const an = await listen(req);
    progress('Choreographing');
    const cars = choreograph(an, req.lineup, req.scheme);
    post({
      kind: 'done', nFrames: an.nFrames, cars: cars.map((c) => ({ name: c.name, frames: c.frames })),
      backend: lastBackend(),
    }, cars.map((c) => c.frames.buffer));
  } catch (err) {
    post({ kind: 'error', message: String(err) });
  }
};
