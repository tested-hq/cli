import { describe, it, expect } from 'vitest';
import { computePatchCoverage } from '../../src/core/patch.js';
import type { FileCoverage } from '../../src/core/istanbul.js';

const auth: FileCoverage = {
  path: 'src/auth.ts',
  absPath: '/repo/src/auth.ts',
  statements: [
    { id: '0', startLine: 1, endLine: 1, hits: 3 },
    { id: '1', startLine: 5, endLine: 5, hits: 0 },
    { id: '2', startLine: 9, endLine: 9, hits: 2 },
    { id: '3', startLine: 10, endLine: 10, hits: 0 },
  ],
};

describe('computePatchCoverage', () => {
  it('counts only statements on added lines', () => {
    const addedByFile = new Map<string, Set<number>>([
      ['src/auth.ts', new Set([5, 10])],
    ]);
    const result = computePatchCoverage([auth], addedByFile);
    expect(result.totals).toEqual({ executable: 2, covered: 0, pct: 0 });
    expect(result.byFile.get('src/auth.ts')).toEqual({
      executable: 2,
      covered: 0,
      pct: 0,
    });
  });

  it('returns 100 pct when all added lines are covered', () => {
    const addedByFile = new Map<string, Set<number>>([
      ['src/auth.ts', new Set([1, 9])],
    ]);
    const result = computePatchCoverage([auth], addedByFile);
    expect(result.totals.pct).toBe(100);
  });

  it('skips files not in coverage report (no executable statements added)', () => {
    const addedByFile = new Map<string, Set<number>>([
      ['README.md', new Set([1, 2, 3])],
    ]);
    const result = computePatchCoverage([auth], addedByFile);
    expect(result.totals).toEqual({ executable: 0, covered: 0, pct: 0 });
    expect(result.byFile.size).toBe(0);
  });
});
