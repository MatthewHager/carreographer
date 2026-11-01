// Read the music the way a player would: notes become events (a key press or a chord), and
// each stretch gets a texture: a single-note run, chords, a trill, an arrival.
//
// Event fields (one entry per onset group):
//   t, dur, low, high (midi), top (melodic pitch), amp,
//   kind: 0 single note, 1 dyad, 2 chord, 3 big chord (by the number of distinct pitch classes)
//   trill: 1 if part of a rapid two-note alternation
//   arrival: 1 if a strong chord that lands after a run or a gap

import type { Events } from '../analysis';
import { median, quantile } from '../np';

const GROUP_WINDOW = 0.045;   // onsets this close together are one event (one hand, one chord)

/** `notes`: basic-pitch rows (start s, end s, midi pitch, amplitude 0..1), sorted by start. */
export function groupEvents(notes: readonly (readonly number[])[]): Events {
  if (notes.length === 0) {
    return { t: [], dur: [], low: [], high: [], top: [], amp: [], kind: [], trill: [], arrival: [], phrase: [] };
  }
  const groups: [number, number][] = [];
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j < notes.length && notes[j][0] - notes[i][0] < GROUP_WINDOW) j++;
    groups.push([i, j]);
    i = j;
  }

  const t: number[] = [], dur: number[] = [], n: number[] = [], low: number[] = [], high: number[] = [];
  const top: number[] = [], amp: number[] = [];
  for (const [a, b] of groups) {
    const g = notes.slice(a, b);
    // Collapse octave doublings: one voice per pitch class, keep the loudest.
    const byPc = new Map<number, readonly number[]>();
    for (const row of g) {
      const pc = Math.trunc(row[2]) % 12;
      const had = byPc.get(pc);
      if (had === undefined || row[3] > had[3]) byPc.set(pc, row);
    }
    let t0 = Infinity, lo = Infinity, hi = -Infinity, loud = -Infinity, topP = -Infinity;
    for (const row of g) {
      t0 = Math.min(t0, row[0]);
      lo = Math.min(lo, row[2]);
      hi = Math.max(hi, row[2]);
      loud = Math.max(loud, row[3]);
    }
    for (const v of byPc.values()) if (v[2] > topP) topP = v[2];
    t.push(t0);
    dur.push(median(g.map((r) => r[1])) - t0);
    n.push(byPc.size);
    low.push(lo);
    high.push(hi);
    top.push(topP);
    amp.push(loud);
  }
  const m = t.length;

  const kind = n.map((k) => (k >= 5 ? 3 : k >= 3 ? 2 : k === 2 ? 1 : 0));

  // Trills: rapid alternation between two nearby pitch classes.
  const trill = new Array<number>(m).fill(0);
  for (let i = 3; i < m; i++) {
    if (Math.max(n[i - 3], n[i - 2], n[i - 1], n[i]) <= 2 && t[i] - t[i - 3] < 0.45) {
      const p = top.slice(i - 3, i + 1);
      const step = Math.abs(p[0] - p[1]);
      if (Math.abs(p[0] - p[2]) <= 1 && Math.abs(p[1] - p[3]) <= 1 && step >= 1 && step <= 3) {
        trill[i - 3] = trill[i - 2] = trill[i - 1] = trill[i] = 1;
      }
    }
  }

  // Arrivals: a strong chord that lands after a busy run or after silence. Rare by design:
  // top-decile loudness, at least 2.5 s apart, so "everything on" stays a punctuation mark.
  const arrival = new Array<number>(m).fill(0);
  const strongAt = quantile(amp, 0.9);
  let last = -9.0;
  for (let i = 0; i < m; i++) {
    if (kind[i] >= 2 && amp[i] >= strongAt && t[i] - last >= 2.5) {
      let before = 0;
      for (const tj of t) if (tj >= t[i] - 1.0 && tj < t[i]) before++;
      const gap = i ? t[i] - t[i - 1] : 9;
      if (before >= 6 || gap > 0.6) {
        arrival[i] = 1;
        last = t[i];
      }
    }
  }

  return { t, dur, low, high, top, amp, kind, trill, arrival, phrase: [] };
}

/** Texture taxonomy: label every event with the kind of passage it belongs to. A phrase starts where the
 * texture turns to chords, an arrival or a trill, or away from chords or a trill (phrases.ts).
 *
 *  run_up / run_down  fast single notes moving mostly one way
 *  zigzag             fast single notes leaping back and forth
 *  trill              rapid alternation of two neighbouring notes
 *  chords             mostly 3+ voice events
 *  arrival            strong chord landing after a run or a gap
 *  melody             everything else */
export function labelPhrases(ev: Events): Events {
  const n = ev.t.length;
  const phrase = new Array<string>(n).fill('melody');
  if (n === 0) {
    ev.phrase = phrase;
    return ev;
  }
  const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  for (let i = 0; i < n; i++) {
    const t = ev.t[i];
    const idx: number[] = [];
    let kinds = 0;
    for (let j = 0; j < n; j++) {
      if (ev.t[j] >= t - 0.6 && ev.t[j] <= t + 0.6) {
        idx.push(j);
        kinds += ev.kind[j];
      }
    }
    const dens = idx.length / 1.2;
    const kindMean = kinds / idx.length;
    const single = kindMean <= 1.0;
    if (ev.arrival[i]) {
      phrase[i] = 'arrival';
    } else if (ev.trill[i]) {
      phrase[i] = 'trill';
    } else if (dens >= 5.5 && single) {
      // Direction over the window: fraction of upward steps among the single notes.
      const steps: number[] = [];
      for (let k = 1; k < idx.length; k++) steps.push(ev.top[idx[k]] - ev.top[idx[k - 1]]);
      let nFlips = 0;
      for (let k = 1; k < steps.length; k++) if (sign(steps[k]) !== sign(steps[k - 1])) nFlips++;
      const flips = nFlips / Math.max(steps.length - 1, 1);
      const up = steps.length ? steps.filter((s) => s > 0).length / steps.length : 0.5;
      if (flips >= 0.6) phrase[i] = 'zigzag';
      else if (up >= 0.65) phrase[i] = 'run_up';
      else if (up <= 0.35) phrase[i] = 'run_down';
      else phrase[i] = 'zigzag';
    } else if (kindMean >= 1.6) {
      phrase[i] = 'chords';
    }
  }
  // Smooth single-event blips into their neighbours.
  for (let i = 1; i < n - 1; i++) {
    const blip = phrase[i - 1] === phrase[i + 1] && phrase[i + 1] !== phrase[i];
    if (blip && phrase[i] !== 'arrival' && phrase[i] !== 'trill') {
      phrase[i] = phrase[i - 1];
    }
  }
  ev.phrase = phrase;
  return ev;
}

/** Low/high midi bounds that map the piece's melodic range onto the stage (0..1). */
export function pitchScale(ev: Events): [number, number] {
  if (ev.t.length === 0) return [48.0, 84.0];
  const lo = quantile(ev.top, 0.05), hi = quantile(ev.top, 0.95);
  return [lo, Math.max(hi, lo + 12)];
}
