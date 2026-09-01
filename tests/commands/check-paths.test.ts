import { describe, expect, it } from 'vitest';
import { runCheck } from '../../src/commands/check.js';
import type { DiffOutput, TestedConfig } from '../../src/schemas.js';
import type { FileCoverage } from '../../src/core/istanbul.js';

function makeConfig(): TestedConfig {
  return {
    ignores: [],
    coverage: { path: 'coverage/coverage-final.json' },
    base: 'main',
    testRunner: null,
    thresholds: {
      patch: 80,
      project: 50,
      paths: [
        { glob: 'src/api/**', patch: 90, project: 90 },
        { glob: 'src/cli/**', patch: 70, project: 70 },
      ],
    },
  };
}

function file(path: string, hits: readonly number[]): FileCoverage {
  return {
    path,
    absPath: `/repo/${path}`,
    statements: hits.map((h, i) => ({
      id: String(i),
      startLine: i + 1,
      endLine: i + 1,
      hits: h,
    })),
  };
}

/** Combined 9/10 = 90% patch — passes global 80. api 4/5 = 80% fails path 90. */
function combinedDiff(): DiffOutput {
  return {
    schemaVersion: 1,
    base: 'main',
    head: 'abc',
    patch: { executable: 10, covered: 9, pct: 90 },
    project: { executable: 12, covered: 11, pct: 91.7, delta: null },
    files: [],
    ignored: [],
  };
}

const api = file('src/api/handler.ts', [1, 1, 1, 1, 1, 0]);
const cli = file('src/cli/main.ts', [1, 1, 1, 1, 1, 1]);
const added = new Map([
  ['src/api/handler.ts', new Set([2, 3, 4, 5, 6])],
  ['src/cli/main.ts', new Set([2, 3, 4, 5, 6])],
]);

describe('runCheck — path floors vs global floor', () => {
  it('fails overall when only src/api/** misses (global would pass)', () => {
    const result = runCheck({
      config: makeConfig(),
      diff: combinedDiff(),
      json: true,
      files: [api, cli],
      addedByFile: added,
    });
    expect(result.patchPass).toBe(true);
    expect(result.projectPass).toBe(true);
    expect(result.overall).toBe('fail');
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      paths: {
        glob: string;
        status: string;
        patch: { pct: number; threshold: number; pass: boolean };
        project: { pct: number; threshold: number; pass: boolean };
      }[];
    };
    expect(parsed.overall).toBe('fail');
    expect(parsed.paths).toHaveLength(2);
    const apiPath = parsed.paths.find((p) => p.glob === 'src/api/**');
    const cliPath = parsed.paths.find((p) => p.glob === 'src/cli/**');
    expect(apiPath?.status).toBe('fail');
    expect(apiPath?.patch.pct).toBe(80);
    expect(apiPath?.patch.threshold).toBe(90);
    expect(apiPath?.patch.pass).toBe(false);
    expect(cliPath?.status).toBe('pass');
    expect(cliPath?.patch.pct).toBe(100);
    expect(cliPath?.patch.threshold).toBe(70);
    expect(cliPath?.patch.pass).toBe(true);
  });

  it('keeps flags and path floors independent on the same config', () => {
    const result = runCheck({
      config: {
        ...makeConfig(),
        flags: {
          api: { paths: ['src/api/**'], thresholds: { patch: 80 } },
        },
      },
      diff: combinedDiff(),
      json: true,
      files: [api, cli],
      addedByFile: added,
    });
    const parsed = JSON.parse(result.stdout) as {
      overall: string;
      flags: { api: { status: string; patch: { pass: boolean; threshold: number } } };
      paths: { glob: string; status: string }[];
    };
    expect(parsed.flags.api.status).toBe('pass');
    expect(parsed.flags.api.patch.pass).toBe(true);
    expect(parsed.flags.api.patch.threshold).toBe(80);
    expect(parsed.paths.find((p) => p.glob === 'src/api/**')?.status).toBe('fail');
    expect(parsed.overall).toBe('fail');
  });

  it('prints both path floors in human output', () => {
    const result = runCheck({
      config: makeConfig(),
      diff: combinedDiff(),
      json: false,
      files: [api, cli],
      addedByFile: added,
    });
    expect(result.exitCode).toBe(1);
    expect(result.pathResults).toHaveLength(2);
    expect(result.stdout).toContain('src/api/**');
    expect(result.stdout).toContain('src/cli/**');
    expect(result.stdout).toContain('threshold 90');
    expect(result.stdout).toContain('threshold 70');
    expect(result.stdout).toContain('[FAIL]');
    expect(result.stdout).toContain('[PASS]');
  });

  it('marks a missing path glob in human output without 0%', () => {
    const result = runCheck({
      config: makeConfig(),
      diff: {
        ...combinedDiff(),
        patch: { executable: 5, covered: 5, pct: 100 },
        project: { executable: 6, covered: 6, pct: 100, delta: null },
      },
      json: false,
      files: [cli],
      addedByFile: added,
    });
    expect(result.exitCode).toBe(0);
    expect(result.overall).toBe('pass');
    expect(result.stdout).toContain('src/api/**');
    expect(result.stdout).toContain('[MISSING]');
    expect(result.stdout).toContain('src/cli/**');
    expect(result.stdout).toContain('[PASS]');
    expect(result.stdout).not.toMatch(/src\/api\/\*\*[\s\S]{0,80}0\.0%/);
  });

  it('skips path patch in human output when the glob has no executable added lines', () => {
    const result = runCheck({
      config: {
        ...makeConfig(),
        thresholds: {
          patch: 80,
          project: 50,
          paths: [{ glob: 'src/cli/**', patch: 90, project: 50 }],
        },
      },
      diff: combinedDiff(),
      json: false,
      files: [cli],
      addedByFile: new Map(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/cli/**');
    expect(result.stdout).toContain('[SKIP]');
    expect(result.stdout).toContain('no executable lines in the patch');
    expect(result.stdout).not.toMatch(/Patch\s+0(?:\.0)?%/);
  });

  it('notes skipped path globs when the gate fails for another reason', () => {
    const result = runCheck({
      config: makeConfig(),
      diff: combinedDiff(),
      json: false,
      files: [api],
      addedByFile: added,
    });
    expect(result.exitCode).toBe(1);
    expect(result.pathResults.find((p) => p.glob === 'src/cli/**')?.status).toBe('missing');
    expect(result.pathResults.find((p) => p.glob === 'src/api/**')?.status).toBe('fail');
    expect(result.stdout).toContain('src/cli/**');
    expect(result.stdout).toContain('[MISSING]');
    expect(result.stdout).toContain('Path globs with no files this run are skipped (not 0%).');
  });

  it('does not invent a flags map when only path floors are configured', () => {
    const result = runCheck({
      config: makeConfig(),
      diff: combinedDiff(),
      json: true,
      files: [api, cli],
      addedByFile: added,
    });
    const parsed = JSON.parse(result.stdout) as { flags?: unknown; paths?: unknown };
    expect(parsed.flags).toBeUndefined();
    expect(Array.isArray(parsed.paths)).toBe(true);
  });
});
