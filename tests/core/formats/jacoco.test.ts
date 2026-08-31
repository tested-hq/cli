import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJacoco } from '../../../src/core/formats/jacoco.js';
import { expectMixedHits, hitsByLine } from '../../helpers/coverage-hits.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/formats/jacoco.xml',
);

describe('parseJacoco', () => {
  it('uses covered instructions (ci), not missed (mi)', () => {
    const files = parseJacoco(readFileSync(fixture, 'utf8'), '/repo');
    expect(files.map((f) => f.path).sort()).toEqual([
      'src/Auth.java',
      'src/Util.java',
      'src/migrations/V001.java',
    ]);
    expectMixedHits(
      files.find((f) => f.path === 'src/Auth.java'),
      'src/Auth.java',
    );
    // If the parser used `mi` as hits, line 1 would be 0 and line 5 would be 2.
    const auth = hitsByLine(files.find((f) => f.path === 'src/Auth.java')!);
    expect(auth[1]).not.toBe(0);
    expect(auth[5]).not.toBe(2);
    expect(hitsByLine(files.find((f) => f.path === 'src/Util.java')!)).toEqual({
      2: 1,
      3: 1,
    });
    expect(hitsByLine(files.find((f) => f.path === 'src/migrations/V001.java')!)).toEqual({
      1: 0,
    });
  });
});
