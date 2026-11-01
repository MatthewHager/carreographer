// --video: films the 3D preview (film.html, served by Vite) moment by moment with Playwright's Chromium,
// and muxes the song under it with ffmpeg. Stepping rather than recording in real time keeps every frame
// of the film on its moment of the show, however slowly the machine draws.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

interface Film {
  root: string;
  song: string;
  lineup: string;
  nFrames: number;
  frames: Uint8Array[];
  from: number;
  to: number;
  fps: number;
  camera: string;
  file: string;
  ffmpeg: string;
}

// the little of Playwright's API used here (it has its own types, but isn't installed with the app)
interface Page {
  on(event: 'pageerror', f: (e: Error) => void): void;
  route(url: string, f: (route: Route) => Promise<void>): Promise<void>;
  goto(url: string): Promise<unknown>;
  waitForFunction(f: () => boolean, arg: null, opts: { timeout: number }): Promise<unknown>;
  evaluate<A>(f: (arg: A) => Promise<void>, arg: A): Promise<void>;
  screenshot(opts: { type: 'jpeg'; quality: number }): Promise<Buffer>;
}
interface Route {
  request(): { url(): string };
  fulfill(r: { body: Buffer; contentType: string }): Promise<void>;
}
interface Playwright {
  chromium: { launch(o: { args: string[] }): Promise<{ newPage(o: object): Promise<Page>; close(): Promise<void> }> };
}
interface FilmPage {
  film: { load(lineup: string, n: number, camera: string): Promise<void>; seek(t: number): Promise<void> };
}

/** Playwright isn't one of the app's dependencies: the one Node finds, else the one REVIEW_PLAYWRIGHT
 * names (a path to its package folder). */
function playwright(root: string): Playwright {
  const req = createRequire(path.join(root, 'package.json'));
  const where = process.env.REVIEW_PLAYWRIGHT;
  try {
    return req(where ?? 'playwright') as Playwright;
  } catch {
    throw new Error('--video needs Playwright and its Chromium: npm i -g playwright && npx playwright install '
      + 'chromium, or set REVIEW_PLAYWRIGHT to a playwright package folder');
  }
}

export async function recordVideo(f: Film): Promise<void> {
  const { chromium } = playwright(f.root);
  const port = Number(process.env.REVIEW_PORT ?? 5176);
  const server = await createServer({
    root: f.root, configFile: path.join(f.root, 'vite.config.ts'), logLevel: 'warn',
    server: { port, strictPort: true }, optimizeDeps: { noDiscovery: true, include: [] },
    cacheDir: path.join(tmpdir(), 'carreographer-review-vite'),     // not the app's own node_modules/.vite
  });
  await server.listen();
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.error('film page:', e.message));
    await page.route('**/__film/*', (route) => route.fulfill({
      body: Buffer.from(f.frames[Number(route.request().url().split('/').pop())]),
      contentType: 'application/octet-stream',
    }));
    await page.goto(`http://localhost:${port}/carreographer/tools/review/film.html`);
    await page.waitForFunction(() => 'film' in window, null, { timeout: 120_000 });
    await page.evaluate(([lineup, n, camera]) => (window as unknown as FilmPage).film.load(lineup, n, camera),
      [f.lineup, f.nFrames, f.camera] as [string, number, string]);

    const count = Math.max(1, Math.round((f.to - f.from) * f.fps));
    const ff = spawn(f.ffmpeg, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(f.fps), '-i', '-',
      '-ss', String(f.from), '-t', String(f.to - f.from), '-i', f.song, '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', f.file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise<void>((ok, fail) => ff.on('close',
      (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`)))));
    const start = Date.now();
    for (let k = 0; k < count; k++) {
      const t = f.from + k / f.fps;
      await page.evaluate((s) => (window as unknown as FilmPage).film.seek(s), t);
      const shot = await page.screenshot({ type: 'jpeg', quality: 90 });
      if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once('drain', r));
      if (k % 30 === 0 && process.stdout.isTTY) process.stdout.write(`\rFilming ${Math.round((100 * k) / count)}%   `);
    }
    ff.stdin.end();
    await done;
    const took = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`${process.stdout.isTTY ? '\r' : ''}Filmed ${count} frames in ${took} s   \n`);
  } finally {
    await browser.close();
    await server.close();
  }
}
