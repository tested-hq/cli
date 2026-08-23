import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { simpleGit } from 'simple-git';
import { loadConfig } from '../../src/config.js';
import { openRepo, resolveBase, headSha, unifiedDiff } from '../../src/git.js';
import { parseIstanbul } from '../../src/core/istanbul.js';
import { parseUnifiedDiff } from '../../src/core/diff.js';
import { splitByIgnore } from '../../src/core/ignores.js';
import { buildDiffOutput } from '../../src/output/json.js';

let repo: string;

beforeAll(async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-e2e-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');

  // Get the canonical repo path that git will use
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

  // Hand-craft coverage: line 1 covered, lines 2-3 uncovered.
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
      s: { '0': 1, '1': 0, '2': 0 },
      f: {},
      b: {},
    },
  };
  await mkdir(join(repo, 'coverage'));
  await writeFile(join(repo, 'coverage/coverage-final.json'), JSON.stringify(cov));
}, 20_000);

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('diff end-to-end', () => {
  it('reports patch = 0%, project = 33.3%, with uncovered range 2-3', async () => {
    const config = await loadConfig({ cwd: repo });
    const ctx = await openRepo(repo);
    const base = await resolveBase(ctx, 'main');
    const head = await headSha(ctx);
    const diff = await unifiedDiff(ctx, base);
    const addedByFile = parseUnifiedDiff(diff);
    const files = await parseIstanbul({
      path: join(repo, 'coverage/coverage-final.json'),
      repoRoot: ctx.repoRoot,
    });
    const { kept, ignored } = splitByIgnore(files.map((f) => f.path), config.ignores);
    const keptSet = new Set(kept);
    const output = buildDiffOutput({
      base: 'main',
      head,
      files: files.filter((f) => keptSet.has(f.path)),
      addedByFile,
      ignored,
    });
    expect(output.patch.executable).toBe(2);
    expect(output.patch.covered).toBe(0);
    expect(output.patch.pct).toBe(0);
    expect(output.project.pct).toBe(33.3);
    const authFile = output.files.find((f) => f.path === 'src/auth.ts');
    expect(authFile?.uncoveredRanges).toEqual([{ start: 2, end: 3, kind: 'line' }]);
  });
});
