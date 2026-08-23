import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../../action/resolve-check-base.sh');
const actionYml = join(here, '../../action/action.yml');

let server = '';
let shallow = '';
let baseSha = '';
let headSha = '';

beforeAll(async () => {
  server = mkdtempSync(join(tmpdir(), 'tested-action-server-'));
  const git = simpleGit({ baseDir: server });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');
  writeFileSync(join(server, 'app.ts'), 'export const a = 1;\n');
  await git.add('.');
  await git.commit('base', { '--no-verify': null });
  baseSha = (await git.revparse(['HEAD'])).trim();
  await git.checkoutLocalBranch('feature');
  writeFileSync(join(server, 'app.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await git.add('.');
  await git.commit('feature', { '--no-verify': null });
  headSha = (await git.revparse(['HEAD'])).trim();

  shallow = mkdtempSync(join(tmpdir(), 'tested-action-shallow-'));
  await simpleGit().clone(server, shallow, ['--depth', '1', '--branch', 'feature']);
}, 20_000);

afterAll(() => {
  if (server) rmSync(server, { recursive: true, force: true });
  if (shallow) rmSync(shallow, { recursive: true, force: true });
});

function runResolve(
  cwd: string,
  env: Record<string, string>,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bash', [script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

describe('action.yml wiring', () => {
  it('defaults tested check --base from the PR SHA / previous push commit', () => {
    const yml = readFileSync(actionYml, 'utf8');
    expect(yml).toContain('resolve-check-base.sh');
    expect(yml).toContain('github.event.pull_request.base.sha');
    expect(yml).toContain('github.event.pull_request.base.ref');
    expect(yml).toContain('github.event.before');
    expect(yml).toContain('github.base_ref');
    expect(yml).toMatch(/tested check --base/);
    expect(yml).toContain('install-cli.sh');
    expect(yml).not.toMatch(/node "\$BIN" check/);
  });

  it('passes the same resolved --base to tested push (not the branch name main)', () => {
    const yml = readFileSync(actionYml, 'utf8');
    const pushSh = readFileSync(join(here, '../../action/run-push.sh'), 'utf8');
    expect(yml).toContain('run-push.sh');
    expect(yml).toContain('INPUT_BASE: ${{ inputs.base }}');
    expect(yml).toContain('PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(pushSh).toContain('resolve-check-base.sh');
    expect(pushSh).toMatch(/tested push --pr "\$PR" --base "\$BASE"/);
    expect(pushSh).toMatch(/tested push --mainline --base "\$BASE"/);
    expect(pushSh).not.toMatch(/tested push --pr "\$PR" "\$\{EXTRA_URL\[@\]\}"/);
  });
});

describe('resolve-check-base.sh', () => {
  it('does not use the branch name main on a shallow feature checkout', () => {
    const missing = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'main'], {
      cwd: shallow,
      encoding: 'utf8',
    });
    expect(missing.status).not.toBe(0);

    const result = runResolve(shallow, {
      EVENT_NAME: 'pull_request',
      PR_BASE_SHA: baseSha,
      INPUT_BASE: '',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(baseSha);
    expect(result.stdout).not.toBe('main');
  });

  it('uses the previous push commit (not the branch name main)', () => {
    const result = runResolve(shallow, {
      EVENT_NAME: 'push',
      PUSH_BEFORE: baseSha,
      INPUT_BASE: '',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(baseSha);
    expect(result.stdout).not.toBe(headSha);
    expect(result.stdout).not.toBe('main');
  });

  it('uses HEAD when push before is a zero SHA (new branch)', () => {
    const result = runResolve(shallow, {
      EVENT_NAME: 'push',
      PUSH_BEFORE: '0000000000000000000000000000000000000000',
      INPUT_BASE: '',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('HEAD');
  });

  it('lets inputs.base win over the PR SHA', () => {
    const result = runResolve(shallow, {
      EVENT_NAME: 'pull_request',
      PR_BASE_SHA: baseSha,
      INPUT_BASE: headSha,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(headSha);
  });

  it('rejects an unsafe inputs.base', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'tested-action-unsafe-'));
    try {
      mkdirSync(cwd, { recursive: true });
      const result = runResolve(cwd, {
        INPUT_BASE: 'foo;rm -rf',
        EVENT_NAME: 'pull_request',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/unsafe git base/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
