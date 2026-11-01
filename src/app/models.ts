// Tesla's 3D car models and paint table, from the Tesla app. The site serves them from
// models/tesla-app/ (the Pages build downloads them from the repository's "car-models" release, so
// they never enter the git history); the browser's cache keeps them between visits.

import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FILES, parseAppModel, type AppModelId } from '@/viewer/car/appBody';
import type { Paint } from '@/viewer/paints';

const parsed = new Map<AppModelId, Promise<GLTF | undefined>>();
/** How much of each model has arrived, 0..1 (1 once it is here, or failed). */
const arrived = new Map<AppModelId, number>();
const listeners = new Set<() => void>();
let paints: Promise<Paint[]> | undefined;

/** A file from models/tesla-app/, reporting the share of it that has arrived as it downloads. A server that
 * compresses it (GitHub Pages gzips the models) announces the compressed length, so that share is an
 * estimate there, held under 1 until the file is whole. */
async function fetchModelFile(name: string, onProgress?: (fraction: number) => void)
  : Promise<ArrayBuffer | undefined> {
  const res = await fetch(`${import.meta.env.BASE_URL}models/tesla-app/${name}`).catch(() => undefined);
  if (!res?.ok) return undefined;
  const length = Number(res.headers.get('content-length')) || 0;
  if (!onProgress || !length || !res.body) return res.arrayBuffer();
  const expect = length * (res.headers.get('content-encoding') ? GZIP_RATIO : 1);
  const chunks: Uint8Array[] = [], reader = res.body.getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    at += value.length;
    onProgress(Math.min(at / expect, 0.99));
  }
  const out = new Uint8Array(at);
  let k = 0;
  for (const c of chunks) {
    out.set(c, k);
    k += c.length;
  }
  return out.buffer;
}

const GZIP_RATIO = 1.7;     // how much a model grows back from gzip: 1.4 to 2.3 for the nine

function report(id: AppModelId, fraction: number) {
  arrived.set(id, fraction);
  for (const l of listeners) l();
}

/** The model, or undefined when it couldn't be loaded. */
export function loadModel(id: AppModelId): Promise<GLTF | undefined> {
  if (!parsed.has(id)) {
    report(id, 0);
    parsed.set(id, fetchModelFile(FILES[id], (f) => report(id, f))
      .then((b) => (b ? parseAppModel(b) : undefined))
      .catch(() => undefined)
      .finally(() => report(id, 1)));
  }
  return parsed.get(id)!;
}

/** How much of these models has arrived, 0..1 (each counted alike), and a way to hear as it changes. */
export function modelsArrived(ids: AppModelId[]): number {
  return ids.length ? ids.reduce((s, id) => s + (arrived.get(id) ?? 0), 0) / ids.length : 1;
}

export function onModelProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The paints in the app's table (paints.json), with the duplicate names it keeps for older option
 * codes folded into the first; [] when the table couldn't be loaded. */
export function loadPaints(): Promise<Paint[]> {
  paints ??= fetchModelFile('paints.json').then((b) => (b ? parsePaints(b) : [])).catch(() => []);
  return paints;
}

/** The paints a car can wear: the app's table, except the Cybertruck, which only comes in stainless. */
export async function paintsFor(id: AppModelId): Promise<Paint[]> {
  return id === 'cybertruck' ? [] : loadPaints();
}

/** "MidnightCherryRed" -> "Midnight Cherry Red". */
export const paintLabel = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

function parsePaints(bytes: ArrayBuffer): Paint[] {
  const table = JSON.parse(new TextDecoder().decode(bytes)) as {
    colors?: Record<string, { albedo?: string; metallic?: number; roughness?: number }>;
  };
  const out: Paint[] = [];
  const seen = new Set<string>();
  for (const [name, c] of Object.entries(table.colors ?? {})) {
    if (typeof c.albedo !== 'string' || !/^#[0-9a-f]{6}$/i.test(c.albedo)) continue;
    const paint = { name, albedo: c.albedo, metallic: Number(c.metallic ?? 0.3), roughness: Number(c.roughness ?? 0.04) };
    const look = `${paint.albedo}/${paint.metallic}/${paint.roughness}`;
    if (seen.has(look)) continue;
    seen.add(look);
    out.push(paint);
  }
  return out;
}
