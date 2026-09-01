import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';

export const PATH_YAML = [
  'base: main',
  'thresholds:',
  '  patch: 80',
  '  project: 50',
  '  paths:',
  '    - glob: src/api/**',
  '      patch: 90',
  '      project: 90',
  '    - glob: src/cli/**',
  '      patch: 70',
  '      project: 70',
  '',
].join('\n');

const API = 'src/api/handler.ts';
const CLI = 'src/cli/main.ts';

const ONE_LINE = 'export const a = 1;\n';
const SIX_LINES = [
  'export const a = 1;',
  'export const b = 2;',
  'export const c = 3;',
  'export const d = 4;',
  'export const e = 5;',
  'export const f = 6;',
  '',
].join('\n');

export interface MakePathRepoOpts {
  yaml?: string;
  /** Hits for lines 1–6 of src/api/handler.ts. Default 1,1,1,1,1,0 (patch 4/5 = 80%). */
  apiHits?: [number, number, number, number, number, number];
  /** Hits for lines 1–6 of src/cli/main.ts. Default all covered (100%). */
  cliHits?: [number, number, number, number, number, number];
}

function istanbulFile(
  absPath: string,
  hits: readonly number[],
): Record<string, unknown> {
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  hits.forEach((hit, i) => {
    const id = String(i);
    const line = i + 1;
    statementMap[id] = { start: { line, column: 0 }, end: { line, column: 20 } };
    s[id] = hit;
  });
  return {
    path: absPath,
    statementMap,
    fnMap: {},
    branchMap: {},
    s,
    f: {},
    b: {},
  };
}

/**
 * Two-path repo: api patch 80% (fails path floor 90), cli 100% (meets 70).
 * Combined patch 90% meets the global 80% floor — only the path floor fails.
 */
export async function makePathRepo(opts: MakePathRepoOpts = {}): Promise<{
  repo: string;
  apiPath: string;
  cliPath: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-paths-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');

  const repo = (await git.revparse(['--show-toplevel'])).trim();
  await mkdir(join(repo, 'src/api'), { recursive: true });
  await mkdir(join(repo, 'src/cli'), { recursive: true });
  await writeFile(join(repo, API), ONE_LINE);
  await writeFile(join(repo, CLI), ONE_LINE);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'paths-demo' }));
  await git.add('.');
  await git.commit('init', { '--no-verify': null });

  await git.checkoutLocalBranch('feature');
  await writeFile(join(repo, API), SIX_LINES);
  await writeFile(join(repo, CLI), SIX_LINES);
  await git.add('.');
  await git.commit('add path lines', { '--no-verify': null });

  const apiPath = join(repo, API);
  const cliPath = join(repo, CLI);
  const apiHits = opts.apiHits ?? ([1, 1, 1, 1, 1, 0] as const);
  const cliHits = opts.cliHits ?? ([1, 1, 1, 1, 1, 1] as const);

  const cov: Record<string, unknown> = {
    [apiPath]: istanbulFile(apiPath, apiHits),
    [cliPath]: istanbulFile(cliPath, cliHits),
  };
  await mkdir(dirname(join(repo, 'coverage/coverage-final.json')), { recursive: true });
  await writeFile(join(repo, 'coverage/coverage-final.json'), JSON.stringify(cov));
  await writeFile(join(repo, '.tested.yaml'), opts.yaml ?? PATH_YAML);

  return { repo, apiPath, cliPath };
}
