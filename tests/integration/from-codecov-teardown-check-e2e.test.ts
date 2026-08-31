/**
 * Runtime e2e B — from Codecov.
 *
 * Not a pack-contract grep (tested-hq/web tests/agent-e2e-pack.test.ts).
 * Teardown script then `tested check` against a temp fixture that started
 * with codecov.yml, a Codecov Action step, CODECOV_TOKEN, and a
 * codecov/* required-check stand-in. Clive → Margot: this file + GitHub
 * Actions job "runtime e2e (from-nothing setup/check + from-codecov teardown)"
 * in .github/workflows/ci.yml.
 *
 * After teardown, Codecov files are gone and `tested check` is the gate
 * with real patch/project numbers (not a mock helper).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invokeCli } from '../helpers/invoke-cli.js';
import { makeTempRepo } from '../helpers/temp-repo.js';

const YAML = [
  'base: main',
  'thresholds:',
  '  patch: 80',
  '  project: 90',
  '',
].join('\n');

const CODECOV_YML = [
  'coverage:',
  '  status:',
  '    project: yes',
  '    patch: yes',
  '',
].join('\n');

const WORKFLOW_WITH_CODECOV = [
  'name: ci',
  'on: [push, pull_request]',
  'jobs:',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - run: npm test',
  '      - uses: codecov/codecov-action@v4',
  '        with:',
  '          token: ${{ secrets.CODECOV_TOKEN }}',
  '',
].join('\n');

const REQUIRED_CHECKS = [
  '# Stand-in for GitHub required status checks.',
  '- codecov/patch',
  '- codecov/project',
  '',
].join('\n');

const WORKFLOW_WITHOUT_CODECOV = [
  'name: ci',
  'on: [push, pull_request]',
  'jobs:',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - run: npm test',
  '',
].join('\n');

const TEARDOWN_JS = `import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

function drop(rel) {
  rmSync(join(repo, rel), { recursive: true, force: true });
}

drop('codecov.yml');
drop('codecov');
drop('.github/CODECOV_TOKEN');

writeFileSync(
  join(repo, '.github/workflows/ci.yml'),
  ${JSON.stringify(WORKFLOW_WITHOUT_CODECOV)},
);
`;

const CODECOV_PATHS = [
  'codecov.yml',
  '.github/CODECOV_TOKEN',
  'codecov/required-checks.yml',
] as const;

describe('runtime e2e — from Codecov: teardown then tested check', () => {
  let repo: string;

  beforeAll(async () => {
    const made = await makeTempRepo({
      yaml: YAML,
      hits: [1, 0, 0],
    });
    repo = made.repo;
    await mkdir(join(repo, '.github/workflows'), { recursive: true });
    await mkdir(join(repo, 'codecov'), { recursive: true });
    await mkdir(join(repo, 'scripts'), { recursive: true });
    await writeFile(join(repo, 'codecov.yml'), CODECOV_YML);
    await writeFile(join(repo, '.github/workflows/ci.yml'), WORKFLOW_WITH_CODECOV);
    await writeFile(join(repo, '.github/CODECOV_TOKEN'), 'codecov-token-stand-in\n');
    await writeFile(join(repo, 'codecov/required-checks.yml'), REQUIRED_CHECKS);
    await writeFile(join(repo, 'scripts/teardown-codecov.mjs'), TEARDOWN_JS);
    process.env.CODECOV_TOKEN = 'codecov-token-stand-in';
  }, 20_000);

  afterAll(async () => {
    delete process.env.CODECOV_TOKEN;
    await rm(repo, { recursive: true, force: true });
  });

  it('drops Codecov artifacts; check is the gate with real 0% / 33.3%', async () => {
    for (const rel of CODECOV_PATHS) {
      expect(existsSync(join(repo, rel)), rel).toBe(true);
    }
    const beforeWf = await readFile(join(repo, '.github/workflows/ci.yml'), 'utf8');
    expect(beforeWf).toContain('codecov/codecov-action@v4');
    expect(beforeWf).toContain('CODECOV_TOKEN');
    expect(process.env.CODECOV_TOKEN).toBe('codecov-token-stand-in');

    const teardown = spawnSync(process.execPath, ['scripts/teardown-codecov.mjs'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(teardown.status, teardown.stderr).toBe(0);
    delete process.env.CODECOV_TOKEN;

    for (const rel of CODECOV_PATHS) {
      expect(existsSync(join(repo, rel)), `${rel} should be gone`).toBe(false);
    }
    expect(existsSync(join(repo, 'codecov'))).toBe(false);
    const afterWf = await readFile(join(repo, '.github/workflows/ci.yml'), 'utf8');
    expect(afterWf).not.toMatch(/codecov/i);
    expect(afterWf).not.toContain('CODECOV_TOKEN');
    expect(process.env.CODECOV_TOKEN).toBeUndefined();
    expect(existsSync(join(repo, '.tested.yaml'))).toBe(true);
    expect(existsSync(join(repo, 'coverage/coverage-final.json'))).toBe(true);

    const check = await invokeCli(['check', '--base', 'main', '--json'], { cwd: repo });
    expect(check.exitCode).toBe(1);
    const gate = JSON.parse(check.stdout) as {
      overall: string;
      patch: { pct: number; threshold: number; pass: boolean };
      project: { pct: number; threshold: number; pass: boolean };
    };
    expect(gate.overall).toBe('fail');
    expect(gate.patch.threshold).toBe(80);
    expect(gate.project.threshold).toBe(90);
    expect(gate.patch.pct).toBe(0);
    expect(gate.project.pct).toBe(33.3);
    expect(gate.patch.pass).toBe(false);
    expect(gate.project.pass).toBe(false);
    expect(typeof gate.patch.pct).toBe('number');
    expect(typeof gate.project.pct).toBe('number');
    expect(check.stdout).not.toMatch(/codecov/i);

    const human = await invokeCli(['check', '--base', 'main'], { cwd: repo });
    expect(human.exitCode).toBe(1);
    expect(human.stdout).toContain('coverage gate');
    expect(human.stdout).toContain('0.0%');
    expect(human.stdout).toContain('33.3%');
    expect(human.stdout).toContain('threshold 80');
    expect(human.stdout).toContain('threshold 90');
    expect(human.stdout).toContain('[FAIL]');
    expect(human.stdout).not.toMatch(/codecov/i);
  });
});
