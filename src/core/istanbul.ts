import { readFile } from 'node:fs/promises';
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

interface IstanbulStatementLoc {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface IstanbulFile {
  path: string;
  statementMap: Record<string, IstanbulStatementLoc>;
  s: Record<string, number>;
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
  const absPath = resolve(entryPath);
  const relPath = relative(root, absPath).split('\\').join('/');
  if (!relPath || relPath === '') return true;
  if (isAbsolute(relPath)) return false;
  if (relPath === '..' || relPath.startsWith('../')) return false;
  return true;
}

export async function parseIstanbul(opts: {
  path: string;
  repoRoot: string;
}): Promise<FileCoverage[]> {
  let raw: string;
  try {
    raw = await readFile(opts.path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `coverage-final.json not found at ${opts.path}. Run \`tested run\` first.`
      );
    }
    throw err;
  }
  const data = JSON.parse(raw) as Record<string, IstanbulFile>;
  const root = resolve(opts.repoRoot);
  const out: FileCoverage[] = [];
  for (const entry of Object.values(data)) {
    // Skip malicious / confused paths that escape the repository root.
    if (!isCoveragePathInsideRoot(root, entry.path)) {
      continue;
    }
    const absPath = resolve(entry.path);
    const relPath = relative(root, absPath).split('\\').join('/');
    const statements = Object.entries(entry.statementMap).map(([id, loc]) => ({
      id,
      startLine: loc.start.line,
      endLine: loc.end.line,
      hits: entry.s[id] ?? 0,
    }));
    out.push({ path: relPath, absPath, statements });
  }
  return out;
}
