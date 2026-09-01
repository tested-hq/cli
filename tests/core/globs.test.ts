import { describe, expect, it } from 'vitest';
import {
  filterFilesByGlobs,
  normalizeRepoPath,
  pathMatchesAnyGlob,
  pathMatchesGlob,
} from '../../src/core/globs.js';

describe('normalizeRepoPath', () => {
  it('rewrites Windows separators so globs match', () => {
    expect(normalizeRepoPath('src\\api\\handler.ts')).toBe('src/api/handler.ts');
  });
});

describe('pathMatchesGlob', () => {
  it('matches a repo-relative glob and a basename-only pattern via **/', () => {
    expect(pathMatchesGlob('src/api/handler.ts', 'src/api/**')).toBe(true);
    expect(pathMatchesGlob('src/api/handler.ts', 'handler.ts')).toBe(true);
    expect(pathMatchesGlob('src/cli/main.ts', 'src/api/**')).toBe(false);
  });
});

describe('filterFilesByGlobs', () => {
  it('keeps files that match any pattern', () => {
    const files = [{ path: 'src/api/handler.ts' }, { path: 'src/cli/main.ts' }];
    expect(filterFilesByGlobs(files, ['src/api/**']).map((f) => f.path)).toEqual([
      'src/api/handler.ts',
    ]);
    expect(pathMatchesAnyGlob('src/cli/main.ts', ['src/api/**', 'src/cli/**'])).toBe(true);
  });
});
