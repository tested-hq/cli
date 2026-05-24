import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIstanbul } from '../../src/core/istanbul.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '..', 'fixtures', 'coverage-final.json');

describe('parseIstanbul', () => {
  it('reads coverage-final.json and produces relative-path FileCoverage entries', async () => {
    const result = await parseIstanbul({ path: fixture, repoRoot: '/repo' });
    expect(result).toHaveLength(3);
    const auth = result.find(f => f.path === 'src/auth.ts');
    expect(auth).toBeDefined();
    expect(auth!.statements).toHaveLength(4);
    expect(auth!.statements[0]).toEqual({ id: '0', startLine: 1, endLine: 1, hits: 3 });
    expect(auth!.statements[1]).toEqual({ id: '1', startLine: 5, endLine: 5, hits: 0 });
  });

  it('throws on missing file with a clear message', async () => {
    await expect(parseIstanbul({ path: '/no/such/file.json', repoRoot: '/repo' }))
      .rejects.toThrow(/coverage-final.json not found/);
  });
});
