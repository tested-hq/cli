import { describe, it, expect } from 'vitest';
import { uncoveredRanges } from '../../src/core/uncovered.js';
import type { FileCoverage } from '../../src/core/istanbul.js';

const file: FileCoverage = {
  path: 'src/auth.ts',
  absPath: '/repo/src/auth.ts',
  statements: [
    { id: '0', startLine: 1, endLine: 1, hits: 3 },
    { id: '1', startLine: 5, endLine: 5, hits: 0 },
    { id: '2', startLine: 6, endLine: 6, hits: 0 },
    { id: '3', startLine: 7, endLine: 7, hits: 0 },
    { id: '4', startLine: 10, endLine: 10, hits: 1 },
    { id: '5', startLine: 12, endLine: 14, hits: 0 },
  ],
};

describe('uncoveredRanges', () => {
  it('merges contiguous uncovered statements into ranges', () => {
    expect(uncoveredRanges(file)).toEqual([
      { start: 5, end: 7, kind: 'line' },
      { start: 12, end: 14, kind: 'line' },
    ]);
  });
});
