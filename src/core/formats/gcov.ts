import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fileCoverageFromLineHits,
  mergeLineHits,
  statementsFromLineHits,
  type FileCoverage,
} from '../coverage-model.js';

/**
 * Parse GNU gcov text reports (`*.gcov`).
 *
 * CI artifact shape: the text files `gcov` writes from `.gcda`/`.gcno`
 * (not the binary notes themselves). Point `coverage.path` at one `.gcov`
 * file or a directory of them:
 *
 * ```
 * gcov -p *.gcda
 * # → src#auth.c.gcov  (or auth.c.gcov)
 * ```
 *
 * Line records: `<count>:<lineno>:<source>`. `#####` / `=====` are 0 hits;
 * `-` is non-executable. `Source:` on line 0 names the file.
 */
export function parseGcov(raw: string, repoRoot: string): FileCoverage[] {
  const byFile = new Map<string, Map<number, number>>();
  let current: string | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const parsed = parseGcovLine(rawLine);
    if (!parsed) continue;
    if (parsed.lineNo === 0) {
      const source = sourceFromMeta(parsed.source);
      if (source) {
        current = source;
        if (!byFile.has(current)) byFile.set(current, new Map());
      }
      continue;
    }
    if (parsed.hits === null) continue;
    if (!current) continue;
    mergeLineHits(byFile.get(current)!, parsed.lineNo, parsed.hits);
  }

  const out: FileCoverage[] = [];
  for (const [path, hits] of byFile) {
    const file = fileCoverageFromLineHits(repoRoot, path, hits);
    if (file) out.push(file);
  }
  return out;
}

export async function parseGcovPath(opts: {
  path: string;
  repoRoot: string;
}): Promise<FileCoverage[]> {
  const info = await stat(opts.path);
  if (info.isDirectory()) {
    const names = (await readdir(opts.path))
      .filter((n) => n.endsWith('.gcov'))
      .sort();
    if (names.length === 0) {
      throw new Error(
        `no .gcov files in ${opts.path}. Run \`gcov\` on your .gcda files ` +
          `(binary .gcno/.gcda notes are not parsed).`,
      );
    }
    const byPath = new Map<string, Map<number, number>>();
    const absByPath = new Map<string, string>();
    for (const name of names) {
      const filePath = join(opts.path, name);
      const raw = await readFile(filePath, 'utf8');
      for (const file of parseGcov(raw, opts.repoRoot)) {
        let hits = byPath.get(file.path);
        if (!hits) {
          hits = new Map();
          byPath.set(file.path, hits);
          absByPath.set(file.path, file.absPath);
        }
        for (const s of file.statements) {
          mergeLineHits(hits, s.startLine, s.hits);
        }
      }
    }
    return [...byPath.entries()].map(([path, hits]) => ({
      path,
      absPath: absByPath.get(path)!,
      statements: statementsFromLineHits(hits),
    }));
  }
  const raw = await readFile(opts.path, 'utf8');
  return parseGcov(raw, opts.repoRoot);
}

function parseGcovLine(
  rawLine: string,
): { hits: number | null; lineNo: number; source: string } | null {
  // count:lineno:source — count may contain spaces, #####, =====, or a trailing *
  const first = rawLine.indexOf(':');
  if (first < 0) return null;
  const second = rawLine.indexOf(':', first + 1);
  if (second < 0) return null;
  const countField = rawLine.slice(0, first).trim();
  const lineNo = Number(rawLine.slice(first + 1, second).trim());
  if (!Number.isInteger(lineNo)) return null;
  const source = rawLine.slice(second + 1);
  if (countField === '-' || countField === '') {
    return { hits: null, lineNo, source };
  }
  if (
    countField.startsWith('#') ||
    countField.startsWith('=')
  ) {
    return { hits: 0, lineNo, source };
  }
  const hits = Number.parseInt(countField.replace(/\*+$/, ''), 10);
  if (!Number.isFinite(hits)) return { hits: 0, lineNo, source };
  return { hits, lineNo, source };
}

function sourceFromMeta(source: string): string | null {
  const trimmed = source.trim();
  const m = trimmed.match(/^Source:(.*)$/);
  if (!m) return null;
  const path = (m[1] ?? '').trim();
  return path || null;
}

