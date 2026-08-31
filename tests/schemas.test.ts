import { describe, it, expect } from 'vitest';
import { TestedConfigSchema, DiffOutputSchema } from '../src/schemas.js';

describe('TestedConfigSchema', () => {
  it('accepts an empty object and fills defaults', () => {
    const parsed = TestedConfigSchema.parse({});
    expect(parsed.ignores).toEqual([]);
    expect(parsed.coverage.format).toBeUndefined();
    expect(parsed.coverage.path).toBe('coverage/coverage-final.json');
  });

  it('accepts coverage.path as a list of files to merge', () => {
    const parsed = TestedConfigSchema.parse({
      coverage: { path: ['coverage/lcov.info', 'coverage/python.xml'] },
    });
    expect(parsed.coverage.path).toEqual(['coverage/lcov.info', 'coverage/python.xml']);
  });

  it('rejects an empty coverage.path list', () => {
    expect(() => TestedConfigSchema.parse({ coverage: { path: [] } })).toThrow();
  });

  it('accepts custom ignores list', () => {
    const parsed = TestedConfigSchema.parse({ ignores: ['scripts/**'] });
    expect(parsed.ignores).toEqual(['scripts/**']);
  });

  it('round-trips thresholds without dropping them', () => {
    const parsed = TestedConfigSchema.parse({ thresholds: { patch: 80, project: 60 } });
    expect(parsed.thresholds).toEqual({ patch: 80, project: 60 });
  });

  it('accepts no thresholds (field is optional)', () => {
    const parsed = TestedConfigSchema.parse({});
    expect(parsed.thresholds).toBeUndefined();
  });

  it('accepts each coverage format and rejects unknown ones', () => {
    for (const format of [
      'istanbul-json',
      'v8-json',
      'lcov',
      'cobertura',
      'jacoco',
      'gcov',
      'simplecov',
    ] as const) {
      const parsed = TestedConfigSchema.parse({
        coverage: { format, path: 'coverage/out' },
      });
      expect(parsed.coverage.format).toBe(format);
    }
    expect(() =>
      TestedConfigSchema.parse({ coverage: { format: 'flags' } }),
    ).toThrow();
  });

  it('rejects threshold values outside 0..100', () => {
    expect(() => TestedConfigSchema.parse({ thresholds: { patch: 101, project: 60 } })).toThrow();
    expect(() => TestedConfigSchema.parse({ thresholds: { patch: 80, project: -1 } })).toThrow();
  });
});

describe('DiffOutputSchema', () => {
  it('validates a minimal schema-v1 payload', () => {
    const result = DiffOutputSchema.parse({
      schemaVersion: 1,
      base: 'origin/main',
      head: 'abc123',
      patch: { executable: 0, covered: 0, pct: 0, empty: true },
      project: { executable: 0, covered: 0, pct: 0, delta: null },
      files: [],
      ignored: [],
    });
    expect(result.schemaVersion).toBe(1);
  });
});
