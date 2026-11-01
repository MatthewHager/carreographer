// The show in words, for whoever can't look at it: per section, the moves chosen and how busy each car's
// lights are, and when the motors move.

import * as C from '@/engine/channels';
import { CLOSURE_CLOSE, CLOSURE_DANCE, CLOSURE_LIMITS, CLOSURE_OPEN, CLOSURE_STOP, N_CHANNELS } from '@/engine/channels';
import { bpm, meanOf, type Review, stepName } from './timeline';

const STEP = C.STEP_MS / 1000;
const NEAR = 3;                 // frames (60 ms) either side of a beat or a note that count as "on" it

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

/** Per frame of one car: is anything lit, how much light, and does a lamp switch on there. */
function busy(lamps: Float32Array[], n: number) {
  const lit = new Uint8Array(n), mass = new Float32Array(n), onset = new Uint8Array(n);
  for (const s of lamps) {
    for (let f = 0; f < n; f++) {
      if (s[f] >= 0.5) lit[f] = 1;
      mass[f] += s[f] / lamps.length;
      if (f > 0 && s[f] >= 0.5 && s[f - 1] < 0.5) onset[f] = 1;
    }
  }
  return { lit, mass, onset };
}

/** Frames within NEAR of any of the times. */
function nearMask(times: number[], n: number): Uint8Array {
  const m = new Uint8Array(n);
  for (const t of times) {
    const f = Math.round(t / STEP);
    for (let g = Math.max(0, f - NEAR - 1); g <= Math.min(n - 1, f + NEAR); g++) m[g] = 1;   // lights lead a frame
  }
  return m;
}

const CLOSURE_NAMES: Record<number, string> = {
  [C.LIFTGATE]: 'liftgate', [C.L_MIRROR]: 'mirror cR', [C.R_MIRROR]: 'mirror cL', [C.CHARGE_PORT]: 'charge port',
  [C.L_FRONT_WINDOW]: 'window front cR', [C.L_REAR_WINDOW]: 'window rear cR', [C.R_FRONT_WINDOW]: 'window front cL',
  [C.R_REAR_WINDOW]: 'window rear cL', [C.L_FALCON]: 'falcon cR', [C.R_FALCON]: 'falcon cL',
  [C.L_FRONT_DOOR]: 'front door cR', [C.R_FRONT_DOOR]: 'front door cL',
};
const COMMANDS: Record<number, string> = {
  [CLOSURE_OPEN]: 'open', [CLOSURE_DANCE]: 'dance', [CLOSURE_CLOSE]: 'close', [CLOSURE_STOP]: 'stop',
};

/** The text summary. frames: each car's show bytes (for the motor commands). */
export function summarize(r: Review, frames: Uint8Array[]): string {
  const { an } = r;
  const n = an.nFrames;
  const out: string[] = [];
  const onBeat = nearMask(an.beats, n), onNote = nearMask(an.events.t, n);
  const stats = r.cars.map((c) => busy(c.lamps, n));
  out.push(`${r.title} · lineup ${r.lineup} · ${clock(an.duration)} · ${bpm(an.beats).toFixed(0)} bpm · `
    + `beat score ${an.beatScore.toFixed(2)} (2+ = a beat to follow) · `
    + `${an.events.t.length} note events · ${(an.phrases ?? []).length} phrases`);
  out.push('Per car: lit = frames with any lamp at half or more; light = mean level of all its lamps; '
    + 'flashes/s = frames where a lamp switches on; on beat / on note = share of those within 60 ms of one.');

  const line = (label: string, f0: number, f1: number) => {
    const span = Math.max(1, f1 - f0), secs = span * STEP;
    const loud = meanOf(an.loudness, f0 * STEP, f1 * STEP), level = meanOf(an.level, f0 * STEP, f1 * STEP);
    const bps = an.beats.filter((t) => t >= f0 * STEP && t < f1 * STEP).length / secs;
    out.push(`${label}  music: loudness ${loud.toFixed(2)}, level ${level.toFixed(2)}, ${bps.toFixed(1)} beats/s`);
    r.cars.forEach((car, i) => {
      const s = stats[i];
      let lit = 0, mass = 0, on = 0, beat = 0, note = 0;
      for (let f = f0; f < f1; f++) {
        lit += s.lit[f];
        mass += s.mass[f];
        if (s.onset[f]) {
          on++;
          beat += onBeat[f];
          note += onNote[f];
        }
      }
      out.push(`    ${car.name.padEnd(26)} lit ${pct(lit / span)}  light ${(mass / span).toFixed(2)}  `
        + `flashes ${(on / secs).toFixed(1).padStart(4)}/s  on beat ${on ? pct(beat / on) : '   -'}  `
        + `on note ${on ? pct(note / on) : '   -'}`);
    });
  };

  line('WHOLE SONG', 0, n);

  // does the light follow the song's arc? the music's loudness against each car's light, 10 s at a time
  out.push('');
  out.push('ARC (every 10 s: loudness and the show\'s level, then each car\'s light and flashes/s)');
  const W = 10 / STEP;
  for (let f0 = 0; f0 < n; f0 += W) {
    const f1 = Math.min(n, f0 + W), span = f1 - f0;
    const loud = meanOf(an.loudness, f0 * STEP, f1 * STEP), level = meanOf(an.level, f0 * STEP, f1 * STEP);
    const cars = stats.map((s) => {
      let mass = 0, on = 0;
      for (let f = f0; f < f1; f++) {
        mass += s.mass[f];
        on += s.onset[f];
      }
      return `${(mass / span).toFixed(2)} ${(on / (span * STEP)).toFixed(1).padStart(4)}/s`;
    });
    out.push(`    ${clock(f0 * STEP)}  loudness ${loud.toFixed(2)} level ${level.toFixed(2)}  |  ${cars.join('  |  ')}`);
  }

  for (const s of an.sections ?? []) {
    out.push('');
    out.push(`SECTION ${s.letter} (${s.nth ? `heard ${s.nth + 1}x` : 'first'})  ${clock(s.t0)}-${clock(s.t1)}  `
      + `level ${meanOf(an.level, s.t0, s.t1).toFixed(2)}`);
    const phrases = (an.phrases ?? []).filter((p) => p.t0 >= s.t0 - 1e-6 && p.t0 < s.t1);
    for (const p of phrases) {
      out.push(`    ${clock(p.t0)}  ${(p.t1 - p.t0).toFixed(1).padStart(4)} s  ${stepName(p).padEnd(6)} `
        + `${p.gesture.padEnd(10)} ${p.move ?? ''}`);
    }
    line('  ', Math.round(s.t0 / STEP), Math.min(n, Math.round(s.t1 / STEP)));
  }

  out.push('');
  out.push('MOTORS (commands; Tesla allows liftgate/windows 6, mirrors 20, port 3 per show)');
  r.cars.forEach((car, i) => {
    const cmds: [number, string][] = [];
    const used = new Map<number, number>();
    for (const ch of Object.keys(CLOSURE_LIMITS).map(Number)) {
      let last = 0;
      for (let f = 0; f < n; f++) {
        const v = frames[i][f * N_CHANNELS + ch];
        if (v !== last && COMMANDS[v]) {
          cmds.push([f, `${clock(f * STEP)} ${CLOSURE_NAMES[ch]} ${COMMANDS[v]}`]);
          if (v !== CLOSURE_STOP) used.set(ch, (used.get(ch) ?? 0) + 1);
        }
        last = v;
      }
    }
    cmds.sort((a, b) => a[0] - b[0]);
    const counts = [...used].map(([ch, k]) => `${CLOSURE_NAMES[ch]} ${k}/${CLOSURE_LIMITS[ch]}`).join(', ');
    out.push(`    ${car.name}: ${counts || 'none'}`);
    for (const [, c] of cmds) out.push(`        ${c}`);
  });
  return out.join('\n') + '\n';
}
