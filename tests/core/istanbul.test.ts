import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  parseIstanbul,
  isCoveragePathInsideRoot,
} from '../../src/core/istanbul.js';

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

  it('rethrows non-ENOENT read errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'istanbul-isdir-'));
    await expect(parseIstanbul({ path: dir, repoRoot: '/repo' })).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });

  it('skips coverage entries whose paths escape repoRoot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'istanbul-escape-'));
    const cov = join(dir, 'coverage-final.json');
    writeFileSync(
      cov,
      JSON.stringify({
        '/repo/src/ok.ts': {
          path: '/repo/src/ok.ts',
          statementMap: {
            '0': {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 1 },
            },
          },
          s: { '0': 1 },
        },
        '/etc/passwd': {
          path: '/etc/passwd',
          statementMap: {
            '0': {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 1 },
            },
          },
          s: { '0': 0 },
        },
        '/repo/../escape.ts': {
          path: '/repo/../escape.ts',
          statementMap: {
            '0': {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 1 },
            },
          },
          s: { '0': 0 },
        },
      }),
    );
    const result = await parseIstanbul({ path: cov, repoRoot: '/repo' });
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/ok.ts');
  });
});

describe('isCoveragePathInsideRoot', () => {
  it('accepts paths under root', () => {
    expect(isCoveragePathInsideRoot('/repo', '/repo/src/a.ts')).toBe(true);
  });

  it('rejects escapes and absolute outsiders', () => {
    expect(isCoveragePathInsideRoot('/repo', '/etc/passwd')).toBe(false);
    expect(isCoveragePathInsideRoot('/repo', '/repo/../escape.ts')).toBe(false);
    expect(isCoveragePathInsideRoot('/repo', '/repo-evil/x')).toBe(false);
  });
});
