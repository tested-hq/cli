import type { FileCoverage } from './istanbul.js';

export interface CoverageTotals {
  executable: number;
  covered: number;
  pct: number;
  /** Present when executable === 0 — not a 0% coverage result. */
  empty?: true;
}

/** Shared copy for humans and agents when the patch has nothing to cover. */
export const EMPTY_PATCH_REASON = 'no executable lines in the patch';

export function isEmptyPatch(totals: Pick<CoverageTotals, 'executable'>): boolean {
  return totals.executable === 0;
}

export interface PatchCoverageResult {
  totals: CoverageTotals;
  byFile: Map<string, CoverageTotals>;
}

function pct(covered: number, executable: number): number {
  if (executable === 0) return 0;
  return Math.round((covered / executable) * 1000) / 10;
}

export function computePatchCoverage(
  files: readonly FileCoverage[],
  addedByFile: ReadonlyMap<string, ReadonlySet<number>>,
): PatchCoverageResult {
  const byFile = new Map<string, CoverageTotals>();
  let execTotal = 0;
  let covTotal = 0;

  for (const file of files) {
    const added = addedByFile.get(file.path);
    if (!added || added.size === 0) continue;

    let exec = 0;
    let cov = 0;
    for (const stmt of file.statements) {
      const touched = lineRangeOverlaps(stmt.startLine, stmt.endLine, added);
      if (!touched) continue;
      exec += 1;
      if (stmt.hits > 0) cov += 1;
    }
    if (exec === 0) continue;
    byFile.set(file.path, { executable: exec, covered: cov, pct: pct(cov, exec) });
    execTotal += exec;
    covTotal += cov;
  }

  return {
    totals: { executable: execTotal, covered: covTotal, pct: pct(covTotal, execTotal) },
    byFile,
  };
}

function lineRangeOverlaps(
  start: number,
  end: number,
  added: ReadonlySet<number>,
): boolean {
  for (let line = start; line <= end; line += 1) {
    if (added.has(line)) return true;
  }
  return false;
}
