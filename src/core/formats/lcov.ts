import {
  fileCoverageFromLineHits,
  mergeLineHits,
  type FileCoverage,
} from '../coverage-model.js';

/**
 * Parse LCOV (`lcov.info` / `*.lcov`).
 *
 * Uses `SF:` (source file) + `DA:<line>,<hits>` records. Branch/function
 * records (`BRDA`, `FN`) are ignored — the gate is statement/line hits.
 */
export function parseLcov(raw: string, repoRoot: string): FileCoverage[] {
  const byFile = new Map<string, Map<number, number>>();
  let current: string | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('SF:')) {
      current = line.slice(3).trim();
      if (current && !byFile.has(current)) byFile.set(current, new Map());
      continue;
    }
    if (line === 'end_of_record') {
      current = null;
      continue;
    }
    if (!current || !line.startsWith('DA:')) continue;
    const payload = line.slice(3);
    const comma = payload.indexOf(',');
    if (comma < 0) continue;
    const lineNo = Number(payload.slice(0, comma));
    const hitsRaw = payload.slice(comma + 1).split(',')[0] ?? '0';
    const hits = Number(hitsRaw);
    mergeLineHits(byFile.get(current)!, lineNo, hits);
  }

  const out: FileCoverage[] = [];
  for (const [path, hits] of byFile) {
    const file = fileCoverageFromLineHits(repoRoot, path, hits);
    if (file) out.push(file);
  }
  return out;
}
