import type {
  FlagMetricJson,
  PathResultJson,
  PathsJson,
  PathThreshold,
  TestedConfig,
} from '../schemas.js';
import { filterFilesByGlobs } from './globs.js';
import type { FileCoverage } from './istanbul.js';
import {
  computePatchCoverage,
  EMPTY_PATCH_REASON,
  isEmptyPatch,
  type CoverageTotals,
} from './patch.js';
import { computeProjectCoverage } from './project.js';

/** A glob that matched no coverage files this run — never 0%. */
export const MISSING_PATH_REASON = 'no coverage files matched this path glob in this run';

export type PathStatus = 'pass' | 'fail' | 'missing';

export interface PathMetricResult {
  pct?: number;
  threshold: number;
  pass?: boolean;
  executable?: number;
  covered?: number;
  skipped?: true;
  reason?: string;
}

export interface PathCheckResult {
  glob: string;
  present: boolean;
  status: PathStatus;
  reason?: string;
  patch: PathMetricResult;
  project: PathMetricResult;
}

export interface EvaluatePathThresholdsInput {
  config: TestedConfig;
  files: readonly FileCoverage[];
  addedByFile: ReadonlyMap<string, ReadonlySet<number>>;
}

export function resolvePathThresholds(
  entry: PathThreshold,
  global: { patch: number; project: number },
): { patch: number; project: number } {
  return {
    patch: entry.patch ?? global.patch,
    project: entry.project ?? global.project,
  };
}

function totalsToMetric(
  totals: CoverageTotals,
  threshold: number,
  kind: 'patch' | 'project',
): PathMetricResult {
  const empty = isEmptyPatch(totals);
  if (kind === 'patch' && empty) {
    return {
      pct: totals.pct,
      threshold,
      pass: true,
      executable: totals.executable,
      covered: totals.covered,
      skipped: true,
      reason: EMPTY_PATCH_REASON,
    };
  }
  const pass = totals.pct >= threshold;
  return {
    pct: totals.pct,
    threshold,
    pass,
    executable: totals.executable,
    covered: totals.covered,
  };
}

function missingMetric(threshold: number, reason: string): PathMetricResult {
  return {
    threshold,
    skipped: true,
    reason,
  };
}

function evaluatePresentPath(
  glob: string,
  files: readonly FileCoverage[],
  addedByFile: ReadonlyMap<string, ReadonlySet<number>>,
  thresholds: { patch: number; project: number },
): PathCheckResult {
  const patch = computePatchCoverage(files, addedByFile);
  const project = computeProjectCoverage(files);
  const patchMetric = totalsToMetric(patch.totals, thresholds.patch, 'patch');
  const projectMetric = totalsToMetric(project.totals, thresholds.project, 'project');
  const status: PathStatus = patchMetric.pass && projectMetric.pass ? 'pass' : 'fail';
  return {
    glob,
    present: true,
    status,
    patch: patchMetric,
    project: projectMetric,
  };
}

function missingPath(
  glob: string,
  thresholds: { patch: number; project: number },
  reason: string,
): PathCheckResult {
  return {
    glob,
    present: false,
    status: 'missing',
    reason,
    patch: missingMetric(thresholds.patch, reason),
    project: missingMetric(thresholds.project, reason),
  };
}

/**
 * Grade each configured path glob from this run's coverage files.
 *
 * Globs that match no files are `missing` (skipped — not a 0% fail).
 */
export function evaluatePathThresholds(input: EvaluatePathThresholdsInput): PathCheckResult[] {
  const global = input.config.thresholds;
  const entries = global?.paths;
  if (!global || !entries || entries.length === 0) return [];

  return entries.map((entry) => {
    const thresholds = resolvePathThresholds(entry, global);
    const matched = filterFilesByGlobs(input.files, [entry.glob]);
    if (matched.length === 0) {
      return missingPath(entry.glob, thresholds, MISSING_PATH_REASON);
    }
    return evaluatePresentPath(entry.glob, matched, input.addedByFile, thresholds);
  });
}

/** Present path floors must pass. Missing/skipped globs do not fail the gate. */
export function pathThresholdsPass(results: readonly PathCheckResult[]): boolean {
  return results.every((p) => p.status !== 'fail');
}

export function pathThresholdsToJson(results: readonly PathCheckResult[]): PathsJson {
  return results.map((path) => ({
    glob: path.glob,
    status: path.status,
    present: path.present,
    ...(path.status === 'missing' ? { skipped: true as const } : {}),
    ...(path.reason ? { reason: path.reason } : {}),
    patch: metricToJson(path.patch),
    project: metricToJson(path.project),
  }));
}

function metricToJson(metric: PathMetricResult): FlagMetricJson {
  if (metric.skipped) {
    return {
      threshold: metric.threshold,
      skipped: true,
      ...(metric.reason ? { reason: metric.reason } : {}),
    };
  }
  return {
    pct: metric.pct ?? 0,
    threshold: metric.threshold,
    pass: metric.pass ?? false,
    executable: metric.executable ?? 0,
    covered: metric.covered ?? 0,
    ...(metric.reason ? { reason: metric.reason } : {}),
  };
}

export function resolvePathThresholdsJson(
  input: EvaluatePathThresholdsInput,
): PathsJson | undefined {
  const results = evaluatePathThresholds(input);
  return results.length > 0 ? pathThresholdsToJson(results) : undefined;
}
