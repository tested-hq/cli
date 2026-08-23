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

export async function tryRevparse(ctx: GitContext, ref: string): Promise<string | null> {
  try {
    const sha = (await ctx.git.revparse([ref])).trim();
    return sha || null;
  } catch {
    return null;
  }
}

export function missingGitRefMessage(ref: string): string {
  return `git base ref "${ref}" not found`;
}

export async function resolveBase(ctx: GitContext, base: string): Promise<string> {
  const sha = await tryRevparse(ctx, base);
  if (!sha) {
    throw new Error(missingGitRefMessage(base));
  }
  return sha;
}

export interface EffectiveBase {
  /** Ref name used in reports (requested, or the fallback). */
  ref: string;
  /** Resolved object name. */
  sha: string;
}

/**
 * Resolve the git base for a coverage diff.
 *
 * Missing refs throw a short, friendly error (not a raw git fatal).
 * When the requested base is HEAD (first repo sitting on `main`), fall back
 * to `@{upstream}` if it differs, else `HEAD~1`, so a local diff is useful.
 */
export async function resolveEffectiveBase(
  ctx: GitContext,
  requested: string,
): Promise<EffectiveBase> {
  const requestedSha = await tryRevparse(ctx, requested);
  if (!requestedSha) {
    throw new Error(missingGitRefMessage(requested));
  }
  const head = await headSha(ctx);
  if (requestedSha !== head) {
    return { ref: requested, sha: requestedSha };
  }

  const upstream = await tryRevparse(ctx, '@{upstream}');
  if (upstream && upstream !== head) {
    return { ref: '@{upstream}', sha: upstream };
  }

  const parent = await tryRevparse(ctx, 'HEAD~1');
  if (parent) {
    return { ref: 'HEAD~1', sha: parent };
  }

  return { ref: requested, sha: requestedSha };
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
