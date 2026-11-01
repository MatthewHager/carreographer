// Runs a listening model over a song's independent pieces (beat chunks, note windows) on the best
// backend the browser has. Times for a 7-minute song on an M1 Max in Chrome, beats + notes:
//   webgpu: one session on the GPU, 8 + 6 s the first time (model download and setup included);
//   pool:   without a GPU, a few workers each with a single-thread WASM session, taking pieces in turn,
//           27 + 6 s with four workers, 39 + 8 s with two (ORT's own threads need cross-origin isolation,
//           which GitHub Pages can't give);
//   wasm:   one single-thread session on this thread, 72 + 15 s: Node, one core, or no nested workers.
// Whatever fails along the way (no adapter, a lost device, workers that won't start or die) falls back
// to the next backend by itself; the visitor never has to choose. Sessions last as long as the show's
// worker; a pool's workers are let go after each run, since each holds its own copy of the model.

import { createSession, ort, runSession, type Ep } from './session';

export type Backend = 'webgpu' | 'pool' | 'wasm';

export interface Model {
  url: string;                    // fetched when no bytes are given
  input: string;
  outputs: readonly string[];
}

export interface Piece {
  data: Float32Array;
  dims: readonly number[];
}

type Outputs = Record<string, Float32Array>;

interface RunOptions {
  backend?: Backend;              // default: bestBackend()
  bytes?: ArrayBuffer;            // the model file, instead of fetching model.url
  onProgress?: (fraction: number) => void;
}

const nav = typeof navigator !== 'undefined' ? navigator : undefined;

/** How many pool workers this device can afford. Each holds its own WASM session, which takes about
 * 1 GB at its peak with the beat model (the attention over a 30 s chunk), so the count follows the
 * memory as well as the cores: one worker per 4 GB where the browser tells (Chromium's deviceMemory),
 * two on other computers, and none on phones and tablets, whose browsers close a tab that takes too
 * much. Two workers get most of the speed: a 7-minute song's beats take 39 s with two, 27 s with four. */
function poolSize(): number {
  const cores = Math.max(1, (nav?.hardwareConcurrency || 2) - 1);
  const gb = (nav as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory;
  const mobile = !!nav && (/Mobi|Android|iPhone|iPad/.test(nav.userAgent)
    || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1));          // iPadOS asks for desktop pages
  const memory = gb ? Math.floor(gb / 4) : mobile ? 1 : 2;
  return Math.max(1, Math.min(4, cores, memory));
}

let best: Promise<Backend> | undefined;
let used: Backend | undefined;

/** The backend the last run actually ended up on. */
export const lastBackend = () => used;

const withoutGpu = (): Backend => (typeof Worker !== 'undefined' && poolSize() > 1 ? 'pool' : 'wasm');

// Safari, and every browser on an iPhone or iPad (all WebKit), crashes the page when a worker that has
// used WebGPU ends: after a show, on reload, or when the tab closes. So WebKit listens on the CPU.
const webkit = nav ? /AppleWebKit/.test(nav.userAgent) && !/Chrome|Chromium|Edg/.test(nav.userAgent) : false;

/** WebGPU when the browser gives a real (not software) adapter, else a worker pool when there are cores
 * and memory for one. */
function bestBackend(): Promise<Backend> {
  best ??= (async (): Promise<Backend> => {
    const gpu = nav && 'gpu' in nav && !webkit ? nav.gpu : undefined;
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
    if (adapter && !adapter.info?.isFallbackAdapter) return 'webgpu';
    return withoutGpu();
  })();
  return best;
}

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  return res.arrayBuffer();
}

const sessions = new Map<string, Promise<ort.InferenceSession>>();

function session(model: Model, ep: Ep, bytes?: ArrayBuffer): Promise<ort.InferenceSession> {
  const key = `${ep} ${model.url}`;
  let s = sessions.get(key);
  if (!s) {
    s = (async () => createSession(bytes ?? (await fetchModel(model.url)), ep))();
    s.catch(() => sessions.delete(key));
    sessions.set(key, s);
  }
  return s;
}

/** Outputs for every piece, in order. */
export async function runPieces(model: Model, pieces: Piece[], opts: RunOptions = {}): Promise<Outputs[]> {
  let backend = opts.backend ?? (await bestBackend());
  let done = 0;
  const tick = () => opts.onProgress?.(++done / pieces.length);
  if (backend === 'webgpu') {
    try {
      const out = await runOnGpu(await session(model, 'webgpu', opts.bytes), model, pieces, tick);
      used = 'webgpu';
      return out;
    } catch (err) {
      // no usable GPU after all (no device, a lost device, an unsupported op): don't try it again
      console.warn('WebGPU failed, listening on the CPU instead:', err);
      void sessions.get(`webgpu ${model.url}`)?.then((x) => x.release()).catch(() => undefined);
      sessions.delete(`webgpu ${model.url}`);
      best = Promise.resolve((backend = withoutGpu()));
      done = 0;
    }
  }
  if (backend === 'pool') {
    const out = await runPool(model, pieces, opts.bytes ?? (await fetchModel(model.url)), tick)
      .catch((err) => {
        console.warn('The model workers failed, listening on one thread instead:', err);
        return null;
      });
    if (out) {
      used = 'pool';
      return out;
    }
    best = Promise.resolve('wasm');   // workers can't start or keep going here: one session on this thread
    done = 0;
  }
  const out = await runInOrder(await session(model, 'wasm', opts.bytes), model, pieces, tick);
  used = 'wasm';
  return out;
}

async function runInOrder(s: ort.InferenceSession, model: Model, pieces: Piece[], tick: () => void) {
  const out: Outputs[] = [];
  for (const p of pieces) {
    out.push(await runSession(s, model.input, p.data, p.dims, model.outputs));
    tick();
  }
  return out;
}

// A piece takes a second or so on a GPU; one that takes this long isn't coming back.
const GPU_STALL_MS = 60_000;

/** runInOrder on the GPU session, but failing when its device is lost or a piece hangs: after a device
 * error Safari can leave a run waiting forever. */
async function runOnGpu(s: ort.InferenceSession, model: Model, pieces: Piece[], tick: () => void) {
  const device = await ort.env.webgpu.device;           // ORT's own, now that a session has it
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rearm = () => {};
  const watch = new Promise<never>((_, reject) => {
    rearm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new Error('WebGPU stopped answering')), GPU_STALL_MS);
    };
    void device.lost.then((info) => reject(new Error(`WebGPU device lost: ${info.message || info.reason}`)));
  });
  watch.catch(() => undefined);                         // a loss after the run is no one's business
  rearm();
  try {
    return await Promise.race([runInOrder(s, model, pieces, () => {
      rearm();
      tick();
    }), watch]);
  } finally {
    clearTimeout(timer);
  }
}

type Reply = { ok: true; outputs?: Outputs } | { ok: false; error: string };

function ask(w: Worker, msg: unknown, transfer: Transferable[]): Promise<Outputs | undefined> {
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<Reply>) =>
      (e.data.ok ? resolve(e.data.outputs) : reject(new Error(e.data.error)));
    w.onerror = (e) => reject(new Error(e.message || 'Model worker failed'));
    w.postMessage(msg, transfer);
  });
}

/** null when the workers couldn't be started. Pieces are copied to the workers, not handed over, so
 * they're still here if a worker dies and the run has to be made again. */
async function runPool(model: Model, pieces: Piece[], bytes: ArrayBuffer, tick: () => void) {
  const workers: Worker[] = [];
  try {
    try {
      for (let i = Math.min(poolSize(), pieces.length); i > 0; i--) {
        workers.push(new Worker(new URL('./infer.worker.ts', import.meta.url), { type: 'module' }));
      }
      await Promise.all(workers.map((w) => {
        const copy = bytes.slice(0);
        return ask(w, { kind: 'load', bytes: copy, input: model.input, outputs: model.outputs }, [copy]);
      }));
    } catch {
      return null;
    }
    const out = new Array<Outputs>(pieces.length);
    let next = 0;
    await Promise.all(workers.map(async (w) => {
      while (next < pieces.length) {
        const i = next++, p = pieces[i];
        out[i] = (await ask(w, { kind: 'run', data: p.data, dims: p.dims }, []))!;
        tick();
      }
    }));
    return out;
  } finally {
    for (const w of workers) w.terminate();
  }
}
