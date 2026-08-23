import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../../action/run-push.sh');
const actionYml = join(here, '../../action/action.yml');

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
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bash', [script], {
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
