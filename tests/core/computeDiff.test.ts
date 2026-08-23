import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { computeDiff } from '../../src/core/computeDiff.js';
import { loadConfig } from '../../src/config.js';

let repo: string;

beforeAll(async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-computediff-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');

  repo = (await git.revparse(['--show-toplevel'])).trim();

  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src/auth.ts'), 'export const a = 1;\n');
  await git.add('.');
  await git.commit('init');
  await git.checkoutLocalBranch('feature');
  await writeFile(
    join(repo, 'src/auth.ts'),
    'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
  );
  await git.add('.');
  await git.commit('add b and c');

  const authPath = join(repo, 'src/auth.ts');
  const cov = {
    [authPath]: {
      path: authPath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
        '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
        '2': { start: { line: 3, column: 0 }, end: { line: 3, column: 20 } },
      },
      fnMap: {},
      branchMap: {},
      s: { '0': 1, '1': 1, '2': 0 },
      f: {},
      b: {},
    },
  };
  await mkdir(join(repo, 'coverage'));
  await writeFile(join(repo, 'coverage/coverage-final.json'), JSON.stringify(cov));
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'demo' }));
}, 60_000);

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('computeDiff', () => {
  it('returns the same shape as the buildDiffOutput integration test', async () => {
    const config = await loadConfig({ cwd: repo });
    const output = await computeDiff({ cwd: repo, config, baseRef: 'main' });
    expect(output.schemaVersion).toBe(1);
    expect(output.base).toBe('main');
    expect(output.patch.executable).toBe(2);
    // Lines 2 and 3 were added; line 2 covered, line 3 not.
    expect(output.patch.covered).toBe(1);
    expect(output.patch.pct).toBe(50);
    expect(output.project.pct).toBe(66.7);
    expect(output.project.delta).toBeNull();
  });

  it('computes project.delta against a baseline coverage file', async () => {
    const config = await loadConfig({ cwd: repo });
    const baseline = join(repo, 'coverage/baseline.json');
    // Baseline: only line 1 exists and is covered (33.3% → 66.7% head).
    const authPath = join(repo, 'src/auth.ts');
    await writeFile(
      baseline,
      JSON.stringify({
        [authPath]: {
          path: authPath,
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
          },
          s: { '0': 1 },
        },
      }),
    );
    const output = await computeDiff({
      cwd: repo,
      config,
      baseRef: 'main',
      withBaseCoverage: 'coverage/baseline.json',
    });
    expect(output.project.pct).toBe(66.7);
    expect(output.project.delta).toBe(66.7 - 100);
  });

  it('falls back to HEAD~1 when diffing on the base branch itself', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tested-computediff-main-'));
    const git = simpleGit({ baseDir: tempDir });
    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 'test@tested.dev');
    await git.addConfig('user.name', 'Test');
    const root = (await git.revparse(['--show-toplevel'])).trim();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/auth.ts'), 'export const a = 1;\n');
    await git.add('.');
    await git.commit('init', { '--no-verify': null });
    await writeFile(
      join(root, 'src/auth.ts'),
      'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
    );
    await git.add('.');
    await git.commit('add b and c', { '--no-verify': null });
    const authPath = join(root, 'src/auth.ts');
    const cov = {
      [authPath]: {
        path: authPath,
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
          '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
          '2': { start: { line: 3, column: 0 }, end: { line: 3, column: 20 } },
        },
        s: { '0': 1, '1': 1, '2': 0 },
      },
    };
    await mkdir(join(root, 'coverage'));
    await writeFile(join(root, 'coverage/coverage-final.json'), JSON.stringify(cov));
    try {
      const config = await loadConfig({ cwd: root });
      const output = await computeDiff({ cwd: root, config, baseRef: 'main' });
      expect(output.base).toBe('HEAD~1');
      expect(output.patch.executable).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws a friendly error when --base origin/main is missing', async () => {
    const config = await loadConfig({ cwd: repo });
    await expect(
      computeDiff({ cwd: repo, config, baseRef: 'origin/main' }),
    ).rejects.toThrow(/git base ref "origin\/main" not found/);
  });

  it('treats an empty baseline as 0% when computing delta', async () => {
    const config = await loadConfig({ cwd: repo });
    const empty = join(repo, 'coverage/empty-base.json');
    await writeFile(empty, JSON.stringify({}));
    const output = await computeDiff({
      cwd: repo,
      config,
      baseRef: 'main',
      withBaseCoverage: 'coverage/empty-base.json',
    });
    expect(output.project.delta).toBe(66.7);
  });
});
