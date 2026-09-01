import { minimatch } from 'minimatch';

const MATCH_OPTS = { dot: true, matchBase: true } as const;

/** Repo-relative paths use `/` so globs match on every platform. */
export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function pathMatchesGlob(filePath: string, pattern: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  return (
    minimatch(normalized, pattern, MATCH_OPTS) ||
    minimatch(normalized, `**/${pattern}`, MATCH_OPTS)
  );
}

export function pathMatchesAnyGlob(filePath: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => pathMatchesGlob(filePath, p));
}

export function filterFilesByGlobs<T extends { path: string }>(
  files: readonly T[],
  patterns: readonly string[],
): T[] {
  return files.filter((f) => pathMatchesAnyGlob(f.path, patterns));
}
