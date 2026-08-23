import { describe, expect, it } from 'vitest';
import {
  formatTokenHuman,
  formatTokenJson,
  formatWhoamiHuman,
  formatWhoamiJson,
  runToken,
  runWhoami,
  tokenSourceFromEnv,
} from '../../src/commands/token.js';

describe('tokenSourceFromEnv', () => {
  it('names env sources without reading values', () => {
    expect(tokenSourceFromEnv({ TESTED_TOKEN: 'x' })).toBe('TESTED_TOKEN');
    expect(tokenSourceFromEnv({ TESTED_INGEST_TOKEN: 'x' })).toBe(
      'TESTED_INGEST_TOKEN',
    );
    expect(tokenSourceFromEnv({ TESTED_TOKEN_FILE: '/tmp/t' })).toBe(
      'TESTED_TOKEN_FILE',
    );
  });
});

describe('formatToken*', () => {
  it('prints mint URL and env names', () => {
    const text = formatTokenHuman({ owner: 'acme', name: 'demo' });
    expect(text).toContain('https://app.tested.dev/repos/acme/demo/settings');
    expect(text).toContain('TESTED_TOKEN');
    expect(text).toContain('TESTED_TOKEN_FILE');
    expect(text).toContain('TESTED_INGEST_TOKEN');
  });

  it('emits JSON with the same fields', () => {
    const parsed = JSON.parse(
      formatTokenJson({ owner: 'acme', name: 'demo' }),
    ) as {
      schemaVersion: number;
      mintUrl: string;
      envNames: string[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.mintUrl).toBe(
      'https://app.tested.dev/repos/acme/demo/settings',
    );
    expect(parsed.envNames).toEqual([
      'TESTED_TOKEN',
      'TESTED_TOKEN_FILE',
      'TESTED_INGEST_TOKEN',
    ]);
  });
});

describe('formatWhoami*', () => {
  it('never prints a token value', () => {
    const set = formatWhoamiHuman({
      tokenSet: true,
      source: 'TESTED_TOKEN',
      identity: { owner: 'acme', name: 'demo' },
      exitCode: 0,
    });
    expect(set).toContain('set via TESTED_TOKEN');
    expect(set).toContain('value not shown');
    expect(set).not.toMatch(/sk_|secret|ghp_/);

    const missing = formatWhoamiHuman({
      tokenSet: false,
      source: null,
      identity: { owner: 'acme', name: 'demo' },
      exitCode: 1,
    });
    expect(missing).toContain('token: not set');
    expect(missing).toContain('TESTED_TOKEN');
  });

  it('emits JSON without a token field', () => {
    const parsed = JSON.parse(
      formatWhoamiJson({
        tokenSet: true,
        source: 'TESTED_TOKEN',
        identity: { owner: 'acme', name: 'demo' },
        exitCode: 0,
      }),
    ) as Record<string, unknown>;
    expect(parsed.tokenSet).toBe(true);
    expect(parsed.source).toBe('TESTED_TOKEN');
    expect(parsed).not.toHaveProperty('token');
  });
});

describe('runToken / runWhoami', () => {
  it('runToken uses origin owner/name when present', async () => {
    const result = await runToken({
      cwd: '/repo',
      json: true,
      openRepoFn: async () => ({ git: {} as never, repoRoot: '/repo' }),
      remoteUrlFn: async () => 'https://github.com/acme/demo.git',
    });
    const parsed = JSON.parse(result.stdout) as { mintUrl: string };
    expect(parsed.mintUrl).toBe(
      'https://app.tested.dev/repos/acme/demo/settings',
    );
    expect(result.exitCode).toBe(0);
  });

  it('runWhoami reports a set token without printing it', async () => {
    const result = await runWhoami({
      cwd: '/repo',
      env: { TESTED_TOKEN: 'super-secret-never-print' },
      json: true,
      openRepoFn: async () => ({ git: {} as never, repoRoot: '/repo' }),
      remoteUrlFn: async () => 'https://github.com/acme/demo.git',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('super-secret-never-print');
    const parsed = JSON.parse(result.stdout) as { tokenSet: boolean };
    expect(parsed.tokenSet).toBe(true);
  });

  it('runWhoami exits 1 when no token is set', async () => {
    const result = await runWhoami({
      cwd: '/repo',
      env: {},
      json: false,
      openRepoFn: async () => {
        throw new Error('no git');
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('token: not set');
  });
});
