import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGcov, parseGcovPath } from '../../../src/core/formats/gcov.js';
import { expectMixedHits, hitsByLine } from '../../helpers/coverage-hits.js';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/formats/gcov',
);
const authFixture = join(dir, 'auth.c.gcov');

describe('parseGcov', () => {
  it('treats ##### as 0 hits and digits as hit counts', () => {
    const files = parseGcov(readFileSync(authFixture, 'utf8'), '/repo');
    expect(files).toHaveLength(1);
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.c'),
      'src/auth.c',
    );
    const byLine = hitsByLine(files[0]!);
    expect(byLine[2]).toBeUndefined();
    expect(byLine[5]).toBe(0);
    expect(byLine[1]).toBe(3);
  });

  it('parses a directory of .gcov files (common CI artifact)', async () => {
    const files = await parseGcovPath({ path: dir, repoRoot: '/repo' });
    expect(files.map((f) => f.path).sort()).toEqual(['src/auth.c', 'src/util.c']);
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.c'),
      'src/auth.c',
    );
    expect(hitsByLine(files.find((f) => f.path === 'src/util.c')!)).toEqual({
      2: 1,
      3: 1,
    });
  });
});
