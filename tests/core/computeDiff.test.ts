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
});

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
});
