// The array arithmetic the engine needs, plainly: sums, means, quantiles, interpolation, sorting order.
// Every function is deterministic (the same input gives the same float), which is all a show needs.
// Arrays are plain number[] or typed arrays.

type Arr = ArrayLike<number>;

export function sum(a: Arr, start = 0, end = a.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += a[i];
  return s;
}

export function mean(a: Arr, start = 0, end = a.length): number {
  return sum(a, start, end) / (end - start);
}

/** Index of the first maximum. */
export function argmax(a: Arr): number {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i;
  return k;
}

/** The indices that sort `a` ascending; ties keep their order, NaNs go last. */
export function argsort(a: Arr): number[] {
  const key = (i: number) => (Number.isNaN(a[i]) ? Infinity : a[i]);
  return Array.from({ length: a.length }, (_, i) => i).sort((i, j) => key(i) - key(j) || i - j);
}

const sorted = (a: Arr) => Float64Array.from(a).sort();

/** The q-quantile (0..1), interpolating linearly between the two nearest values. */
function quantileOf(s: Arr, q: number): number {
  const v = clip((s.length - 1) * q, 0, s.length - 1);
  const lo = Math.floor(v), hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (v - lo);
}

export function quantile(a: Arr, q: number): number {
  return quantileOf(sorted(a), q);
}

export function quantiles(a: Arr, qs: number[]): number[] {
  const s = sorted(a);
  return qs.map((q) => quantileOf(s, q));
}

export function median(a: Arr): number {
  const s = sorted(a), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** `num` evenly spaced values from start to stop, both included. */
export function linspace(start: number, stop: number, num: number): Float64Array {
  const out = new Float64Array(Math.max(0, num));
  for (let i = 0; i < num; i++) out[i] = num > 1 ? start + ((stop - start) * i) / (num - 1) : start;
  return out;
}

/** start, start + step, ... up to (not including) stop. */
export function arange(start: number, stop: number, step: number): Float64Array {
  const n = Math.max(0, Math.ceil((stop - start) / step));
  return Float64Array.from({ length: n }, (_, i) => start + i * step);
}

/** Where v goes in the ascending `a`: before any equal values ('left') or after them ('right'). */
export function searchsorted(a: Arr, v: number, side: 'left' | 'right' = 'left'): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (side === 'left' ? a[mid] < v : a[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function diff(a: Arr): Float64Array {
  const out = new Float64Array(Math.max(0, a.length - 1));
  for (let i = 1; i < a.length; i++) out[i - 1] = a[i] - a[i - 1];
  return out;
}

export function cumsum(a: Arr): Float64Array {
  const out = new Float64Array(a.length);
  let s = 0;
  for (let i = 0; i < a.length; i++) out[i] = s += a[i];
  return out;
}

export function clip(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** A 0..255 level as a byte (truncated). */
export function u8(x: number): number {
  return x <= 0 ? 0 : x >= 255 ? 255 : Math.trunc(x);
}

/** [start, end) for each run of true. */
export function runs(mask: ArrayLike<number | boolean>): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < mask.length) {
    if (mask[i]) {
      let j = i;
      while (j < mask.length && mask[j]) j++;
      out.push([i, j]);
      i = j;
    } else i++;
  }
  return out;
}

/** Halves to the even neighbour. */
export function round(x: number): number {
  const f = Math.floor(x);
  if (x - f === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
