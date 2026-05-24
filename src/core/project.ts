import type { FileCoverage } from './istanbul.js';
import type { CoverageTotals } from './patch.js';

export interface ProjectCoverageResult {
  totals: CoverageTotals;
  byFile: Map<string, CoverageTotals>;
}

function pct(covered: number, executable: number): number {
  if (executable === 0) return 0;
  return Math.round((covered / executable) * 1000) / 10;
}

export function computeProjectCoverage(
  files: readonly FileCoverage[],
): ProjectCoverageResult {
  const byFile = new Map<string, CoverageTotals>();
  let execTotal = 0;
  let covTotal = 0;

  for (const file of files) {
    let exec = 0;
    let cov = 0;
    for (const stmt of file.statements) {
      exec += 1;
      if (stmt.hits > 0) cov += 1;
    }
    byFile.set(file.path, { executable: exec, covered: cov, pct: pct(cov, exec) });
    execTotal += exec;
    covTotal += cov;
  }

  return {
    totals: { executable: execTotal, covered: covTotal, pct: pct(covTotal, execTotal) },
    byFile,
  };
}
