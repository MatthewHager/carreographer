// npm run assets: downloads what the site needs and the repository doesn't hold, from its public releases,
// into public/ (no GitHub CLI or sign-in needed): the listening models, Tesla's car models and the example
// song. Files already there whole are kept. The Pages build runs the same script.

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = 'MatthewHager/carreographer';
const RELEASES = { models: 'public/models', 'car-models': 'public/models/tesla-app', examples: 'public/examples' };
const root = path.resolve(import.meta.dirname, '..');
// a token is optional: it only lifts GitHub's limit of 60 unauthenticated API calls an hour (CI passes one)
const auth = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

for (const [tag, dir] of Object.entries(RELEASES)) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers: auth });
  if (!res.ok) throw new Error(`release ${tag}: HTTP ${res.status}`);
  const { assets } = await res.json();
  mkdirSync(path.join(root, dir), { recursive: true });
  for (const a of assets) {
    const to = path.join(root, dir, a.name);
    if (existsSync(to) && statSync(to).size === a.size) continue;
    const file = await fetch(a.browser_download_url);
    if (!file.ok || !file.body) throw new Error(`${a.name}: HTTP ${file.status}`);
    // written beside it first, so a download cut short never passes for the file
    await pipeline(Readable.fromWeb(file.body), createWriteStream(`${to}.part`));
    if (statSync(`${to}.part`).size !== a.size) throw new Error(`${a.name}: incomplete download`);
    renameSync(`${to}.part`, to);
    console.log(`${dir}/${a.name}`);
  }
}
