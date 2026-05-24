import { describe, it, expect } from 'vitest';
import { isIgnored, splitByIgnore } from '../../src/core/ignores.js';

describe('isIgnored', () => {
  it('matches default patterns', () => {
    expect(isIgnored('src/migrations/001.ts', ['migrations/**'])).toBe(true);
    expect(isIgnored('src/types/api.d.ts', ['**/*.d.ts'])).toBe(true);
    expect(isIgnored('src/auth.ts', ['migrations/**', '**/*.d.ts'])).toBe(false);
  });
});

describe('splitByIgnore', () => {
  it('partitions paths into kept and ignored', () => {
    const { kept, ignored } = splitByIgnore(
      ['src/auth.ts', 'src/migrations/001.ts', 'src/util.ts'],
      ['migrations/**']
    );
    expect(kept).toEqual(['src/auth.ts', 'src/util.ts']);
    expect(ignored).toEqual(['src/migrations/001.ts']);
  });
});
