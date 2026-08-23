import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import {
  currentBranch,
  gitUserName,
  headSha,
  missingGitRefMessage,
  openRepo,
  remoteUrl,
  resolveBase,
  resolveEffectiveBase,
  unifiedDiff,
} from '../src/git.js';

let repo: string;

async function initRepo(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-git-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Ada Lovelace');
  const root = (await git.revparse(['--show-toplevel'])).trim();
  await writeFile(join(root, 'readme.md'), 'hello\n');
  await git.add('.');
  await git.commit('init', { '--no-verify': null });
  // example.invalid avoids CI url.*.insteadOf rewrites aimed at github.com
  await git.addRemote('origin', 'https://example.invalid/acme/demo.git');
  return root;
}

repo = await initRepo();

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('git helpers', () => {
  it('openRepo resolves the toplevel and talks to the same repo', async () => {
    const ctx = await openRepo(join(repo, '.'));
    expect(ctx.repoRoot).toBe(repo);
    const sha = await headSha(ctx);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const base = await resolveBase(ctx, 'main');
    expect(base).toBe(sha);
  });

  it('uses three-dot diff when merge-base exists', async () => {
    const calls: string[][] = [];
    const ctx = {
      git: {
        raw: async () => 'aabbcc\n',
        diff: async (args: string[]) => {
          calls.push(args);
          return '';
        },
      } as never,
      repoRoot: repo,
    };
    await unifiedDiff(ctx, 'aabbcc');
    expect(calls).toEqual([['aabbcc...HEAD']]);
  });

  it('falls back to two-dot diff when merge-base is missing', async () => {
    const calls: string[][] = [];
    const ctx = {
      git: {
        raw: async () => {
          throw new Error('no merge base');
        },
        diff: async (args: string[]) => {
          calls.push(args);
          return 'diff --git a/x b/x\n';
        },
      } as never,
      repoRoot: repo,
    };
    const diff = await unifiedDiff(ctx, 'deadbeef');
    expect(diff).toContain('diff --git');
    expect(calls).toEqual([['deadbeef', 'HEAD']]);
  });

  it('unifiedDiff is empty when base is HEAD (no commits since)', async () => {
    const ctx = await openRepo(repo);
    const sha = await headSha(ctx);
    const diff = await unifiedDiff(ctx, sha);
    expect(diff).toBe('');
  });

  it('remoteUrl reads origin (and a named remote)', async () => {
    const ctx = await openRepo(repo);
    const url = await remoteUrl(ctx);
    expect(url).toMatch(/example\.invalid\/acme\/demo\.git$/);
    expect(await remoteUrl(ctx, 'origin')).toBe(url);
  });

  it('currentBranch returns the branch name on a named HEAD', async () => {
    const ctx = await openRepo(repo);
    expect(await currentBranch(ctx)).toBe('main');
  });

  it('currentBranch returns empty string on detached HEAD', async () => {
    const git = simpleGit({ baseDir: repo });
    const sha = (await git.revparse(['HEAD'])).trim();
    await git.checkout([sha]);
    try {
      const ctx = await openRepo(repo);
      expect(await currentBranch(ctx)).toBe('');
    } finally {
      await git.checkout(['main']);
    }
  });

  it('currentBranch returns empty string when rev-parse fails', async () => {
    const ctx = {
      git: {
        revparse: async () => {
          throw new Error('not a git repo');
        },
      } as never,
      repoRoot: repo,
    };
    expect(await currentBranch(ctx)).toBe('');
  });

  it('gitUserName reads user.name', async () => {
    const ctx = await openRepo(repo);
    expect(await gitUserName(ctx)).toBe('Ada Lovelace');
  });

  it('gitUserName returns null when user.name is empty', async () => {
    const ctx = {
      git: {
        raw: async () => '   \n',
      } as never,
      repoRoot: repo,
    };
    expect(await gitUserName(ctx)).toBeNull();
  });

  it('resolveBase throws a friendly error when the ref is missing', async () => {
    const ctx = await openRepo(repo);
    await expect(resolveBase(ctx, 'origin/main')).rejects.toThrow(
      missingGitRefMessage('origin/main'),
    );
  });

  it('gitUserName returns null when config throws', async () => {
    const ctx = {
      git: {
        raw: async () => {
          throw new Error('config unset');
        },
      } as never,
      repoRoot: repo,
    };
    expect(await gitUserName(ctx)).toBeNull();
  });
});
