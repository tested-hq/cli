import { simpleGit, type SimpleGit } from 'simple-git';

export interface GitContext {
  git: SimpleGit;
  repoRoot: string;
}

export async function openRepo(cwd: string): Promise<GitContext> {
  const git = simpleGit({ baseDir: cwd });
  const repoRoot = (await git.revparse(['--show-toplevel'])).trim();
  return { git, repoRoot };
}

export async function resolveBase(ctx: GitContext, base: string): Promise<string> {
  return (await ctx.git.revparse([base])).trim();
}

export async function headSha(ctx: GitContext): Promise<string> {
  return (await ctx.git.revparse(['HEAD'])).trim();
}

export async function unifiedDiff(ctx: GitContext, base: string): Promise<string> {
  try {
    const mergeBase = (await ctx.git.raw(['merge-base', base, 'HEAD'])).trim();
    if (mergeBase) {
      return ctx.git.diff([`${base}...HEAD`]);
    }
  } catch {
    // Shallow clone: base SHA fetched without shared history (no merge-base).
  }
  return ctx.git.diff([base, 'HEAD']);
}

export async function remoteUrl(ctx: GitContext, remote = 'origin'): Promise<string> {
  return (await ctx.git.raw(['remote', 'get-url', remote])).trim();
}

/** Current branch name, or empty string when detached HEAD. */
export async function currentBranch(ctx: GitContext): Promise<string> {
  try {
    const name = (await ctx.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    return name === 'HEAD' ? '' : name;
  } catch {
    return '';
  }
}

export async function gitUserName(ctx: GitContext): Promise<string | null> {
  try {
    const name = (await ctx.git.raw(['config', 'user.name'])).trim();
    return name || null;
  } catch {
    return null;
  }
}
