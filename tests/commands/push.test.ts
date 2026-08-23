import { describe, it, expect, vi } from 'vitest';
import {
  resolveToken,
  readTokenFile,
  resetTokenArgvWarning,
  resolveApiBase,
  assertSafeApiBase,
  isAllowedApiHost,
  parseGitHubRepository,
  redactGitRemote,
  resolvePrNumber,
  parseGitHubRemote,
  sanitizeAuthor,
  toBranchName,
  buildIngestBody,
  postIngest,
  formatPushSuccess,
  formatPushError,
  formatMissingTokenError,
  executePush,
  DEFAULT_API_BASE,
  type IngestBody,
} from '../../src/commands/push.js';
import type { DiffOutput, TestedConfig } from '../../src/schemas.js';
import type { GitContext } from '../../src/git.js';

function makeDiff(): DiffOutput {
  return {
    schemaVersion: 1,
    base: 'main',
    head: 'abc1234deadbeef',
    patch: { executable: 10, covered: 8, pct: 80 },
    project: { executable: 100, covered: 70, pct: 70, delta: null },
    files: [],
    ignored: [],
  };
}

function makeConfig(overrides: Partial<TestedConfig> = {}): TestedConfig {
  return {
    ignores: [],
    coverage: { format: 'istanbul-json', path: 'coverage/coverage-final.json' },
    base: 'origin/main',
    testRunner: null,
    ...overrides,
  };
}

function mockGitCtx(): GitContext {
  return {
    git: {} as GitContext['git'],
    repoRoot: '/repo',
  };
}

describe('resolveToken', () => {
  it('prefers --token flag over env', () => {
    expect(
      resolveToken({
        flag: 'flag-token',
        env: { TESTED_TOKEN: 'env-token', TESTED_INGEST_TOKEN: 'ingest' },
        isTTY: false,
      }),
    ).toBe('flag-token');
  });

  it('falls back to TESTED_TOKEN then TESTED_INGEST_TOKEN', () => {
    expect(resolveToken({ env: { TESTED_TOKEN: 'a' }, isTTY: false })).toBe('a');
    expect(resolveToken({ env: { TESTED_INGEST_TOKEN: 'b' }, isTTY: false })).toBe(
      'b',
    );
    expect(
      resolveToken({
        env: { TESTED_TOKEN: 'a', TESTED_INGEST_TOKEN: 'b' },
        isTTY: false,
      }),
    ).toBe('a');
  });

  it('reads TESTED_TOKEN_FILE when env tokens are unset', () => {
    const warnings: string[] = [];
    const token = resolveToken({
      env: { TESTED_TOKEN_FILE: '/secret/token' },
      isTTY: false,
      warn: (m) => warnings.push(m),
      readFileSyncFn: (() => '  file-token\n') as unknown as typeof import('node:fs').readFileSync,
      statSyncFn: (() => ({ mode: 0o600 })) as unknown as typeof import('node:fs').statSync,
    });
    expect(token).toBe('file-token');
    expect(warnings).toHaveLength(0);
  });

  it('warns once on TTY when --token is used', () => {
    resetTokenArgvWarning();
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(
      resolveToken({ flag: 'secret', env: {}, isTTY: true, warn }),
    ).toBe('secret');
    expect(
      resolveToken({ flag: 'secret2', env: {}, isTTY: true, warn }),
    ).toBe('secret2');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/--token/);
  });

  it('returns null when missing', () => {
    expect(resolveToken({ env: {}, isTTY: false })).toBeNull();
    expect(resolveToken({ flag: '', env: {}, isTTY: false })).toBeNull();
  });
});

describe('readTokenFile', () => {
  it('rejects world-readable token files', () => {
    expect(() =>
      readTokenFile('/t', {
        readFileSyncFn: (() => 'tok') as unknown as typeof import('node:fs').readFileSync,
        statSyncFn: (() => ({ mode: 0o644 })) as unknown as typeof import('node:fs').statSync,
      }),
    ).toThrow(/world-readable/);
  });

  it('accepts mode 0600', () => {
    expect(
      readTokenFile('/t', {
        readFileSyncFn: (() => 'tok\n') as unknown as typeof import('node:fs').readFileSync,
        statSyncFn: (() => ({ mode: 0o600 })) as unknown as typeof import('node:fs').statSync,
      }),
    ).toBe('tok');
  });
});

describe('resolveApiBase / assertSafeApiBase', () => {
  it('defaults to app.tested.dev', () => {
    expect(resolveApiBase({ env: {} })).toBe(DEFAULT_API_BASE);
  });

  it('treats empty TESTED_API_URL / --url as the default', () => {
    expect(resolveApiBase({ env: { TESTED_API_URL: '' } })).toBe(DEFAULT_API_BASE);
    expect(resolveApiBase({ env: { TESTED_API_URL: '   ' } })).toBe(DEFAULT_API_BASE);
    expect(resolveApiBase({ flag: '', env: {} })).toBe(DEFAULT_API_BASE);
    expect(resolveApiBase({ flag: '  ', env: { TESTED_API_URL: '' } })).toBe(
      DEFAULT_API_BASE,
    );
  });

  it('prefers flag, then TESTED_API_URL, strips trailing slash', () => {
    expect(
      resolveApiBase({
        flag: 'https://staging.tested.dev/',
        env: { TESTED_API_URL: 'https://app.tested.dev/' },
      }),
    ).toBe('https://staging.tested.dev');
    expect(resolveApiBase({ env: { TESTED_API_URL: 'https://app.tested.dev/' } })).toBe(
      'https://app.tested.dev',
    );
  });

  it('allows http only for localhost', () => {
    expect(assertSafeApiBase('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(assertSafeApiBase('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('rejects non-https remote URLs (SSRF / token exfil)', () => {
    expect(() => assertSafeApiBase('http://evil.example/')).toThrow(/https/);
    expect(() => assertSafeApiBase('ftp://app.tested.dev')).toThrow(/https/);
  });

  it('rejects arbitrary https hosts so the Bearer token cannot be exfiltrated', () => {
    expect(() => assertSafeApiBase('https://evil.example/')).toThrow(/not allowed/);
    expect(() =>
      resolveApiBase({ env: { TESTED_API_URL: 'https://attacker.example' } }),
    ).toThrow(/not allowed/);
    expect(() => assertSafeApiBase('https://app.tested.dev.evil.example')).toThrow(
      /not allowed/,
    );
    expect(() => assertSafeApiBase('https://tested.dev.evil.example')).toThrow(
      /not allowed/,
    );
  });

  it('allows custom https hosts only with TESTED_ALLOW_CUSTOM_API_URL', () => {
    expect(
      resolveApiBase({
        env: {
          TESTED_API_URL: 'https://ingest.example/',
          TESTED_ALLOW_CUSTOM_API_URL: '1',
        },
      }),
    ).toBe('https://ingest.example');
    expect(assertSafeApiBase('https://ingest.example', { allowCustom: true })).toBe(
      'https://ingest.example',
    );
  });

  it('treats tested.dev and localhost as allowed ingest hosts', () => {
    expect(isAllowedApiHost('app.tested.dev')).toBe(true);
    expect(isAllowedApiHost('staging.tested.dev')).toBe(true);
    expect(isAllowedApiHost('tested.dev')).toBe(true);
    expect(isAllowedApiHost('app.tested.dev.evil.example')).toBe(false);
    expect(assertSafeApiBase('https://localhost:8443')).toBe('https://localhost:8443');
  });

  it('rejects embedded credentials in API URL', () => {
    expect(() =>
      assertSafeApiBase('https://user:pass@app.tested.dev'),
    ).toThrow(/credentials/);
  });

  it('rejects non-absolute / unparseable URLs', () => {
    expect(() => assertSafeApiBase('not-a-url')).toThrow(/invalid API URL/);
    expect(() => assertSafeApiBase('')).toThrow(/empty/);
  });
});

describe('redactGitRemote', () => {
  it('redacts userinfo from https remotes', () => {
    expect(redactGitRemote('https://ghp_secret@github.com/acme/widgets.git')).toBe(
      'https://***@github.com/acme/widgets.git',
    );
    expect(
      redactGitRemote('https://user:token@github.com/acme/widgets.git'),
    ).toBe('https://***@github.com/acme/widgets.git');
  });

  it('leaves scp-style remotes unchanged', () => {
    expect(redactGitRemote('git@github.com:acme/widgets.git')).toBe(
      'git@github.com:acme/widgets.git',
    );
  });
});

describe('resolvePrNumber', () => {
  it('reads --pr flag first', () => {
    expect(
      resolvePrNumber({ flag: '42', env: { GITHUB_PR_NUMBER: '1', PR_NUMBER: '2' } }),
    ).toBe(42);
  });

  it('falls back to GITHUB_PR_NUMBER then PR_NUMBER', () => {
    expect(resolvePrNumber({ env: { GITHUB_PR_NUMBER: '7' } })).toBe(7);
    expect(resolvePrNumber({ env: { PR_NUMBER: '9' } })).toBe(9);
    expect(
      resolvePrNumber({ env: { GITHUB_PR_NUMBER: '7', PR_NUMBER: '9' } }),
    ).toBe(7);
  });

  it('returns null when missing', () => {
    expect(resolvePrNumber({ env: {} })).toBeNull();
  });

  it('throws on non-positive / non-integer values', () => {
    expect(() => resolvePrNumber({ flag: '0', env: {} })).toThrow(/invalid PR number/);
    expect(() => resolvePrNumber({ flag: '1.5', env: {} })).toThrow(/invalid PR number/);
    expect(() => resolvePrNumber({ flag: 'nope', env: {} })).toThrow(/invalid PR number/);
  });
});

describe('parseGitHubRemote', () => {
  it('parses scp-style git@github.com:owner/name.git', () => {
    expect(parseGitHubRemote('git@github.com:acme/widgets.git')).toEqual({
      owner: 'acme',
      name: 'widgets',
    });
  });

  it('parses https remotes with and without .git', () => {
    expect(parseGitHubRemote('https://github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      name: 'widgets',
    });
    expect(parseGitHubRemote('https://github.com/acme/widgets')).toEqual({
      owner: 'acme',
      name: 'widgets',
    });
  });

  it('parses ssh:// URLs', () => {
    expect(parseGitHubRemote('ssh://git@github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      name: 'widgets',
    });
  });

  it('returns null for unparseable input', () => {
    expect(parseGitHubRemote('')).toBeNull();
    expect(parseGitHubRemote('not-a-url')).toBeNull();
  });
});

describe('parseGitHubRepository', () => {
  it('parses owner/name and rejects unsafe values', () => {
    expect(parseGitHubRepository('acme/widgets')).toEqual({
      owner: 'acme',
      name: 'widgets',
    });
    expect(parseGitHubRepository('  acme/widgets  ')).toEqual({
      owner: 'acme',
      name: 'widgets',
    });
    expect(parseGitHubRepository('acme/foo/bar')).toBeNull();
    expect(parseGitHubRepository('acme/foo;id')).toBeNull();
    expect(parseGitHubRepository('')).toBeNull();
    expect(parseGitHubRepository(undefined)).toBeNull();
  });
});

describe('sanitizeAuthor', () => {
  it('lowercases and slugifies names', () => {
    expect(sanitizeAuthor('Jane Doe')).toBe('jane-doe');
    expect(sanitizeAuthor('  Alice_B@b  ')).toBe('alice-b-b');
  });

  it('falls back to unknown for empty input', () => {
    expect(sanitizeAuthor('   ')).toBe('unknown');
    expect(sanitizeAuthor('@@@')).toBe('unknown');
  });
});

describe('toBranchName', () => {
  it('strips common git ref prefixes', () => {
    expect(toBranchName('origin/main')).toBe('main');
    expect(toBranchName('refs/heads/feature/x')).toBe('feature/x');
    expect(toBranchName('refs/remotes/origin/main')).toBe('main');
    expect(toBranchName('main')).toBe('main');
  });
});

describe('buildIngestBody', () => {
  it('shapes the POST body and normalizes baseRef', () => {
    const diff = makeDiff();
    const body = buildIngestBody({
      owner: 'acme',
      name: 'widgets',
      baseRef: 'origin/main',
      prNumber: 12,
      prTitle: 'Add feature',
      author: 'jane',
      headRef: 'feat/x',
      headSha: 'abc1234deadbeef',
      runUrl: 'https://ci.example/1',
      diff,
    });
    expect(body).toEqual({
      repo: { owner: 'acme', name: 'widgets', defaultBranch: 'main' },
      pr: {
        number: 12,
        title: 'Add feature',
        authorLogin: 'jane',
        baseRef: 'main',
        headRef: 'feat/x',
        headSha: 'abc1234deadbeef',
        state: 'open',
      },
      runUrl: 'https://ci.example/1',
      diff,
    } satisfies IngestBody);
  });
});

describe('postIngest', () => {
  it('POSTs JSON with Bearer token and returns shareUrl on 200', async () => {
    const body = buildIngestBody({
      owner: 'acme',
      name: 'widgets',
      baseRef: 'main',
      prNumber: 1,
      prTitle: 't',
      author: 'a',
      headRef: 'h',
      headSha: 'sha',
      runUrl: null,
      diff: makeDiff(),
    });

    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://app.tested.dev/api/ingest');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('manual');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer secret');
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual(body);
      return new Response(
        JSON.stringify({
          shareUrl: 'https://app.tested.dev/s/abc',
          expiresAt: '2026-08-01T00:00:00.000Z',
        }),
        { status: 200 },
      );
    });

    const result = await postIngest({
      apiBase: 'https://app.tested.dev',
      token: 'secret',
      body,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.shareUrl).toBe('https://app.tested.dev/s/abc');
      expect(result.data.expiresAt).toBe('2026-08-01T00:00:00.000Z');
    }
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('refuses to follow HTTP redirects (token exfil)', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example/steal' },
        }),
    );
    const result = await postIngest({
      apiBase: 'https://app.tested.dev',
      token: 'secret',
      body: buildIngestBody({
        owner: 'a',
        name: 'b',
        baseRef: 'main',
        prNumber: 1,
        prTitle: 't',
        author: 'u',
        headRef: 'h',
        headSha: 's',
        runUrl: null,
        diff: makeDiff(),
      }),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(302);
      expect(result.message).toMatch(/redirect/i);
    }
  });

  it('returns status + message on non-200', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'invalid token' }), { status: 401 }),
    );
    const result = await postIngest({
      apiBase: 'https://app.tested.dev',
      token: 'bad',
      body: buildIngestBody({
        owner: 'a',
        name: 'b',
        baseRef: 'main',
        prNumber: 1,
        prTitle: 't',
        author: 'u',
        headRef: 'h',
        headSha: 's',
        runUrl: null,
        diff: makeDiff(),
      }),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.message).toBe('invalid token');
    }
  });

  it('handles network failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await postIngest({
      apiBase: 'https://app.tested.dev',
      token: 't',
      body: buildIngestBody({
        owner: 'a',
        name: 'b',
        baseRef: 'main',
        prNumber: 1,
        prTitle: 't',
        author: 'u',
        headRef: 'h',
        headSha: 's',
        runUrl: null,
        diff: makeDiff(),
      }),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.message).toMatch(/network error.*ECONNREFUSED/);
    }
  });
});

describe('formatPushSuccess / formatPushError', () => {
  it('prints shareUrl in human mode', () => {
    const { stdout } = formatPushSuccess(
      { shareUrl: 'https://app.tested.dev/s/x' },
      false,
    );
    expect(stdout).toContain('https://app.tested.dev/s/x');
    expect(stdout).toMatch(/shared/);
  });

  it('prints expiresAt dim line when present in human mode', () => {
    const { stdout } = formatPushSuccess(
      { shareUrl: 'https://app.tested.dev/s/x', expiresAt: '2026-01-01T00:00:00Z' },
      false,
    );
    expect(stdout).toContain('https://app.tested.dev/s/x');
    expect(stdout).toContain('expires 2026-01-01T00:00:00Z');
  });

  it('includes expiresAt in json mode when present', () => {
    const { stdout } = formatPushSuccess(
      { shareUrl: 'https://app.tested.dev/s/x', expiresAt: '2026-01-01T00:00:00Z' },
      true,
    );
    expect(JSON.parse(stdout)).toEqual({
      shareUrl: 'https://app.tested.dev/s/x',
      expiresAt: '2026-01-01T00:00:00Z',
    });
  });

  it('formats HTTP errors with status as multi-line blocks', () => {
    const err403 = formatPushError(403, 'forbidden');
    expect(err403).toMatch(/error: ingest failed \(403\)/);
    expect(err403).toContain('forbidden');

    const net = formatPushError(0, 'network error: boom');
    expect(net).toMatch(/error: network error: boom/);
  });

  it('maps token_required / 401 to token guidance', () => {
    const text = formatPushError(401, 'token_required', 'token_required');
    expect(text).toMatch(/auth failed|token/i);
    expect(text).toContain('TESTED_TOKEN');
    expect(text).toContain(
      'https://app.tested.dev/repos/{owner}/{name}/settings',
    );
  });

  it('maps repo_not_found to owner/name guidance', () => {
    const text = formatPushError(404, 'repo_not_found', 'repo_not_found');
    expect(text).toMatch(/repo not found/i);
    expect(text).toContain('--owner');
    expect(text).toContain('--name');
  });

  it('formatMissingTokenError is multi-line help', () => {
    const text = formatMissingTokenError();
    expect(text).toContain('missing ingest token');
    expect(text).toContain('--token');
    expect(text).toContain('TESTED_TOKEN');
    expect(text).toContain('TESTED_TOKEN_FILE');
    expect(text).toContain('TESTED_INGEST_TOKEN');
    expect(text).toContain(
      'https://app.tested.dev/repos/{owner}/{name}/settings',
    );
  });

  it('formatMissingTokenError fills owner/name when known', () => {
    const text = formatMissingTokenError({ owner: 'acme', name: 'demo' });
    expect(text).toContain('https://app.tested.dev/repos/acme/demo/settings');
  });
});

describe('executePush', () => {
  it('errors clearly when token is missing', async () => {
    const result = await executePush(
      { json: false, pr: '1' },
      { cwd: '/repo', env: {}, onProgress: () => {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/missing ingest token/i);
    expect(result.stderr).toMatch(/TESTED_TOKEN/);
    expect(result.stderr).toMatch(/TESTED_INGEST_TOKEN/);
    expect(result.stderr).toMatch(/TESTED_TOKEN_FILE|--token/);
    expect(result.stderr).toContain(
      'https://app.tested.dev/repos/{owner}/{name}/settings',
    );
  });

  it('missing token names the mint URL when owner/name are known', async () => {
    const result = await executePush(
      { json: false, pr: '1', owner: 'acme', name: 'demo' },
      { cwd: '/repo', env: {}, onProgress: () => {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'https://app.tested.dev/repos/acme/demo/settings',
    );
  });

  it('rejects unsafe --url before contacting the network', async () => {
    const fetchFn = vi.fn();
    const result = await executePush(
      { json: false, token: 't', pr: '1', url: 'http://evil.example' },
      { cwd: '/repo', env: {}, fetchFn: fetchFn as unknown as typeof fetch, onProgress: () => {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/https/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects https token-exfil hosts before contacting the network', async () => {
    const fetchFn = vi.fn();
    const result = await executePush(
      { json: false, token: 't', pr: '1', url: 'https://evil.example' },
      { cwd: '/repo', env: {}, fetchFn: fetchFn as unknown as typeof fetch, onProgress: () => {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not allowed/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('errors clearly when PR number is missing', async () => {
    const result = await executePush(
      { json: false, token: 't' },
      { cwd: '/repo', env: {}, onProgress: () => {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/PR number required/i);
    expect(result.stderr).toMatch(/GITHUB_PR_NUMBER/);
  });

  it('posts ingest payload with mocked computeDiff + fetch and prints shareUrl', async () => {
    const diff = makeDiff();
    const computeDiffFn = vi.fn(async () => diff);
    let postedBody: IngestBody | undefined;
    let postedUrl: string | undefined;
    let postedAuth: string | undefined;
    const fetchFn: typeof fetch = async (url, init) => {
      postedUrl = String(url);
      const headers = init?.headers as Record<string, string> | undefined;
      postedAuth = headers?.Authorization;
      postedBody = JSON.parse(String(init?.body)) as IngestBody;
      return new Response(
        JSON.stringify({
          shareUrl: 'https://app.tested.dev/s/xyz',
          expiresAt: '2026-09-01T00:00:00.000Z',
        }),
        { status: 200 },
      );
    };

    const gitRaw = vi.fn(async (args: string[]) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return 'git@github.com:acme/widgets.git\n';
      }
      if (args[0] === 'config' && args[1] === 'user.name') {
        return 'Jane Doe\n';
      }
      throw new Error(`unexpected git.raw ${args.join(' ')}`);
    });
    const revparse = vi.fn(async (args: string[]) => {
      if (args[0] === 'HEAD') return 'abc1234deadbeef\n';
      if (args[0] === '--abbrev-ref') return 'feat/coverage\n';
      throw new Error(`unexpected revparse ${args.join(' ')}`);
    });

    const ctx: GitContext = {
      git: { raw: gitRaw, revparse } as unknown as GitContext['git'],
      repoRoot: '/repo',
    };

    const progress: string[] = [];
    const result = await executePush(
      {
        json: false,
        token: 'secret-token',
        pr: '99',
        runUrl: 'https://ci.example/run/1',
      },
      {
        cwd: '/repo',
        env: {},
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
        onProgress: (m) => progress.push(m),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('https://app.tested.dev/s/xyz');
    expect(result.stdout).toContain('expires 2026-09-01T00:00:00.000Z');
    expect(result.shareUrl).toBe('https://app.tested.dev/s/xyz');
    expect(progress).toContain('computing diff…');
    expect(progress).toContain('uploading…');
    expect(computeDiffFn).toHaveBeenCalledOnce();
    expect(postedUrl).toBe('https://app.tested.dev/api/ingest');
    expect(postedAuth).toBe('Bearer secret-token');
    expect(postedBody).toBeDefined();
    expect(postedBody!.repo).toEqual({
      owner: 'acme',
      name: 'widgets',
      defaultBranch: 'main',
    });
    expect(postedBody!.pr).toMatchObject({
      number: 99,
      title: 'feat/coverage',
      authorLogin: 'jane-doe',
      baseRef: 'main',
      headRef: 'feat/coverage',
      headSha: 'abc1234deadbeef',
      state: 'open',
    });
    expect(postedBody!.runUrl).toBe('https://ci.example/run/1');
    expect(postedBody!.diff).toEqual(diff);
  });

  it('emits JSON on success when --json is set', async () => {
    const computeDiffFn = vi.fn(async () => makeDiff());
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            shareUrl: 'https://app.tested.dev/s/j',
            expiresAt: '2026-10-01T00:00:00.000Z',
          }),
          { status: 200 },
        ),
    );
    const ctx: GitContext = {
      git: {
        raw: async (args: string[]) => {
          if (args[0] === 'remote') return 'https://github.com/acme/widgets.git\n';
          if (args[0] === 'config') return 'bob\n';
          return '\n';
        },
        revparse: async (args: string[]) => {
          if (args[0] === 'HEAD') return 'deadbeef\n';
          if (args[0] === '--abbrev-ref') return 'main\n';
          return '\n';
        },
      } as unknown as GitContext['git'],
      repoRoot: '/repo',
    };

    const result = await executePush(
      { json: true, token: 't', pr: '3', owner: 'acme', name: 'widgets' },
      {
        cwd: '/repo',
        env: {},
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn: fetchFn as unknown as typeof fetch,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
        onProgress: () => {},
      },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      shareUrl: 'https://app.tested.dev/s/j',
      expiresAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('prints status + body message and exits 1 on API error', async () => {
    const computeDiffFn = vi.fn(async () => makeDiff());
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'quota exceeded' }), { status: 429 }),
    );
    const ctx: GitContext = {
      git: {
        raw: async () => 'git@github.com:acme/widgets.git\n',
        revparse: async (args: string[]) =>
          args[0] === 'HEAD' ? 'sha\n' : 'branch\n',
      } as unknown as GitContext['git'],
      repoRoot: '/repo',
    };

    const result = await executePush(
      { json: false, token: 't', pr: '1', owner: 'acme', name: 'widgets' },
      {
        cwd: '/repo',
        env: {},
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn: fetchFn as unknown as typeof fetch,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
        onProgress: () => {},
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/error: ingest failed \(429\)/);
    expect(result.stderr).toContain('quota exceeded');
    expect(result.stdout).toBe('');
  });

  it('passes --base through to computeDiff', async () => {
    const computeDiffFn = vi.fn(async () => makeDiff());
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ shareUrl: 'https://app.tested.dev/s/1' }), {
          status: 200,
        }),
    );
    const ctx = mockGitCtx();
    ctx.git = {
      raw: async (args: string[]) => {
        if (args[0] === 'remote') return 'git@github.com:o/n.git\n';
        if (args[0] === 'config') return 'u\n';
        return '\n';
      },
      revparse: async (args: string[]) =>
        args[0] === 'HEAD' ? 'h\n' : 'feat\n',
    } as unknown as GitContext['git'];

    await executePush(
      { json: false, token: 't', pr: '1', base: 'origin/develop' },
      {
        cwd: '/repo',
        env: {},
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn: fetchFn as unknown as typeof fetch,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
        onProgress: () => {},
      },
    );

    expect(computeDiffFn).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'origin/develop' }),
    );
  });

  it('prefers GITHUB_REPOSITORY over git remote origin', async () => {
    const computeDiffFn = vi.fn(async () => makeDiff());
    let posted: IngestBody | undefined;
    const fetchFn: typeof fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body)) as IngestBody;
      return new Response(JSON.stringify({ shareUrl: 'https://app.tested.dev/s/r' }), {
        status: 200,
      });
    };
    const ctx: GitContext = {
      git: {
        raw: async (args: string[]) => {
          if (args[0] === 'remote') return 'https://github.com/attacker/evil.git\n';
          if (args[0] === 'config') return 'u\n';
          return '\n';
        },
        revparse: async (args: string[]) =>
          args[0] === 'HEAD' ? 'h\n' : 'b\n',
      } as unknown as GitContext['git'],
      repoRoot: '/repo',
    };

    const result = await executePush(
      { json: false, token: 't', pr: '4' },
      {
        cwd: '/repo',
        env: { GITHUB_REPOSITORY: 'acme/widgets' },
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
        onProgress: () => {},
      },
    );

    expect(result.exitCode).toBe(0);
    expect(posted?.repo).toEqual({
      owner: 'acme',
      name: 'widgets',
      defaultBranch: 'main',
    });
  });

  it('accepts PR number from GITHUB_PR_NUMBER env', async () => {
    const computeDiffFn = vi.fn(async () => makeDiff());
    let posted: IngestBody | undefined;
    const fetchFn: typeof fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body)) as IngestBody;
      return new Response(JSON.stringify({ shareUrl: 'https://app.tested.dev/s/e' }), {
        status: 200,
      });
    };
    const ctx: GitContext = {
      git: {
        raw: async (args: string[]) => {
          if (args[0] === 'remote') return 'git@github.com:o/n.git\n';
          if (args[0] === 'config') return 'u\n';
          return '\n';
        },
        revparse: async (args: string[]) =>
          args[0] === 'HEAD' ? 'h\n' : 'b\n',
      } as unknown as GitContext['git'],
      repoRoot: '/repo',
    };

    const result = await executePush(
      { json: false, token: 't' },
      {
        cwd: '/repo',
        env: { GITHUB_PR_NUMBER: '55' },
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
        onProgress: () => {},
      },
    );

    expect(result.exitCode).toBe(0);
    expect(posted?.pr?.number).toBe(55);
  });

  it('attaches a JUnit test report when --junit is set', async () => {
    const xml = `<?xml version="1.0"?><testsuite><testcase name="ok" time="0.1"/></testsuite>`;
    const computeDiffFn = vi.fn(async () => makeDiff());
    let posted: IngestBody | undefined;
    const fetchFn: typeof fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body)) as IngestBody;
      return new Response(JSON.stringify({ shareUrl: 'https://app.tested.dev/s/j' }), {
        status: 200,
      });
    };
    const ctx: GitContext = {
      git: {
        raw: async (args: string[]) => {
          if (args[0] === 'remote') return 'git@github.com:o/n.git\n';
          if (args[0] === 'config') return 'u\n';
          return '\n';
        },
        revparse: async (args: string[]) =>
          args[0] === 'HEAD' ? 'h\n' : 'b\n',
      } as unknown as GitContext['git'],
      repoRoot: '/repo',
    };
    const result = await executePush(
      { json: false, token: 't', pr: '1', junit: '/tmp/does-not-exist.xml' },
      {
        cwd: '/repo',
        env: {},
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
        onProgress: () => {},
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/JUnit file not found/);

    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'tested-junit-'));
    const junitPath = join(dir, 'junit.xml');
    writeFileSync(junitPath, xml);
    try {
      const ok = await executePush(
        { json: false, token: 't', pr: '1', owner: 'o', name: 'n', junit: junitPath },
        {
          cwd: dir,
          env: {},
          computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
          fetchFn,
          openRepoFn: async () => ctx,
          loadConfigFn: async () => makeConfig(),
          onProgress: () => {},
        },
      );
      expect(ok.exitCode).toBe(0);
      expect(posted?.testReport?.totals.tests).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to "coverage push" on detached HEAD and default onProgress', async () => {
    const computeDiffFn = vi.fn(async () => makeDiff());
    let posted: IngestBody | undefined;
    const fetchFn: typeof fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body)) as IngestBody;
      return new Response(JSON.stringify({ shareUrl: 'https://app.tested.dev/s/d' }), {
        status: 200,
      });
    };
    const ctx: GitContext = {
      git: {
        raw: async (args: string[]) => {
          if (args[0] === 'remote') return 'git@github.com:o/n.git\n';
          if (args[0] === 'config') throw new Error('no user.name');
          return '\n';
        },
        revparse: async (args: string[]) =>
          args[0] === 'HEAD' ? 'h\n' : 'HEAD\n',
      } as unknown as GitContext['git'],
      repoRoot: '/repo',
    };
    const result = await executePush(
      { json: false, token: 't', pr: '2', owner: 'o', name: 'n' },
      {
        cwd: '/repo',
        env: { USER: 'ci-user' },
        computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
        fetchFn,
        openRepoFn: async () => ctx,
        loadConfigFn: async () => makeConfig(),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(posted?.pr?.headRef).toBe('coverage push');
    expect(posted?.pr?.authorLogin).toBe('ci-user');
  });
});

describe('resolveJunitPath / loadTestReportFromJunit', () => {
  it('resolves TESTED_JUNIT and default candidate paths', async () => {
    const { resolveJunitPath, loadTestReportFromJunit } = await import(
      '../../src/commands/push.js'
    );
    expect(
      resolveJunitPath({
        cwd: '/repo',
        env: {},
        existsSyncFn: (() => false) as typeof import('node:fs').existsSync,
      }),
    ).toBeNull();

    expect(
      resolveJunitPath({
        cwd: '/repo',
        env: { TESTED_JUNIT: 'reports/junit.xml' },
        existsSyncFn: ((p: string) => p.endsWith('reports/junit.xml')) as typeof import('node:fs').existsSync,
      }),
    ).toBe('/repo/reports/junit.xml');

    expect(
      resolveJunitPath({
        cwd: '/repo',
        env: {},
        existsSyncFn: ((p: string) => p.endsWith('junit.xml')) as typeof import('node:fs').existsSync,
      }),
    ).toBe('/repo/junit.xml');

    expect(() =>
      resolveJunitPath({
        cwd: '/repo',
        env: { TESTED_JUNIT: '/missing.xml' },
        existsSyncFn: (() => false) as typeof import('node:fs').existsSync,
      }),
    ).toThrow(/TESTED_JUNIT file not found/);

    const xml = `<?xml version="1.0"?><testsuite><testcase name="a" time="0.2"/></testsuite>`;
    const report = loadTestReportFromJunit(
      '/x.xml',
      (() => xml) as unknown as typeof import('node:fs').readFileSync,
    );
    expect(report.totals.tests).toBe(1);
  });
});
