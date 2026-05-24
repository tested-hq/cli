import { describe, it, expect } from 'vitest';
import { formatHuman } from '../../src/output/human.js';
import type { DiffOutput } from '../../src/schemas.js';

const sample: DiffOutput = {
  schemaVersion: 1,
  base: 'origin/main',
  head: 'abc123',
  patch: { executable: 10, covered: 6, pct: 60 },
  project: { executable: 100, covered: 80, pct: 80, delta: null },
  files: [
    {
      path: 'src/auth.ts',
      patchCoverage: 50,
      projectCoverage: 70,
      uncoveredRanges: [{ start: 5, end: 7, kind: 'line' }],
    },
  ],
  ignored: ['migrations/**'],
};

describe('formatHuman', () => {
  it('mentions patch %, project %, and per-file uncovered ranges', () => {
    const text = formatHuman(sample);
    expect(text).toContain('Patch coverage');
    expect(text).toContain('60');
    expect(text).toContain('Project coverage');
    expect(text).toContain('80');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('5-7');
  });
});
