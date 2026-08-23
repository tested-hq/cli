import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import {
  headSha,
  missingGitRefMessage,
  openRepo,
  resolveEffectiveBase,
} from '../src/git.js';

async function initTwoCommitMain(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'tested-effective-base-'));
  const git = simpleGit({ baseDir: tempDir });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');
  const root = (await git.revparse(['--show-toplevel'])).trim();
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  await git.add('.');
  await git.commit('init', { '--no-verify': null });
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await git.add('.');
  await git.commit('add b', { '--no-verify': null });
  return root;
}

const repo = await initTwoCommitMain();

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('resolveEffectiveBase', () => {
  it('falls back to HEAD~1 when HEAD is the configured base branch', async () => {
    const ctx = await openRepo(repo);
    const head = await headSha(ctx);
    const parent = (await ctx.git.revparse(['HEAD~1'])).trim();
    const effective = await resolveEffectiveBase(ctx, 'main');
    expect(effective.ref).toBe('HEAD~1');
    expect(effective.sha).toBe(parent);
    expect(effective.sha).not.toBe(head);
  });

  it('keeps a requested base that is not HEAD', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tested-feature-base-'));
    const git = simpleGit({ baseDir: tempDir });
    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 'test@tested.dev');
    await git.addConfig('user.name', 'Test');
    const root = (await git.revparse(['--show-toplevel'])).trim();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
    await git.add('.');
    await git.commit('init', { '--no-verify': null });
    const mainSha = (await git.revparse(['HEAD'])).trim();
    await git.checkoutLocalBranch('feature');
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
    await git.add('.');
    await git.commit('add b', { '--no-verify': null });
    try {
      const ctx = await openRepo(root);
      const effective = await resolveEffectiveBase(ctx, 'main');
      expect(effective.ref).toBe('main');
      expect(effective.sha).toBe(mainSha);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws a friendly error when origin/main is missing', async () => {
    const ctx = await openRepo(repo);
    await expect(resolveEffectiveBase(ctx, 'origin/main')).rejects.toThrow(
      missingGitRefMessage('origin/main'),
    );
  });

  it('prefers @{upstream} when it differs from HEAD', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tested-upstream-base-'));
    const git = simpleGit({ baseDir: tempDir });
    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 'test@tested.dev');
    await git.addConfig('user.name', 'Test');
    const root = (await git.revparse(['--show-toplevel'])).trim();
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
    await git.add('.');
    await git.commit('init', { '--no-verify': null });
    const remoteDir = await mkdtemp(join(tmpdir(), 'tested-upstream-remote-'));
    const remoteGit = simpleGit({ baseDir: remoteDir });
    await remoteGit.init(['-b', 'main', '--bare']);
    await git.addRemote('origin', remoteDir);
    await git.push(['-u', 'origin', 'main']);
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
    await git.add('.');
    await git.commit('local ahead', { '--no-verify': null });
    try {
      const ctx = await openRepo(root);
      const upstream = (await git.revparse(['@{upstream}'])).trim();
      const head = await headSha(ctx);
      const effective = await resolveEffectiveBase(ctx, 'main');
      expect(effective.ref).toBe('@{upstream}');
      expect(effective.sha).toBe(upstream);
      expect(effective.sha).not.toBe(head);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(remoteDir, { recursive: true, force: true });
    }
  });
});
