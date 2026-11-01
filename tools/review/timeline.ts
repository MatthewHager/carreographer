// The timeline picture: time across; a band of rows per car (every lamp the crowd sees, the front bar's
// pixels, the closures, the cabin), then the music the lights answer (sections, phrases and their moves,
// loudness, beats, bass and treble hits, notes). One picture per stretch of the song, and an overview.

import type { Analysis, Phrase } from '@/engine/analysis';
import { STEP_MS } from '@/engine/channels';
import { STEP_NAMES, stepOf } from '@/engine/level';
import { builds, drops } from '@/engine/moments';
import { dim, mix, Picture, type Rgb } from './image';
import type { CarView, Row } from './stage';

export interface Review {
  title: string;
  lineup: string;
  an: Analysis;
  notes: number[][];        // [start s, end s, midi, amplitude]
  cars: CarView[];
}

const STEP = STEP_MS / 1000;
const GUTTER = 168, RIGHT = 12, PITCH = 10;
const WHITE: Rgb = [255, 255, 255], TEXT: Rgb = [200, 200, 205], FAINT: Rgb = [120, 120, 130];
const BG: Rgb = [14, 14, 18], ROW_BG: Rgb = [24, 24, 30], DANCING: Rgb = [255, 60, 220];
/** A phrase's step by its level (level.ts). */
export const stepName = (p: Phrase) => STEP_NAMES[stepOf(p.level ?? 0)];
const STEP_SHADES: Rgb[] = [[40, 50, 90], [40, 60, 115], [35, 100, 60], [140, 95, 20], [150, 35, 35]];
const STEP_COLORS: Rgb[] = [[60, 70, 110], [70, 90, 140], [40, 160, 150], [230, 150, 40], [235, 60, 50]];
const SECTION_COLORS: Rgb[] = [[70, 70, 120], [110, 70, 50], [50, 100, 90], [110, 60, 110], [90, 100, 40],
  [60, 90, 130], [120, 80, 80], [70, 110, 60]];

interface Band {
  h: number;
  label?: string;
  draw: (y: number) => void;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** The mean of a per-frame curve over [t0, t1) seconds. */
export function meanOf(c: ArrayLike<number> | undefined, t0: number, t1: number): number {
  if (!c?.length) return 0;
  const a = Math.min(Math.trunc(t0 / STEP), c.length - 1), b = Math.min(Math.max(a + 1, Math.trunc(t1 / STEP)), c.length);
  let m = 0;
  for (let i = a; i < b; i++) m += c[i];
  return m / (b - a);
}

/** Beats a minute, from the tracked beats' mean spacing. */
export function bpm(beats: number[]): number {
  return beats.length > 1 ? (60 * (beats.length - 1)) / (beats.at(-1)! - beats[0]) : 0;
}

/** The show from t0 to t1 seconds at pxPerS pixels a second (50 is one pixel per 20 ms frame). */
export function drawTimeline(r: Review, t0: number, t1: number, pxPerS: number): Buffer {
  const { an } = r;
  const plotW = Math.ceil((t1 - t0) * pxPerS);
  const W = GUTTER + plotW + RIGHT;
  const X = (t: number) => GUTTER + (t - t0) * pxPerS;
  // the frames under each pixel column: a flash shorter than a column still shows
  const fa = new Int32Array(plotW), fb = new Int32Array(plotW);
  for (let x = 0; x < plotW; x++) {
    fa[x] = Math.floor((t0 + x / pxPerS) / STEP + 1e-6);
    fb[x] = Math.max(fa[x] + 1, Math.floor((t0 + (x + 1) / pxPerS) / STEP + 1e-6));
  }
  const colMax = (s: ArrayLike<number>, x: number) => {
    let m = 0;
    for (let f = fa[x]; f < fb[x] && f < s.length; f++) if (s[f] > m) m = s[f];
    return m;
  };
  const inView = (t: number) => t >= t0 && t < t1;
  const beats = an.beats.filter(inView), downs = an.downbeats.filter(inView);
  const grid = (y: number, h: number) => {
    if (pxPerS >= 20) for (const t of beats) pic.rect(X(t), y, 1, h, [34, 34, 42]);
    if (pxPerS >= 8) for (const t of downs) pic.rect(X(t), y, 1, h, [52, 52, 64]);
  };
  const lane = (y: number, h: number) => pic.rect(GUTTER, y, plotW, h, ROW_BG);

  const bands: Band[] = [];
  let pic!: Picture;

  // --- the header and the clock ---
  const sec = an.sections ?? [];
  const head = `${r.title} · ${r.lineup} · ${clock(t0)}-${clock(t1)} · ${Math.round(bpm(an.beats))} bpm · `
    + `beat score ${an.beatScore.toFixed(1)} · ${sec.length} sections`;
  bands.push({ h: 14, draw: (y) => pic.text(4, y + 3, head, WHITE) });
  bands.push({ h: 12, draw: (y) => pic.text(4, y + 2, "Pairs: upper half = crowd's left, lower half = crowd's "
    + 'right. Closures: brightness = how open, magenta = dancing. Grid: beats, brighter on downbeats.', FAINT) });
  const every = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pxPerS >= 60) ?? 60;
  bands.push({ h: 14, draw: (y) => {
    for (let s = Math.ceil(t0); s < t1; s++) {
      pic.rect(X(s), y + 9, 1, 5, s % every === 0 ? TEXT : FAINT);
      if (s % every === 0) pic.text(X(s) + 2, y, clock(s), TEXT);
    }
  } });

  // --- the music's form, and the move each phrase got ---
  const span = (y: number, a0: number, a1: number, c: Rgb, text: string) => {
    const a = X(Math.max(t0, a0)), b = X(Math.min(t1, a1));
    pic.rect(a, y, b - a, PITCH, c);
    pic.rect(a, y, 1, PITCH, [0, 0, 0]);
    pic.text(a + 3, y + 1, text, WHITE, b - a - 4);
  };
  bands.push({ h: PITCH + 2, label: 'section, level', draw: (y) => {
    for (const s of sec) {
      const c = SECTION_COLORS[s.letter.charCodeAt(0) % SECTION_COLORS.length];
      if (s.t1 > t0 && s.t0 < t1) span(y, s.t0, s.t1, c, `${s.letter} ${meanOf(an.level, s.t0, s.t1).toFixed(2)}`);
    }
  } });
  const phrases = (an.phrases ?? []).filter((p) => p.t1 > t0 && p.t0 < t1);
  const phraseBand = (text: (p: (typeof phrases)[number]) => string) => (y: number) => phrases.forEach((p, i) => {
    const c = STEP_SHADES[stepOf(p.level ?? 0)];
    span(y, p.t0, p.t1, i % 2 ? c : mix(c, [0, 0, 0], 0.3), text(p));
  });
  bands.push({ h: PITCH, label: 'move', draw: phraseBand((p) => p.move ?? '') });
  bands.push({ h: PITCH + 4, label: 'step, gesture', draw: phraseBand((p) => `${stepName(p)} · ${p.gesture}`) });

  // --- the cars ---
  for (const car of r.cars) {
    bands.push({ h: 13, draw: (y) => {
      pic.rect(0, y + 2, W, 11, [36, 36, 46]);
      pic.text(4, y + 4, `${car.name} (${car.letter})`, WHITE);
    } });
    for (const row of car.rows) bands.push(rowBand(row));
    bands.push({ h: 4, draw: () => {} });
  }

  function rowBand(row: Row): Band {
    const n = row.series.length;
    const h = row.kind === 'pixels' ? n * (n >= 30 ? 1 : 2) : PITCH;
    const lh = row.kind === 'pixels' ? h : PITCH - 1;
    // a lamp's two sides as halves; a bar's pixels as rows of their own
    const top = (k: number) => (row.kind === 'pixels' ? (k * h) / n : n === 2 ? k * 5 : 0);
    const height = row.kind === 'pixels' ? h / n : n === 2 ? 4 : lh;
    return { h, label: row.label, draw: (y) => {
      lane(y, lh);
      grid(y, lh);
      for (let x = 0; x < plotW; x++) {
        if (row.rgb) {
          const c: [number, number, number] = [0, 0, 0];
          for (let f = fa[x]; f < fb[x] && f * 3 < row.rgb.length; f++) {
            for (let k = 0; k < 3; k++) c[k] = Math.max(c[k], row.rgb[f * 3 + k]);
          }
          if (c[0] + c[1] + c[2] > 6) pic.rect(GUTTER + x, y, 1, lh, c);
          continue;
        }
        row.series.forEach((s, k) => {
          const v = colMax(s, x);
          if (v <= 0.01) return;
          const dancing = row.dancing && colMax(row.dancing[k], x) > 0;
          pic.rect(GUTTER + x, y + top(k), 1, height, dancing ? DANCING : dim(row.color, v));
        });
      }
    } };
  }

  // --- the music ---
  bands.push({ h: 6, draw: (y) => pic.rect(0, y + 2, W, 1, [60, 60, 70]) });
  bands.push({ h: 40, label: 'loudness, level', draw: (y) => {
    lane(y, 39);
    for (let x = 0; x < plotW; x++) {
      const v = colMax(an.loudness, x), lv = an.level ? colMax(an.level, x) : 0;
      const hh = Math.round(v * 38);
      pic.rect(GUTTER + x, y + 39 - hh, 1, hh, STEP_COLORS[stepOf(lv)]);
      if (an.level) pic.set(GUTTER + x, y + 39 - Math.round(lv * 38), [235, 235, 235]);
    }
    for (const t of an.hits.filter(inView)) pic.rect(X(t), y, 1, 5, WHITE);
  } });
  const strip = (label: string, s: ArrayLike<number> | undefined, c: Rgb) => s && bands.push({ h: PITCH, label,
    draw: (y) => {
      lane(y, PITCH - 1);
      for (let x = 0; x < plotW; x++) {
        const v = colMax(s, x);
        if (v > 0.01) pic.rect(GUTTER + x, y, 1, PITCH - 1, dim(c, v));
      }
    } });
  strip('beat confidence', an.beatConfidence, [120, 220, 140]);
  strip('kit', an.kit, [200, 140, 255]);
  bands.push({ h: PITCH, label: 'builds, drops', draw: (y) => {
    lane(y, PITCH - 1);
    for (const [a, b] of builds(an)) {
      if (b <= t0 || a >= t1) continue;
      const xa = X(Math.max(a, t0)), xb = X(Math.min(b, t1));
      for (let x = Math.floor(xa); x < xb; x++) {
        pic.rect(x, y, 1, PITCH - 1, dim([255, 220, 60], 0.2 + (0.8 * (t0 + (x - GUTTER) / pxPerS - a)) / (b - a)));
      }
    }
    for (const d of drops(an).filter(inView)) pic.rect(X(d) - 1, y, 3, PITCH - 1, WHITE);
  } });
  bands.push({ h: 12, label: 'beats, downbeats', draw: (y) => {
    lane(y, 11);
    for (const t of beats) pic.rect(X(t), y + 5, 1, 6, FAINT);
    for (const t of downs) pic.rect(X(t), y, 1, 11, WHITE);
  } });
  const ticks = (label: string, rows: number[][], c: Rgb) => bands.push({ h: PITCH, label, draw: (y) => {
    lane(y, PITCH - 1);
    for (const [t, v] of rows) if (inView(t)) pic.rect(X(t), y, Math.max(1, pxPerS * 0.04), PITCH - 1, dim(c, v));
  } });
  ticks('kick', an.kick, [255, 110, 50]);
  ticks('snare, clap, snap', an.snare, [255, 200, 60]);
  ticks('hats', an.hats, [80, 200, 255]);

  // the piano roll: every transcribed note, the melody the moves follow as red dots
  const notes = r.notes.filter((n) => n[1] > t0 && n[0] < t1);
  const pitches = r.notes.length ? r.notes.map((n) => n[2]) : [60];
  const lo = Math.max(21, Math.min(...pitches) - 1), hi = Math.min(108, Math.max(...pitches) + 1);
  const pps = hi - lo <= 72 ? 2 : 1, rollH = (hi - lo + 1) * pps;
  bands.push({ h: rollH + 2, draw: (y) => {
    const Y = (p: number) => y + (hi - p) * pps;
    lane(y, rollH);
    grid(y, rollH);
    for (let p = Math.ceil(lo / 12) * 12; p <= hi; p += 12) {
      pic.rect(GUTTER, Y(p), plotW, 1, [48, 48, 58]);
      pic.text(GUTTER - 30, Y(p) - 4, `C${p / 12 - 1}`, FAINT);
    }
    for (const p of [an.pitchLo, an.pitchHi]) if (p >= lo && p <= hi) pic.rect(GUTTER, Y(p), plotW, 1, [90, 30, 30]);
    for (const [s, e, p, a] of notes) {
      const x0 = X(Math.max(t0, s)), x1 = Math.max(x0 + 1, X(Math.min(t1, e)));
      pic.rect(x0, Y(p), x1 - x0, pps, mix([40, 60, 130], [220, 230, 255], Math.min(1, a * 1.4)));
    }
    const ev = an.events;
    for (let i = 0; i < ev.t.length; i++) {
      if (inView(ev.t[i])) pic.rect(X(ev.t[i]), Y(ev.top[i]) - 1, 2, 1 + pps, [255, 50, 50]);
    }
    pic.text(4, y + 2, 'notes', TEXT);
    pic.text(4, y + 12, 'red: melody', [255, 90, 90]);
    pic.text(4, y + 22, 'dark red:', [170, 70, 70]);
    pic.text(4, y + 32, 'stage range', [170, 70, 70]);
  } });
  pic = new Picture(W, bands.reduce((s, b) => s + b.h, 0) + 6, BG);
  let y = 2;
  for (const b of bands) {
    if (b.label) pic.text(4, y + 1, b.label, TEXT, GUTTER - 8);
    b.draw(y);
    y += b.h;
  }
  return pic.png();
}
