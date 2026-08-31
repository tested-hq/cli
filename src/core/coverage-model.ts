import { isAbsolute, relative, resolve } from 'node:path';

export interface StatementCoverage {
  id: string;
  startLine: number;
  endLine: number;
  hits: number;
}

export interface FileCoverage {
  path: string;
  absPath: string;
  statements: StatementCoverage[];
}

/**
 * Resolve a coverage-entry path against the repository root.
 * Relative paths are rooted at repoRoot (not process.cwd()).
 */
export function resolveCoverageEntryPath(
  repoRoot: string,
  entryPath: string,
): string {
  const cleaned = entryPath.trim().replace(/\\/g, '/');
  if (cleaned.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(cleaned).pathname);
    } catch {
      return resolve(repoRoot, cleaned.replace(/^file:\/\//, ''));
    }
  }
  return isAbsolute(cleaned) ? resolve(cleaned) : resolve(repoRoot, cleaned);
}

/**
 * True when a resolved coverage entry path is inside repoRoot.
 * Rejects `../` escapes and absolute paths that land outside the root.
 */
export function isCoveragePathInsideRoot(
  repoRoot: string,
  entryPath: string,
): boolean {
  const root = resolve(repoRoot);
  let absPath: string;
  try {
    absPath = resolveCoverageEntryPath(root, entryPath);
  } catch {
    return false;
  }
  const relPath = relative(root, absPath).split('\\').join('/');
  if (!relPath || relPath === '') return true;
  if (isAbsolute(relPath)) return false;
  if (relPath === '..' || relPath.startsWith('../')) return false;
  return true;
}

export function toFileCoverage(
  repoRoot: string,
  entryPath: string,
  statements: StatementCoverage[],
): FileCoverage | null {
  if (!isCoveragePathInsideRoot(repoRoot, entryPath)) return null;
  const absPath = resolveCoverageEntryPath(repoRoot, entryPath);
  const relPath = relative(resolve(repoRoot), absPath).split('\\').join('/');
  return { path: relPath, absPath, statements };
}

/** One statement per executable line (lcov / Cobertura / JaCoCo / gcov / SimpleCov). */
export function statementsFromLineHits(
  lineHits: Iterable<readonly [line: number, hits: number]>,
): StatementCoverage[] {
  return [...lineHits]
    .filter(([line]) => Number.isInteger(line) && line > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([line, hits]) => ({
      id: String(line),
      startLine: line,
      endLine: line,
      hits: Number.isFinite(hits) && hits > 0 ? hits : 0,
    }));
}

export function mergeLineHits(
  into: Map<number, number>,
  line: number,
  hits: number,
): void {
  if (!Number.isInteger(line) || line <= 0) return;
  const n = Number.isFinite(hits) && hits > 0 ? hits : 0;
  into.set(line, (into.get(line) ?? 0) + n);
}

export function fileCoverageFromLineHits(
  repoRoot: string,
  entryPath: string,
  lineHits: Map<number, number>,
): FileCoverage | null {
  return toFileCoverage(repoRoot, entryPath, statementsFromLineHits(lineHits));
}
