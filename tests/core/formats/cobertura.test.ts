import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCobertura } from '../../../src/core/formats/cobertura.js';
import { expectMixedHits, hitsByLine } from '../../helpers/coverage-hits.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/formats/cobertura.xml',
);

describe('parseCobertura', () => {
  it('maps line hits from pytest-cov Cobertura XML', () => {
    const files = parseCobertura(readFileSync(fixture, 'utf8'), '/repo');
    expect(files.map((f) => f.path).sort()).toEqual([
      'src/auth.py',
      'src/migrations/001.py',
      'src/util.py',
    ]);
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.py'),
      'src/auth.py',
    );
    expect(hitsByLine(files.find((f) => f.path === 'src/util.py')!)).toEqual({
      2: 1,
      3: 1,
    });
  });

  it('would fail if hits attributes were ignored (all zero)', () => {
    const files = parseCobertura(readFileSync(fixture, 'utf8'), '/repo');
    const auth = files.find((f) => f.path === 'src/auth.py')!;
    const covered = auth.statements.filter((s) => s.hits > 0).map((s) => s.startLine);
    const missed = auth.statements.filter((s) => s.hits === 0).map((s) => s.startLine);
    expect(covered).toEqual([1, 9]);
    expect(missed).toEqual([5, 10]);
  });
});
