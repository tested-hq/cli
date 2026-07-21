import { describe, it, expect } from 'vitest';
import {
  parseLocation,
  explainAt,
  formatExplainHuman,
} from '../../src/commands/explain.js';
import type { FileCoverage } from '../../src/core/istanbul.js';

const file: FileCoverage = {
  path: 'src/auth.ts',
  absPath: '/repo/src/auth.ts',
  statements: [
    { id: '0', startLine: 5, endLine: 5, hits: 0 },
    { id: '1', startLine: 10, endLine: 10, hits: 3 },
  ],
};

describe('parseLocation', () => {
  it('parses file:line', () => {
    expect(parseLocation('src/auth.ts:5')).toEqual({ path: 'src/auth.ts', line: 5 });
  });
  it('throws on bad format', () => {
    expect(() => parseLocation('src/auth.ts')).toThrow(/expected <file>:<line>/);
    expect(() => parseLocation('src/auth.ts:notanumber')).toThrow();
  });
});

describe('explainAt', () => {
  it('returns uncovered status for line 5', () => {
    const result = explainAt(file, 5, ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7']);
    expect(result.uncovered).toBe(true);
    expect(result.reason).toMatch(/no test exercises line 5/);
    expect(result.codeExcerpt).toContain('line5');
  });
  it('returns covered status for line 10', () => {
    const result = explainAt(file, 10, Array.from({ length: 12 }, (_, i) => `l${i + 1}`));
    expect(result.uncovered).toBe(false);
    expect(result.reason).toMatch(/hit 3 time/);
  });
  it('handles lines outside any statement', () => {
    const result = explainAt(file, 99, []);
    expect(result.uncovered).toBe(false);
    expect(result.reason).toMatch(/no executable statement/);
  });
});

describe('formatExplainHuman', () => {
  it('includes header and status badge', () => {
    const result = explainAt(file, 5, [
      'line1',
      'line2',
      'line3',
      'line4',
      'line5',
      'line6',
      'line7',
    ]);
    const text = formatExplainHuman(result);
    expect(text).toContain('tested.dev — explain');
    expect(text).toContain('src/auth.ts:5');
    expect(text).toContain('UNCOVERED');
    expect(text).toContain('[FAIL]');
  });
});
