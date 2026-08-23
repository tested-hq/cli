import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';

export interface TempRepo {
  repo: string;
  authPath: string;
}

export interface MakeTempRepoOpts {
  /** Extra files to write at repo root before the first commit. */
  extraFiles?: Record<string, string>;
  /** Coverage hits for src/auth.ts statements 0/1/2. Default 1,0,0. */
  hits?: [number, number, number];
  yaml?: string;
  /**
   * Files written on the feature branch instead of the default src/auth.ts
   * edit. Use for tests-only / docs-only fixtures.
   */
  featureFiles?: Record<string, string>;
}

/**
 * Minimal git repo with a two-commit history and hand-crafted Istanbul JSON.
 * Same shape as tests/integration/diff-e2e.test.ts.
 */
export async function makeTempRepo(opts: MakeTempRepoOpts = {}): Promise<TempRepo> {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-repo-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');

  const repo = (await git.revparse(['--show-toplevel'])).trim();
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src/auth.ts'), 'export const a = 1;\n');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'demo' }));
  if (opts.extraFiles) {
    for (const [rel, contents] of Object.entries(opts.extraFiles)) {
      await writeFile(join(repo, rel), contents);
    }
  }
  await git.add('.');
  await git.commit('init', { '--no-verify': null });

  await git.checkoutLocalBranch('feature');
  if (opts.featureFiles) {
    for (const [rel, contents] of Object.entries(opts.featureFiles)) {
      const abs = join(repo, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, contents);
    }
  } else {
    await writeFile(
      join(repo, 'src/auth.ts'),
      'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
    );
  }
  await git.add('.');
  await git.commit(opts.featureFiles ? 'feature changes' : 'add b and c', {
    '--no-verify': null,
  });

  const authPath = join(repo, 'src/auth.ts');
  const hits = opts.hits ?? ([1, 0, 0] as [number, number, number]);
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
      s: { '0': hits[0], '1': hits[1], '2': hits[2] },
      f: {},
      b: {},
    },
  };
  await mkdir(join(repo, 'coverage'));
  await writeFile(join(repo, 'coverage/coverage-final.json'), JSON.stringify(cov));

  if (opts.yaml !== undefined) {
    await writeFile(join(repo, '.tested.yaml'), opts.yaml);
  }

  return { repo, authPath };
}
