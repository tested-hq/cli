import { describe, it, expect, vi } from 'vitest';
import {
  resolveToken,
  resolveApiBase,
  resolvePrNumber,
  parseGitHubRemote,
  sanitizeAuthor,
  toBranchName,
  buildIngestBody,
  postIngest,
  formatPushSuccess,
  formatPushError,
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
      }),
    ).toBe('flag-token');
  });

  it('falls back to TESTED_TOKEN then TESTED_INGEST_TOKEN', () => {
    expect(resolveToken({ env: { TESTED_TOKEN: 'a' } })).toBe('a');
    expect(resolveToken({ env: { TESTED_INGEST_TOKEN: 'b' } })).toBe('b');
    expect(
      resolveToken({ env: { TESTED_TOKEN: 'a', TESTED_INGEST_TOKEN: 'b' } }),
    ).toBe('a');
  });

  it('returns null when missing', () => {
    expect(resolveToken({ env: {} })).toBeNull();
    expect(resolveToken({ flag: '', env: {} })).toBeNull();
  });
});

describe('resolveApiBase', () => {
  it('defaults to app.tested.dev', () => {
    expect(resolveApiBase({ env: {} })).toBe(DEFAULT_API_BASE);
  });

  it('prefers flag, then TESTED_API_URL, strips trailing slash', () => {
    expect(
      resolveApiBase({
        flag: 'https://example.com/',
        env: { TESTED_API_URL: 'https://env.example/' },
      }),
    ).toBe('https://example.com');
    expect(resolveApiBase({ env: { TESTED_API_URL: 'https://env.example/' } })).toBe(
      'https://env.example',
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
    expect(
      formatPushSuccess({ shareUrl: 'https://app.tested.dev/s/x' }, false).stdout,
    ).toBe('https://app.tested.dev/s/x\n');
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

  it('formats HTTP errors with status', () => {
    expect(formatPushError(403, 'forbidden')).toBe(
      'error: ingest failed (403): forbidden\n',
    );
    expect(formatPushError(0, 'network error: boom')).toBe(
      'error: network error: boom\n',
    );
  });
});

describe('executePush', () => {
  it('errors clearly when token is missing', async () => {
    const result = await executePush(
      { json: false, pr: '1' },
      { cwd: '/repo', env: {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/missing ingest token/i);
    expect(result.stderr).toMatch(/TESTED_TOKEN/);
  });

  it('errors clearly when PR number is missing', async () => {
    const result = await executePush(
      { json: false, token: 't' },
      { cwd: '/repo', env: {} },
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
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('https://app.tested.dev/s/xyz\n');
    expect(result.shareUrl).toBe('https://app.tested.dev/s/xyz');
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
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('error: ingest failed (429): quota exceeded\n');
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
      },
    );

    expect(computeDiffFn).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'origin/develop' }),
    );
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
      },
    );

    expect(result.exitCode).toBe(0);
    expect(posted?.pr.number).toBe(55);
  });
});
