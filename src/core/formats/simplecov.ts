import {
  fileCoverageFromLineHits,
  mergeLineHits,
  type FileCoverage,
} from '../coverage-model.js';

/**
 * Parse SimpleCov JSON (Ruby).
 *
 * Accepts:
 * - `coverage/.resultset.json` (default SimpleCov) — suites with a `coverage`
 *   map of filename → `{ lines: (number|null)[] }` or a bare hits array
 * - `simplecov-json` gem `coverage.json` — `{ files: [{ filename, coverage }] }`
 *
 * `null` entries are non-executable. Array index 0 is line 1.
 * Hits from multiple suites for the same file are summed.
 */
export function parseSimpleCov(raw: string, repoRoot: string): FileCoverage[] {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('SimpleCov coverage file is not valid JSON');
  }
  const byFile = new Map<string, Map<number, number>>();

  if (isSimpleCovJsonGem(data)) {
    for (const file of data.files) {
      const filename = typeof file.filename === 'string' ? file.filename : '';
      if (!filename) continue;
      addCoverageArray(byFile, filename, file.coverage);
    }
  } else if (isSimpleCovResultset(data)) {
    for (const suite of Object.values(data)) {
      if (!suite || typeof suite !== 'object') continue;
      const coverage = (suite as { coverage?: unknown }).coverage;
      if (!coverage || typeof coverage !== 'object') continue;
      for (const [filename, entry] of Object.entries(
        coverage as Record<string, unknown>,
      )) {
        addCoverageArray(byFile, filename, linesFromResultsetEntry(entry));
      }
    }
  } else {
    throw new Error(
      'Not a SimpleCov resultset or simplecov-json report. Expected coverage/.resultset.json',
    );
  }

  const out: FileCoverage[] = [];
  for (const [path, hits] of byFile) {
    const file = fileCoverageFromLineHits(repoRoot, path, hits);
    if (file) out.push(file);
  }
  return out;
}

export function isSimpleCovJsonGem(
  data: unknown,
): data is { files: Array<{ filename?: string; coverage?: unknown }> } {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { files?: unknown }).files) &&
    (data as { files: unknown[] }).files.some(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as { filename?: unknown }).filename === 'string',
    )
  );
}

export function isSimpleCovResultset(
  data: unknown,
): data is Record<string, { coverage?: unknown }> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  if (isSimpleCovJsonGem(data)) return false;
  return Object.values(data).some((suite) => {
    if (typeof suite !== 'object' || suite === null) return false;
    const coverage = (suite as { coverage?: unknown }).coverage;
    return typeof coverage === 'object' && coverage !== null;
  });
}

function linesFromResultsetEntry(entry: unknown): unknown {
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === 'object' && 'lines' in entry) {
    return (entry as { lines: unknown }).lines;
  }
  return undefined;
}

function addCoverageArray(
  byFile: Map<string, Map<number, number>>,
  filename: string,
  coverage: unknown,
): void {
  if (!Array.isArray(coverage)) return;
  let hits = byFile.get(filename);
  if (!hits) {
    hits = new Map();
    byFile.set(filename, hits);
  }
  coverage.forEach((cell, idx) => {
    if (cell === null || cell === undefined) return;
    const n = typeof cell === 'number' ? cell : Number(cell);
    if (!Number.isFinite(n)) return;
    mergeLineHits(hits!, idx + 1, n);
  });
}
