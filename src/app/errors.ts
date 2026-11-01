// What to tell people when this browser can't make a show, in their words rather than the browser's.

/** Why this browser can't make shows at all, or null when it can. */
export function unsupported(): string | null {
  const missing = [
    typeof WebAssembly !== 'object' && 'WebAssembly',
    typeof Worker === 'undefined' && 'Web Workers',
    typeof OfflineAudioContext === 'undefined' && 'Web Audio',
    typeof BigInt === 'undefined' && 'BigInt',
  ].filter(Boolean);
  if (!missing.length) return null;
  const lockdown = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && typeof WebAssembly !== 'object'
    ? ' On an iPhone, iPad or Mac, Lockdown Mode turns WebAssembly off.' : '';
  return `This browser can't make light shows: it has no ${missing.join(' or ')}. `
    + `A recent Chrome, Edge, Firefox or Safari can.${lockdown}`;
}

// What browsers, WebAssembly and ONNX Runtime say when an allocation fails. Not every RangeError: most
// are plain bugs (a stack overflow, a bad index).
const OUT_OF_MEMORY =
  /out of memory|allocation failed|(could not|failed to) (allocate|grow)|bad_alloc|cannot enlarge memory|Aborted\(OOM\)/i;

export const outOfMemory = (message: string) => OUT_OF_MEMORY.test(message);

/** A message for a show that failed partway. */
export function explain(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  if (outOfMemory(message)) {
    return 'This device ran out of memory making the show. Close other tabs and try again, or try a shorter '
      + 'song or a computer.';
  }
  if (/Couldn't load|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return "The listening models didn't download. Check the connection and try again.";
  }
  const detail = message.replace(/^Error: /, '').trim() || 'the browser stopped it';
  return `Something went wrong making the show (${detail}). Try again, or try another browser.`;
}
