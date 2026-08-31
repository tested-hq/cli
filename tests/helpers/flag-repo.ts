import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';

export const FLAG_YAML = [
  'base: main',
  'thresholds:',
  '  patch: 80',
  '  project: 50',
  'flags:',
  '  frontend:',
  '    paths:',
  '      - apps/web/**',
  '    thresholds:',
  '      patch: 90',
  '  backend:',
  '    paths:',
  '      - apps/api/**',
  '',
].join('\n');

const WEB = 'apps/web/ui.ts';
const API = 'apps/api/srv.ts';

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

export interface MakeFlagRepoOpts {
  yaml?: string;
  /** Default true. When false, coverage omits apps/web (flag is missing this run). */
  includeFrontend?: boolean;
  /** Default true. */
  includeBackend?: boolean;
  /** Hits for lines 1–6 of apps/web/ui.ts. Default 1,1,1,1,1,0 (patch 4/5 = 80%). */
  frontendHits?: [number, number, number, number, number, number];
  /** Hits for lines 1–6 of apps/api/srv.ts. Default all covered. */
  backendHits?: [number, number, number, number, number, number];
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
 * Two-package repo: frontend patch 80% (fails flag floor 90), backend 100%.
 * Combined patch 90% meets the global 80% floor.
 */
export async function makeFlagRepo(opts: MakeFlagRepoOpts = {}): Promise<{
  repo: string;
  webPath: string;
  apiPath: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-flags-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');

  const repo = (await git.revparse(['--show-toplevel'])).trim();
  await mkdir(join(repo, 'apps/web'), { recursive: true });
  await mkdir(join(repo, 'apps/api'), { recursive: true });
  await writeFile(join(repo, WEB), ONE_LINE);
  await writeFile(join(repo, API), ONE_LINE);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'mono' }));
  await git.add('.');
  await git.commit('init', { '--no-verify': null });

  await git.checkoutLocalBranch('feature');
  await writeFile(join(repo, WEB), SIX_LINES);
  await writeFile(join(repo, API), SIX_LINES);
  await git.add('.');
  await git.commit('add package lines', { '--no-verify': null });

  const webPath = join(repo, WEB);
  const apiPath = join(repo, API);
  await writeFlagCoverage(repo, opts);
  await writeFile(join(repo, '.tested.yaml'), opts.yaml ?? FLAG_YAML);

  return { repo, webPath, apiPath };
}

/** Rewrite coverage-final.json in an existing flag fixture (for sequential e2e runs). */
export async function writeFlagCoverage(
  repo: string,
  opts: Pick<
    MakeFlagRepoOpts,
    'includeFrontend' | 'includeBackend' | 'frontendHits' | 'backendHits'
  > = {},
): Promise<void> {
  const webPath = join(repo, WEB);
  const apiPath = join(repo, API);
  const frontendHits = opts.frontendHits ?? ([1, 1, 1, 1, 1, 0] as const);
  const backendHits = opts.backendHits ?? ([1, 1, 1, 1, 1, 1] as const);

  const cov: Record<string, unknown> = {};
  if (opts.includeFrontend !== false) {
    cov[webPath] = istanbulFile(webPath, frontendHits);
  }
  if (opts.includeBackend !== false) {
    cov[apiPath] = istanbulFile(apiPath, backendHits);
  }

  await mkdir(dirname(join(repo, 'coverage/coverage-final.json')), { recursive: true });
  await writeFile(join(repo, 'coverage/coverage-final.json'), JSON.stringify(cov));
}
