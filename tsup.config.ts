import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { tested: 'bin/tested.ts', td: 'bin/td.ts' },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
});
