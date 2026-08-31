import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../../action/install-cli.sh');
const actionYml = join(here, '../../action/action.yml');
const pkg = JSON.parse(
  readFileSync(join(here, '../../package.json'), 'utf8'),
) as { version: string };

function plan(env: Record<string, string>): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bash', [script, '--plan'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

function parsePlan(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (key) out[key] = value;
  }
  return out;
}

describe('install-cli.sh --plan', () => {
  it('defaults to npm @tested/cli@package-version', () => {
    const result = plan({
      CLI_PATH: '',
      CLI_REF: '',
      CLI_VERSION: '',
    });
    expect(result.status).toBe(0);
    const parsed = parsePlan(result.stdout);
    expect(parsed.source).toBe('npm');
    expect(parsed.spec).toBe(`@tested/cli@${pkg.version}`);
    expect(readFileSync(script, 'utf8')).toContain(`VERSION_DEFAULT='${pkg.version}'`);
  });

  it('uses cli-path over npm and git', () => {
    const result = plan({
      CLI_PATH: '/tmp/cli-checkout',
      CLI_REF: 'main',
      CLI_VERSION: '9.9.9',
    });
    expect(result.status).toBe(0);
    const parsed = parsePlan(result.stdout);
    expect(parsed.source).toBe('path');
    expect(parsed.dir).toBe('/tmp/cli-checkout');
  });

  it('uses cli-ref as a git fallback', () => {
    const result = plan({
      CLI_PATH: '',
      CLI_REF: 'abc123def',
      CLI_REPOSITORY: 'tested-hq/cli',
      CLI_VERSION: '0.1.2',
    });
    expect(result.status).toBe(0);
    const parsed = parsePlan(result.stdout);
    expect(parsed.source).toBe('git');
    expect(parsed.repository).toBe('tested-hq/cli');
    expect(parsed.ref).toBe('abc123def');
  });

  it('rejects an unsafe npm version before touching the network', () => {
    const result = plan({
      CLI_PATH: '',
      CLI_REF: '',
      CLI_VERSION: '0.1.2;rm -rf /',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe npm version/);
  });

  it('rejects an unsafe cli-ref', () => {
    const result = plan({
      CLI_PATH: '',
      CLI_REF: 'main;curl evil',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe cli-ref/);
  });

  it('rejects an unsafe cli-repository', () => {
    const result = plan({
      CLI_PATH: '',
      CLI_REF: 'main',
      CLI_REPOSITORY: 'https://evil.example/repo',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe cli-repository/);
  });
});

describe('install-cli.sh path shim', () => {
  it('fails --link when tested.js is missing', () => {
    const result = spawnSync('bash', [script, '--link', '/no/such/tested.js'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing/);
  });

  it('fails when cli-path does not exist', () => {
    const result = spawnSync('bash', [script], {
      env: {
        ...process.env,
        CLI_PATH: '/no/such/tested-cli-path',
        CLI_REF: '',
        CLI_VERSION: '0.1.2',
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/cli-path does not exist/);
  });

  it('puts a tested shim on PATH from a built dist/tested.js', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-install-link-'));
    try {
      const dist = join(dir, 'dist');
      mkdirSync(dist);
      const js = join(dist, 'tested.js');
      writeFileSync(js, '#!/usr/bin/env node\nconsole.log("ok");\n');
      chmodSync(js, 0o755);
      const githubPath = join(dir, 'github-path');
      writeFileSync(githubPath, '');

      const result = spawnSync('bash', [script, '--link', js], {
        env: {
          ...process.env,
          ACTION_PATH: dir,
          GITHUB_PATH: githubPath,
        },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(readFileSync(githubPath, 'utf8')).toContain(`${dir}/.bin`);

      const run = spawnSync(join(dir, '.bin/tested'), { encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('puts tested on PATH when --link is a relative ./dist/tested.js', () => {
    const repo = mkdtempSync(join(tmpdir(), 'tested-install-rel-'));
    const actionDir = mkdtempSync(join(tmpdir(), 'tested-install-action-'));
    try {
      mkdirSync(join(repo, 'dist'));
      writeFileSync(
        join(repo, 'dist/tested.js'),
        '#!/usr/bin/env node\nconsole.log("ok");\n',
      );
      chmodSync(join(repo, 'dist/tested.js'), 0o755);
      const githubPath = join(actionDir, 'github-path');
      writeFileSync(githubPath, '');

      const result = spawnSync('bash', [script, '--link', './dist/tested.js'], {
        cwd: repo,
        env: {
          ...process.env,
          ACTION_PATH: actionDir,
          GITHUB_PATH: githubPath,
        },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toMatch(/not on PATH/);
      expect(readFileSync(githubPath, 'utf8')).toContain(`${actionDir}/.bin`);

      const run = spawnSync(join(actionDir, '.bin/tested'), { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('ok');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(actionDir, { recursive: true, force: true });
    }
  });
});

describe('action.yml install wiring', () => {
  it('installs from npm by default and keeps cli-path / resolve-check-base', () => {
    const yml = readFileSync(actionYml, 'utf8');
    expect(yml).toMatch(new RegExp(`default: '${pkg.version.replace(/\./g, '\\.')}'`));
    expect(yml).not.toContain('TESTED_API_URL: ${{ inputs.api-url }}');
    expect(yml).toContain('INPUT_API_URL: ${{ inputs.api-url }}');
    expect(yml).toContain('install-cli.sh');
    expect(yml).toContain('inputs.cli-path');
    expect(yml).toContain('run-check.sh');
    expect(yml).toContain('run-push.sh');
    expect(yml).toMatch(/run-check\.sh/);
    expect(yml).not.toMatch(/node "\$BIN"/);
    expect(yml).not.toMatch(/corepack enable/);
    expect(yml).not.toMatch(/git clone/);
    expect(yml).toMatch(/default: '24'/);
  });
});
