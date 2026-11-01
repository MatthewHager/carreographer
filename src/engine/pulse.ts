// The beat layer: the pulse under the choreography, on the headlights, the lamps with the most visual mass
// (concert lighting gives the beat to its biggest fixtures and the effects to the rest). How it hits
// follows the level at each beat (level.ts):
//
//   hush    nothing
//   calm    a soft tick of the middle car's inner beams on each downbeat, where the beat is very clear
//   groove  1 and 3 on every car's inner beams, the bars glinting on the 1
//   drive   every beat on every car's inner beams, the bars on the 1
//   peak    every beat on every car's headlights (all that drive has, and more), every lamp of every car
//           on the 1, the bars full white, and the off-beats sweeping the stage car by car on the amber
//           turns; the moves light whole halves over it, so the climax travels the stage as it thumps
//
// Each hit is a bright attack that decays on the shortest of Tesla's ramps (0.5, 1 or 2 s) that lasts until
// the next hit, the way the drum it follows sounds, so every beat lands as a thump from a glow, never from
// black. Below the peak, while a hit rings its inner beams are the beat's (ownership, kept by Car.light):
// where the music strikes most beats, the moves light around them. The other lamps are the moves', so a
// figure travelling the stage shows over the thump.
// A beat the music doesn't strike gets no hit. Where the beat is unclear (an.beatConfidence under CLEAR, and
// the tracker not keeping steady time either) the layer plays only the downbeats from drive up, and where
// the music flows (feel.ts) it isn't there.
//
// Builds: where the music climbs into its biggest step up, the pulse speeds up and spreads out - half
// notes, then every beat, then eighths in the last bar - growing from the middle car out to the ends; then a
// beat of black, and the whole stage hits the landing together (drops). A song gets at most one drop for
// every DROP_EVERY_S of its length, the biggest steps up that land from a build or onto a drum kit, so a
// drop stays an event; that beat of black is the show's only deliberate pull-back. Which landings are drops,
// and the builds into them, is moments.ts's plan.

import type { Analysis } from './analysis';
import * as C from './channels';
import { type Car, centreTruck, LIGHT_LEAD_S } from './car';
import { flowsAt, steadyAt, struckBeats, struckShare } from './feel';
import { DRIVE, GROOVE, levelAt, stepOf } from './level';
import { builds, drops } from './moments';
import * as M from './moves';
import { clip } from './np';
import { barPositions, beatAt, beatLen } from './tempo';

const OWNERS = new Set(['motif']);                 // phrase shapes whose moves own the whole stage
const CLEAR = 0.6, FAINT = 0.25, SURE = 0.9;       // how clear the beat is (an.beatConfidence): a full pulse,
                                                   // downbeats only, a calm tick
/** How clear the beat at t is: the listening's beat confidence, or CLEAR where the tracker keeps steady
 * time. */
const clearAt = (an: Analysis, t: number) =>
  Math.max(an.beatConfidence[clip(Math.round(t / an.step), 0, an.nFrames - 1)], steadyAt(an, t) ? CLEAR : 0);

const ATTACK_S = [0.1, 0.2];     // a hit holds full this long, from a groove to the peak, then decays: a thump
const ONE = 1.25;                // the 1 holds this much longer
const BAR_FLASH_S = 0.3;         // the trucks' bars flash on the 1 for this long at most, the 2025+ Model Y's
const GLINT_S = 0.1;             // ... for this long
const RAMPS: [number, number][] = [[0.5, C.OFF_500], [1.0, C.OFF_1000], [2.0, C.OFF_2000]];

/** One hit of the layer: its beat, kind ('tick' the calm downbeat, 'big' on the 1, 'beat' the others, ''
 * a build's beat, which buildPulse plays), the headlights it owns while it rings (0 none, 1 the inner beams,
 * 3 both, in a build), how long its attack holds, the ramp it decays on, and when it stops ringing: when
 * the next hit lands or the ramp ends, whichever is first. */
interface Hit { t: number; kind: string; own: number; hold: number; ramp: number; end: number }

/** Every hit the layer plays (see the module notes). Each decays on the shortest of Tesla's ramps that lasts
 * until the next, so a beat lands while the last still glows. */
function hits(an: Analysis): Hit[] {
  const b = an.beats, pos = barPositions(an), spans = builds(an), on = struckBeats(an);
  const out: Hit[] = [];
  const owners = (an.phrases ?? []).filter((ph) => OWNERS.has(ph.gesture));
  for (let i = 0; i < b.length; i++) {
    const t = b[i], next = b[i + 1] ?? t + beatLen(an);
    if (flowsAt(an, t) || owners.some((ph) => t >= ph.t0 - 0.05 && t < ph.t1)) continue;
    if (spans.some(([s0, land]) => t >= s0 && t < land)) {                     // the build's own pulse
      out.push({ t, kind: '', own: 3, hold: 0, ramp: 0, end: next });
      continue;
    }
    const s = levelAt(an, t), step = stepOf(s), clear = clearAt(an, t);
    if (step === 0 || clear < FAINT || !on[i]) continue;
    const every = clear >= CLEAR ? (step === 2 ? 2 : 1) : 0;    // how often it hits off the 1
    const kind = step === 1 ? (pos[i] === 0 && clear >= SURE ? 'tick' : '')
      : pos[i] === 0 && (step >= 3 || every) ? 'big' : every && pos[i] % every === 0 ? 'beat' : '';
    if (!kind) continue;
    const plays = every && struckShare(an, b[Math.max(0, i - 4)], b[i + 4] ?? t + 1) >= 0.5;
    const loud = clip((s - GROOVE) / (1 - GROOVE), 0, 1);
    const hold = Math.min(ATTACK_S[0] + (ATTACK_S[1] - ATTACK_S[0]) * loud, 0.4 * (next - t));
    out.push({ t, kind, own: plays && step < 4 ? 1 : 0, hold, ramp: 0, end: 0 });
  }
  out.forEach((h, k) => {
    if (!h.kind) return;
    const next = out[k + 1]?.t ?? Infinity;
    const [len, code] = RAMPS.find(([s]) => s >= next - h.t - h.hold) ?? RAMPS[RAMPS.length - 1];
    h.ramp = code;
    h.end = Math.min(next, h.t + h.hold + len);
  });
  return out;
}

/** Per frame, the headlights the beat layer owns (as Hit.own says), from each hit until it stops ringing:
 * every other layer lights around them (Car.light). */
export function ownership(an: Analysis): Uint8Array {
  const out = new Uint8Array(an.nFrames);
  const f = (x: number) => clip(Math.round((x - LIGHT_LEAD_S) / an.step), 0, an.nFrames);     // as Car.fr
  for (const h of hits(an)) if (h.own) out.fill(h.own, f(h.t), f(h.end));
  return out;
}

/** Lay the beat layer over the choreography (after the moves and drums), then the builds and the drops. */
export function apply(cars: Car[], an: Analysis): void {
  if (an.beats.length < 4) return;
  const mid = centreTruck(cars) ?? cars[Math.floor(cars.length / 2)];
  let sweep = 0;
  for (const { t, kind, hold, ramp, end } of hits(an)) {
    const peak = stepOf(levelAt(an, t)) === 4;
    const hit = (c: Car, chs: number[], dur: number) => {
      c.lightOver(chs, t, t + dur);
      c.lightOver(chs, t + dur, end, ramp);
    };
    if (kind === 'tick') hit(mid, mid.inner(), ATTACK_S[0]);
    if (kind !== 'big' && kind !== 'beat') continue;
    for (const c of cars) {
      hit(c, peak ? c.heads() : c.inner(), kind === 'big' ? hold * ONE : hold);
      if (kind !== 'big') continue;
      if (peak) hit(c, c.everything(), hold);
      if (c.isCt) M.barFlash(c, t, Math.min(BAR_FLASH_S, end - t), peak ? 1.0 : 0.5);
      c.light(c.bar(), t, t + GLINT_S);
    }
    if (peak && end - t > 2 * hold) {             // the off-beat sweeping the turns: 0, 1, 2, 1, 0 ...
      const n = cars.length, j = sweep++ % Math.max(1, 2 * n - 2), c = cars[j < n ? j : 2 * n - 2 - j];
      c.light(c.turns(), (t + end) / 2, (t + end) / 2 + hold);
    }
  }
  for (const [s0, land] of builds(an)) buildPulse(cars, an, s0, land);
  dropHits(cars, an);
}

/** The pulse through a build: half notes, then every beat, then eighths in the last bar - the middle car
 * first, its neighbours joining, every car by the last third - and a beat of black before the landing. */
function buildPulse(cars: Car[], an: Analysis, t0: number, land: number): void {
  const fromMiddle = (c: Car) => Math.abs(c.x - (cars.length - 1) / 2);
  const order = [...cars].sort((p, q) => fromMiddle(p) - fromMiddle(q));
  const beats = an.beats.filter((x) => x >= t0 - 0.01 && x < land);
  if (beats.length < 2) return;
  const span = Math.max(land - t0, 1e-3);
  beats.forEach((x, k) => {
    const gap = (beats[k + 1] ?? land) - x, left = land - x, u = (x - t0) / span;
    const bar = 4 * gap;
    const ticks = left <= bar + 0.01 ? [x, x + gap / 2] : left <= 3 * bar ? [x] : k % 2 === 0 ? [x] : [];
    const reach = clip(Math.floor(order.length * (0.34 + u)), 1, order.length);
    for (const t of ticks) {
      if (t >= land - gap - 0.01) continue;                             // the beat of black before the landing
      const hold = clip(gap * 0.3, 0.08, 0.14);
      const lamps = (c: Car) => (levelAt(an, t) >= DRIVE ? c.heads() : c.inner());
      for (const c of order.slice(0, reach)) c.lightOver(lamps(c), t, t + hold);
    }
  });
}

/** Each drop: black for a beat before it, then every lamp of every car on together for a beat. */
function dropHits(cars: Car[], an: Analysis): void {
  for (const d of drops(an)) {
    const beat = beatAt(an, d), gap = clip(beat, 0.25, 0.6);
    for (const c of cars) {
      c.dark(c.everything(), d - gap, d);
      c.set([...C.FRONT_BAR, ...C.REAR_BAR, ...C.OFFROAD_BAR], d - gap, d, 0);
      c.set(C.ALL_RGB.flatMap((ch) => [ch, ch + 1, ch + 2]), d - gap, d, 0);
    }
    M.allOn(cars, d, clip(beat, 0.3, 0.6));
    for (const c of cars) c.rgb(d, d + clip(beat, 0.3, 0.6), [255, 255, 255]);
  }
}
