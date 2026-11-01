// npm run review -- SONG [options]: runs main.ts on the app's own TypeScript (src/) through Vite's module
// runner, so the review makes the show with exactly the code the page runs. See README.md.

import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '../..');
const { module } = await runnerImport(path.join(root, 'tools/review/main.ts'), {
  root, configFile: false, logLevel: 'warn', resolve: { alias: { '@': path.join(root, 'src') } },
});
try {
  process.exitCode = await module.main(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
}
