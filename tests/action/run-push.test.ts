import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_JUNIT_CANDIDATES } from '../../src/commands/push.js';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../../action/run-push.sh');
const actionYml = join(here, '../../action/action.yml');

function initGit(dir: string): void {
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 't@tested.dev'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  writeFileSync(join(dir, '.gitkeep'), '');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'init', '--no-verify'], { cwd: dir });
}

function mockTested(dir: string): { bin: string; log: string } {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(dir, 'tested-argv.log');
  writeFileSync(
    join(bin, 'tested'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
`,
  );
  chmodSync(join(bin, 'tested'), 0o755);
  return { bin, log };
}

function runPush(
  env: Record<string, string>,
  bin: string,
  cwd?: string,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bash', [script], {
    cwd,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      ACTION_PATH: join(here, '../../action'),
      INPUT_BASE: 'HEAD',
      ...env,
    },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

const SAMPLE_JUNIT = `<?xml version="1.0"?><testsuite><testcase name="ok" time="0.1"/></testsuite>`;

describe('action.yml push wiring', () => {
  it('does not interpolate untrusted GitHub expressions into bash', () => {
    const yml = readFileSync(actionYml, 'utf8');
    expect(yml).toContain('run-push.sh');
    expect(yml).toContain('INPUT_REPOSITORY: ${{ github.repository }}');
    expect(yml).toContain('INPUT_MAINLINE: ${{ inputs.mainline }}');
    expect(yml).toContain('REF_NAME: ${{ github.ref_name }}');
    expect(yml).not.toContain('MAINLINE="${{ inputs.mainline }}"');
    expect(yml).not.toContain('REF="${{ github.ref_name }}"');
    expect(yml).not.toContain('PR="${{ github.event.pull_request.number }}"');
    expect(yml).not.toContain('TESTED_API_URL: ${{ inputs.api-url }}');
    expect(yml).toContain('INPUT_JUNIT: ${{ inputs.junit }}');
    expect(yml).toContain('INPUT_FILES: ${{ inputs.files }}');
    expect(yml).toContain('INPUT_PARTS: ${{ inputs.parts }}');
    expect(yml).toContain('INPUT_COMPLETE: ${{ inputs.complete }}');
    expect(yml).toMatch(/test-results\/junit\.xml/);
    const runPushSh = readFileSync(script, 'utf8');
    for (const candidate of DEFAULT_JUNIT_CANDIDATES) {
      expect(runPushSh).toContain(candidate);
    }
    expect(yml).toContain('INPUT_BASE: ${{ inputs.base }}');
    expect(yml).toContain('PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(yml).toContain('ACTION_PATH: ${{ github.action_path }}');
    expect(yml).toMatch(
      /name: tested push \(optional\)\s*\n\s+if: inputs\.push == 'true'\s*\n\s+continue-on-error: true/,
    );
  });
});

describe('run-push.sh', () => {
  it('requires a token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin } = mockTested(dir);
      const result = runPush({ TESTED_TOKEN: '' }, bin);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/requires token/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a polluted GITHUB_REPOSITORY when the action input is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          GITHUB_REPOSITORY: 'attacker/evil',
          EVENT_PR_NUMBER: '5',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--owner acme');
      expect(argv).toContain('--name widgets');
      expect(argv).not.toContain('attacker');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores ambient TESTED_API_URL from a previous step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          TESTED_API_URL: 'https://evil.example',
          TESTED_ALLOW_CUSTOM_API_URL: '1',
          EVENT_PR_NUMBER: '12',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--pr 12');
      expect(argv).toContain('--base HEAD');
      expect(argv).toContain('--owner acme');
      expect(argv).toContain('--name widgets');
      expect(argv).not.toContain('--url');
      expect(argv).not.toContain('evil.example');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not execute metacharacters in REF_NAME or INPUT_MAINLINE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    const marker = join(dir, 'injected');
    try {
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          INPUT_MAINLINE: `false"; touch ${marker}; echo "`,
          EVENT_NAME: 'push',
          DEFAULT_BRANCH: 'main',
          REF_NAME: `main"; touch ${marker}; echo "`,
          EVENT_PR_NUMBER: '7',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
      );
      expect(result.status).toBe(0);
      expect(readFileSync(log, 'utf8')).toContain('--pr 7');
      expect(() => readFileSync(marker)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --base from the resolved PR SHA, not the branch name main', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
      expect(sha.status).toBe(0);
      const baseSha = sha.stdout.trim();
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          INPUT_BASE: '',
          EVENT_NAME: 'pull_request',
          PR_BASE_SHA: baseSha,
          EVENT_PR_NUMBER: '35',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain(`--base ${baseSha}`);
      expect(argv).not.toMatch(/--base main\b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto-mainlines on push to the default branch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_NAME: 'push',
          DEFAULT_BRANCH: 'main',
          REF_NAME: 'main',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--mainline');
      expect(argv).toContain('--base HEAD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --url only from the action api-url input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          INPUT_API_URL: 'https://staging.tested.dev',
          TESTED_API_URL: 'https://evil.example',
          EVENT_PR_NUMBER: '3',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--url https://staging.tested.dev');
      expect(argv).not.toContain('evil.example');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --junit from the explicit action input and logs the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      initGit(dir);
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_PR_NUMBER: '8',
          INPUT_REPOSITORY: 'acme/widgets',
          INPUT_JUNIT: 'reports/custom.xml',
        },
        bin,
        dir,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/using JUnit report reports\/custom\.xml/);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--junit reports/custom.xml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto-detects the first common JUnit path when junit input is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      initGit(dir);
      mkdirSync(join(dir, 'test-results'), { recursive: true });
      mkdirSync(join(dir, 'coverage'), { recursive: true });
      writeFileSync(join(dir, 'test-results', 'junit.xml'), SAMPLE_JUNIT);
      writeFileSync(join(dir, 'coverage', 'junit.xml'), SAMPLE_JUNIT);
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_PR_NUMBER: '8',
          INPUT_REPOSITORY: 'acme/widgets',
          INPUT_JUNIT: '',
        },
        bin,
        dir,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/using JUnit report test-results\/junit\.xml/);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--junit test-results/junit.xml');
      expect(argv).not.toContain('coverage/junit.xml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers ./junit.xml over nested candidates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      initGit(dir);
      mkdirSync(join(dir, 'test-results'), { recursive: true });
      writeFileSync(join(dir, 'junit.xml'), SAMPLE_JUNIT);
      writeFileSync(join(dir, 'test-results', 'junit.xml'), SAMPLE_JUNIT);
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_PR_NUMBER: '8',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
        dir,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/using JUnit report junit\.xml/);
      expect(readFileSync(log, 'utf8')).toContain('--junit junit.xml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets an explicit junit input win over auto-detected files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      initGit(dir);
      writeFileSync(join(dir, 'junit.xml'), SAMPLE_JUNIT);
      writeFileSync(join(dir, 'custom.xml'), SAMPLE_JUNIT);
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_PR_NUMBER: '8',
          INPUT_REPOSITORY: 'acme/widgets',
          INPUT_JUNIT: 'custom.xml',
        },
        bin,
        dir,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--junit custom.xml');
      expect(argv).not.toContain('--junit junit.xml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits --junit when no report exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      initGit(dir);
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_PR_NUMBER: '8',
          INPUT_REPOSITORY: 'acme/widgets',
        },
        bin,
        dir,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).not.toMatch(/JUnit report/);
      expect(readFileSync(log, 'utf8')).not.toContain('--junit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --file / --parts / --incomplete for a matrix shard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_PR_NUMBER: '8',
          INPUT_REPOSITORY: 'acme/widgets',
          INPUT_FILES: 'coverage/lcov.info,coverage/python.xml',
          INPUT_PARTS: '2',
          INPUT_PART: '1',
          INPUT_COMPLETE: 'false',
          INPUT_SHARD: 'node',
          INPUT_RUN_ID: '99',
        },
        bin,
      );
      expect(result.status).toBe(0);
      const argv = readFileSync(log, 'utf8');
      expect(argv).toContain('--file coverage/lcov.info');
      expect(argv).toContain('--file coverage/python.xml');
      expect(argv).toContain('--parts 2');
      expect(argv).toContain('--part 1');
      expect(argv).toContain('--incomplete');
      expect(argv).toContain('--shard node');
      expect(argv).toContain('--run-id 99');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --complete on the finish handshake', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin, log } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          EVENT_PR_NUMBER: '8',
          INPUT_REPOSITORY: 'acme/widgets',
          INPUT_COMPLETE: 'true',
        },
        bin,
      );
      expect(result.status).toBe(0);
      expect(readFileSync(log, 'utf8')).toContain('--complete');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a polluted GITHUB_PR_NUMBER when the event has no PR', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tested-run-push-'));
    try {
      const { bin } = mockTested(dir);
      const result = runPush(
        {
          TESTED_TOKEN: 't',
          GITHUB_PR_NUMBER: '99',
          PR_NUMBER: '99',
          EVENT_NAME: 'push',
          DEFAULT_BRANCH: 'main',
          REF_NAME: 'feature',
        },
        bin,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/pr-number|mainline/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
