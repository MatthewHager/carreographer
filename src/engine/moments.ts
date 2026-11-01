// The show's big moments, where the whole stage moves at once: the drops, each with the build that climbs
// into it, and the accents, the other moments that stand out most. The beat layer plays the builds and lands
// the drops (pulse.ts), the motors spend themselves on them (motors.ts), and the accents light the whole
// stage on their own.

import type { Analysis } from './analysis';
import type { Car } from './car';
import { flowsAt, kitAt } from './feel';
import { CALM, DRIVE, GROOVE, levelAt, levelOver, stepOf } from './level';
import * as M from './moves';
import { clip, quantile } from './np';
import { beatAt } from './tempo';

// ---- Drops and builds --------------------------------------------------------------------------

const DROP_EVERY_S = 100, DROP_GAP_S = 30, BUILD_S = 4;
const DROP_MIN = 0.25, DROP_ALONE = 0.45;          // a drop's size (plan): with a build or a kit, or on its own
const PEAK_BONUS = 0.2;                            // a drop onto the peak (level.ts) counts as this much more
const MUSIC_LEAD_S = 8;                            // no drop this soon after the music starts: nothing to build

const cached = new WeakMap<Analysis, { drops: number[]; builds: [number, number][] }>();

/** The level that holds over [t0, t1): its quieter quarter, so a lone loud moment doesn't count. */
function heldLevel(an: Analysis, t0: number, t1: number): number {
  const lv = an.level!, a = clip(Math.trunc(t0 / an.step), 0, lv.length - 1);
  return quantile(lv.subarray(a, clip(Math.trunc(t1 / an.step), a + 1, lv.length)), 0.25);
}

/** The drops: downbeats where the music lands a step higher and stays there - the level held over the four
 * seconds after a step above the two before, into a drive or the peak - none in the first MUSIC_LEAD_S of
 * the music or where it flows or is about to. Each may have a build: the climb into it, where the level has
 * been rising for BUILD_S or more (a crescendo, a riser). A drop's size is the jump, the climb into it, and
 * PEAK_BONUS for landing on the song's peak; it counts from DROP_MIN where it has a build to land from or
 * a drum kit to drop, and from DROP_ALONE without (an organ's entrance is no drop). Of these the biggest,
 * one for every DROP_EVERY_S of the song, at least DROP_GAP_S apart; a song can have none. */
function plan(an: Analysis) {
  let out = cached.get(an);
  if (out) return out;
  let first = 0;
  while (first < an.nFrames && an.level![first] < CALM) first++;
  const start = first * an.step;
  const jump = (d: number) => heldLevel(an, d + 0.1, d + 4) - levelOver(an, d - 2, d - 0.1);
  const smooth = (t: number) => levelOver(an, t - 2, t);
  const buildInto = (d: number): [number, number] | null => {
    let t0 = d;                                      // back while the level keeps falling the earlier we look
    while (t0 > start + 4 && d - t0 < 16 && smooth(t0 - 2) <= smooth(t0) + 0.02) t0 -= 2;
    return d - t0 >= BUILD_S && smooth(d) - smooth(t0) >= 0.1 ? [Math.max(start + 2, t0 - 2), d] : null;
  };
  const cands = an.downbeats.filter((d) => {
    const before = stepOf(levelOver(an, d - 2, d - 0.1)), after = stepOf(heldLevel(an, d + 0.1, d + 4));
    return d > start + MUSIC_LEAD_S && after >= 3 && after > before && jump(d) >= 0.08
      && [0, 2, 4, 6].every((k) => !flowsAt(an, d + k));
  }).map((d) => {
    const b = buildInto(d);
    const peak = stepOf(heldLevel(an, d + 0.1, d + 4)) === 4 ? PEAK_BONUS : 0;
    return { d, b, size: jump(d) + (b ? smooth(d) - smooth(b[0] + 2) : 0) + peak };
  });
  const most = Math.max(1, Math.round(an.duration / DROP_EVERY_S));
  const kept: typeof cands = [];
  const lands = (c: (typeof cands)[number]) =>
    c.size >= DROP_MIN && (c.b !== null || kitAt(an, c.d + 2) || c.size >= DROP_ALONE);
  for (const c of cands.filter(lands).sort((p, q) => q.size - p.size)) {
    if (kept.length < most && kept.every((k) => Math.abs(k.d - c.d) >= DROP_GAP_S)) kept.push(c);
  }
  kept.sort((p, q) => p.d - q.d);
  out = { drops: kept.map((k) => k.d), builds: kept.flatMap((k) => (k.b ? [k.b] : [])) };
  cached.set(an, out);
  return out;
}

export const drops = (an: Analysis) => plan(an).drops;
export const builds = (an: Analysis) => plan(an).builds;

// ---- Accents -----------------------------------------------------------------------------------
// The whole stage at once is the show's exclamation mark, so it is kept for the moments that stand out most.
// Besides the drops, the strongest of
//   arrivals   a phrase's arrival chord in lively music where the music steps up: its level LIFT over the
//              seconds before, or a jump of BLAST
//   blasts     a strike out of a breath that lands loud (LOUD: within 16 dB of the song's loud end, the show
//              at a groove or more as it rings, RING_S on): BLAST (16 dB) louder than the quietest moment of
//              the BREATH_S before (an orchestra's tutti after a rest, a band's hit after a stop)
// light the whole stage, at most one for every ACCENT_EVERY_S of the song, strongest first: a strike out of
// silence (the breath before it at REST: 30 dB under the loud end) at least STRIKE_GAP_S after another, as
// the Toccata's opening calls are, anything else ACCENT_GAP_S clear of every other and of a drop.

export const LOUD = 0.6;
const BLAST = 0.4, LIFT = 0.08, REST = 0.25, RING_S = 0.8;
const ACCENT_EVERY_S = 40, ACCENT_GAP_S = 10, STRIKE_GAP_S = 4;
const BREATH_S = 0.4, STRIKE_S = 0.15;     // the breath before a strike, and its attack (the loudest moment)
const LIFT_WEIGHT = 2;     // a step up in the level counts twice a jump in loudness: it lasts
const STRIKE_HOLD_S = 0.3;     // a strike holds the whole stage this long at most, and under a beat

/** The accents (see above), clear of the drops. */
export function accents(cars: Car[], an: Analysis) {
  const x = an.loudness, ev = an.events, at = (t: number) => clip(Math.round(t / an.step), 0, an.nFrames - 1);
  /** [the quietest moment of the breath before t (silence before the song), the loudest of its attack] */
  const around = (t: number): [number, number] => {
    let before = Infinity, after = 0;
    for (let f = at(t - BREATH_S); f < at(t - 0.05); f++) before = Math.min(before, x[f]);
    for (let f = at(t); f <= at(t + STRIKE_S); f++) after = Math.max(after, x[f]);
    return [before === Infinity ? 0 : before, after];
  };
  const lift = (t: number) => levelOver(an, t, t + 2) - levelOver(an, t - 4, t - 0.3);
  const strength = (t: number, [before, after]: [number, number]) =>
    after - before + LIFT_WEIGHT * Math.max(0, lift(t));
  const taken = drops(an);
  const phrases = an.phrases!.filter((ph) => !flowsAt(an, ph.t0));
  const cands: { t: number; strength: number; hold: number; strike: boolean }[] = [];
  for (const h of an.hits) {
    const [before, after] = around(h);
    if (after < LOUD || after - before < BLAST || levelAt(an, h + RING_S) < GROOVE || flowsAt(an, h)) continue;
    const hold = Math.min(STRIKE_HOLD_S, beatAt(an, h) * 0.6);
    cands.push({ t: h, strength: strength(h, [before, after]), hold, strike: before <= REST });
  }
  for (const ph of phrases) {
    for (let i = ph.a; i < ph.b; i++) {
      const t = ev.t[i], [before, after] = around(t);
      if (!ev.arrival[i] || levelAt(an, t) < DRIVE
        || (lift(t) < LIFT && after - before < BLAST)) continue;
      cands.push({ t, strength: strength(t, [before, after]), hold: clip(ev.dur[i], 0.3, 1.2), strike: false });
    }
  }
  let most = Math.round(an.duration / ACCENT_EVERY_S);
  const kept: typeof cands = [];
  for (const c of cands.sort((p, q) => q.strength - p.strength)) {
    const near = (u: number, gap: number) => Math.abs(u - c.t) < gap;
    if (most <= 0 || taken.some((u) => near(u, c.strike ? 1 : ACCENT_GAP_S))
      || kept.some((k) => near(k.t, c.strike && k.strike ? STRIKE_GAP_S : ACCENT_GAP_S))) continue;
    most--;
    kept.push(c);
    M.allOn(cars, c.t, c.hold);
  }
}
