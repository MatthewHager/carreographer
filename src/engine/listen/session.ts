// ONNX Runtime for the listening models. The WebGPU build of ORT: it runs on the GPU when there is one
// and on WASM otherwise (the default JSEP build gave wrong beat logits on WebGPU). Its
// .wasm is a Vite asset, so a build under any base finds it; ORT's own threads need cross-origin
// isolation, which GitHub Pages can't give, so it always runs one thread per session.

import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';
// ORT wants an absolute URL; inside a worker, relative ones resolve against the worker's script.
if (typeof location !== 'undefined') ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, location.href).href };

export { ort };

export type Ep = 'webgpu' | 'wasm';

export function createSession(bytes: ArrayBuffer | Uint8Array, ep: Ep): Promise<ort.InferenceSession> {
  const model = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // severity 3: errors only (not the warning that shape ops stay on the CPU)
  return ort.InferenceSession.create(model,
    { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
}

/** One run: `input` fed as a float32 tensor of `dims`, the named outputs copied out. */
export async function runSession(session: ort.InferenceSession, input: string, data: Float32Array,
  dims: readonly number[], outputs: readonly string[]): Promise<Record<string, Float32Array>> {
  const res = await session.run({ [input]: new ort.Tensor('float32', data, dims) }, outputs as string[]);
  const out: Record<string, Float32Array> = {};
  for (const name of outputs) out[name] = res[name].data as Float32Array;   // ORT copies outputs out of WASM
  return out;
}
