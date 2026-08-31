/**
 * Runtime e2e A — from nothing.
 *
 * Not a pack-contract grep (tested-hq/web tests/agent-e2e-pack.test.ts).
 * Two real CLI invocations against a temp fixture: `tested setup` then
 * `tested check`. Clive → Margot: this file + GitHub Actions job
 * "runtime e2e (from-nothing setup/check + from-codecov teardown)"
 * in .github/workflows/ci.yml.
 *
 * Fixture starts with no coverage tool (no vitest.config, no coverage
 * wired in package.json, no .tested.yaml). A tiny node runner writes
 * Istanbul coverage-final.json only after setup — stand-in for
 * `tested run` when nothing is configured yet.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { invokeCli } from '../helpers/invoke-cli.js';

const WRITE_COVERAGE_JS = `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
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
    s: { '0': 1, '1': 1, '2': 1 },
    f: {},
    b: {},
  },
};
mkdirSync(join(repo, 'coverage'), { recursive: true });
writeFileSync(join(repo, 'coverage/coverage-final.json'), JSON.stringify(cov));
`;

async function makeGreenfieldRepo(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-from-nothing-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');

  const repo = (await git.revparse(['--show-toplevel'])).trim();
  await mkdir(join(repo, 'src'));
  await mkdir(join(repo, 'scripts'));
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({
      name: 'greenfield-demo',
      private: true,
      type: 'module',
      scripts: { test: 'node scripts/write-coverage.mjs' },
    }),
  );
  await writeFile(join(repo, 'src/auth.ts'), 'export const a = 1;\n');
  await writeFile(join(repo, 'scripts/write-coverage.mjs'), WRITE_COVERAGE_JS);
  await git.addRemote('origin', 'https://github.com/tested-hq/greenfield-demo.git');
  await git.add('.');
  await git.commit('init', { '--no-verify': null });

  await git.checkoutLocalBranch('feature');
  await writeFile(
    join(repo, 'src/auth.ts'),
    'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
  );
  await git.add('.');
  await git.commit('add b and c', { '--no-verify': null });
  return repo;
}

function assertNoCoverageTool(repo: string, pkg: Record<string, unknown>): void {
  expect(existsSync(join(repo, '.tested.yaml'))).toBe(false);
  expect(existsSync(join(repo, 'vitest.config.ts'))).toBe(false);
  expect(existsSync(join(repo, 'vitest.config.js'))).toBe(false);
  expect(existsSync(join(repo, 'jest.config.js'))).toBe(false);
  expect(existsSync(join(repo, 'coverage/coverage-final.json'))).toBe(false);
  expect(pkg.devDependencies).toBeUndefined();
  expect(pkg.dependencies).toBeUndefined();
  const scripts = pkg.scripts as Record<string, string> | undefined;
  expect(JSON.stringify(pkg)).not.toMatch(/vitest|c8|nyc|istanbul|@vitest\/coverage/i);
  expect(scripts?.test).toBe('node scripts/write-coverage.mjs');
}

describe('runtime e2e — from nothing: tested setup then tested check', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await makeGreenfieldRepo();
  }, 20_000);

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('setup writes .tested.yaml; check reports real 100% patch and project', async () => {
    const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    assertNoCoverageTool(repo, pkg);

    const setup = await invokeCli(['setup', '--json'], { cwd: repo });
    expect(setup.exitCode).toBe(0);
    const setupJson = JSON.parse(setup.stdout) as {
      schemaVersion: number;
      initRan: boolean;
      doctor: { ok: boolean; exitCode: number };
    };
    expect(setupJson.schemaVersion).toBe(1);
    expect(setupJson.initRan).toBe(true);
    expect(setupJson.doctor.ok).toBe(true);
    expect(existsSync(join(repo, '.tested.yaml'))).toBe(true);
    const yaml = await readFile(join(repo, '.tested.yaml'), 'utf8');
    expect(yaml).toMatch(/thresholds:\s*\n\s*patch:\s*80/);
    expect(yaml).toMatch(/project:\s*90/);
    expect(yaml).not.toMatch(/vitest|coverage:\s*\n/i);

    const written = spawnSync(process.execPath, ['scripts/write-coverage.mjs'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(written.status, written.stderr).toBe(0);
    expect(existsSync(join(repo, 'coverage/coverage-final.json'))).toBe(true);

    const check = await invokeCli(['check', '--base', 'main', '--json'], { cwd: repo });
    expect(check.exitCode).toBe(0);
    const gate = JSON.parse(check.stdout) as {
      overall: string;
      patch: { pct: number; threshold: number; pass: boolean };
      project: { pct: number; threshold: number; pass: boolean };
    };
    expect(gate.overall).toBe('pass');
    expect(gate.patch.threshold).toBe(80);
    expect(gate.project.threshold).toBe(90);
    expect(gate.patch.pct).toBe(100);
    expect(gate.project.pct).toBe(100);
    expect(gate.patch.pass).toBe(true);
    expect(gate.project.pass).toBe(true);
    expect(typeof gate.patch.pct).toBe('number');
    expect(typeof gate.project.pct).toBe('number');

    const human = await invokeCli(['check', '--base', 'main'], { cwd: repo });
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('coverage gate');
    expect(human.stdout).toContain('100.0%');
    expect(human.stdout).toContain('threshold 80');
    expect(human.stdout).toContain('threshold 90');
    expect(human.stdout).toContain('[PASS]');
  });
});
