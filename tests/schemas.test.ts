import { describe, it, expect } from 'vitest';
import { TestedConfigSchema, DiffOutputSchema } from '../src/schemas.js';

describe('TestedConfigSchema', () => {
  it('accepts an empty object and fills defaults', () => {
    const parsed = TestedConfigSchema.parse({});
    expect(parsed.ignores).toEqual([]);
    expect(parsed.coverage.format).toBe('istanbul-json');
    expect(parsed.coverage.path).toBe('coverage/coverage-final.json');
  });

  it('accepts custom ignores list', () => {
    const parsed = TestedConfigSchema.parse({ ignores: ['scripts/**'] });
    expect(parsed.ignores).toEqual(['scripts/**']);
  });
});

describe('DiffOutputSchema', () => {
  it('validates a minimal schema-v1 payload', () => {
    const result = DiffOutputSchema.parse({
      schemaVersion: 1,
      base: 'origin/main',
      head: 'abc123',
      patch: { executable: 0, covered: 0, pct: 0 },
      project: { executable: 0, covered: 0, pct: 0, delta: null },
      files: [],
      ignored: [],
    });
    expect(result.schemaVersion).toBe(1);
  });
});
