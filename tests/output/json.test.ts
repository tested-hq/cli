import { describe, it, expect } from 'vitest';
import { buildDiffOutput } from '../../src/output/json.js';
import { DiffOutputSchema } from '../../src/schemas.js';
import type { FileCoverage } from '../../src/core/istanbul.js';

const files: FileCoverage[] = [
  {
    path: 'src/auth.ts',
    absPath: '/repo/src/auth.ts',
    statements: [
      { id: '0', startLine: 1, endLine: 1, hits: 3 },
      { id: '1', startLine: 5, endLine: 5, hits: 0 },
    ],
  },
];

describe('buildDiffOutput', () => {
  it('produces a schema-v1 object that validates against DiffOutputSchema', () => {
    const out = buildDiffOutput({
      base: 'origin/main',
      head: 'abc123',
      files,
      addedByFile: new Map([['src/auth.ts', new Set([5])]]),
      ignored: ['src/migrations/**'],
    });
    expect(out.schemaVersion).toBe(1);
    expect(out.patch).toEqual({ executable: 1, covered: 0, pct: 0 });
    expect(out.project).toEqual({ executable: 2, covered: 1, pct: 50, delta: null });
    expect(out.files[0]).toMatchObject({
      path: 'src/auth.ts',
      patchCoverage: 0,
      projectCoverage: 50,
    });
    expect(out.files[0]!.uncoveredRanges).toEqual([{ start: 5, end: 5, kind: 'line' }]);
    expect(() => DiffOutputSchema.parse(out)).not.toThrow();
  });

  it('marks an empty patch and does not list project files as the diff', () => {
    const out = buildDiffOutput({
      base: 'origin/main',
      head: 'abc123',
      files,
      addedByFile: new Map([['tests/auth.test.ts', new Set([1, 2, 3])]]),
      ignored: ['tests/**'],
    });
    expect(out.patch).toEqual({ executable: 0, covered: 0, pct: 0, empty: true });
    expect(out.files).toEqual([]);
    expect(() => DiffOutputSchema.parse(out)).not.toThrow();
  });
});
