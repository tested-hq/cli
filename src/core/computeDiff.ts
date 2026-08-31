import { resolve } from 'node:path';
import type { TestedConfig, DiffOutput } from '../schemas.js';
import {
  openRepo,
  resolveEffectiveBase,
  headSha,
  unifiedDiff,
  type GitContext,
} from '../git.js';
import { assertSafeGitRef } from '../git-ref.js';
import { parseCoverage } from './coverage.js';
import { parseUnifiedDiff } from './diff.js';
import { splitByIgnore } from './ignores.js';
import { assertWithinRoot } from './assert-within-root.js';
import { parseAndMergeCoverage, resolveCoveragePaths } from './coverage-paths.js';
import { buildDiffOutput } from '../output/json.js';

export interface ComputeDiffOpts {
  cwd: string;
  config: TestedConfig;
  /** Override the base ref from config. */
  baseRef?: string;
  /** Optional baseline coverage path for project-delta computation. */
  withBaseCoverage?: string;
  /**
   * Override `coverage.path` (repeatable `--file` / Action `files`).
   * Multiple paths are parsed then merged (union + max hits).
   */
  coveragePaths?: string[];
  /**
   * Optional pre-opened repo. Tests may pass this; production callers usually
   * let computeDiff open the repo itself.
   */
  ctx?: GitContext;
}

/**
 * Compute the schema-v1 DiffOutput that backs `tested diff --json`.
 *
 * Extracted so `tested check` can consume the same logic without re-parsing
 * stdout. Keep this pure-ish: no process.exit, no stdout writes.
 */
export async function computeDiff(opts: ComputeDiffOpts): Promise<DiffOutput> {
  const { cwd, config } = opts;
  const ctx = opts.ctx ?? (await openRepo(cwd));
  const requested = assertSafeGitRef(opts.baseRef ?? config.base);
  const { ref: baseRef, sha: base } = await resolveEffectiveBase(ctx, requested);
  const head = await headSha(ctx);
  const diffText = await unifiedDiff(ctx, base);
  const addedByFile = parseUnifiedDiff(diffText);

  const coveragePaths = resolveCoveragePaths({
    ...(opts.coveragePaths ? { files: opts.coveragePaths } : {}),
    configPath: config.coverage.path,
  });
  const allFiles = await parseAndMergeCoverage({
    paths: coveragePaths,
    cwd,
    repoRoot: ctx.repoRoot,
    ...(config.coverage.format ? { format: config.coverage.format } : {}),
  });
  const { kept, ignored } = splitByIgnore(
    allFiles.map((f) => f.path),
    config.ignores,
  );
  const keptSet = new Set(kept);
  const files = allFiles.filter((f) => keptSet.has(f.path));

  let projectDelta: number | null = null;
  if (opts.withBaseCoverage) {
    const baseCoveragePath = resolve(cwd, opts.withBaseCoverage);
    assertWithinRoot(ctx.repoRoot, baseCoveragePath);
    const baseFiles = await parseCoverage({
      path: baseCoveragePath,
      repoRoot: ctx.repoRoot,
      ...(config.coverage.format ? { format: config.coverage.format } : {}),
    });
    const baseKept = baseFiles.filter((f) => !ignored.includes(f.path));
    const baseExec = baseKept.reduce((n, f) => n + f.statements.length, 0);
    const baseCov = baseKept.reduce(
      (n, f) => n + f.statements.filter((s) => s.hits > 0).length,
      0,
    );
    const basePct = baseExec === 0 ? 0 : Math.round((baseCov / baseExec) * 1000) / 10;
    const headPct = (() => {
      const exec = files.reduce((n, f) => n + f.statements.length, 0);
      const cov = files.reduce(
        (n, f) => n + f.statements.filter((s) => s.hits > 0).length,
        0,
      );
      return exec === 0 ? 0 : Math.round((cov / exec) * 1000) / 10;
    })();
    projectDelta = Math.round((headPct - basePct) * 10) / 10;
  }

  return buildDiffOutput({
    base: baseRef,
    head,
    files,
    addedByFile,
    ignored,
    projectDelta,
  });
}
