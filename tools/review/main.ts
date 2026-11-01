// npm run review -- SONG [--lineup YCY] [--colours party] [--from S] [--to S] [--out DIR] [--video] [--fresh]
//
// Makes a song's show in Node the way the page's worker does (show.worker.ts), then writes what it looks
// like: timeline pictures, a text summary, the show files and, with --video, the 3D preview playing it
// with the sound. See README.md.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { STEP_MS } from '@/engine/channels';
import { makeShow } from '@/engine/choreo';
import { builds, drops } from '@/engine/moments';
import { SCHEMES, type SchemeId } from '@/engine/schemes';
import { analyze } from '@/engine/listen/audio';
import { trackBeats } from '@/engine/listen/beats';
import { transcribe } from '@/engine/listen/notes';
import { mixdown, monoAt22050 } from '@/engine/listen/resample';
import { parseLineup } from '@/engine/vehicles';
import { fileName, showFile } from '@/app/show';
import { readWav } from '@/app/wav';
import { carView } from './stage';
import { summarize } from './summary';
import { drawTimeline, type Review } from './timeline';
import { recordVideo } from './video';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MODELS = path.join(ROOT, 'public/models');
const BREW_FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFMPEG = process.env.FFMPEG ?? (existsSync(BREW_FFMPEG) ? BREW_FFMPEG : 'ffmpeg');

const USAGE = `npm run review -- SONG [options]
  --lineup YCY     the cars, crowd's left to right (default YCY)
  --colours NAME   the cabins' colour scheme: party (the default), halloween, christmas, july4, valentines
  --from S --to S  the stretch to draw and film, in seconds (the show is always made for the whole song)
  --stretch S      seconds per timeline picture (default 30)
  --out DIR        where to write (default review-out/<song>/ at the top of the checkout)
  --video          film the 3D preview with the sound (video.mp4), from --from to --to
  --fps N          the video's frame rate (default 30)
  --camera NAME    Stage (the crowd's view of the whole lineup, close up: the default), Front, 3/4, Rear
                   or Top
  --fresh          listen again rather than reuse the beats and notes heard last time`;

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The song's first two channels at 44.1 kHz: a 44.1 kHz WAV as it is, as the page reads it; anything else
 * through ffmpeg (where the page uses the browser's decoder, so an MP3's show can differ a little). */
function decode(file: string, bytes: Buffer): { channels: Float32Array[]; sampleRate: number } {
  const pcm = readWav(ab(bytes));
  if (pcm?.sampleRate === 44100) return pcm;
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'],
    { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new Error(`ffmpeg couldn't decode ${file}: ${r.stderr?.toString() || r.error}`);
  const all = new Float32Array(ab(r.stdout));
  const n = all.length / 2;
  const channels = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    channels[0][i] = all[2 * i];
    channels[1][i] = all[2 * i + 1];
  }
  return { channels, sampleRate: 44100 };
}

/** Beats and notes, as the page's worker hears them (ONNX Runtime on WASM, one thread), kept in
 * cacheDir by the samples' hash: the slow part, and the same every time for the same song. */
interface Heard {
  beats: { beats: number[]; downbeats: number[] };
  notes: number[][];
}

async function listen(y: Float32Array, cacheDir: string, fresh: boolean): Promise<Heard> {
  const model = (name: string) => path.join(MODELS, name);
  const beatModel = model('beat_this-final0-fp16w.onnx'), noteModel = model('basic_pitch-nmp.onnx');
  for (const m of [beatModel, noteModel]) {
    if (!existsSync(m)) {
      throw new Error(`${m} is missing: npm run assets`);
    }
  }
  const hash = createHash('sha256').update(new Uint8Array(y.buffer, y.byteOffset, y.byteLength))
    .update(`${statSync(beatModel).size} ${statSync(noteModel).size}`).digest('hex').slice(0, 16);
  const cached = path.join(cacheDir, `${hash}.json`);
  if (!fresh && existsSync(cached)) {
    console.log('Listening: reusing what was heard last time (--fresh to listen again)');
    return JSON.parse(readFileSync(cached, 'utf8')) as Heard;
  }
  const tty = process.stdout.isTTY;
  const bar = (step: string) => (f: number) => tty && process.stdout.write(`\r${step} ${Math.round(f * 100)}%   `);
  if (!tty) console.log('Listening: beats, then notes (a minute or two)');
  const t = Date.now();
  const beats = await trackBeats(y,
    { backend: 'wasm', model: ab(readFileSync(beatModel)), onProgress: bar('Finding the beat') });
  const notes = await transcribe(y,
    { backend: 'wasm', model: ab(readFileSync(noteModel)), onProgress: bar('Hearing the notes') });
  process.stdout.write(`${tty ? '\r' : ''}Listened in ${((Date.now() - t) / 1000).toFixed(0)} s${' '.repeat(20)}\n`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, JSON.stringify({ beats, notes }));
  return { beats, notes };
}

export async function main(argv: string[]): Promise<number> {
  const { values: o, positionals } = parseArgs({
    args: argv, allowPositionals: true, options: {
      lineup: { type: 'string', default: 'YCY' }, colours: { type: 'string', default: 'party' }, from: { type: 'string' }, to: { type: 'string' },
      stretch: { type: 'string', default: '30' }, out: { type: 'string' }, video: { type: 'boolean' },
      fps: { type: 'string', default: '30' }, camera: { type: 'string', default: 'Stage' },
      fresh: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (o.help || positionals.length !== 1) {
    console.log(USAGE);
    return o.help ? 0 : 1;
  }
  const song = path.resolve(positionals[0]);
  const lineup = parseLineup(o.lineup!);
  const scheme = o.colours as SchemeId;
  if (!(scheme in SCHEMES)) throw new Error(`--colours ${scheme}: one of ${Object.keys(SCHEMES).join(', ')}`);
  const title = path.basename(song).replace(/\.[^.]+$/, '');
  const outRoot = path.join(ROOT, 'review-out');
  const named = `${fileName(title)}_${lineup}${scheme === 'party' ? '' : `_${scheme}`}`;
  const out = path.resolve(o.out ?? path.join(outRoot, named));
  mkdirSync(out, { recursive: true });
  // what an earlier run left (another stretch, another lineup's cars) would be mistaken for this show
  for (const f of readdirSync(out)) if (/^timeline_.*\.png$|^video\.mp4$/.test(f)) rmSync(path.join(out, f));
  const shows = path.join(out, 'show');
  for (const f of existsSync(shows) ? readdirSync(shows) : []) {
    if (/^Car\d.*\.fseq$/.test(f)) rmSync(path.join(shows, f));
  }
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(path.join(outRoot, '.gitignore'), '# made by tools/review: never committed\n*\n');

  const bytes = readFileSync(song);
  const { channels, sampleRate } = decode(song, bytes);
  // as pipeline.ts and show.worker.ts do: mixed down first, then to 22050 Hz
  const y = monoAt22050([mixdown(channels)], sampleRate);
  const heard = await listen(y, path.join(outRoot, '.listen'), !!o.fresh);     // shared, whatever --out says
  const listened = analyze(y, { stepMs: STEP_MS, notes: heard.notes, neuralBeats: heard.beats });
  const t = Date.now();
  const { cars, an } = makeShow(listened, lineup, scheme);     // the analysis as the show used it
  console.log(`Choreographed in ${Date.now() - t} ms`);

  mkdirSync(path.join(out, 'show'), { recursive: true });
  for (const c of cars) {
    writeFileSync(path.join(out, 'show', `${c.name}.fseq`), showFile(c.frames, an.nFrames, fileName(title)));
  }
  const views = cars.map((c, i) => carView(c.name, lineup[i], c.frames, an.nFrames));
  const review: Review = { title, lineup, an, notes: heard.notes, cars: views };
  // the per-frame curves every fifth frame (10 a second), rounded: enough to read, small enough to load
  const tenth = (c: ArrayLike<number> | undefined) =>
    c && Array.from({ length: Math.ceil(c.length / 5) }, (_, i) => Math.round(c[i * 5] * 100) / 100);
  writeFileSync(path.join(out, 'show.json'), JSON.stringify({
    title, lineup, duration: an.duration, tempo: an.tempo, beatScore: an.beatScore,
    sections: an.sections, phrases: an.phrases, beats: an.beats,
    downbeats: an.downbeats, hits: an.hits, builds: builds(an), drops: drops(an),
    curves: { hz: 10, loudness: tenth(an.loudness), level: tenth(an.level) },
    drums: { kick: an.kick, snare: an.snare, hats: an.hats },
  }, null, 1));

  const from = Math.max(0, Number(o.from ?? 0)), to = Math.min(an.duration, Number(o.to ?? an.duration));
  if (!(to > from)) throw new Error(`--from ${from} --to ${to}: nothing to draw`);
  const stretch = Math.max(1, Number(o.stretch));
  const pictures: string[] = [];
  const stamp = (s: number) => String(Math.floor(s)).padStart(4, '0');      // as the picture's own clock
  const pieces = Math.max(1, Math.round((to - from) / stretch));     // even stretches: no stub at the end
  for (let k = 0; k < pieces; k++) {
    const a = from + ((to - from) * k) / pieces, b = from + ((to - from) * (k + 1)) / pieces;
    const file = path.join(out, `timeline_${stamp(a)}-${stamp(b)}.png`);
    writeFileSync(file, drawTimeline(review, a, b, 50));
    pictures.push(file);
  }
  const overview = drawTimeline(review, 0, an.duration, Math.min(50, 1500 / an.duration));
  writeFileSync(path.join(out, 'overview.png'), overview);
  const text = summarize(review, cars.map((c) => c.frames));
  writeFileSync(path.join(out, 'summary.txt'), text);
  console.log('\n' + text);
  if (o.video) {
    const file = path.join(out, 'video.mp4');
    await recordVideo({
      root: ROOT, song, lineup, nFrames: an.nFrames, frames: cars.map((c) => c.frames), from, to,
      fps: Number(o.fps), camera: o.camera!, file, ffmpeg: FFMPEG,
    });
    console.log(`Video: ${file}`);
  }
  console.log(`Wrote ${out}: overview.png, ${pictures.length} timeline picture(s), summary.txt, show.json, `
    + 'show/*.fseq');
  return 0;
}
