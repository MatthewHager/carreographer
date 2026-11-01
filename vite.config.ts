/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The site is served from matthewhager.github.io/carreographer/.
export default defineConfig({
  base: '/carreographer/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  worker: { format: 'es' },
  // the first test to use a test song analyses it (src/engine/fixtures), a few seconds each
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000 },
})
