import { describe, it, expect, vi } from 'vitest';
import {
  runDoctor,
  formatDoctorHuman,
  buildDoctorJson,
  TESTED_BIN_BASENAME_RE,
  MIN_NODE_MAJOR,
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

describe('MIN_NODE_MAJOR', () => {
  it('matches engines.node (>=24)', () => {
    expect(MIN_NODE_MAJOR).toBe(24);
  });
});

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
      nodeVersion: 'v24.5.0',
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

  it('fails on Node 20 (engines.node is >=24)', async () => {
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v20.19.2',
      env: {},
      existsSyncFn: (() => true) as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    const node = result.checks.find((c) => c.id === 'node');
    expect(node?.status).toBe('fail');
    expect(node?.optional).not.toBe(true);
    expect(node?.detail).toMatch(/20\.19\.2/);
    expect(node?.detail).toMatch(/Node >= 24 required/);
    expect(node?.detail).not.toMatch(/—/);
  });

  it('fails on Node 22 (engines.node is >=24)', async () => {
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v22.14.0',
      env: {},
      existsSyncFn: (() => true) as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    const node = result.checks.find((c) => c.id === 'node');
    expect(node?.status).toBe('fail');
    expect(node?.optional).not.toBe(true);
    expect(node?.detail).toMatch(/22\.14\.0/);
    expect(node?.detail).toMatch(/Node >= 24 required/);
  });

  it('fails on older Node (v18)', async () => {
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
      nodeVersion: 'v24.0.0',
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
      nodeVersion: 'v24.0.0',
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
      nodeVersion: 'v24.0.0',
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
      nodeVersion: 'v24.0.0',
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
      nodeVersion: 'v24.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(0);
    const token = result.checks.find((c) => c.id === 'token');
    expect(token?.status).toBe('warn');
    expect(token?.detail).toContain(
      'https://app.tested.dev/repos/acme/demo/settings',
    );
    expect(token?.detail).toMatch(/TESTED_TOKEN/);
    expect(token?.detail).toMatch(/TESTED_TOKEN_FILE/);
    expect(token?.detail).toMatch(/TESTED_INGEST_TOKEN/);
  });

  it('validates TESTED_API_URL when set', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const bad = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: { TESTED_API_URL: 'http://evil.example.com' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(bad.exitCode).toBe(1);
    expect(bad.checks.find((c) => c.id === 'api_url')?.status).toBe('fail');

    const good = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: { TESTED_API_URL: 'https://app.tested.dev' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(good.checks.find((c) => c.id === 'api_url')?.status).toBe('pass');

    const httpsExfil = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: { TESTED_API_URL: 'https://evil.example.com' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(httpsExfil.exitCode).toBe(1);
    expect(httpsExfil.checks.find((c) => c.id === 'api_url')?.status).toBe('fail');
    expect(httpsExfil.checks.find((c) => c.id === 'api_url')?.detail).toMatch(
      /not allowed/,
    );
  });

  it('checks TESTED_BIN basename when set', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const bad = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: { TESTED_BIN: '/opt/bin/evil.sh' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(bad.exitCode).toBe(1);
    expect(bad.checks.find((c) => c.id === 'tested_bin')?.status).toBe('fail');

    const good = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
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
      nodeVersion: 'v24.0.0',
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
      nodeVersion: 'v24.0.0',
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

  it('warns when TESTED_BIN is a relative path', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: { TESTED_BIN: 'dist/tested.js' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    const bin = result.checks.find((c) => c.id === 'tested_bin');
    expect(bin?.status).toBe('warn');
    expect(bin?.detail).toMatch(/relative path/);
  });

  it('keeps the default coverage path when loadConfig throws', async () => {
    const exists = vi.fn((p: string) => p.endsWith('.tested.yaml'));
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => {
        throw new Error('bad yaml');
      },
    });
    expect(result.checks.find((c) => c.id === 'coverage')?.detail).toMatch(
      /coverage\/coverage-final\.json/,
    );
  });

  it('fails when origin URL is empty', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({ originUrl: '' }) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.checks.find((c) => c.id === 'origin')?.detail).toMatch(/empty/);
  });

  it('names TESTED_INGEST_TOKEN and TESTED_TOKEN_FILE as the token source', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const ingest = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: { TESTED_INGEST_TOKEN: 'tok' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
    });
    expect(ingest.checks.find((c) => c.id === 'token')?.detail).toMatch(
      /TESTED_INGEST_TOKEN/,
    );

    const file = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: { TESTED_TOKEN_FILE: '/tmp/token' },
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
      resolveTokenFn: () => 'from-file',
    });
    expect(file.checks.find((c) => c.id === 'token')?.detail).toMatch(
      /TESTED_TOKEN_FILE/,
    );
  });

  it('reports a token resolve failure without echoing secrets', async () => {
    const exists = vi.fn(
      (p: string) => p.endsWith('.tested.yaml') || p.includes('coverage-final'),
    );
    const result = await runDoctor({
      cwd: '/repo',
      nodeVersion: 'v24.0.0',
      env: {},
      existsSyncFn: exists as typeof import('node:fs').existsSync,
      gitFactory: mockGit({}) as never,
      loadConfigFn: async () => makeConfig(),
      resolveTokenFn: () => {
        throw new Error('token file "supersecretvalue" is world-readable');
      },
    });
    const token = result.checks.find((c) => c.id === 'token');
    expect(token?.status).toBe('fail');
    expect(token?.detail).not.toContain('supersecretvalue');
  });
});

describe('formatDoctorHuman / buildDoctorJson', () => {
  it('includes badges and overall status', () => {
    const text = formatDoctorHuman({
      checks: [
        { id: 'node', label: 'Node.js', status: 'pass', detail: 'v24' },
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
      checks: [{ id: 'node', label: 'Node.js', status: 'pass', detail: 'v24' }],
      ok: true,
      exitCode: 0,
    });
    expect(json).toMatchObject({ schemaVersion: 1, ok: true });
  });
});
