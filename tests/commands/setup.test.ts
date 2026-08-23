import { describe, it, expect, vi } from 'vitest';
import {
  runSetup,
  buildCiSnippet,
  buildTokenInstructions,
  buildInstallInstructions,
  formatSetupHuman,
  PINNED_CLI,
} from '../../src/commands/setup.js';
import type { InitResult } from '../../src/commands/init.js';
import type { DoctorResult } from '../../src/commands/doctor.js';

const sampleInit: InitResult = {
  configPath: '/repo/.tested.yaml',
  configWritten: true,
  hookInstalled: false,
  hookPath: null,
  detected: { hasPackageJson: true, testRunner: 'vitest', defaultBranch: 'main' },
  nextSteps: ['1. tested run'],
  warnings: [],
};

function okDoctor(): DoctorResult {
  return {
    checks: [
      { id: 'node', label: 'Node.js', status: 'pass', detail: 'v22' },
      { id: 'config', label: '.tested.yaml', status: 'pass', detail: 'ok' },
    ],
    ok: true,
    exitCode: 0,
    stdout: 'tested.dev — doctor  [PASS]\n\n  Node.js  [PASS]  v22\n',
    stderr: '',
  };
}

describe('buildCiSnippet / token / install', () => {
  it('includes composite action and secrets placeholder', () => {
    const snip = buildCiSnippet();
    expect(snip).toContain('tested-hq/cli/action@main');
    expect(snip).toContain('secrets.TESTED_TOKEN');
    expect(snip).toContain('version: 0.1.2');
    expect(snip).not.toContain('cli-ref');
    expect(snip).not.toContain('fetch-depth: 0');
  });

  it('token instructions never invent a sample secret value', () => {
    const text = buildTokenInstructions();
    expect(text).toMatch(/TESTED_TOKEN/);
    expect(text).toMatch(/TESTED_TOKEN_FILE/);
    expect(text).toMatch(/TESTED_INGEST_TOKEN/);
    expect(text).toContain(
      'https://app.tested.dev/repos/{owner}/{name}/settings',
    );
    expect(text).not.toMatch(/sk_live|ghp_/);
  });

  it('prints npm install instructions', () => {
    const text = buildInstallInstructions();
    expect(text).toContain(PINNED_CLI);
    expect(text).toContain('pnpm add -D @tested/cli');
    expect(text).toContain('npx @tested/cli');
    expect(text).toContain('tested-hq/cli/action@main');
    expect(text.toLowerCase()).not.toMatch(/not on npm|git\+https/);
  });
});

describe('runSetup', () => {
  it('runs init when .tested.yaml is missing', async () => {
    const runInitFn = vi.fn(async () => sampleInit);
    const runDoctorFn = vi.fn(async () => okDoctor());
    const result = await runSetup({
      cwd: '/repo',
      existsSyncFn: (() => false) as typeof import('node:fs').existsSync,
      runInitFn,
      runDoctorFn,
    });
    expect(runInitFn).toHaveBeenCalledOnce();
    expect(result.initRan).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('setup');
    expect(result.stdout).toContain('CI snippet');
    expect(result.stdout).toContain('TESTED_TOKEN');
    expect(result.stdout).toContain(PINNED_CLI);
  });

  it('skips init when config already exists', async () => {
    const runInitFn = vi.fn(async () => sampleInit);
    const runDoctorFn = vi.fn(async () => okDoctor());
    const result = await runSetup({
      cwd: '/repo',
      existsSyncFn: ((p: string) => p.endsWith('.tested.yaml')) as typeof import('node:fs').existsSync,
      runInitFn,
      runDoctorFn,
    });
    expect(runInitFn).not.toHaveBeenCalled();
    expect(result.initRan).toBe(false);
    expect(result.stdout).toContain('already present');
  });

  it('force re-runs init', async () => {
    const runInitFn = vi.fn(async () => sampleInit);
    const runDoctorFn = vi.fn(async () => okDoctor());
    await runSetup({
      cwd: '/repo',
      force: true,
      existsSyncFn: ((p: string) => p.endsWith('.tested.yaml')) as typeof import('node:fs').existsSync,
      runInitFn,
      runDoctorFn,
    });
    expect(runInitFn).toHaveBeenCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it('propagates doctor exit code', async () => {
    const failDoctor: DoctorResult = {
      ...okDoctor(),
      ok: false,
      exitCode: 1,
    };
    const result = await runSetup({
      cwd: '/repo',
      existsSyncFn: ((p: string) => p.endsWith('.tested.yaml')) as typeof import('node:fs').existsSync,
      runInitFn: async () => sampleInit,
      runDoctorFn: async () => failDoctor,
    });
    expect(result.exitCode).toBe(1);
  });

  it('json mode includes snippet and pin', async () => {
    const result = await runSetup({
      cwd: '/repo',
      json: true,
      existsSyncFn: (() => false) as typeof import('node:fs').existsSync,
      runInitFn: async () => sampleInit,
      runDoctorFn: async () => okDoctor(),
    });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.initRan).toBe(true);
    expect(parsed.pinnedCli).toBe(PINNED_CLI);
    expect(parsed.install).toContain('pnpm add -D @tested/cli');
    expect(parsed.ciSnippet).toContain('tested-hq/cli/action');
    expect(parsed.tokenInstructions).toContain('TESTED_TOKEN');
  });
});

describe('formatSetupHuman', () => {
  it('shows doctor + next steps', () => {
    const text = formatSetupHuman({
      initRan: false,
      initResult: null,
      doctor: okDoctor(),
    });
    expect(text).toContain('setup');
    expect(text).toContain('doctor');
    expect(text).toContain('tested run');
    expect(text).toContain('tested push');
    expect(text).toContain('no executable lines');
  });
});
