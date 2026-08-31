import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLcov } from '../../../src/core/formats/lcov.js';
import { expectMixedHits, hitsByLine } from '../../helpers/coverage-hits.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/formats/lcov.info',
);

describe('parseLcov', () => {
  it('maps DA hits and leaves uncovered lines at 0', () => {
    const files = parseLcov(readFileSync(fixture, 'utf8'), '/repo');
    expect(files.map((f) => f.path).sort()).toEqual([
      'src/auth.ts',
      'src/migrations/001.ts',
      'src/util.ts',
    ]);
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.ts'),
      'src/auth.ts',
    );
    expect(hitsByLine(files.find((f) => f.path === 'src/util.ts')!)).toEqual({
      2: 1,
      3: 1,
    });
    expect(hitsByLine(files.find((f) => f.path === 'src/migrations/001.ts')!)).toEqual({
      1: 0,
    });
  });

  it('skips records whose SF path escapes repoRoot', () => {
    const raw = [
      'SF:/etc/passwd',
      'DA:1,1',
      'end_of_record',
      'SF:/repo/src/ok.ts',
      'DA:1,4',
      'end_of_record',
    ].join('\n');
    const files = parseLcov(raw, '/repo');
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('src/ok.ts');
    expect(files[0]!.statements[0]!.hits).toBe(4);
  });
});
