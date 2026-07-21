import { describe, it, expect, vi } from 'vitest';
import {
  runDoctor,
  formatDoctorHuman,
  buildDoctorJson,
  TESTED_BIN_BASENAME_RE,
} from '../../src/commands/doctor.js';
import type { TestedConfig } from '../../src/schemas.js';

function makeConfig(path = 'coverage/coverage-final.json'): TestedConfig {
  return {
    ignores: [],
    coverage: { format: 'istanbul-json', path },
    base: 'main',
    testRunner: 'vitest',
    thresholds: { patch: 80, project: 60 },
  };
}

function mockGit(opts: {
  isRepo?: boolean;
  originUrl?: string | null;
  throwOnOrigin?: boolean;
}) {
  return vi.fn(() => ({
    checkIsRepo: async () => opts.isRepo ?? true,
    raw: async (args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        if (opts.throwOnOrigin) throw new Error('No such remote');
        if (opts.originUrl === null) return '';
        return opts.originUrl ?? 'https://github.com/acme/demo.git';
      }
      return '';
    },
  }));
}

describe('TESTED_BIN_BASENAME_RE', () => {
  it('accepts tested and tested.js', () => {
    expect(TESTED_BIN_BASENAME_RE.test('tested')).toBe(true);
    expect(TESTED_BIN_BASENAME_RE.test('tested.js')).toBe(true);
    expect(TESTED_BIN_BASENAME_RE.test('evil')).toBe(false);
    expect(TESTED_BIN_BASENAME_RE.test('tested.sh')).toBe(false);
  });
});

describe('runDoctor', () => {
  it('passes a healthy environment', async () => {
    const exists = vi.fn((p: string) => {
      if (p.endsWith('.tested.yaml')) return true;
      if (p.includes('coverage-final.json')) return true;
      return false;
    });
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.14.0',
      env: { TESTED_TOKEN: 'secret-never-print' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({ isRepo: true }) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[PASS]');
    expect(result.stdout).not.toContain('secret-never-print');
    const node = result.checks.find((c) => c.id === 'node');
    expect(node?.status).toBe('pass');
    const token = result.checks.find((c) => c.id === 'token');
    expect(token?.status).toBe('pass');
    expect(token?.detail).toMatch(/TESTED_TOKEN/);
    expect(token?.detail).not.toContain('secret');
  });

  it('fails on old Node', async () => {
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v18.0.0',
      env: {},
      existsSyncFn: (() => true) as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.checks.find((c) => c.id === 'node')?.status).toBe('fail');
  });

  it('fails when not a git repo', async () => {
    const result = await runDoctor({
      cwd: '/tmp/not-a-repo',
      nodeVersion: 'v22.0.0',
      env: {},
      existsSyncFn: (() => false) as typeof import('node:fs').existsSync,
      gitFactory: mockGit({ isRepo: false }) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.checks.find((c) => c.id === 'git')?.status).toBe('fail');
    expect(result.checks.find((c) => c.id === 'origin')?.status).toBe('skip');
  });

  it('fails when .tested.yaml is missing', async () => {
    const exists = vi.fn((p: string) => !p.endsWith('.tested.yaml'));
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.checks.find((c) => c.id === 'config')?.status).toBe('fail');
  });

  it('warns when coverage file is missing (optional)', async () => {
    const exists = vi.fn((p: string) => p.endsWith('.tested.yaml'));
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    // Still ok if only coverage is missing
    expect(result.exitCode).toBe(0);
    expect(result.checks.find((c) => c.id === 'coverage')?.status).toBe('warn');
  });

  it('fails when origin remote is missing', async () => {
    const exists = vi.fn((p: string) => p.endsWith('.tested.yaml') || p.includes('coverage'));
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({ throwOnOrigin: true }) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.checks.find((c) => c.id === 'origin')?.status).toBe('fail');
  });

  it('warns when token is missing (optional for local loop)', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.checks.find((c) => c.id === 'token')?.status).toBe('warn');
  });

  it('validates TESTED_API_URL when set', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const bad = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: { TESTED_API_URL: 'http://evil.example.com' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(bad.exitCode).toBe(1);
    expect(bad.checks.find((c) => c.id === 'api_url')?.status).toBe('fail');

    const good = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: { TESTED_API_URL: 'https://app.tested.dev' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(good.checks.find((c) => c.id === 'api_url')?.status).toBe('pass');
  });

  it('checks TESTED_BIN basename when set', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const bad = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: { TESTED_BIN: '/opt/bin/evil.sh' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(bad.exitCode).toBe(1);
    expect(bad.checks.find((c) => c.id === 'tested_bin')?.status).toBe('fail');

    const good = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: { TESTED_BIN: '/opt/cli/dist/tested.js' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(good.checks.find((c) => c.id === 'tested_bin')?.status).toBe('pass');
  });

  it('emits JSON without secrets', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: { TESTED_TOKEN: 'super-secret-token-value' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
      json: true,
    });
    expect(result.stdout).toContain('"schemaVersion": 1');
    expect(result.stdout).not.toContain('super-secret-token-value');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
  });

  it('redacts credentials in origin URL', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({
        originUrl: 'https://user:ghp_secret@github.com/acme/demo.git',
      }) as never,
      loadConfigFn: async () => makeConfig(),
    });
    const origin = result.checks.find((c) => c.id === 'origin');
    expect(origin?.detail).toContain('***@');
    expect(origin?.detail).not.toContain('ghp_secret');
  });
});

describe('formatDoctorHuman / buildDoctorJson', () => {
  it('includes badges and overall status', () => {
    const text = formatDoctorHuman({
      checks: [
        { id: 'node', label: 'Node.js', status: 'pass', detail: 'v22' },
        { id: 'git', label: 'Git repo', status: 'fail', detail: 'nope' },
      ],
      ok: false,
      exitCode: 1,
    });
    expect(text).toContain('doctor');
    expect(text).toContain('[PASS]');
    expect(text).toContain('[FAIL]');
    expect(text).toContain('tested doctor');
  });

  it('serializes checks for agents', () => {
    const json = buildDoctorJson({
      checks: [{ id: 'node', label: 'Node.js', status: 'pass', detail: 'v22' }],
      ok: true,
      exitCode: 0,
    });
    expect(json).toMatchObject({ schemaVersion: 1, ok: true });
  });
});
