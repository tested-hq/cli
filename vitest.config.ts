import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // CLI invoke tests chdir; run files one-at-a-time so cwd cannot leak.
    fileParallelism: false,
    // Git fixture setup is slower under coverage (husky pre-push).
    hookTimeout: 60_000,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
      include: ['src/**/*.ts'],
      exclude: ['tests/**'],
    },
  },
});
