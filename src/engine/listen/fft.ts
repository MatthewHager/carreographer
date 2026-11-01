// The one FFT the listening side uses: an in-place iterative radix-2 complex FFT, and a real FFT of
// length n computed as a complex FFT of length n / 2 (the usual even/odd packing). Forward transforms
// use numpy's sign convention, X[k] = sum x[j] e^(-2 pi i jk / n). Plans are cached by size.

const plans = new Map<number, ComplexFft>();

/** In-place complex DFT of a power-of-two size. */
export class ComplexFft {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    if (n < 1 || (n & (n - 1)) !== 0) throw new Error(`FFT size ${n} is not a power of two`);
    this.n = n;
    const levels = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n >> 1);
    this.sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  static of(n: number): ComplexFft {
    let p = plans.get(n);
    if (!p) plans.set(n, (p = new ComplexFft(n)));
    return p;
  }

  /** Forward DFT of (re, im) in place. */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n, rev = this.rev, cos = this.cos, sin = this.sin, s = 1;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let i = 0; i + 1 < n; i += 2) {
      const ar = re[i], ai = im[i], br = re[i + 1], bi = im[i + 1];
      re[i] = ar + br;
      im[i] = ai + bi;
      re[i + 1] = ar - br;
      im[i + 1] = ai - bi;
    }
    for (let size = 4; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = cos[k], sn = s * sin[k];
        for (let a = j; a < n; a += size) {
          const b = a + half;
          const tre = re[b] * c + im[b] * sn, tim = im[b] * c - re[b] * sn;
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
  }
}

/** Real DFT of length n (a power of two, at least 2): bins 0 .. n/2, as numpy's rfft. */
class RealFft {
  readonly n: number;
  private readonly half: ComplexFft;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly wc: Float64Array;
  private readonly ws: Float64Array;

  constructor(n: number) {
    this.n = n;
    const m = n >> 1;
    this.half = ComplexFft.of(m);
    this.zr = new Float64Array(m);
    this.zi = new Float64Array(m);
    this.wc = new Float64Array(m + 1);
    this.ws = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) {
      this.wc[k] = Math.cos((2 * Math.PI * k) / n);
      this.ws[k] = Math.sin((2 * Math.PI * k) / n);
    }
  }

  /** x has n samples; re/im receive the n/2 + 1 bins. */
  forward(x: ArrayLike<number>, re: Float64Array, im: Float64Array): void {
    const m = this.n >> 1, zr = this.zr, zi = this.zi;
    for (let j = 0; j < m; j++) {
      zr[j] = x[2 * j];
      zi[j] = x[2 * j + 1];
    }
    this.half.transform(zr, zi);
    for (let k = 0; k <= m; k++) {
      const a = zr[k % m], b = zi[k % m], c = zr[(m - k) % m], d = zi[(m - k) % m];
      // even part E = (Z[k] + conj Z[m-k]) / 2, odd part O = (Z[k] - conj Z[m-k]) / 2i
      const er = (a + c) / 2, ei = (b - d) / 2, or = (b + d) / 2, oi = (c - a) / 2;
      const wc = this.wc[k], ws = this.ws[k];
      re[k] = er + or * wc + oi * ws;
      im[k] = ei + oi * wc - or * ws;
    }
  }
}

const realPlans = new Map<number, RealFft>();

export function realFft(n: number): RealFft {
  let p = realPlans.get(n);
  if (!p) realPlans.set(n, (p = new RealFft(n)));
  return p;
}
