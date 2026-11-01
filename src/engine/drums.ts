// The drums, voice by voice, each on lamps of its own, wherever that voice keeps time (a band's kit, a
// finger snap, a timpani, a clap): not only where a whole kit is heard.
//
//   kick    (kick drum, timpani, a bass note's attack)   the fogs (a truck's frunk light), low on every car;
//                                                        from drive up also the brake lights and the trucks'
//                                                        rear bars
//   snare   (snare, clap, snap, a crash)                 the amber turn signals, the rear ones from a groove
//                                                        up, a truck's off-road bar from drive
//   hats    (hi-hats, ride, shakers)                     the side markers, at the peak only (hat-rate flashing
//                                                        everywhere else would tire the eye)
//
// A voice keeps time where its hits land on the beat or halfway between (within GRID_S) and come often: at
// least NEED hits a beat over the four seconds around (a kick every two or three beats, a snare every three
// or four, a hat nearly every beat), so a stray detection lights nothing, and neither does an organ's or a
// piano's attack, which the listening may hear as a kick but which falls anywhere. A hit that keeps time
// lights on the beat or half beat it keeps, so it lands with everything else on it. Quiet music gets short,
// small hits.

import type { Analysis } from './analysis';
import * as C from './channels';
import type { Car } from './car';
import { flowsAt } from './feel';
import { DRIVE, GROOVE, levelAt, PEAK } from './level';
import { clip, searchsorted } from './np';
import { eighthAt } from './tempo';

const REACH_S = 2.0;            // presence is counted over this much either side of a hit
const GRID_S = 0.05;            // a hit this close to a beat or an eighth keeps time
const MIN_STRENGTH = 0.2;
const NEED = { kick: 0.4, snare: 0.3, hats: 0.9 };
const HEARD = 0.1;              // below this level the music is barely there: no drums

/** Per hit of `hits`, where it keeps time (the beat or half beat within GRID_S of it), or NaN where it
 * doesn't: off the grid, or with fewer than `need` such hits of MIN_STRENGTH a beat around it. */
function keepsTime(an: Analysis, hits: number[][], need: number): number[] {
  const beats = an.beats, on = (t: number, g = eighthAt(an, t)) => (Math.abs(g - t) <= GRID_S ? g : NaN);
  const at = hits.map(([t, s]) => (s >= MIN_STRENGTH ? on(t) : NaN));
  const strong = hits.filter((_, i) => !Number.isNaN(at[i])).map(([t]) => t);
  const count = (a: number[], t0: number, t1: number) => searchsorted(a, t1) - searchsorted(a, t0);
  return hits.map(([t], i) =>
    (count(strong, t - REACH_S, t + REACH_S) / Math.max(2, count(beats, t - REACH_S, t + REACH_S)) >= need
      ? at[i] : NaN));
}

/** The drum layer (after the moves, before the beat layer). */
export function apply(cars: Car[], an: Analysis): void {
  if (an.beats.length < 2) return;
  const play = (hits: number[][], need: number, fn: (t: number, strength: number, s: number) => void) => {
    const keeps = keepsTime(an, hits, need);
    hits.forEach(([, strength], i) => {
      const t = keeps[i];
      if (Number.isNaN(t) || flowsAt(an, t)) return;
      const s = levelAt(an, t);
      if (s >= HEARD) fn(t, strength, s);
    });
  };
  play(an.kick, NEED.kick, (t, strength, s) => {
    const hold = 0.08 + 0.08 * strength * s;
    for (const c of cars) {
      c.light(c.isCt ? c.frunk() : c.fogs(), t, t + hold);
      if (s >= DRIVE) {
        c.light([C.BRAKE], t, t + hold + 0.04);
        if (c.isCt) rearBar(c, t, hold + 0.15, 0.6 + 0.4 * strength);
      }
    }
  });
  play(an.snare, NEED.snare, (t, strength, s) => {
    const hold = clip(0.06 + 0.1 * s, 0.08, 0.16);
    for (const c of cars) {
      c.light(c.turns().filter((ch) => !c.rearTurns().includes(ch)), t, t + hold);
      if (s >= GROOVE) c.light(c.rearTurns(), t, t + hold);
      if (c.isCt && s >= DRIVE) c.pixels(C.OFFROAD_BAR, t, Array.from({ length: c.fr(t + hold) - c.fr(t) },
        () => new Float64Array(C.OFFROAD_BAR.length).fill(strength)));
    }
  });
  play(an.hats, NEED.hats, (t, _, s) => {
    if (s < PEAK) return;
    for (const c of cars) c.light(c.markers(), t, t + 0.06);
  });
}

/** A truck's rear bar flashing to `level` and fading over `dur`. */
function rearBar(c: Car, t: number, dur: number, level: number) {
  const n = Math.max(2, c.fr(t + dur) - c.fr(t));
  c.pixels(C.REAR_BAR, t, Array.from({ length: n }, (_, f) => new Float64Array(C.REAR_BAR.length)
    .fill(level * (1 - f / n))));
}
