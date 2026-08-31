import { readFile } from 'node:fs/promises';
import {
  isCoveragePathInsideRoot,
  toFileCoverage,
  type FileCoverage,
  type StatementCoverage,
} from './coverage-model.js';

export type { FileCoverage, StatementCoverage };
export { isCoveragePathInsideRoot };

interface IstanbulStatementLoc {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface IstanbulFile {
  path: string;
  statementMap: Record<string, IstanbulStatementLoc>;
  s: Record<string, number>;
}

export function parseIstanbulString(
  raw: string,
  repoRoot: string,
  pathForError?: string,
): FileCoverage[] {
  let data: Record<string, IstanbulFile>;
  try {
    data = JSON.parse(raw) as Record<string, IstanbulFile>;
  } catch {
    throw new Error(
      `Istanbul/V8 JSON is not valid JSON${pathForError ? ` (${pathForError})` : ''}`,
    );
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Istanbul/V8 JSON must be an object of file entries');
  }
  const out: FileCoverage[] = [];
  for (const entry of Object.values(data)) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') {
      continue;
    }
    if (!entry.statementMap || typeof entry.statementMap !== 'object') {
      continue;
    }
    const statements: StatementCoverage[] = Object.entries(
      entry.statementMap,
    ).map(([id, loc]) => ({
      id,
      startLine: loc.start.line,
      endLine: loc.end.line,
      hits: entry.s?.[id] ?? 0,
    }));
    const file = toFileCoverage(repoRoot, entry.path, statements);
    if (file) out.push(file);
  }
  return out;
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
        `coverage-final.json not found at ${opts.path}. Run \`tested run\` first.`,
      );
    }
    throw err;
  }
  return parseIstanbulString(raw, opts.repoRoot, opts.path);
}
