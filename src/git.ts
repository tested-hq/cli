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
  return ctx.git.diff([`${base}...HEAD`]);
}
