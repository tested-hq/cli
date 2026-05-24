import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUnifiedDiff } from '../../src/core/diff.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('parseUnifiedDiff', () => {
  it('extracts added line ranges per file', async () => {
    const text = await readFile(
      join(here, '..', 'fixtures', 'diffs', 'basic.patch'),
      'utf8'
    );
    const byFile = parseUnifiedDiff(text);
    expect(byFile.get('src/auth.ts')).toEqual(new Set([4, 5, 6, 13]));
    expect(byFile.get('src/util.ts')).toEqual(new Set([1, 2]));
  });

  it('returns empty map for empty input', () => {
    expect(parseUnifiedDiff('').size).toBe(0);
  });
});
