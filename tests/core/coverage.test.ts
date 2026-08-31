import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectFormatFromContents,
  detectFormatFromPath,
  parseCoverage,
  resolveCoverageFormat,
} from '../../src/core/coverage.js';
import { splitByIgnore } from '../../src/core/ignores.js';
import { DEFAULT_IGNORES } from '../../src/config.js';
import { expectMixedHits } from '../helpers/coverage-hits.js';

const formatsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/formats',
);

describe('detectFormatFromPath', () => {
  it('maps well-known filenames', () => {
    expect(detectFormatFromPath('coverage/coverage-final.json')).toBe('istanbul-json');
    expect(detectFormatFromPath('coverage/lcov.info')).toBe('lcov');
    expect(detectFormatFromPath('reports/app.lcov')).toBe('lcov');
    expect(detectFormatFromPath('coverage/cobertura.xml')).toBe('cobertura');
    expect(detectFormatFromPath('target/jacoco.xml')).toBe('jacoco');
    expect(detectFormatFromPath('auth.c.gcov')).toBe('gcov');
    expect(detectFormatFromPath('coverage/.resultset.json')).toBe('simplecov');
    expect(detectFormatFromPath('coverage.xml')).toBeUndefined();
  });
});

describe('detectFormatFromContents', () => {
  it('sniffs each fixture', () => {
    expect(detectFormatFromContents(readFileSync(join(formatsDir, 'lcov.info'), 'utf8'))).toBe(
      'lcov',
    );
    expect(
      detectFormatFromContents(readFileSync(join(formatsDir, 'cobertura.xml'), 'utf8')),
    ).toBe('cobertura');
    expect(detectFormatFromContents(readFileSync(join(formatsDir, 'jacoco.xml'), 'utf8'))).toBe(
      'jacoco',
    );
    expect(
      detectFormatFromContents(
        readFileSync(join(formatsDir, 'gcov/auth.c.gcov'), 'utf8'),
      ),
    ).toBe('gcov');
    expect(
      detectFormatFromContents(
        readFileSync(join(formatsDir, 'simplecov.resultset.json'), 'utf8'),
      ),
    ).toBe('simplecov');
  });

  it('detects Istanbul JSON from statementMap', () => {
    const raw = JSON.stringify({
      '/repo/src/a.ts': {
        path: '/repo/src/a.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        },
        s: { '0': 1 },
      },
    });
    expect(detectFormatFromContents(raw)).toBe('istanbul-json');
  });

  it('rejects coverage.py JSON with a pytest-cov hint', () => {
    const raw = JSON.stringify({
      meta: { format: 2, version: '7.6.1' },
      files: { 'src/app.py': { executed_lines: [1], missing_lines: [2] } },
    });
    expect(() => detectFormatFromContents(raw)).toThrow(/coverage\.py JSON is not supported/);
    expect(() => detectFormatFromContents(raw)).toThrow(/lcov|xml/);
  });
});

describe('resolveCoverageFormat', () => {
  it('aliases v8-json to istanbul-json', () => {
    expect(resolveCoverageFormat('v8-json')).toBe('istanbul-json');
    expect(resolveCoverageFormat('istanbul-json')).toBe('istanbul-json');
  });
});

describe('parseCoverage auto-detect', () => {
  it('parses lcov.info without an explicit format', async () => {
    const files = await parseCoverage({
      path: join(formatsDir, 'lcov.info'),
      repoRoot: '/repo',
    });
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.ts'),
      'src/auth.ts',
    );
  });

  it('parses a gcov directory without an explicit format', async () => {
    const files = await parseCoverage({
      path: join(formatsDir, 'gcov'),
      repoRoot: '/repo',
    });
    expectMixedHits(
      files.find((f) => f.path === 'src/auth.c'),
      'src/auth.c',
    );
  });

  it('honors explicit format over a misleading extension', async () => {
    const files = await parseCoverage({
      path: join(formatsDir, 'lcov.info'),
      repoRoot: '/repo',
      format: 'lcov',
    });
    expect(files.some((f) => f.path === 'src/auth.ts')).toBe(true);
  });

  it('throws a missing-file error that CLI tests recognize', async () => {
    await expect(
      parseCoverage({ path: '/no/such/coverage-final.json', repoRoot: '/repo' }),
    ).rejects.toThrow(/coverage file missing/);
  });
});

describe('ignores after parse', () => {
  it('still drops default ignore globs from lcov output', async () => {
    const files = await parseCoverage({
      path: join(formatsDir, 'lcov.info'),
      repoRoot: '/repo',
    });
    const { kept, ignored } = splitByIgnore(
      files.map((f) => f.path),
      DEFAULT_IGNORES,
    );
    expect(ignored).toContain('src/migrations/001.ts');
    expect(kept).toContain('src/auth.ts');
    expect(kept).toContain('src/util.ts');
    expect(kept).not.toContain('src/migrations/001.ts');
  });
});
