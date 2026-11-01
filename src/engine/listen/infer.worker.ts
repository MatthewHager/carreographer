// One member of infer.ts's pool: a single-thread WASM session that runs the pieces it's handed.

import { createSession, runSession, type ort } from './session';

let session: ort.InferenceSession | undefined;
let input = '';
let outputs: readonly string[] = [];

const reply = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.kind === 'load') {
      session = await createSession(m.bytes, 'wasm');
      ({ input, outputs } = m);
      reply({ ok: true });
    } else {
      const out = await runSession(session!, input, m.data, m.dims, outputs);
      reply({ ok: true, outputs: out }, Object.values(out).map((a) => a.buffer));
    }
  } catch (err) {
    reply({ ok: false, error: (err as Error).message ?? String(err) });
  }
};
