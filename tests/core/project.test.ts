import { describe, it, expect } from 'vitest';
import { computeProjectCoverage } from '../../src/core/project.js';
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
  {
    path: 'src/util.ts',
    absPath: '/repo/src/util.ts',
    statements: [
      { id: '0', startLine: 2, endLine: 2, hits: 1 },
      { id: '1', startLine: 3, endLine: 3, hits: 1 },
    ],
  },
];

describe('computeProjectCoverage', () => {
  it('sums all statements across kept files', () => {
    const result = computeProjectCoverage(files);
    expect(result.totals).toEqual({ executable: 4, covered: 3, pct: 75 });
    expect(result.byFile.get('src/auth.ts')).toEqual({
      executable: 2,
      covered: 1,
      pct: 50,
    });
  });
});
