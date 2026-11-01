// The motors: the closures as a second, slow stage. Lights flash in 20 ms; the motors move in seconds
// (mirrors 2 s, windows 4 s, liftgates 14 s up and 4 s down, the Cybertruck's frunk 10 s up, the charge port
// 2 s), and Tesla counts their commands per show per closure (CLOSURE_LIMITS: liftgate 6, each window 6, each
// mirror 20, charge port 3, a Model X's doors 6 each; Open, Close and Dance count), with about 30 s of
// dancing each before a thermal cut-out. So each family of motors gets moments of its own, planned backwards
// from the travel times so a lid is fully open on its beat:
//
//   lids      open to land on the song's peak, dance through it (hold open, where the music flows) and
//             close; a part-way wave (each lid lifts and stops on its beat) on the biggest loud moment
//   windows   down as the music starts (the music plays from the cabins, so the crowd hears it through
//             them); on the peak a dance across the cars, each car's half a relay after its lid lands, so
//             lid and windows take turns; a burst rolling across the cars on big moments the lids left,
//             spread over the song, within the loud stretch each starts; and down again after their last
//             dance
//   port      its Dance is the rainbow light: over the most exciting 30 s of the song
//   doors     a Model X's falcon doors rise into the peak, dance and close; its windows keep still meanwhile,
//             as Tesla warns moving windows can trip the doors' pinch detection
//   mirrors   a fold-and-unfold figure on each big moment nothing else took, then wherever nothing has moved
//             for a while where the music beats (twice as long when calm), until their commands run out
//
// No figure moves two cars at once: the cars take their turns a relay apart (the motor's travel time, at
// most RELAY_MAX_S), crowd-left to right, closed up on a moment so the last car still moves within it.
// Apart from the windows going down, the lids opening onto the peak and the mirrors, motors move only where
// the music is at least in a groove and beats (not where it flows), and every lid is shut before the show
// ends.

import type { Analysis } from './analysis';
import { type Car, centreTruck } from './car';
import * as C from './channels';
import { flowsAt } from './feel';
import { CALM, DRIVE, GROOVE, levelAt, levelOver, PEAK, stepOf } from './level';
import { clip } from './np';
import { builds, drops } from './moments';
import { beatLen, onBeat } from './tempo';

// the Cybertruck's frunk timed on the truck, Oct 2026; the rest from Tesla's README
export const LIFTGATE_OPEN_S: Record<string, number> = { modely: 14.0, cybertruck: 10.0 };
export const LIFTGATE_CLOSE_S = 4.0, WINDOW_S = 4.0, PORT_S = 2.0, MIRROR_S = 2.0;
export const FALCON_OPEN_S = 20.0;
export const FALCON_CLOSE_S = 8.0;

const RELAY_MAX_S = 4.0;           // the longest a car waits for the one before it (a lid's close)
const SPACING_S = 24;              // big moments for the motors at least this far apart
const FALLBACK = -0.3;             // a driving downbeat ranks below any moment that stands out (moments)
const LID_DANCE_S: [number, number] = [4.0, 20.0];   // a lid's dance on the peak, at least and at most
const OPEN_MARGIN_S = 0.8;         // a lid or door only dances once fully open: land a little early
const RISE_S = 5.0, WAVE_S = 2.0;  // a part-way lift, and the cars of a wave this far apart
const SHUT_BY_S = 1.0;             // every lid is shut this long before the show ends
const BURST_S = 4.5;               // a window's dance burst, and its dance on the peak: three bursts and
const PEAK_DANCE_S = 10.0;         // ... the peak's dance stay under 30 s
const PORT_DANCE_S = 30.0;         // the port's rainbow, about as long as a motor may dance in a show
const DOOR_DANCE_S = 10.0;
const STILL_S = 4.0;               // music in a groove with nothing moving this long gets a mirror figure
const QUIET_START = 0.25;          // ... past this share of the song, so its opening keeps still
const ROOM_S: [number, number] = [8, 20];   // a big moment leaves this much of the song before and after it:
                                   // the windows going down, and a lid's dance and close
const DANCED_BY_S = 8;             // every window's dance ends this long before the show, to go down again
const DOWN_BY_S = 2;               // ... and is down this long before it

/** How long after the car before it a car starts a motor's figure: that motor's travel time (at most
 * RELAY_MAX_S), so each car moves while the one before it is on its way. */
const relay = (travel: number) => Math.min(travel, RELAY_MAX_S);

/** The relay for a figure on a moment `span` s long: closed up so the last of `n` cars still starts within
 * it, but at least a beat, so each car's move reads as its own. */
const relayWithin = (an: Analysis, travel: number, span: number, n: number) =>
  Math.max(beatLen(an), Math.min(relay(travel), span / Math.max(n - 1, 1)));

/** When car `i` of `n` starts lowering a window as the music starts: fronts then rears, car by car from the
 * crowd's left, a beat (at most a second) apart. */
function lowered(an: Analysis, i: number, n: number, rear: boolean): number {
  return (an.beats.find((b) => b >= 0.2) ?? 0.2) + Math.min(beatLen(an), 1.0) * (i + (rear ? n : 0));
}

/** The motor plan as it is written: every command goes through cmd(), which keeps Tesla's limits
 * (Car.closure) and marks the frames where some motor is moving, so the mirrors can fill the stillness. */
class Plan {
  readonly moving: Uint8Array;
  readonly still = new Map<Car, [number, number][]>();      // spans a Model X's windows must keep still
  readonly danced = new Map<string, number>();              // per car and closure, when its last dance ends
  constructor(readonly cars: Car[], readonly an: Analysis) {
    this.moving = new Uint8Array(an.nFrames);
  }

  /** A command from t0 to t1 if Tesla's limits allow, its motor moving for `busy` seconds from t0. */
  cmd(c: Car, ch: number, t0: number, t1: number, cmd: number, busy = t1 - t0): boolean {
    if (!c.closure(ch, t0, t1, cmd)) return false;
    this.moving.fill(1, c.fr(t0), c.fr(t0 + busy));
    const key = `${c.x} ${ch}`;
    if (cmd === C.CLOSURE_DANCE) this.danced.set(key, Math.max(t1, this.danced.get(key) ?? 0));
    return true;
  }
}

/** How long from t the music stays at `step` or above. */
function holds(an: Analysis, t: number, step: number): number {
  const lv = an.level!;
  let f = clip(Math.trunc(t / an.step), 0, lv.length - 1);
  while (f < lv.length - 1 && stepOf(lv[f]) >= step) f++;
  return f * an.step - t;
}

/** Every closure's part in the show. */
export function choreograph(cars: Car[], an: Analysis): void {
  const plan = new Plan(cars, an), peak = thePeak(an), big = moments(an, peak);
  const waved = lids(plan, peak, big);
  doors(plan, peak);
  windows(plan, peak, big.filter((t) => !waved.includes(t)));
  port(plan);
  mirrors(plan, big);
}

/** The song's peak, where the level first reaches its top step, on the beat, and how long the music stays
 * at drive or above after it: [t, until], or null for a song that never gets there. */
function thePeak(an: Analysis): [number, number] | null {
  const top = an.level!.findIndex((v) => v >= PEAK) * an.step;
  return top < 0 ? null : [onBeat(an, top), top + holds(an, top, 3)];
}

/** The other big moments, biggest first: each build's landing and drop (moments.ts), each arrival chord,
 * each loud section's start and strike (an.hits) in lively music, then any driving downbeat, sized by the
 * level they reach, at least SPACING_S apart and from the peak, clear of the song's ends. */
function moments(an: Analysis, peak: [number, number] | null): number[] {
  const cands: [number, number][] = [...builds(an).map(([, land]): [number, number] => [land, 0.5]),
    ...drops(an).map((d): [number, number] => [d, 0.3])];
  for (let i = 0; i < an.events.t.length; i++) if (an.events.arrival[i]) cands.push([an.events.t[i], 0.2]);
  for (const s of an.sections) if (levelOver(an, s.t0, s.t1) >= DRIVE) cands.push([s.t0, 0]);
  for (const h of an.hits) if (levelAt(an, h) >= DRIVE) cands.push([h, 0]);
  // after everything else, a driving downbeat: a long loud stretch where nothing stands out still gets its
  // moments, SPACING_S apart, rather than a minute and a half of loud music with every motor still
  for (const d of an.downbeats) if (levelAt(an, d) >= DRIVE) cands.push([d, FALLBACK]);
  const out: number[] = peak ? [peak[0]] : [];
  const sized = cands.filter(([t]) => t > ROOM_S[0] && t < an.duration - ROOM_S[1]
    && levelOver(an, t, t + 2) >= GROOVE && !flowsAt(an, t) && (!peak || t < peak[0] || t > peak[1] + 4))
    .map(([t, bonus]): [number, number] => [onBeat(an, t), bonus + levelOver(an, t, t + 2)]);
  for (const [t] of sized.sort((p, q) => q[1] - p[1] || p[0] - q[0])) {
    if (out.every((u) => Math.abs(u - t) >= SPACING_S)) out.push(t);
  }
  return peak ? out.slice(1) : out;
}

/** Whether no command is on channel `ch` of car `c` from t0 to t1. */
function free(c: Car, ch: number, t0: number, t1: number): boolean {
  for (let f = c.fr(t0); f < c.fr(t1); f++) if (c.get(f, ch)) return false;
  return true;
}

/** The lids (see the module notes). Returns the moments their waves took. */
function lids(plan: Plan, peak: [number, number] | null, big: number[]): number[] {
  const { cars, an } = plan, n = cars.length, end = an.duration - SHUT_BY_S - LIFTGATE_CLOSE_S;
  const lead = Math.max(...cars.map((c) => LIFTGATE_OPEN_S[c.kind])) + OPEN_MARGIN_S;
  if (peak) {
    const dance = !flowsAt(an, peak[0]);       // music that flows gets the slow opening alone
    const each = relayWithin(an, lead, clip(peak[1] - peak[0], ...LID_DANCE_S), n);
    const lands = cars.map((_, i) => onBeat(an, peak[0] + each * i));
    const len = Math.min(clip(peak[1] - peak[0], ...LID_DANCE_S), end - 0.3 - lands[n - 1]);
    if (lands[0] - lead >= 0.8 && len >= LID_DANCE_S[0]) {
      cars.forEach((c, i) => {
        plan.cmd(c, C.LIFTGATE, lands[i] - lead, lands[i] - lead + 0.5, C.CLOSURE_OPEN, lead);
        if (dance) plan.cmd(c, C.LIFTGATE, lands[i], lands[i] + len, C.CLOSURE_DANCE);
        const close = lands[i] + len + 0.3;
        plan.cmd(c, C.LIFTGATE, close, close + 0.5, C.CLOSURE_CLOSE, LIFTGATE_CLOSE_S);
      });
    }
  }
  // a wave on a loud moment: each lid lifts for RISE_S and stops on its beat, the cars WAVE_S apart, the
  // centrepiece (or the middle car) on the moment, and closes again two beats later in the same order
  const mid = centreTruck(cars)?.x ?? Math.floor(n / 2);
  const left = (c: Car) => C.CLOSURE_LIMITS[C.LIFTGATE] - (c.closureCounts.get(C.LIFTGATE) ?? 0);
  for (const m of big.filter((t) => levelOver(an, t, t + 2) >= DRIVE)) {
    const stops = cars.map((_, i) => onBeat(an, m + (i - mid) * WAVE_S));
    const hold = Math.max(2, 2 * beatLen(an)), first = stops[0] - RISE_S, shut = stops[n - 1] + hold;
    if (first < 0.8 || shut > end || cars.some((c) => left(c) < 2
      || !free(c, C.LIFTGATE, first - 1, shut + LIFTGATE_CLOSE_S + 1))) continue;
    cars.forEach((c, i) => {
      const close = stops[i] + hold;
      plan.cmd(c, C.LIFTGATE, stops[i] - RISE_S, stops[i] - RISE_S + 0.5, C.CLOSURE_OPEN, RISE_S);
      plan.cmd(c, C.LIFTGATE, stops[i], stops[i] + 0.3, C.CLOSURE_STOP, 0);
      plan.cmd(c, C.LIFTGATE, close, close + 0.5, C.CLOSURE_CLOSE, LIFTGATE_CLOSE_S);
    });
    return [m];
  }
  return [];
}

/** A Model X's falcon doors (see the module notes): they land on the peak a relay after the car before,
 * dance through it and close, all three of their commands or none. */
function doors(plan: Plan, peak: [number, number] | null): void {
  const { cars, an } = plan;
  if (!peak || flowsAt(an, peak[0])) return;
  cars.forEach((c, i) => {
    if (!c.falcon) return;
    const land = onBeat(an, peak[0] + i * relayWithin(an, FALCON_OPEN_S, peak[1] - peak[0], cars.length));
    const open = land - FALCON_OPEN_S - OPEN_MARGIN_S;
    const close = land + clip(peak[1] - land, 4, DOOR_DANCE_S) + 0.3;
    // after its windows have gone down, and shut in time for their last Open to follow
    const down = lowered(an, i, cars.length, true) + WINDOW_S + 0.5;
    if (open < down || close + FALCON_CLOSE_S + 0.5 > an.duration - 2.0) return;
    for (const door of [C.L_FALCON, C.R_FALCON]) {
      plan.cmd(c, door, open, open + 0.5, C.CLOSURE_OPEN, FALCON_OPEN_S);
      plan.cmd(c, door, land, close - 0.3, C.CLOSURE_DANCE);
      plan.cmd(c, door, close, close + 0.5, C.CLOSURE_CLOSE, FALCON_CLOSE_S);
    }
    plan.still.set(c, [[open - 0.5, close + FALCON_CLOSE_S + 0.5]]);
  });
}

/** The windows (see the module notes): fronts then rears down as the music starts, car by car from the
 * crowd's left; on the peak every window dances PEAK_DANCE_S, car after car; on other moments a burst - the
 * fronts dance, the rears half a burst later, the cars a relay apart within the moment's loud stretch, left
 * to right and then back - on the biggest moments at least a share of the song apart, so the bursts spread
 * over it; and after the last dance, down again. */
function windows(plan: Plan, peak: [number, number] | null, big: number[]): void {
  const { cars, an } = plan, n = cars.length, beat = beatLen(an), end = an.duration - DANCED_BY_S;
  const burst = beat * Math.max(2, Math.round(BURST_S / beat));
  const half = beat * Math.max(1, Math.round(burst / beat / 2));
  const moves = (c: Car, t0: number, t1: number) =>
    (plan.still.get(c) ?? []).every(([a, b]) => t1 + WINDOW_S <= a || t0 >= b);
  const fronts = [C.L_FRONT_WINDOW, C.R_FRONT_WINDOW], rears = [C.L_REAR_WINDOW, C.R_REAR_WINDOW];
  cars.forEach((c, i) => {
    for (const w of C.WINDOWS) {
      const t = lowered(an, i, n, rears.includes(w));
      plan.cmd(c, w, t, t + 0.5, C.CLOSURE_OPEN, WINDOW_S);
    }
  });
  const dances = peak && !flowsAt(an, peak[0]);
  if (dances) {
    // half a relay after each car's lid lands (lids), the last car still done in time
    const lag = relayWithin(an, WINDOW_S, peak[1] - peak[0], n);
    const late = Math.max(0, peak[0] + (n - 0.5) * lag + PEAK_DANCE_S - end);
    cars.forEach((c, i) => {
      const t0 = onBeat(an, peak[0] - late + (i + 0.5) * lag);
      if (!moves(c, t0, t0 + PEAK_DANCE_S + 1)) return;
      C.WINDOWS.forEach((w, j) => plan.cmd(c, w, t0 + 0.3 * j, t0 + 0.3 * j + PEAK_DANCE_S, C.CLOSURE_DANCE));
    });
  }
  // a window's six commands: down at the start, down again at the end, the peak's dance, and the bursts
  const most = C.CLOSURE_LIMITS[C.L_FRONT_WINDOW] - (dances ? 3 : 2), apart = an.duration / (most + 2);
  const times: number[] = [];
  // a burst only where the music keeps a groove through it, not on a landing that falls straight back to calm
  const carried = (m: number) => holds(an, m, 2) >= half + burst;
  for (const m of big) {
    if (times.length < most && carried(m) && times.every((u) => Math.abs(u - m) >= apart)) times.push(m);
  }
  times.sort((p, q) => p - q).forEach((m, k) => {
    const lag = relayWithin(an, WINDOW_S, holds(an, m, 2) - half - burst, n);
    cars.forEach((c, i) => {
      const t0 = onBeat(an, m + lag * (k % 2 ? n - 1 - i : i)), t1 = t0 + half + burst;
      if (t1 > end || !moves(c, t0, t1) || !C.WINDOWS.every((w) => free(c, w, t0 - 1, t1 + 1))) return;
      for (const w of fronts) plan.cmd(c, w, t0, t0 + burst, C.CLOSURE_DANCE);
      for (const w of rears) plan.cmd(c, w, t0 + half, t1, C.CLOSURE_DANCE);
    });
  });
  for (const c of cars) {
    const latest = an.duration - DOWN_BY_S - (n - 1 - c.x) * Math.min(beat, 1.0);
    for (const w of C.WINDOWS) {
      const last = plan.danced.get(`${c.x} ${w}`);
      if (last === undefined) continue;
      let t = last + 1.0;
      for (const [a, b] of plan.still.get(c) ?? []) if (t + WINDOW_S > a && t < b) t = b;
      plan.cmd(c, w, Math.min(latest, t), Math.min(latest, t) + 0.5, C.CLOSURE_OPEN, WINDOW_S);
    }
  }
}

/** The charge port's rainbow (Open, Dance, Close: its three commands) over the most exciting PORT_DANCE_S of
 * the song (the peak counting double, drive once), the cars its travel time apart from the crowd's left, so
 * the rainbows arrive and leave as a relay; none for a song that never drives. */
function port(plan: Plan): void {
  const { cars, an } = plan, lv = an.level!, w = Math.trunc(PORT_DANCE_S / an.step);
  const score = new Float64Array(lv.length + 1);
  for (let i = 0; i < lv.length; i++) score[i + 1] = score[i] + Math.max(0, stepOf(lv[i]) - 2);
  const lo = Math.trunc((PORT_S + 1.5) / an.step), hi = Math.trunc((an.duration - 6 - PORT_DANCE_S) / an.step);
  let best = -1, top = 0;
  for (let s = lo; s <= hi; s++) {
    if (score[s + w] - score[s] > top) [best, top] = [s, score[s + w] - score[s]];
  }
  if (best < 0) return;
  let a = best, b = best + w;
  while (a < b && stepOf(lv[a]) < 3) a++;
  while (b > a && stepOf(lv[b - 1]) < 3) b--;
  const t0 = onBeat(an, a * an.step), t1 = Math.min(b * an.step + 2, t0 + PORT_DANCE_S, an.duration - 6);
  if (t1 - t0 < 6) return;
  cars.forEach((c, i) => {
    const lag = onBeat(an, t0 + relay(PORT_S) * i) - t0;
    plan.cmd(c, C.CHARGE_PORT, t0 + lag - PORT_S - 0.5, t0 + lag - PORT_S, C.CLOSURE_OPEN, 0);
    plan.cmd(c, C.CHARGE_PORT, t0 + lag, t1 + lag, C.CLOSURE_DANCE, 0);
    plan.cmd(c, C.CHARGE_PORT, t1 + lag + 0.3, t1 + lag + 0.8, C.CLOSURE_CLOSE, 0);
  });
}

/** The mirrors: a fold-and-unfold figure on the downbeat nearest each big moment where nothing else moves,
 * then one in the middle of each stretch past the song's opening where the music beats and nothing has moved
 * for STILL_S (twice that where it is calm), the longest first, until none is left or the commands run
 * out. */
function mirrors(plan: Plan, big: number[]): void {
  const { cars, an } = plan;
  const line: [Car, number][] = cars.flatMap((c) => [[c, C.R_MIRROR], [c, C.L_MIRROR]] as [Car, number][]);
  const patterns = ['wave_lr', 'outside_in', 'wave_rl', 'inside_out', 'alternate'];
  const downbeat = (t: number) => an.downbeats.filter((d) => Math.abs(d - t) < 3)
    .reduce((p, d) => (Math.abs(d - t) < Math.abs(p - t) ? d : p), t);
  const beats = (t: number) => t > QUIET_START * an.duration && t < an.duration - 10
    && levelAt(an, t) >= CALM && !flowsAt(an, t);
  let k = 0;
  for (const m of [...big].sort((p, q) => p - q)) {
    if (!plan.moving[cars[0].fr(m)]) gesture(plan, line, downbeat(m), patterns[k++ % patterns.length]);
  }
  const tried = new Set<number>();
  for (; ; k++) {
    let best: [number, number] | null = null;
    for (let f = 0, a = -1; f <= plan.moving.length; f++) {
      if (f < plan.moving.length && !plan.moving[f] && beats(f * an.step)) {
        if (a < 0) a = f;
        continue;
      }
      const need = (t0: number, t1: number) => (levelOver(an, t0, t1) >= GROOVE ? STILL_S : 2 * STILL_S);
      if (a >= 0 && (f - a) * an.step >= need(a * an.step, f * an.step) && !tried.has(a)
        && (!best || f - a > best[1] - best[0])) best = [a, f];
      a = -1;
    }
    if (!best) return;
    tried.add(best[0]);
    gesture(plan, line, downbeat(((best[0] + best[1]) / 2) * an.step), patterns[k % patterns.length]);
  }
}

/** One fold-and-unfold figure across the line of mirrors from `t`, each mirror on its own moment:
 *   wave_lr / wave_rl        an eighth note apart, crowd-left to right / right to left
 *   outside_in / inside_out  from the ends to the middle / the middle outward, a beat a pair, the crowd's
 *                            left of each pair an eighth before its right
 *   alternate                every other mirror an eighth apart, then the rest as they unfold */
function gesture(plan: Plan, line: [Car, number][], t: number, pat: string): void {
  const an = plan.an, n = line.length, beat = beatLen(an), step = Math.max(0.2, beat / 2);
  const hold = beat * Math.ceil((MIRROR_S + 0.5) / beat);     // fold to unfold: whole beats, >= the 2 s fold
  const pair = (j: number) => (2 * j > n - 1 ? step : 0);
  line.forEach(([c, m], j) => {
    const lag = pat === 'wave_lr' ? j * step : pat === 'wave_rl' ? (n - 1 - j) * step
      : pat === 'outside_in' ? Math.min(j, n - 1 - j) * beat + pair(j)
        : pat === 'inside_out' ? (Math.floor(n / 2) - 1 - Math.min(j, n - 1 - j)) * beat + pair(j)
          : (j % 2) * hold + Math.floor(j / 2) * step;
    const a = t + lag, b = a + hold;
    if (b + 0.5 > an.duration - 3 || (c.closureCounts.get(m) ?? 0) + 2 > C.CLOSURE_LIMITS[m]) return;
    for (let f = c.fr(a - MIRROR_S); f < c.fr(b + MIRROR_S); f++) if (c.get(f, m)) return;
    plan.cmd(c, m, a, a + 0.4, C.CLOSURE_CLOSE, MIRROR_S);
    plan.cmd(c, m, b, b + 0.4, C.CLOSURE_OPEN, MIRROR_S);
  });
  const span = hold + (n - 1) * Math.max(step, beat) + MIRROR_S;
  plan.moving.fill(1, plan.cars[0].fr(t), plan.cars[0].fr(t + span));
}
