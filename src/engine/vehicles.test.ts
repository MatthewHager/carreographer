// Every lineup makes a show within Tesla's rules, on every test song: the closure command limits, no two
// cars' motors starting together, lids that dance only once fully open and are shut when the show ends,
// at most about 30 s of dancing per closure, a Model X's falcon doors with its windows still while they
// move, the lights dark at the end, and one file per car in order. And every lighting reads: a lamp lit at
// least 100 ms, dark between two lightings at least 60 ms, and dark where the music is silent.

import { describe, expect, it } from 'vitest';
import * as C from './channels';
import { choreograph } from './choreo';
import { FIXTURES, fixture } from './fixtures';
import { silence } from './level';
import { FALCON_CLOSE_S, LIFTGATE_CLOSE_S, LIFTGATE_OPEN_S, WINDOW_S } from './motors';
import { lineupCars, parseLineup, VEHICLES } from './vehicles';

// one to five cars, every letter, no truck, one truck in the middle or at either end, several trucks
const LINEUPS = ['Y', 'C', 'CY', 'YCY', 'yYC', 'CCC', 'SMXmB', 'YYCYY', 'CYyLX', 'BCYCB'];

const COMMANDS = new Set([C.CLOSURE_OPEN, C.CLOSURE_DANCE, C.CLOSURE_CLOSE]);
const KINDS = { lid: [C.LIFTGATE], windows: C.WINDOWS, mirrors: C.MIRRORS, port: [C.CHARGE_PORT],
  doors: [C.L_FALCON, C.R_FALCON] };

/** [start frame, end frame, value] of each command (a run of one non-zero value) on a channel. */
function commands(frames: Uint8Array, nFrames: number, ch: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let f = 0; f < nFrames; f++) {
    const v = frames[f * C.N_CHANNELS + ch];
    if (!v) continue;
    const last = out[out.length - 1];
    if (last && last[1] === f && last[2] === v) last[1] = f + 1;
    else out.push([f, f + 1, v]);
  }
  return out;
}

/** [start frame, end frame] of each lighting (a run at half or more) on a lamp's channel. */
function lit(frames: Uint8Array, nFrames: number, ch: number): [number, number][] {
  const out: [number, number][] = [];
  for (let f = 0; f < nFrames; f++) {
    if (frames[f * C.N_CHANNELS + ch] < 128) continue;
    const last = out[out.length - 1];
    if (last && last[1] === f) last[1] = f + 1;
    else out.push([f, f + 1]);
  }
  return out;
}

describe('vehicles', () => {
  it('knows every letter', () => {
    for (const letter of 'SMmXYyBLC') expect(parseLineup(letter)).toBe(letter);
    expect(lineupCars('XL').map(([name]) => name)).toEqual(['Car1_ModelX_Left', 'Car2_ModelYL_Right']);
    expect(() => parseLineup('Q')).toThrow(/unknown car letter/);
    expect(() => parseLineup('YYCYYY')).toThrow(/1 to 5 cars/);
    expect(new Set(Object.values(VEHICLES).map((v) => v.body)).size).toBe(Object.keys(VEHICLES).length);
  });
});

describe('every lineup keeps the rules', () => {
  for (const song of FIXTURES) {
    for (const lineup of LINEUPS) {
      it(`${song} ${lineup}`, () => {
        const an = fixture(song);
        const cars = choreograph(an, lineup), hush = silence(an);
        expect(cars.map((c) => c.name)).toEqual(lineupCars(lineup).map(([name]) => name));
        // no figure moves two cars at once: no kind of closure starts the same command on two cars at once
        const started = new Map<string, string>();
        for (const car of cars) {
          for (const [kind, chs] of Object.entries(KINDS)) {
            for (const ch of chs) {
              for (const [a, , v] of commands(car.frames, car.nFrames, ch)) {
                const key = `${kind} ${v} at ${(a * an.step).toFixed(2)} s`, other = started.get(key);
                expect(other === undefined || other === car.name, `${car.name} and ${other}: ${key}`).toBe(true);
                started.set(key, car.name);
              }
            }
          }
        }
        for (const car of cars) {
          const n = car.nFrames, step = an.step;
          expect(car.frames.length).toBe(n * C.N_CHANNELS);
          for (const [ch, limit] of Object.entries(C.CLOSURE_LIMITS)) {
            const cmds = commands(car.frames, n, Number(ch));
            const what = `${car.name} channel ${ch}`;
            expect(cmds.filter(([, , v]) => COMMANDS.has(v)).length, what).toBeLessThanOrEqual(limit);
            const dances = cmds.filter(([, , v]) => v === C.CLOSURE_DANCE);
            const dancing = dances.reduce((s, [a, b]) => s + (b - a) * step, 0);
            expect(dancing, `${what} dances`).toBeLessThanOrEqual(30);
          }
          let opened = -Infinity;
          for (const [a, , v] of commands(car.frames, n, C.LIFTGATE)) {
            if (v === C.CLOSURE_OPEN) opened = a * step;
            if (v === C.CLOSURE_CLOSE) {
              opened = -Infinity;
              expect(a * step + LIFTGATE_CLOSE_S, `${car.name} lid still closing at the end`)
                .toBeLessThanOrEqual(n * step);
            }
            if (v === C.CLOSURE_DANCE) {
              expect(a * step - opened, `${car.name} lid dances before it is open`)
                .toBeGreaterThanOrEqual(LIFTGATE_OPEN_S[car.kind]);
            }
          }
          expect(opened, `${car.name} lid left open at the end`).toBe(-Infinity);
          for (let ch = 0; ch < C.L_FALCON; ch++) expect(car.get(n - 1, ch), `${car.name} lamp ${ch}`).toBe(0);
          for (let ch = 0; ch < C.L_FALCON; ch++) {
            let last = -Infinity;
            for (const [a, b] of lit(car.frames, n, ch)) {
              const at = `${car.name} lamp ${ch} at ${(a * step).toFixed(2)} s`;
              for (let f = a; f < b; f++) expect(hush[f], `${at}: lit in a silence`).toBe(0);
              if (b < n - 3 && !hush[b]) expect(b - a, `${at}: lit under 100 ms`).toBeGreaterThanOrEqual(5);
              expect(a - last, `${at}: dark under 60 ms`).toBeGreaterThanOrEqual(3);
              last = b;
            }
          }
          // the doors need a peak with 20 s before it and room after (the build has one): all or nothing
          const falcon = commands(car.frames, n, C.L_FALCON);
          if (!car.falcon || !falcon.length) {
            expect(falcon).toEqual([]);
            continue;
          }
          expect(falcon.map(([, , v]) => v)).toEqual([C.CLOSURE_OPEN, C.CLOSURE_DANCE, C.CLOSURE_CLOSE]);
          const from = falcon[0][0] * step, to = falcon[2][0] * step + FALCON_CLOSE_S;
          for (const w of C.WINDOWS) {
            for (const [f] of commands(car.frames, n, w)) {
              const t = f * step;
              expect(t + WINDOW_S <= from || t >= to, `${car.name} window ${w} at ${t.toFixed(1)} s`).toBe(true);
            }
          }
        }
      });
    }
  }
});
